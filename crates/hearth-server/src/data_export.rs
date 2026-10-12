//! Paginated account-owned metadata and opaque records; credentials are excluded.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::{auth::Account, community::Community, lifecycle::*};
use serde::Deserialize;
use sqlx::Row;
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
#[derive(Deserialize)]
pub(crate) struct Cursor {
    #[serde(default)]
    after: String,
}
pub(crate) async fn export(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Query(cursor): Query<Cursor>,
) -> Result<Json<AccountExport>> {
    let id = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&id)?;
    if !cursor.after.is_empty() {
        let Some((kind, value)) = cursor.after.split_once(':') else {
            return Err(StatusCode::BAD_REQUEST);
        };
        if !["blob", "message", "report"].contains(&kind)
            || !hearth_crypto::messaging::valid_id(value)
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let row = sqlx::query("SELECT id,username,owner FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let account = Account {
        id: row.get("id"),
        username: row.get("username"),
        owner: row.get("owner"),
    };
    let devices=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 ORDER BY d.device_key").bind(&id).fetch_all(&mut *tx).await.map_err(unavailable)?.iter().map(crate::delivery::enrollment).collect();
    let communities=sqlx::query("SELECT c.id,c.name,c.owner_id FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.account_id=$1 ORDER BY c.id").bind(&id).fetch_all(&mut *tx).await.map_err(unavailable)?.iter().map(|r|Community{id:r.get("id"),name:r.get("name"),owner_id:r.get("owner_id")}).collect();
    let blocks=sqlx::query("SELECT a.id,a.username,a.owner FROM accounts a JOIN user_blocks b ON b.blocked_id=a.id WHERE b.account_id=$1 ORDER BY a.id").bind(&id).fetch_all(&mut *tx).await.map_err(unavailable)?.iter().map(|r|Account{id:r.get("id"),username:r.get("username"),owner:r.get("owner")}).collect();
    let rows=sqlx::query("SELECT cursor,data FROM (SELECT 'blob:'||b.id AS cursor,to_jsonb(b) AS data FROM encrypted_blobs b WHERE b.account_id=$1 UNION ALL SELECT 'message:'||o.operation_id AS cursor,jsonb_build_object('operation',to_jsonb(o),'envelope',e.data) AS data FROM delivery_operations o LEFT JOIN LATERAL (SELECT data FROM delivery_events WHERE operation_id=o.operation_id ORDER BY device_key LIMIT 1) e ON TRUE WHERE o.account_id=$1 AND o.action<>'commit' UNION ALL SELECT 'report:'||r.id AS cursor,jsonb_build_object('envelope',r.envelope,'resolved',r.resolved,'created_at',r.created_at) AS data FROM moderation_reports r WHERE r.reporter_id=$1 OR r.recipient_id=$1) records WHERE cursor>$2 ORDER BY cursor LIMIT 33").bind(&id).bind(&cursor.after).fetch_all(&mut *tx).await.map_err(unavailable)?;
    let more = rows.len() > 32;
    let records = rows
        .iter()
        .take(32)
        .map(|r| ExportRecord {
            cursor: r.get("cursor"),
            data: r.get("data"),
        })
        .collect::<Vec<_>>();
    let next = if more {
        records.last().map(|r| r.cursor.clone())
    } else {
        None
    };
    Ok(Json(AccountExport {
        account,
        devices,
        communities,
        blocks,
        records,
        next,
    }))
}
