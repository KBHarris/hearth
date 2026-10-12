//! Expire host-retained ciphertext. Recipient copies and backups cannot be recalled.
use crate::SharedState;
use axum::http::StatusCode;

// Reuse the signed channel limits; the server accepts only positive, bounded day counts.
pub(crate) async fn expired_blob(
    state: &SharedState,
    conversation: &str,
    id: &str,
) -> Result<bool, StatusCode> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM encrypted_blobs WHERE id=$1 AND conversation_id=$2 AND hearth_retention_expired(conversation_id,created_at))")
        .bind(id).bind(conversation).fetch_one(&state.db).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)
}
pub async fn cleanup(state: &SharedState) -> Result<(), StatusCode> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    // Preserve Welcome/commit material for offline devices. Retain cursor and operation
    // digests so delayed retries cannot repopulate the expired ciphertext.
    sqlx::query("UPDATE delivery_events SET data='{\"kind\":\"redacted\"}'::jsonb WHERE data->>'kind'='message' AND hearth_retention_expired(conversation_id,created_at)").execute(&mut *tx).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
    sqlx::query("DELETE FROM channel_archives a USING delivery_operations o WHERE o.operation_id=a.operation_id AND hearth_retention_expired(a.conversation_id,o.created_at)").execute(&mut *tx).await.map_err(|_|StatusCode::SERVICE_UNAVAILABLE)?;
    tx.commit()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    crate::attachments::cleanup_retained(state).await
}
