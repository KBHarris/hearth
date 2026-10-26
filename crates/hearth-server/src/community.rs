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
#[path = "community_deletion.rs"]
mod deletion;
fn decode_kind(value: &str) -> Result<ChannelKind> {
    match value {
        "text" => Ok(ChannelKind::Text),
        "announcement" => Ok(ChannelKind::Announcement),
        "forum" => Ok(ChannelKind::Forum),
        "voice" => Ok(ChannelKind::Voice),
        "stage" => Ok(ChannelKind::Stage),
        _ => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}
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
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT owner_id FROM communities WHERE id=$1 AND NOT deleted FOR UPDATE",
    )
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
        .route(
            "/channels/{id}/report-keys",
            get(crate::reports::keys).post(crate::reports::register),
        )
        .route(
            "/channels/{id}/reports",
            get(crate::reports::queue).post(crate::reports::submit),
        )
        .route(
            "/channels/{channel}/reports/{id}/resolve",
            post(crate::reports::resolve),
        )
        .route("/{id}", get(structure))
        .route("/{id}/categories", post(create_category))
        .route("/{id}/channels", post(create_channel))
        .route("/{id}/delete", post(deletion::community))
        .route("/{id}/channels/{channel}/delete", post(deletion::channel))
        .route(
            "/{id}/categories/{category}/delete",
            post(deletion::category),
        )
        .route("/{id}/authority", post(set_authority))
        .route("/{id}/admissions", post(admit_member))
        .route("/channels/{id}/policy", post(set_policy))
        .route("/{id}/invites", post(invite))
        .route("/{id}/invitation", get(member_invitation))
        .route(
            "/{id}/governance",
            get(crate::governance::get).post(crate::governance::set),
        )
        .route("/{id}/audit", get(crate::governance::audit))
        .route("/{id}/rules/accept", post(crate::governance::accept_rules))
        .route(
            "/{id}/ownership",
            get(crate::ownership::get).post(crate::ownership::offer),
        )
        .route("/{id}/ownership/accept", post(crate::ownership::accept))
        .route("/{id}/ownership/cancel", post(crate::ownership::cancel))
        .layer(DefaultBodyLimit::max(1024 * 1024))
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
    pub kind: ChannelKind,
    pub authority: Option<CommunityAuthority>,
    pub policy: Option<ChannelPolicy>,
    pub governance: Option<hearth_proto::governance::Governance>,
}
/// Lock communities before conversations/devices, so admission and rekeys are ordered.
pub(crate) async fn channel_access(
    tx: &mut PgConnection,
    channel: &str,
    account: &str,
) -> Result<Option<ChannelAccess>> {
    let row = sqlx::query("SELECT c.id AS community_id,c.owner_id,c.authority,c.governance,c.deleted FROM communities c WHERE c.id=(SELECT h.community_id FROM community_channels h WHERE h.id=$1) FOR SHARE OF c")
        .bind(channel).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    let Some(row) = row else {
        return Ok(None);
    };
    // Read channel metadata only after the community lock is held. A joined
    // row read before waiting on that lock can otherwise retain a stale channel.
    let metadata = sqlx::query("SELECT policy,kind,deleted FROM community_channels WHERE id=$1")
        .bind(channel)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    if row.get::<bool, _>("deleted") || metadata.get::<bool, _>("deleted") {
        return Err(StatusCode::FORBIDDEN);
    }
    let community_id: String = row.get("community_id");
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2)",
    )
    .bind(&community_id)
    .bind(account)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    let governance = crate::governance::decode(row.get("governance"))?;
    if !member
        || crate::governance::bits(
            tx,
            &community_id,
            row.get("owner_id"),
            account,
            Some(channel),
            governance.as_ref(),
        )
        .await?
            & hearth_proto::governance::READ
            == 0
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Some(ChannelAccess {
        community_id,
        governance,
        owner_id: row.get("owner_id"),
        announcement: metadata.get::<&str, _>("kind") == "announcement",
        kind: decode_kind(metadata.get("kind"))?,
        authority: decode_optional(row.get("authority"))?,
        policy: decode_optional(metadata.get("policy"))?,
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
    let accounts = sqlx::query("SELECT a.id,a.username,a.owner,a.departure,m.admission,m.invitation FROM accounts a JOIN community_members m ON m.account_id=a.id WHERE m.community_id=$1 ORDER BY a.id").bind(&access.community_id).fetch_all(&mut *tx).await.map_err(unavailable)?;
    if accounts.len() > 128 {
        return Err(StatusCode::CONFLICT);
    }
    let mut people = Vec::new();
    let mut admissions = Vec::new();
    let mut invitations = Vec::new();
    let mut departures = Vec::new();
    for a in accounts {
        if let Some(value) =
            decode_optional::<hearth_proto::lifecycle::AccountDeparture>(a.get("departure"))?
        {
            departures.push(value);
            continue;
        }
        if crate::governance::bits(
            &mut tx,
            &access.community_id,
            &access.owner_id,
            a.get("id"),
            Some(&channel),
            access.governance.as_ref(),
        )
        .await?
            & hearth_proto::governance::READ
            == 0
        {
            continue;
        }
        if let Some(invitation) = decode_optional::<CommunityInvitation>(a.get("invitation"))? {
            invitations.push(MemberInvitation {
                account_id: a.get("id"),
                invitation,
            });
        }
        if let Some(grant) = decode_optional::<CommunityAdmission>(a.get("admission"))? {
            admissions.push(grant);
        }
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
    let rules_accepted = crate::governance::rules_accepted(
        &mut tx,
        &access.community_id,
        &access.owner_id,
        &account,
        access.governance.as_ref(),
    )
    .await?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(ChannelRoster {
        community: community(&row),
        channel: Channel {
            id: h.get("id"),
            community_id: h.get("community_id"),
            name: h.get("name"),
            category_id: h.get("category_id"),
            kind: access.kind,
        },
        people,
        authority: access.authority,
        policy: access.policy,
        departures,
        admissions,
        invitations,
        governance: access.governance,
        rules_accepted: Some(rules_accepted),
    }))
}
fn decode_optional<T: serde::de::DeserializeOwned>(
    v: Option<serde_json::Value>,
) -> Result<Option<T>> {
    v.map(serde_json::from_value)
        .transpose()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
async fn approved_issuer(
    tx: &mut PgConnection,
    proof: &hearth_proto::messaging::GroupMember,
) -> Result<()> {
    let row=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 AND d.device_key=$2").bind(&proof.account_id).bind(&proof.enrollment.device_key).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    if crate::delivery::enrollment(&row) != proof.enrollment {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
async fn set_authority(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<CommunityAuthority>,
) -> Result<Json<CommunityAuthority>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    if value.community_id != id || value.owner.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    hearth_crypto::community::verify_authority(&state.server_key.public().to_hex(), &value)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &id, &account).await?;
    approved_issuer(&mut tx, &value.owner).await?;
    let old: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT authority FROM communities WHERE id=$1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if let Some(old) = decode_optional::<CommunityAuthority>(old)?
        && old != value
    {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("UPDATE communities SET authority=$2 WHERE id=$1")
        .bind(id)
        .bind(serde_json::to_value(&value).map_err(|_| StatusCode::BAD_REQUEST)?)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(value))
}
async fn admit_member(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<CommunityAdmission>,
) -> Result<Json<CommunityAdmission>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    if value.community_id != id || value.owner.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &id, &account).await?;
    let root = decode_optional::<CommunityAuthority>(
        sqlx::query_scalar("SELECT authority FROM communities WHERE id=$1")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?,
    )?
    .ok_or(StatusCode::CONFLICT)?;
    hearth_crypto::community::verify_admission(&state.server_key.public().to_hex(), &root, &value)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    approved_issuer(&mut tx, &value.owner).await?;
    let expected:Option<String>=sqlx::query_scalar("SELECT a.identity_key FROM accounts a JOIN community_members m ON m.account_id=a.id WHERE m.community_id=$1 AND a.id=$2").bind(&id).bind(&value.account_id).fetch_optional(&mut *tx).await.map_err(unavailable)?.flatten();
    if expected.as_deref() != Some(&value.identity_key) {
        return Err(StatusCode::FORBIDDEN);
    }
    let invitation = decode_optional::<CommunityInvitation>(
        sqlx::query_scalar(
            "SELECT m.invitation FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.community_id=$1 AND m.account_id=$2 AND NOT c.deleted",
        )
        .bind(&id)
        .bind(&value.account_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?,
    )?;
    if value.invitation != invitation {
        return Err(StatusCode::FORBIDDEN);
    }
    let old = decode_optional::<CommunityAdmission>(
        sqlx::query_scalar(
            "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
        )
        .bind(&id)
        .bind(&value.account_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?,
    )?;
    if old.is_some_and(|old| old != value) {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query(
        "UPDATE community_members SET admission=$3 WHERE community_id=$1 AND account_id=$2",
    )
    .bind(id)
    .bind(&value.account_id)
    .bind(serde_json::to_value(&value).map_err(|_| StatusCode::BAD_REQUEST)?)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(value))
}
async fn set_policy(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<ChannelPolicy>,
) -> Result<Json<ChannelPolicy>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    if value.channel_id != id || value.owner.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &value.community_id, &account).await?;
    let root = decode_optional::<CommunityAuthority>(
        sqlx::query_scalar("SELECT authority FROM communities WHERE id=$1")
            .bind(&value.community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?,
    )?
    .ok_or(StatusCode::CONFLICT)?;
    hearth_crypto::community::verify_policy(&state.server_key.public().to_hex(), &root, &value)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    approved_issuer(&mut tx, &value.owner).await?;
    let row =
        sqlx::query("SELECT policy,kind FROM community_channels WHERE id=$1 AND community_id=$2")
            .bind(&id)
            .bind(&value.community_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(StatusCode::FORBIDDEN)?;
    if decode_kind(row.get("kind"))? != value.kind {
        return Err(StatusCode::BAD_REQUEST);
    }
    let old = decode_optional::<ChannelPolicy>(row.get("policy"))?;
    if let Some(old) = old {
        if old.created_at != value.created_at || old.history_open_for != value.history_open_for {
            return Err(StatusCode::CONFLICT);
        }
        if old != value && value.revision != old.revision + 1 {
            return Err(StatusCode::CONFLICT);
        }
    } else if value.revision != 1 {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("UPDATE community_channels SET policy=$2 WHERE id=$1")
        .bind(id)
        .bind(serde_json::to_value(&value).map_err(|_| StatusCode::BAD_REQUEST)?)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(value))
}
async fn list(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Community>>> {
    let account = authenticated(&state, &headers).await?;
    let rows = sqlx::query("SELECT c.id,c.name,c.owner_id FROM communities c JOIN community_members m ON m.community_id=c.id WHERE m.account_id=$1 AND NOT c.deleted ORDER BY c.created_at,c.id")
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
        sqlx::query_scalar("SELECT count(*) FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.account_id=$1 AND NOT c.deleted")
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
    let row = sqlx::query("SELECT c.id,c.name,c.owner_id,c.authority,c.governance FROM communities c JOIN community_members m ON m.community_id=c.id WHERE c.id=$1 AND m.account_id=$2 AND NOT c.deleted")
        .bind(&community_id).bind(&account).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    let categories = sqlx::query("SELECT id,community_id,name FROM community_categories WHERE community_id=$1 ORDER BY created_at,id").bind(&community_id).fetch_all(&mut *tx).await.map_err(unavailable)?
        .iter().map(|r| Category { id:r.get("id"), community_id:r.get("community_id"), name:r.get("name") }).collect();
    let channels = sqlx::query("SELECT id,community_id,category_id,name,kind FROM community_channels WHERE community_id=$1 AND NOT deleted ORDER BY created_at,id").bind(&community_id).fetch_all(&mut *tx).await.map_err(unavailable)?
        .iter().map(|r| Ok(Channel { id:r.get("id"), community_id:r.get("community_id"), name:r.get("name"), category_id:r.get("category_id"), kind: match r.get::<&str,_>("kind") { "text"=>ChannelKind::Text,"announcement"=>ChannelKind::Announcement,"forum"=>ChannelKind::Forum,"voice"=>ChannelKind::Voice,"stage"=>ChannelKind::Stage,_=>return Err(StatusCode::SERVICE_UNAVAILABLE) } })).collect::<Result<Vec<_>>>()?;
    let governance = crate::governance::decode(row.get("governance"))?;
    let mut permitted = Vec::new();
    for channel in channels {
        if crate::governance::bits(
            &mut tx,
            &community_id,
            row.get("owner_id"),
            &account,
            Some(&channel.id),
            governance.as_ref(),
        )
        .await?
            & hearth_proto::governance::READ
            != 0
        {
            permitted.push(channel);
        }
    }
    let channels = permitted;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(CommunityStructure {
        community: community(&row),
        categories,
        channels,
        authority: decode_optional(row.get("authority"))?,
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
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM community_channels WHERE community_id=$1 AND NOT deleted",
    )
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
    sqlx::query("INSERT INTO community_channels(id,community_id,category_id,name,kind) VALUES($1,$2,$3,$4,$5)").bind(&result.id).bind(&result.community_id).bind(&result.category_id).bind(&result.name).bind(match result.kind {ChannelKind::Text=>"text",ChannelKind::Announcement=>"announcement",ChannelKind::Forum=>"forum",ChannelKind::Voice=>"voice",ChannelKind::Stage=>"stage"}).execute(&mut *tx).await.map_err(unavailable)?;
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
        code: request
            .code
            .clone()
            .unwrap_or_else(crate::auth::random_token),
        expires_in_seconds: request.expires_in_seconds,
        max_uses: request.max_uses,
    };
    id(&result.code)?;
    let root = decode_optional::<CommunityAuthority>(
        sqlx::query_scalar("SELECT authority FROM communities WHERE id=$1")
            .bind(&community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?,
    )?;
    match (&root, &request.authorization) {
        (Some(root), Some(certificate)) => {
            hearth_crypto::community::verify_invitation(
                &state.server_key.public().to_hex(),
                root,
                certificate,
            )
            .map_err(|_| StatusCode::BAD_REQUEST)?;
            if certificate.invite_id != hex::encode(Sha256::digest(result.code.as_bytes())) {
                return Err(StatusCode::BAD_REQUEST);
            }
            approved_issuer(&mut tx, &certificate.owner).await?;
        }
        (None, None) => {}
        _ => return Err(StatusCode::BAD_REQUEST),
    }
    sqlx::query("INSERT INTO community_invites(code_hash,community_id,created_by,expires_at,max_uses,certificate) VALUES($1,$2,$3,now()+make_interval(secs=>$4),$5,$6)")
        .bind(Sha256::digest(result.code.as_bytes()).to_vec()).bind(community_id).bind(account).bind(f64::from(result.expires_in_seconds)).bind(i32::try_from(result.max_uses).map_err(|_|StatusCode::BAD_REQUEST)?).bind(request.authorization.map(serde_json::to_value).transpose().map_err(|_|StatusCode::BAD_REQUEST)?).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(result))
}
async fn member_invitation(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Option<CommunityInvitation>>> {
    let account = authenticated(&state, &headers).await?;
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT m.invitation FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.community_id=$1 AND m.account_id=$2 AND NOT c.deleted",
    )
    .bind(id)
    .bind(account)
    .fetch_optional(&state.db)
    .await
    .map_err(unavailable)?
    .ok_or(StatusCode::FORBIDDEN)?;
    Ok(Json(decode_optional(value)?))
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
    let row =
        sqlx::query("SELECT id,name,owner_id,governance FROM communities WHERE id=$1 AND NOT deleted FOR UPDATE")
            .bind(&community_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    let policy = crate::governance::decode(row.get("governance"))?;
    // clock_timestamp, unlike now(), advances while concurrent joins wait for locks.
    let invitation = sqlx::query("SELECT uses,max_uses,certificate FROM community_invites WHERE code_hash=$1 AND expires_at>clock_timestamp() FOR UPDATE").bind(&digest).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    let joined: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2)",
    )
    .bind(&community_id)
    .bind(&account)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    let certificate = decode_optional::<CommunityInvitation>(invitation.get("certificate"))?;
    let issued = certificate.as_ref().map(|i| i.issued_at);
    if hearth_proto::governance::permissions_with_invite(
        policy.as_ref(),
        row.get("owner_id"),
        &account,
        None,
        crate::governance::now(),
        issued,
    ) & hearth_proto::governance::READ
        == 0
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let kicked = joined
        && crate::governance::bits(
            &mut tx,
            &community_id,
            row.get("owner_id"),
            &account,
            None,
            policy.as_ref(),
        )
        .await?
            & hearth_proto::governance::READ
            == 0
        && policy.as_ref().is_some_and(|p| {
            p.sanctions.iter().any(|s| {
                s.account_id == account && s.kind == hearth_proto::governance::SanctionKind::Kick
            })
        });
    if !joined || kicked {
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
            sqlx::query_scalar("SELECT count(*) FROM community_members m JOIN communities c ON c.id=m.community_id WHERE m.account_id=$1 AND NOT c.deleted")
                .bind(&account)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        if !joined && (total >= 1024 || own >= 100) {
            return Err(StatusCode::CONFLICT);
        }
        sqlx::query(
            "INSERT INTO community_members(community_id,account_id,invitation) VALUES($1,$2,$3) ON CONFLICT(community_id,account_id) DO UPDATE SET invitation=excluded.invitation,admission=NULL,joined_at=now()",
        )
        .bind(&community_id)
        .bind(account)
        .bind(invitation.get::<Option<serde_json::Value>, _>("certificate"))
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
