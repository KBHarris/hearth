//! Immutable first-device enrollment. Password authentication cannot replace an identity.
use crate::SharedState;
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::device::{AccountIdentity, DeviceEnrollment};
use hearth_proto::device::{DeviceLinkEnvelope, DeviceLinkOffer, DeviceRestore};
use sqlx::Row;

pub(crate) async fn account_id(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<String, StatusCode> {
    sqlx::query_scalar(
        "SELECT account_id FROM auth_sessions WHERE token_hash=$1 AND expires_at > now()",
    )
    .bind(crate::auth::bearer(headers)?)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
    .ok_or(StatusCode::UNAUTHORIZED)
}
fn device(row: &sqlx::postgres::PgRow, identity: &str) -> DeviceEnrollment {
    DeviceEnrollment {
        identity_key: identity.into(),
        device_key: row.get("device_key"),
        certificate: row.get("certificate"),
        account_signature: row.get("account_signature"),
        device_signature: row.get("device_signature"),
    }
}
pub async fn identity(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<AccountIdentity>, StatusCode> {
    let id = account_id(&state, &headers).await?;
    // One transaction snapshot so an enrollment cannot split identity and device reads.
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let key: Option<String> = sqlx::query_scalar("SELECT identity_key FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let rows = sqlx::query("SELECT device_key,certificate,account_signature,device_signature FROM account_devices WHERE account_id=$1 ORDER BY created_at,device_key").bind(&id).fetch_all(&mut *tx).await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let devices = rows
        .iter()
        .map(|row| device(row, key.as_deref().unwrap_or_default()))
        .collect();
    tx.commit()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(AccountIdentity {
        identity_key: key,
        devices,
    }))
}
pub async fn enroll_first(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<DeviceEnrollment>,
) -> Result<Json<DeviceEnrollment>, StatusCode> {
    let _permit = state.auth.admit()?;
    let id = account_id(&state, &headers).await?;
    state.auth.limit(&id)?;
    if request.identity_key == request.device_key {
        return Err(StatusCode::BAD_REQUEST);
    }
    for (value, len) in [
        (&request.identity_key, 64),
        (&request.device_key, 64),
        (&request.certificate, 128),
        (&request.account_signature, 128),
        (&request.device_signature, 128),
    ] {
        if value.len() != len
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let proof = hearth_crypto::identity::Enrollment {
        identity_key: request.identity_key.clone(),
        device_key: request.device_key.clone(),
        certificate: request.certificate.clone(),
        account_signature: request.account_signature.clone(),
        device_signature: request.device_signature.clone(),
    };
    proof
        .verify(&id, &state.server_key.public().to_hex())
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let current: Option<String> =
        sqlx::query_scalar("SELECT identity_key FROM accounts WHERE id=$1 FOR UPDATE")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if let Some(current) = current {
        if current != request.identity_key {
            return Err(StatusCode::CONFLICT);
        }
        let row = sqlx::query("SELECT device_key,certificate,account_signature,device_signature FROM account_devices WHERE account_id=$1 AND device_key=$2").bind(&id).bind(&request.device_key).fetch_optional(&mut *tx).await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if row.as_ref().map(|row| device(row, &current)).as_ref() != Some(&request) {
            return Err(StatusCode::CONFLICT);
        }
        // Retry only the exact already accepted initial proof, never a new device.
    } else {
        sqlx::query("UPDATE accounts SET identity_key=$1 WHERE id=$2")
            .bind(&request.identity_key)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        sqlx::query("INSERT INTO account_devices (account_id,device_key,certificate,account_signature,device_signature) VALUES ($1,$2,$3,$4,$5)").bind(&id).bind(&request.device_key).bind(&request.certificate).bind(&request.account_signature).bind(&request.device_signature).execute(&mut *tx).await.map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    }
    tx.commit()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(request))
}

fn verify(request: &DeviceEnrollment, account: &str, server: &str) -> Result<(), StatusCode> {
    if request.identity_key == request.device_key {
        return Err(StatusCode::BAD_REQUEST);
    }
    for (value, length) in [
        (&request.identity_key, 64),
        (&request.device_key, 64),
        (&request.certificate, 128),
        (&request.account_signature, 128),
        (&request.device_signature, 128),
    ] {
        if value.len() != length
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    hearth_crypto::identity::Enrollment {
        identity_key: request.identity_key.clone(),
        device_key: request.device_key.clone(),
        certificate: request.certificate.clone(),
        account_signature: request.account_signature.clone(),
        device_signature: request.device_signature.clone(),
    }
    .verify(account, server)
    .map_err(|_| StatusCode::BAD_REQUEST)
}
pub async fn restore(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<DeviceRestore>,
) -> Result<Json<DeviceEnrollment>, StatusCode> {
    let _permit = state.auth.admit()?;
    let id = account_id(&state, &headers).await?;
    state.auth.limit(&id)?;
    verify(
        &request.enrollment,
        &id,
        &state.server_key.public().to_hex(),
    )?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let current: Option<String> =
        sqlx::query_scalar("SELECT identity_key FROM accounts WHERE id=$1 FOR UPDATE")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if current.as_ref() != Some(&request.enrollment.identity_key) {
        return Err(StatusCode::CONFLICT);
    }
    let existing = sqlx::query("SELECT device_key,certificate,account_signature,device_signature FROM account_devices WHERE account_id=$1 AND device_key=$2").bind(&id).bind(&request.enrollment.device_key).fetch_optional(&mut *tx).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
    if let Some(row) = existing {
        if device(&row, &request.enrollment.identity_key) != request.enrollment {
            return Err(StatusCode::CONFLICT);
        }
    } else {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM account_devices WHERE account_id=$1")
                .bind(&id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if count >= 16 {
            return Err(StatusCode::CONFLICT);
        }
        if let Some(link) = &request.link_id {
            let consumed = sqlx::query("DELETE FROM device_link_offers WHERE id=$1 AND account_id=$2 AND expires_at > now() RETURNING id").bind(link).bind(&id).fetch_optional(&mut *tx).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
            if consumed.is_none() {
                return Err(StatusCode::CONFLICT);
            }
        }
        sqlx::query("INSERT INTO account_devices(account_id,device_key,certificate,account_signature,device_signature) VALUES($1,$2,$3,$4,$5)").bind(&id).bind(&request.enrollment.device_key).bind(&request.enrollment.certificate).bind(&request.enrollment.account_signature).bind(&request.enrollment.device_signature).execute(&mut *tx).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
    }
    tx.commit()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(request.enrollment))
}
pub async fn link_offer(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<DeviceLinkOffer>,
) -> Result<Json<DeviceLinkEnvelope>, StatusCode> {
    let _permit = state.auth.admit()?;
    let id = account_id(&state, &headers).await?;
    state.auth.limit(&id)?;
    hearth_crypto::recovery::verify_link(
        &request.device_key,
        &request.id,
        &request.envelope,
        &id,
        &state.server_key.public().to_hex(),
        &request.signature,
    )
    .map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let approved: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM account_devices WHERE account_id=$1 AND device_key=$2)",
    )
    .bind(&id)
    .bind(&request.device_key)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !approved {
        return Err(StatusCode::FORBIDDEN);
    }
    sqlx::query("DELETE FROM device_link_offers WHERE expires_at <= now()")
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM device_link_offers WHERE account_id=$1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if count >= 4 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    sqlx::query("INSERT INTO device_link_offers(id,account_id,device_key,envelope,signature) VALUES($1,$2,$3,$4,$5)").bind(&request.id).bind(&id).bind(&request.device_key).bind(&request.envelope).bind(&request.signature).execute(&mut *tx).await.map_err(|error|if error.as_database_error().is_some_and(|e|e.is_unique_violation()) {StatusCode::CONFLICT} else {StatusCode::SERVICE_UNAVAILABLE})?;
    tx.commit()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(DeviceLinkEnvelope {
        envelope: request.envelope,
        expires_in_seconds: 180,
    }))
}
pub async fn link_envelope(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(link): Path<String>,
) -> Result<Json<DeviceLinkEnvelope>, StatusCode> {
    let id = account_id(&state, &headers).await?;
    let row = sqlx::query("SELECT envelope, GREATEST(1,EXTRACT(EPOCH FROM expires_at-now())::integer) AS ttl FROM device_link_offers WHERE id=$1 AND account_id=$2 AND expires_at > now()").bind(&link).bind(&id).fetch_optional(&state.db).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?.ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(DeviceLinkEnvelope {
        envelope: row.get("envelope"),
        expires_in_seconds: row.get::<i32, _>("ttl") as u32,
    }))
}
