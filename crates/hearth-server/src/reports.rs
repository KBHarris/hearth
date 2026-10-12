//! Opaque, recipient-device-bound report queue. No evidence plaintext is accepted.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::{governance::MODERATE, reports::*};
use sqlx::Row;
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
async fn auth(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let account = account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    Ok(account)
}
async fn approved(
    state: &SharedState,
    member: &hearth_proto::messaging::GroupMember,
) -> Result<()> {
    crate::delivery::approved(state, &member.account_id, &member.enrollment.device_key).await?;
    let identity: Option<String> =
        sqlx::query_scalar("SELECT identity_key FROM accounts WHERE id=$1")
            .bind(&member.account_id)
            .fetch_one(&state.db)
            .await
            .map_err(unavailable)?;
    if identity.as_deref() != Some(&member.enrollment.identity_key) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
async fn access(
    tx: &mut sqlx::PgConnection,
    channel: &str,
    account: &str,
    moderator: bool,
) -> Result<crate::community::ChannelAccess> {
    let access = crate::community::channel_access(tx, channel, account)
        .await?
        .ok_or(StatusCode::NOT_FOUND)?;
    if moderator
        && crate::governance::bits(
            tx,
            &access.community_id,
            &access.owner_id,
            account,
            Some(channel),
            access.governance.as_ref(),
        )
        .await?
            & MODERATE
            == 0
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(access)
}
pub(crate) async fn register(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(channel): Path<String>,
    Json(key): Json<ReportKey>,
) -> Result<StatusCode> {
    let account = auth(&state, &headers).await?;
    if key.member.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    hearth_crypto::messaging::reports::verify_report_key(&state.server_key.public().to_hex(), &key)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    approved(&state, &key.member).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let a = access(&mut tx, &channel, &account, true).await?;
    if a.community_id != key.community_id {
        return Err(StatusCode::BAD_REQUEST);
    }
    let identity: Option<String> = sqlx::query_scalar(
        "SELECT value->>'public_key' FROM moderation_keys WHERE community_id=$1 AND device_key=$2",
    )
    .bind(&a.community_id)
    .bind(&key.member.enrollment.device_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?
    .flatten();
    if identity
        .as_deref()
        .is_some_and(|value| value != key.public_key)
    {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("INSERT INTO moderation_keys(community_id,account_id,device_key,value) VALUES($1,$2,$3,$4) ON CONFLICT(community_id,device_key) DO UPDATE SET value=EXCLUDED.value").bind(&a.community_id).bind(&account).bind(&key.member.enrollment.device_key).bind(serde_json::to_value(&key).map_err(|_|StatusCode::BAD_REQUEST)?).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn keys(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(channel): Path<String>,
) -> Result<Json<Vec<ReportKey>>> {
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let a = access(&mut tx, &channel, &account, false).await?;
    let rows=sqlx::query("SELECT account_id,device_key,value FROM moderation_keys WHERE community_id=$1 ORDER BY device_key LIMIT 128").bind(&a.community_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
    let mut keys = Vec::new();
    for row in rows {
        let key: ReportKey = serde_json::from_value(row.get("value"))
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        match access(&mut tx, &channel, row.get("account_id"), true).await {
            Ok(_) => {}
            Err(StatusCode::FORBIDDEN) => continue,
            Err(error) => return Err(error),
        }
        match approved(&state, &key.member).await {
            Ok(_) => keys.push(key),
            Err(StatusCode::FORBIDDEN) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(Json(keys))
}
pub(crate) async fn submit(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(channel): Path<String>,
    Json(envelope): Json<ReportEnvelope>,
) -> Result<StatusCode> {
    let account = auth(&state, &headers).await?;
    if envelope.reporter.account_id != account || envelope.channel_id != channel {
        return Err(StatusCode::FORBIDDEN);
    }
    hearth_crypto::messaging::reports::verify_envelope(
        &state.server_key.public().to_hex(),
        &envelope,
    )
    .map_err(|_| StatusCode::BAD_REQUEST)?;
    approved(&state, &envelope.reporter).await?;
    approved(&state, &envelope.recipient.member).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let a = access(&mut tx, &channel, &account, false).await?;
    if a.community_id != envelope.recipient.community_id {
        return Err(StatusCode::BAD_REQUEST);
    }
    access(
        &mut tx,
        &channel,
        &envelope.recipient.member.account_id,
        true,
    )
    .await?;
    sqlx::query("SELECT id FROM communities WHERE id=$1 FOR UPDATE")
        .bind(&a.community_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let key: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT value FROM moderation_keys WHERE community_id=$1 AND device_key=$2",
    )
    .bind(&a.community_id)
    .bind(&envelope.recipient.member.enrollment.device_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if key != Some(serde_json::to_value(&envelope.recipient).map_err(|_| StatusCode::BAD_REQUEST)?)
    {
        return Err(StatusCode::CONFLICT);
    }
    let value = serde_json::to_value(&envelope).map_err(|_| StatusCode::BAD_REQUEST)?;
    let old: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT envelope FROM moderation_reports WHERE id=$1")
            .bind(&envelope.id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?;
    if let Some(old) = old {
        return if old == value {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(StatusCode::CONFLICT)
        };
    }
    let full:bool=sqlx::query_scalar("SELECT (SELECT count(*) FROM moderation_reports WHERE community_id=$1)>=1000 OR (SELECT count(*) FROM moderation_reports WHERE reporter_id=$2 AND created_at>now()-interval '1 day')>=10").bind(&a.community_id).bind(&account).fetch_one(&mut *tx).await.map_err(unavailable)?;
    if full {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    sqlx::query("INSERT INTO moderation_reports(id,community_id,channel_id,reporter_id,recipient_id,recipient_device,envelope) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(&envelope.id).bind(&a.community_id).bind(&channel).bind(&account).bind(&envelope.recipient.member.account_id).bind(&envelope.recipient.member.enrollment.device_key).bind(value).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn queue(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(channel): Path<String>,
) -> Result<Json<Vec<QueuedReport>>> {
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    access(&mut tx, &channel, &account, true).await?;
    let rows=sqlx::query("SELECT envelope,resolved FROM moderation_reports WHERE channel_id=$1 AND recipient_id=$2 ORDER BY created_at DESC LIMIT 100").bind(&channel).bind(&account).fetch_all(&mut *tx).await.map_err(unavailable)?;
    let reports = rows
        .iter()
        .map(|r| {
            Ok(QueuedReport {
                envelope: serde_json::from_value(r.get("envelope"))
                    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?,
                resolved: r.get("resolved"),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Json(reports))
}
pub(crate) async fn resolve(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((channel, id)): Path<(String, String)>,
) -> Result<StatusCode> {
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    access(&mut tx, &channel, &account, true).await?;
    let result=sqlx::query("UPDATE moderation_reports SET resolved=TRUE WHERE id=$1 AND channel_id=$2 AND recipient_id=$3").bind(&id).bind(&channel).bind(&account).execute(&mut *tx).await.map_err(unavailable)?;
    if result.rows_affected() != 1 {
        return Err(StatusCode::NOT_FOUND);
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
