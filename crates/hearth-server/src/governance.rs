//! Signed, content-free policy storage and enforcement.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::governance::*;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
pub(crate) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub(crate) fn decode(value: Option<serde_json::Value>) -> Result<Option<Governance>> {
    value
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
pub(crate) fn rules_digest(policy: &Governance) -> String {
    hex::encode(Sha256::digest(policy.rules.as_bytes()))
}
pub(crate) async fn rules_accepted(
    tx: &mut PgConnection,
    community: &str,
    owner: &str,
    account: &str,
    policy: Option<&Governance>,
) -> Result<bool> {
    let Some(p) = policy.filter(|p| p.screening && account != owner) else {
        return Ok(true);
    };
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM community_rules_acceptance WHERE community_id=$1 AND account_id=$2 AND digest=$3)")
        .bind(community).bind(account).bind(rules_digest(p)).fetch_one(&mut *tx).await.map_err(unavailable)
}
pub(crate) async fn bits(
    tx: &mut PgConnection,
    community: &str,
    owner: &str,
    account: &str,
    channel: Option<&str>,
    policy: Option<&Governance>,
) -> Result<u32> {
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members m JOIN accounts a ON a.id=m.account_id WHERE community_id=$1 AND account_id=$2 AND NOT a.deleted)",
    )
    .bind(community)
    .bind(account)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    if !member {
        return Ok(0);
    }
    let invite:Option<serde_json::Value>=sqlx::query_scalar("SELECT CASE WHEN admission IS NOT NULL THEN admission->'invitation' ELSE invitation END FROM community_members WHERE community_id=$1 AND account_id=$2").bind(community).bind(account).fetch_optional(&mut *tx).await.map_err(unavailable)?.flatten();
    let issued = invite
        .as_ref()
        .and_then(|v| v.get("issued_at"))
        .and_then(serde_json::Value::as_u64);
    let mut value = permissions_with_invite(policy, owner, account, channel, now(), issued);
    if !rules_accepted(tx, community, owner, account, policy).await? {
        // Screening permits read-only onboarding and does not change the MLS audience.
        value &= !(SEND | REACT | ATTACH | PIN);
    }
    Ok(value)
}
async fn auth(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let account = account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    Ok(account)
}
async fn member(tx: &mut PgConnection, id: &str, account: &str) -> Result<sqlx::postgres::PgRow> {
    if !hearth_crypto::messaging::valid_id(id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let row =
        sqlx::query("SELECT owner_id,authority,governance FROM communities WHERE id=$1 FOR SHARE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(StatusCode::NOT_FOUND)?;
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members m JOIN accounts a ON a.id=m.account_id WHERE community_id=$1 AND account_id=$2 AND NOT a.deleted)",
    )
    .bind(id)
    .bind(account)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    let p = decode(row.get("governance"))?;
    if !member || bits(tx, id, row.get("owner_id"), account, None, p.as_ref()).await? & READ == 0 {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(row)
}
pub(crate) async fn get(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<GovernanceView>> {
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let row = member(&mut tx, &id, &account).await?;
    let members = sqlx::query("SELECT a.id,a.username,a.owner FROM accounts a JOIN community_members m ON m.account_id=a.id WHERE m.community_id=$1 ORDER BY a.username").bind(&id).fetch_all(&mut *tx).await.map_err(unavailable)?.iter().map(|r| hearth_proto::auth::Account{id:r.get("id"),username:r.get("username"),owner:r.get("owner")}).collect();
    let governance = decode(row.get("governance"))?;
    let rules_accepted = rules_accepted(
        &mut tx,
        &id,
        row.get("owner_id"),
        &account,
        governance.as_ref(),
    )
    .await?;
    let admission: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
    )
    .bind(&id)
    .bind(&account)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?
    .flatten();
    let admission = admission
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .map(Box::new);
    Ok(Json(GovernanceView {
        admission,
        governance,
        members,
        rules_accepted,
    }))
}
pub(crate) async fn set(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(policy): Json<Governance>,
) -> Result<Json<Governance>> {
    let _permit = state.auth.admit()?;
    let account = auth(&state, &headers).await?;
    if policy.community_id != id || policy.owner.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let row =
        sqlx::query("SELECT owner_id,authority,governance FROM communities WHERE id=$1 FOR UPDATE")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .ok_or(StatusCode::NOT_FOUND)?;
    let owner = row.get::<String, _>("owner_id") == account;
    crate::delivery::approved(&state, &account, &policy.owner.enrollment.device_key).await?;
    let authority: hearth_proto::community::CommunityAuthority = serde_json::from_value(
        row.get::<Option<serde_json::Value>, _>("authority")
            .ok_or(StatusCode::CONFLICT)?,
    )
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    hearth_crypto::community::verify_governance(
        &state.server_key.public().to_hex(),
        &authority,
        &policy,
    )
    .map_err(|_| {
        if owner {
            StatusCode::BAD_REQUEST
        } else {
            StatusCode::FORBIDDEN
        }
    })?;
    let old = decode(row.get("governance"))?;
    if old
        .as_ref()
        .is_some_and(|p| !hearth_proto::governance::kicks_preserved(p, &policy))
    {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(grant) = &policy.moderator_admission {
        let current: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
        )
        .bind(&id)
        .bind(&account)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .flatten();
        if current.as_ref()
            != Some(&serde_json::to_value(grant).map_err(|_| StatusCode::BAD_REQUEST)?)
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    if old.as_ref() == Some(&policy) {
        return Ok(Json(policy));
    }
    if !owner && policy.delegation.as_deref() != old.as_ref() {
        return Err(StatusCode::CONFLICT);
    }
    if policy.revision != old.as_ref().map_or(1, |p| p.revision + 1) {
        return Err(StatusCode::CONFLICT);
    }
    let members: Vec<String> =
        sqlx::query_scalar("SELECT account_id FROM community_members WHERE community_id=$1")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
    let channels: Vec<String> =
        sqlx::query_scalar("SELECT id FROM community_channels WHERE community_id=$1")
            .bind(&id)
            .fetch_all(&mut *tx)
            .await
            .map_err(unavailable)?;
    if policy
        .assignments
        .iter()
        .any(|a| !members.contains(&a.account_id))
        || policy.sanctions.iter().any(|s| {
            !members.contains(&s.account_id)
                || s.channel_id.as_ref().is_some_and(|c| !channels.contains(c))
        })
        || policy.overrides.iter().any(|o| {
            !channels.contains(&o.channel_id)
                || (o.kind == OverrideKind::Member && !members.contains(&o.target_id))
        })
        || policy
            .limits
            .iter()
            .any(|l| !channels.contains(&l.channel_id))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let digest = hex::encode(Sha256::digest(
        serde_json::to_vec(&policy).map_err(|_| StatusCode::BAD_REQUEST)?,
    ));
    sqlx::query("UPDATE communities SET governance=$2 WHERE id=$1")
        .bind(&id)
        .bind(serde_json::to_value(&policy).map_err(|_| StatusCode::BAD_REQUEST)?)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("INSERT INTO community_audit(community_id,revision,actor_id,action,digest) VALUES($1,$2,$3,'governance_update',$4)").bind(&id).bind(policy.revision as i64).bind(account).bind(digest).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(policy))
}
pub(crate) async fn audit(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Vec<AuditEntry>>> {
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let row = member(&mut tx, &id, &account).await?;
    let policy = decode(row.get("governance"))?;
    if bits(
        &mut tx,
        &id,
        row.get("owner_id"),
        &account,
        None,
        policy.as_ref(),
    )
    .await?
        & AUDIT
        == 0
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let entries = sqlx::query("SELECT revision,actor_id,action,digest FROM community_audit WHERE community_id=$1 ORDER BY revision DESC LIMIT 100").bind(id).fetch_all(&mut *tx).await.map_err(unavailable)?.iter().map(|r|AuditEntry{revision:r.get::<i64,_>("revision") as u64,actor_id:r.get("actor_id"),action:r.get("action"),digest:r.get("digest")}).collect();
    Ok(Json(entries))
}

pub(crate) async fn accept_rules(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<RulesAcceptance>,
) -> Result<Json<GovernanceView>> {
    let _permit = state.auth.admit()?;
    let account = auth(&state, &headers).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let row = member(&mut tx, &id, &account).await?;
    let policy = decode(row.get("governance"))?.ok_or(StatusCode::CONFLICT)?;
    if !policy.screening || request.digest != rules_digest(&policy) {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("INSERT INTO community_rules_acceptance(community_id,account_id,digest) VALUES($1,$2,$3) ON CONFLICT(community_id,account_id) DO UPDATE SET digest=EXCLUDED.digest,accepted_at=now()")
        .bind(&id).bind(&account).bind(request.digest).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    get(State(state.clone()), headers, Path(id)).await
}
