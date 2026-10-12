//! User DM blocks and operator availability bans carry no message content.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hearth_proto::auth::Account;
use serde::Deserialize;
use sqlx::Row;
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Change {
    account_id: String,
    active: bool,
}
async fn auth(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let id = account_id(state, headers).await?;
    state.auth.limit_delivery(&id)?;
    Ok(id)
}
async fn owner(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let id = auth(state, headers).await?;
    if !sqlx::query_scalar::<_, bool>("SELECT owner FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .map_err(unavailable)?
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(id)
}
async fn accounts(state: &SharedState, query: &str, id: &str) -> Result<Json<Vec<Account>>> {
    let rows = sqlx::query(query)
        .bind(id)
        .fetch_all(&state.db)
        .await
        .map_err(unavailable)?;
    Ok(Json(
        rows.iter()
            .map(|r| Account {
                id: r.get("id"),
                username: r.get("username"),
                owner: r.get("owner"),
            })
            .collect(),
    ))
}
pub(crate) async fn blocks(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Account>>> {
    let id = auth(&state, &headers).await?;
    accounts(&state,"SELECT a.id,a.username,a.owner FROM accounts a JOIN user_blocks b ON b.blocked_id=a.id WHERE b.account_id=$1 ORDER BY a.username LIMIT 512",&id).await
}
pub(crate) async fn block(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<StatusCode> {
    let id = auth(&state, &headers).await?;
    if change.account_id == id || !hearth_crypto::messaging::valid_id(&change.account_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    if change.active {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=$1)")
            .bind(&change.account_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        if !exists {
            return Err(StatusCode::NOT_FOUND);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM user_blocks WHERE account_id=$1 AND blocked_id<>$2",
        )
        .bind(&id)
        .bind(&change.account_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if count >= 512 {
            return Err(StatusCode::CONFLICT);
        }
        sqlx::query(
            "INSERT INTO user_blocks(account_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(&change.account_id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    } else {
        sqlx::query("DELETE FROM user_blocks WHERE account_id=$1 AND blocked_id=$2")
            .bind(&id)
            .bind(&change.account_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn bans(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Account>>> {
    let id = owner(&state, &headers).await?;
    accounts(&state,"SELECT a.id,a.username,a.owner FROM accounts a JOIN server_bans b ON b.account_id=a.id WHERE $1<>'' ORDER BY a.username LIMIT 1024",&id).await
}
pub(crate) async fn ban(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(change): Json<Change>,
) -> Result<StatusCode> {
    let issuer = owner(&state, &headers).await?;
    if !hearth_crypto::messaging::valid_id(&change.account_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let owner: bool = sqlx::query_scalar("SELECT owner FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&change.account_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if owner {
        return Err(StatusCode::FORBIDDEN);
    }
    if change.active {
        sqlx::query(
            "INSERT INTO server_bans(account_id,issuer_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(&change.account_id)
        .bind(&issuer)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        sqlx::query("DELETE FROM auth_sessions WHERE account_id=$1")
            .bind(&change.account_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("DELETE FROM auth_login_exchanges WHERE account_id=$1")
            .bind(&change.account_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    } else {
        sqlx::query("DELETE FROM server_bans WHERE account_id=$1")
            .bind(&change.account_id)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn dm_allowed(
    tx: &mut sqlx::PgConnection,
    conversation: &str,
    account: &str,
) -> Result<()> {
    let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_blocks b JOIN conversation_accounts m ON m.account_id=CASE WHEN b.account_id=$2 THEN b.blocked_id ELSE b.account_id END WHERE m.conversation_id=$1 AND (b.account_id=$2 OR b.blocked_id=$2))").bind(conversation).bind(account).fetch_one(tx).await.map_err(unavailable)?;
    if blocked {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
