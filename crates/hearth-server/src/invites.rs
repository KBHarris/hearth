//! Opaque relay for short invites. Resolving an envelope grants no admission rights.
use crate::SharedState;
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::invite::{InviteEnvelope, StoreInviteEnvelope};

fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn hex(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value.len().is_multiple_of(2)
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub async fn store(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<StoreInviteEnvelope>,
) -> Result<StatusCode, StatusCode> {
    let _permit = state.auth.admit()?;
    let account = crate::device::account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    if !hex(&request.id, 64, 64)
        || !hex(&request.envelope.nonce, 24, 24)
        || !hex(&request.envelope.ciphertext, 64, 8192)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    // Serialize quota checks, including concurrent creators on a small home server.
    sqlx::query("SELECT pg_advisory_xact_lock(1212502603)")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("DELETE FROM invite_envelopes WHERE expires_at<=now()")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM invite_envelopes WHERE creator_id=$1")
            .bind(&account)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM invite_envelopes")
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    if count >= 64 || total >= 10000 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let inserted = sqlx::query("INSERT INTO invite_envelopes(id,creator_id,nonce,ciphertext) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING")
        .bind(request.id).bind(account).bind(request.envelope.nonce).bind(request.envelope.ciphertext)
        .execute(&mut *tx).await.map_err(unavailable)?;
    if inserted.rows_affected() != 1 {
        return Err(StatusCode::CONFLICT);
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn resolve(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<InviteEnvelope>, StatusCode> {
    let _permit = state.auth.admit()?;
    state.auth.limit_delivery("invite-resolution")?;
    if !hex(&id, 64, 64) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT nonce,ciphertext FROM invite_envelopes WHERE id=$1 AND expires_at>now()",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(unavailable)?;
    let (nonce, ciphertext) = row.ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(InviteEnvelope { nonce, ciphertext }))
}
