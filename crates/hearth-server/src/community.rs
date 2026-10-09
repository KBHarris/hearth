//! Community directory metadata. Channel ciphertext delivery is a separate milestone.
use crate::{SharedState, device::account_id};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware,
    routing::{get, post},
};
use hearth_crypto::messaging::valid_id;
use hearth_proto::community::*;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row, postgres::PgRow};
use tower_http::cors::CorsLayer;

type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn name(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 80
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}
fn id(value: &str) -> Result<()> {
    if !valid_id(value) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}
fn community(row: &PgRow) -> Community {
    Community {
        id: row.get("id"),
        name: row.get("name"),
        owner_id: row.get("owner_id"),
    }
}
async fn authenticated(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let account = account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    Ok(account)
}
async fn owner(tx: &mut PgConnection, community_id: &str, account: &str) -> Result<()> {
    id(community_id)?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_id FROM communities WHERE id=$1 FOR UPDATE")
            .bind(community_id)
            .fetch_optional(tx)
            .await
            .map_err(unavailable)?;
    if owner.as_deref() != Some(account) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
pub fn routes(origins: &[String]) -> Router<SharedState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/join", post(join))
        .route("/channels/{id}/roster", get(channel_roster))
        .route("/{id}", get(structure))
        .route("/{id}/categories", post(create_category))
        .route("/{id}/channels", post(create_channel))
        .route("/{id}/invites", post(invite))
        .layer(DefaultBodyLimit::max(4096))
        .layer(
            CorsLayer::new()
                .allow_origin(
                    origins
                        .iter()
                        .filter_map(|s| s.parse::<HeaderValue>().ok())
                        .collect::<Vec<_>>(),
                )
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        )
        .layer(middleware::map_response(crate::auth::no_store))
}
pub(crate) struct ChannelAccess {
    pub community_id: String,
    pub owner_id: String,
    pub announcement: bool,
}
/// Lock communities before conversations/devices, so admission and rekeys are ordered.
pub(crate) async fn channel_access(
    tx: &mut PgConnection,
    channel: &str,
    account: &str,
) -> Result<Option<ChannelAccess>> {
    let row = sqlx::query("SELECT c.id AS community_id,c.owner_id,h.kind FROM community_channels h JOIN communities c ON c.id=h.community_id WHERE h.id=$1 FOR SHARE OF c")
        .bind(channel).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let community_id: String = row.get("community_id");
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2)",
    )
    .bind(&community_id)
    .bind(account)
    .fetch_one(tx)
    .await
    .map_err(unavailable)?;
    if !member {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Some(ChannelAccess {
        community_id,
        owner_id: row.get("owner_id"),
        announcement: row.get::<&str, _>("kind") == "announcement",
    }))
}
async fn channel_roster(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(channel): Path<String>,
) -> Result<Json<ChannelRoster>> {
    let account = authenticated(&state, &headers).await?;
    id(&channel)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let access = channel_access(&mut tx, &channel, &account)
        .await?
        .ok_or(StatusCode::NOT_FOUND)?;
    let row = sqlx::query("SELECT id,name,owner_id FROM communities WHERE id=$1")
        .bind(&access.community_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let h =
        sqlx::query("SELECT id,community_id,name,category_id FROM community_channels WHERE id=$1")
            .bind(&channel)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    let accounts = sqlx::query("SELECT a.id,a.username,a.owner FROM accounts a JOIN community_members m ON m.account_id=a.id WHERE m.community_id=$1 ORDER BY a.id").bind(&access.community_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
    if accounts.len() > 128 {
        return Err(StatusCode::CONFLICT);
    }
    let mut people = Vec::new();
    for a in accounts {
        let devices = sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 ORDER BY d.device_key")
            .bind(a.get::<&str,_>("id")).fetch_all(&mut *tx).await.map_err(unavailable)?;
        people.push(hearth_proto::messaging::Person {
            account: hearth_proto::auth::Account {
                id: a.get("id"),
                username: a.get("username"),
                owner: a.get("owner"),
            },
            devices: devices.iter().map(crate::delivery::enrollment).collect(),
        });
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(ChannelRoster {
        community: community(&row),
        channel: Channel {
            id: h.get("id"),
            community_id: h.get("community_id"),
            name: h.get("name"),
            category_id: h.get("category_id"),
            kind: if access.announcement {
                ChannelKind::Announcement
            } else {
                ChannelKind::Text
            },
        },
        people,
    }))
}
async fn list(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Community>>> {
    let account = authenticated(&state, &headers).await?;
    let rows = sqlx::query("SELECT c.id,c.name,c.owner_id FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.account_id=$1 ORDER BY c.created_at,c.id")
        .bind(account).fetch_all(&state.db).await.map_err(unavailable)?;
    Ok(Json(rows.iter().map(community).collect()))
}
async fn create(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<CreateCommunity>,
) -> Result<Json<Community>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    name(&request.name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    // All community creation/join operations lock this account before the community.
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR NO KEY UPDATE")
        .bind(&account)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM community_members WHERE account_id=$1")
            .bind(&account)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if count >= 100 {
        return Err(StatusCode::CONFLICT);
    }
    let result = Community {
        id: crate::auth::random_token(),
        name: request.name,
        owner_id: account.clone(),
    };
    sqlx::query("INSERT INTO communities(id,name,owner_id) VALUES($1,$2,$3)")
        .bind(&result.id)
        .bind(&result.name)
        .bind(&account)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("INSERT INTO community_members(community_id,account_id) VALUES($1,$2)")
        .bind(&result.id)
        .bind(&account)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
async fn structure(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Result<Json<CommunityStructure>> {
    let account = authenticated(&state, &headers).await?;
    id(&community_id)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let row = sqlx::query("SELECT c.id,c.name,c.owner_id FROM communities c JOIN community_members m ON m.community_id=c.id WHERE c.id=$1 AND m.account_id=$2")
        .bind(&community_id).bind(account).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    let categories = sqlx::query("SELECT id,community_id,name FROM community_categories WHERE community_id=$1 ORDER BY created_at,id").bind(&community_id).fetch_all(&mut *tx).await.map_err(unavailable)?
        .iter().map(|r| Category { id:r.get("id"), community_id:r.get("community_id"), name:r.get("name") }).collect();
    let channels = sqlx::query("SELECT id,community_id,category_id,name,kind FROM community_channels WHERE community_id=$1 ORDER BY created_at,id").bind(&community_id).fetch_all(&mut *tx).await.map_err(unavailable)?
        .iter().map(|r| Ok(Channel { id:r.get("id"), community_id:r.get("community_id"), name:r.get("name"), category_id:r.get("category_id"), kind: match r.get::<&str,_>("kind") { "text"=>ChannelKind::Text,"announcement"=>ChannelKind::Announcement,_=>return Err(StatusCode::SERVICE_UNAVAILABLE) } })).collect::<Result<Vec<_>>>()?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(CommunityStructure {
        community: community(&row),
        categories,
        channels,
    }))
}
async fn create_category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    Json(request): Json<CreateCommunity>,
) -> Result<Json<Category>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    name(&request.name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &community_id, &account).await?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM community_categories WHERE community_id=$1")
            .bind(&community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if count >= 256 {
        return Err(StatusCode::CONFLICT);
    }
    let result = Category {
        id: crate::auth::random_token(),
        community_id,
        name: request.name,
    };
    sqlx::query("INSERT INTO community_categories(id,community_id,name) VALUES($1,$2,$3)")
        .bind(&result.id)
        .bind(&result.community_id)
        .bind(&result.name)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
async fn create_channel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    Json(request): Json<CreateChannel>,
) -> Result<Json<Channel>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    name(&request.name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &community_id, &account).await?;
    if let Some(category) = &request.category_id {
        id(category)?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM community_categories WHERE id=$1 AND community_id=$2)",
        )
        .bind(category)
        .bind(&community_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if !exists {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM community_channels WHERE community_id=$1")
            .bind(&community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if count >= 512 {
        return Err(StatusCode::CONFLICT);
    }
    let result = Channel {
        id: crate::auth::random_token(),
        community_id,
        name: request.name,
        category_id: request.category_id,
        kind: request.kind,
    };
    sqlx::query("INSERT INTO community_channels(id,community_id,category_id,name,kind) VALUES($1,$2,$3,$4,$5)").bind(&result.id).bind(&result.community_id).bind(&result.category_id).bind(&result.name).bind(match result.kind {ChannelKind::Text=>"text",ChannelKind::Announcement=>"announcement"}).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
async fn invite(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    Json(request): Json<CreateCommunityInvite>,
) -> Result<Json<CommunityInvite>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    if !(60..=604800).contains(&request.expires_in_seconds)
        || !(1..=1000).contains(&request.max_uses)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &community_id, &account).await?;
    sqlx::query("DELETE FROM community_invites WHERE community_id=$1 AND (expires_at<=now() OR uses>=max_uses)").bind(&community_id).execute(&mut *tx).await.map_err(unavailable)?;
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM community_invites WHERE community_id=$1")
            .bind(&community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if count >= 32 {
        return Err(StatusCode::CONFLICT);
    }
    let result = CommunityInvite {
        code: crate::auth::random_token(),
        expires_in_seconds: request.expires_in_seconds,
        max_uses: request.max_uses,
    };
    sqlx::query("INSERT INTO community_invites(code_hash,community_id,created_by,expires_at,max_uses) VALUES($1,$2,$3,now()+make_interval(secs=>$4),$5)")
        .bind(Sha256::digest(result.code.as_bytes()).to_vec()).bind(community_id).bind(account).bind(f64::from(result.expires_in_seconds)).bind(i32::try_from(result.max_uses).map_err(|_|StatusCode::BAD_REQUEST)?).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
async fn join(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<JoinCommunity>,
) -> Result<Json<Community>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    id(&request.code)?;
    let digest = Sha256::digest(request.code.as_bytes()).to_vec();
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR NO KEY UPDATE")
        .bind(&account)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let community_id: String =
        sqlx::query_scalar("SELECT community_id FROM community_invites WHERE code_hash=$1")
            .bind(&digest)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(StatusCode::FORBIDDEN)?;
    let row = sqlx::query("SELECT id,name,owner_id FROM communities WHERE id=$1 FOR UPDATE")
        .bind(&community_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    // clock_timestamp, unlike now(), advances while concurrent joins wait for locks.
    let invitation = sqlx::query("SELECT uses,max_uses FROM community_invites WHERE code_hash=$1 AND expires_at>clock_timestamp() FOR UPDATE").bind(&digest).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    let joined: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2)",
    )
    .bind(&community_id)
    .bind(&account)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    if !joined {
        if invitation.get::<i32, _>("uses") >= invitation.get::<i32, _>("max_uses") {
            return Err(StatusCode::FORBIDDEN);
        }
        let total: i64 =
            sqlx::query_scalar("SELECT count(*) FROM community_members WHERE community_id=$1")
                .bind(&community_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        let own: i64 =
            sqlx::query_scalar("SELECT count(*) FROM community_members WHERE account_id=$1")
                .bind(&account)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        if total >= 1024 || own >= 100 {
            return Err(StatusCode::CONFLICT);
        }
        sqlx::query("INSERT INTO community_members(community_id,account_id) VALUES($1,$2)")
            .bind(&community_id)
            .bind(account)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("UPDATE community_invites SET uses=uses+1 WHERE code_hash=$1")
            .bind(digest)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(community(&row)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_names_have_a_byte_bound_and_no_controls() {
        for bad in ["", " leading", "trailing ", "line\nbreak", "hidden\u{0}"] {
            assert!(name(bad).is_err());
        }
        assert!(name(&"a".repeat(81)).is_err());
        assert!(name(&"🦀".repeat(21)).is_err());
        assert!(name("Friends & family 🦀").is_ok());
    }
}
