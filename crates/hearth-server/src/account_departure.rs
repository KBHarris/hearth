//! Signed account erasure. Public attestations and retry digests remain verifiable.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hearth_proto::lifecycle::AccountDeparture;
use sqlx::Row;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
pub(crate) async fn erase(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(value): Json<AccountDeparture>,
) -> Result<StatusCode, StatusCode> {
    let _permit = state.auth.admit()?;
    hearth_crypto::messaging::reports::verify_departure(
        &state.server_key.public().to_hex(),
        &value,
    )
    .map_err(|_| StatusCode::BAD_REQUEST)?;
    let id = &value.member.account_id;
    state.auth.limit_delivery(id)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let row = sqlx::query(
        "SELECT owner,identity_key,deleted,departure FROM accounts WHERE id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?
    .ok_or(StatusCode::FORBIDDEN)?;
    let stored = serde_json::to_value(&value).map_err(|_| StatusCode::BAD_REQUEST)?;
    if row.get::<bool, _>("deleted") {
        return if row
            .get::<Option<serde_json::Value>, _>("departure")
            .as_ref()
            == Some(&stored)
        {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(StatusCode::CONFLICT)
        };
    }
    // The signature permits retry after session revocation; initial deletion also
    // requires a current session belonging to this account and exact approved proof.
    if account_id(&state, &headers).await? != *id {
        return Err(StatusCode::FORBIDDEN);
    };
    if row.get::<bool, _>("owner")
        || sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM communities WHERE owner_id=$1)",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?
    {
        return Err(StatusCode::CONFLICT);
    };
    let device=sqlx::query("SELECT certificate,account_signature,device_signature FROM account_devices WHERE account_id=$1 AND device_key=$2").bind(id).bind(&value.member.enrollment.device_key).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    let proof = &value.member.enrollment;
    if row.get::<Option<String>, _>("identity_key").as_deref() != Some(&proof.identity_key)
        || device.get::<String, _>("certificate") != proof.certificate
        || device.get::<String, _>("account_signature") != proof.account_signature
        || device.get::<String, _>("device_signature") != proof.device_signature
    {
        return Err(StatusCode::FORBIDDEN);
    };
    for query in [
        "DELETE FROM auth_sessions WHERE account_id=$1",
        "DELETE FROM auth_login_exchanges WHERE account_id=$1",
        "DELETE FROM device_link_offers WHERE account_id=$1",
        "DELETE FROM mls_key_packages WHERE account_id=$1",
        "DELETE FROM account_invites WHERE issuer_id=$1",
        "DELETE FROM user_blocks WHERE account_id=$1 OR blocked_id=$1",
        "DELETE FROM push_subscriptions WHERE account_id=$1",
        "DELETE FROM moderation_keys WHERE account_id=$1",
        "DELETE FROM moderation_reports WHERE reporter_id=$1 OR recipient_id=$1",
        "DELETE FROM community_rules_acceptance WHERE account_id=$1",
        "DELETE FROM delivery_events WHERE device_key IN(SELECT device_key FROM account_devices WHERE account_id=$1)",
        "UPDATE delivery_events SET data='{\"kind\":\"redacted\"}'::jsonb WHERE operation_id IN(SELECT operation_id FROM delivery_operations WHERE account_id=$1 AND action<>'commit')",
        "DELETE FROM channel_archives WHERE operation_id IN(SELECT operation_id FROM delivery_operations WHERE account_id=$1)",
        "UPDATE encrypted_blobs SET erased_at=now() WHERE account_id=$1 AND erased_at IS NULL",
    ] {
        sqlx::query(query)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
    let username = format!("deleted_{}", &id[..24]);
    sqlx::query("UPDATE accounts SET deleted=TRUE,departure=$2,username=$3,password_file=''::bytea WHERE id=$1").bind(id).bind(stored).bind(username).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
