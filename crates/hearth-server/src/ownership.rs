//! Jointly signed root transfer. A host cannot replace a pinned community owner.
use crate::{SharedState, device::account_id};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use hearth_proto::{community::*, governance::*};
use sqlx::{PgConnection, Row};
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn decode<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T> {
    serde_json::from_value(v).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
fn encode(v: &impl serde::Serialize) -> Result<serde_json::Value> {
    serde_json::to_value(v).map_err(|_| StatusCode::BAD_REQUEST)
}
fn digest(v: &impl serde::Serialize) -> Result<String> {
    hearth_crypto::community::object_digest(v).map_err(|_| StatusCode::BAD_REQUEST)
}
async fn row(tx: &mut PgConnection, id: &str) -> Result<sqlx::postgres::PgRow> {
    if !hearth_crypto::messaging::valid_id(id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    sqlx::query("SELECT owner_id,authority,governance,ownership_offer FROM communities WHERE id=$1 AND NOT deleted FOR UPDATE")
        .bind(id).fetch_optional(tx).await.map_err(unavailable)?.ok_or(StatusCode::NOT_FOUND)
}
async fn endorsed(
    tx: &mut PgConnection,
    id: &str,
    governance: Option<&Governance>,
) -> Result<Vec<String>> {
    let mut values = Vec::new();
    let admissions: Vec<serde_json::Value> = sqlx::query_scalar(
        "SELECT admission FROM community_members WHERE community_id=$1 AND admission IS NOT NULL",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await
    .map_err(unavailable)?;
    for a in admissions {
        values.push(digest(&decode::<CommunityAdmission>(a)?)?);
    }
    let policies: Vec<Option<serde_json::Value>> = sqlx::query_scalar(
        "SELECT policy FROM community_channels WHERE community_id=$1 AND NOT deleted ORDER BY id",
    )
    .bind(id)
    .fetch_all(tx)
    .await
    .map_err(unavailable)?;
    for p in policies {
        values.push(digest(&decode::<ChannelPolicy>(
            p.ok_or(StatusCode::CONFLICT)?,
        )?)?);
    }
    if let Some(g) = governance {
        values.push(digest(g)?);
    }
    values.sort();
    values.dedup();
    Ok(values)
}
async fn member(tx: &mut PgConnection, id: &str, account: &str) -> Result<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2)",
    )
    .bind(id)
    .bind(account)
    .fetch_one(tx)
    .await
    .map_err(unavailable)?;
    if !exists {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
pub(crate) async fn get(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<OwnershipState>> {
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let r = row(&mut tx, &id).await?;
    member(&mut tx, &id, &account).await?;
    let governance = crate::governance::decode(r.get("governance"))?;
    if crate::governance::bits(
        &mut tx,
        &id,
        r.get("owner_id"),
        &account,
        None,
        governance.as_ref(),
    )
    .await?
        & READ
        == 0
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Json(OwnershipState {
        authority: decode(
            r.get::<Option<serde_json::Value>, _>("authority")
                .ok_or(StatusCode::CONFLICT)?,
        )?,
        endorsed: endorsed(&mut tx, &id, governance.as_ref()).await?,
        offer: r
            .get::<Option<serde_json::Value>, _>("ownership_offer")
            .map(decode)
            .transpose()?,
    }))
}
pub(crate) async fn offer(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(offer): Json<OwnershipHandoff>,
) -> Result<Json<OwnershipHandoff>> {
    let _permit = state.auth.admit()?;
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    hearth_crypto::community::verify_handoff(&state.server_key.public().to_hex(), &offer)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if offer.previous.community_id != id || offer.issuer.account_id != account {
        return Err(StatusCode::FORBIDDEN);
    }
    crate::delivery::approved(&state, &account, &offer.issuer.enrollment.device_key).await?;
    crate::delivery::approved(
        &state,
        &offer.successor.account_id,
        &offer.successor.enrollment.device_key,
    )
    .await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let r = row(&mut tx, &id).await?;
    if r.get::<String, _>("owner_id") != account {
        return Err(StatusCode::FORBIDDEN);
    }
    let authority: CommunityAuthority = decode(
        r.get::<Option<serde_json::Value>, _>("authority")
            .ok_or(StatusCode::CONFLICT)?,
    )?;
    let governance = crate::governance::decode(r.get("governance"))?;
    if authority != offer.previous
        || endorsed(&mut tx, &id, governance.as_ref()).await? != offer.endorsed
    {
        return Err(StatusCode::CONFLICT);
    }
    member(&mut tx, &id, &offer.successor.account_id).await?;
    let grant: CommunityAdmission = decode(
        sqlx::query_scalar::<_, Option<serde_json::Value>>(
            "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
        )
        .bind(&id)
        .bind(&offer.successor.account_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::FORBIDDEN)?,
    )?;
    hearth_crypto::community::verify_admission(
        &state.server_key.public().to_hex(),
        &authority,
        &grant,
    )
    .map_err(|_| StatusCode::FORBIDDEN)?;
    if grant.identity_key != offer.successor.enrollment.identity_key
        || governance.as_ref().is_some_and(|g| {
            g.sanctions
                .iter()
                .any(|s| s.account_id == offer.successor.account_id)
        })
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let channels: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM community_channels WHERE community_id=$1 AND NOT deleted",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await
    .map_err(unavailable)?;
    for c in channels {
        if crate::governance::bits(
            &mut tx,
            &id,
            &account,
            &offer.successor.account_id,
            Some(&c),
            governance.as_ref(),
        )
        .await?
            & READ
            == 0
        {
            return Err(StatusCode::FORBIDDEN);
        }
        let joined: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_devices WHERE conversation_id=$1 AND device_key=$2)").bind(c).bind(&offer.successor.enrollment.device_key).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if !joined {
            return Err(StatusCode::CONFLICT);
        }
    }
    sqlx::query("UPDATE communities SET ownership_offer=$2 WHERE id=$1")
        .bind(&id)
        .bind(encode(&offer)?)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(offer))
}
pub(crate) async fn cancel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let r = row(&mut tx, &id).await?;
    if r.get::<String, _>("owner_id") != account {
        return Err(StatusCode::FORBIDDEN);
    }
    sqlx::query("UPDATE communities SET ownership_offer=NULL WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn accept(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(value): Json<OwnershipAcceptance>,
) -> Result<Json<CommunityAuthority>> {
    let _permit = state.auth.admit()?;
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    let server = state.server_key.public().to_hex();
    hearth_crypto::community::verify_authority(&server, &value.authority)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    hearth_crypto::community::verify_governance(&server, &value.authority, &value.governance)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    hearth_crypto::community::verify_admission(&server, &value.authority, &value.former_owner)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let offer = value
        .authority
        .handoff
        .as_deref()
        .ok_or(StatusCode::BAD_REQUEST)?;
    if value.authority.community_id != id
        || value.authority.owner.account_id != account
        || value.former_owner.account_id != offer.previous.owner.account_id
        || value.former_owner.identity_key != offer.previous.owner.enrollment.identity_key
        || value.former_owner.invitation.is_some()
        || !value.former_owner.history_from.is_empty()
    {
        return Err(StatusCode::FORBIDDEN);
    }
    crate::delivery::approved(
        &state,
        &account,
        &value.authority.owner.enrollment.device_key,
    )
    .await?;
    crate::delivery::approved(
        &state,
        &account,
        &value.governance.owner.enrollment.device_key,
    )
    .await?;
    crate::delivery::approved(
        &state,
        &account,
        &value.former_owner.owner.enrollment.device_key,
    )
    .await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let r = row(&mut tx, &id).await?;
    let old: CommunityAuthority = decode(
        r.get::<Option<serde_json::Value>, _>("authority")
            .ok_or(StatusCode::CONFLICT)?,
    )?;
    let governance = crate::governance::decode(r.get("governance"))?;
    if old == value.authority && governance.as_ref() == Some(&value.governance) {
        return Ok(Json(value.authority));
    }
    let stored_offer: OwnershipHandoff = decode(
        r.get::<Option<serde_json::Value>, _>("ownership_offer")
            .ok_or(StatusCode::CONFLICT)?,
    )?;
    if old != offer.previous
        || stored_offer != *offer
        || endorsed(&mut tx, &id, governance.as_ref()).await? != offer.endorsed
    {
        return Err(StatusCode::CONFLICT);
    }
    member(&mut tx, &id, &account).await?;
    let mut expected = governance.unwrap_or_else(|| Governance {
        media_version: None,
        delegation: None,
        moderator_admission: None,
        community_id: id.clone(),
        revision: 0,
        everyone: DEFAULT,
        roles: vec![],
        assignments: vec![],
        overrides: vec![],
        sanctions: vec![],
        limits: vec![],
        rules: String::new(),
        screening: false,
        owner: value.authority.owner.clone(),
        signature: String::new(),
    });
    expected.revision += 1;
    expected.delegation = None;
    expected.moderator_admission = None;
    expected.owner = value.governance.owner.clone();
    expected.signature = value.governance.signature.clone();
    if expected != value.governance {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("UPDATE communities SET owner_id=$2,authority=$3,governance=$4,ownership_offer=NULL WHERE id=$1").bind(&id).bind(&account).bind(encode(&value.authority)?).bind(encode(&value.governance)?).execute(&mut *tx).await.map_err(unavailable)?;
    sqlx::query(
        "UPDATE community_members SET admission=$3 WHERE community_id=$1 AND account_id=$2 AND admission IS NULL",
    )
    .bind(&id)
    .bind(&value.former_owner.account_id)
    .bind(encode(&value.former_owner)?)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    sqlx::query("DELETE FROM community_invites WHERE community_id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("INSERT INTO community_audit(community_id,revision,actor_id,action,digest) VALUES($1,$2,$3,'ownership_transfer',$4)").bind(&id).bind(value.governance.revision as i64).bind(&account).bind(digest(&value)?).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(value.authority))
}
