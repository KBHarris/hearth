//! Ciphertext-only MLS delivery. Public certificates, headers and device signatures are verified.
use crate::{SharedState, device::account_id};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware,
    routing::{get, post},
};
use hearth_crypto::messaging::{valid_id, verify_commit, verify_message, verify_package};
use hearth_proto::{auth::Account, device::DeviceEnrollment, messaging::*};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row, postgres::PgRow};
use tower_http::cors::CorsLayer;
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn public<T: serde::Serialize>(value: &T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| StatusCode::BAD_REQUEST)
}
fn parsed<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
pub fn routes(origins: &[String]) -> Router<SharedState> {
    Router::new()
        .route("/people/{username}", get(person))
        .route("/accounts/{id}", get(person_by_id))
        .route("/packages", post(upload_package))
        .route("/packages/{device}", get(package_count))
        .route("/packages/claim", post(claim_packages))
        .route("/conversations", get(conversations))
        .route("/conversations/{id}/commit", post(commit))
        .route("/conversations/{id}/message", post(message))
        .route("/conversations/{id}/history", get(history))
        .route("/events/{device}", get(events))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
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
pub(crate) fn enrollment(row: &PgRow) -> DeviceEnrollment {
    DeviceEnrollment {
        identity_key: row.get("identity_key"),
        device_key: row.get("device_key"),
        certificate: row.get("certificate"),
        account_signature: row.get("account_signature"),
        device_signature: row.get("device_signature"),
    }
}
pub(crate) async fn approved(state: &SharedState, account: &str, device: &str) -> Result<()> {
    if !valid_id(device) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE account_id=$1 AND device_key=$2 AND NOT a.deleted)",
    )
    .bind(account)
    .bind(device)
    .fetch_one(&state.db)
    .await
    .map_err(unavailable)?;
    if exists {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}
async fn authenticated(state: &SharedState, headers: &HeaderMap) -> Result<String> {
    let account = account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    Ok(account)
}
async fn person(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(username): Path<String>,
) -> Result<Json<Person>> {
    authenticated(&state, &headers).await?;
    crate::auth::username(&username)?;
    let row = sqlx::query("SELECT id,username,owner FROM accounts WHERE username=$1")
        .bind(&username)
        .fetch_optional(&state.db)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let account = Account {
        id: row.get("id"),
        username: row.get("username"),
        owner: row.get("owner"),
    };
    let rows=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 ORDER BY d.device_key")
        .bind(&account.id).fetch_all(&state.db).await.map_err(unavailable)?;
    Ok(Json(Person {
        account,
        devices: rows.iter().map(enrollment).collect(),
    }))
}
async fn person_by_id(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Person>> {
    authenticated(&state, &headers).await?;
    if !valid_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let row = sqlx::query("SELECT id,username,owner FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let rows=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 ORDER BY d.device_key").bind(&id).fetch_all(&state.db).await.map_err(unavailable)?;
    Ok(Json(Person {
        account: Account {
            id: row.get("id"),
            username: row.get("username"),
            owner: row.get("owner"),
        },
        devices: rows.iter().map(enrollment).collect(),
    }))
}
async fn package_count(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(device): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let account = authenticated(&state, &headers).await?;
    approved(&state, &account, &device).await?;
    let available:i64=sqlx::query_scalar("SELECT count(*) FROM mls_key_packages WHERE device_key=$1 AND NOT claimed AND expires_at>now()").bind(device).fetch_one(&state.db).await.map_err(unavailable)?;
    Ok(Json(serde_json::json!({"available":available})))
}
async fn upload_package(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<KeyPackageRecord>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    if account != request.member.account_id {
        return Err(StatusCode::FORBIDDEN);
    }
    verify_package(&request, &state.server_key.public().to_hex())
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    // Same lock used by all pool uploads/claims: the four-package bound cannot race.
    let row=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 AND d.device_key=$2 FOR UPDATE OF d")
        .bind(&account).bind(&request.member.enrollment.device_key).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
    if enrollment(&row) != request.member.enrollment {
        return Err(StatusCode::FORBIDDEN);
    }
    let consumed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM consumed_mls_packages WHERE package_hash=$1)",
    )
    .bind(&request.package_hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    if consumed {
        tx.commit().await.map_err(unavailable)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    sqlx::query("DELETE FROM mls_key_packages WHERE expires_at <= now() AND device_key=$1")
        .bind(&request.member.enrollment.device_key)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let existing: Option<String> =
        sqlx::query_scalar("SELECT package FROM mls_key_packages WHERE package_hash=$1")
            .bind(&request.package_hash)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?;
    if let Some(existing) = existing {
        if existing != request.package {
            return Err(StatusCode::CONFLICT);
        }
    } else {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM mls_key_packages WHERE device_key=$1 AND NOT claimed AND expires_at>now()")
            .bind(&request.member.enrollment.device_key).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if count >= 4 {
            return Err(StatusCode::CONFLICT);
        }
        sqlx::query("INSERT INTO mls_key_packages (package_hash,account_id,device_key,package) VALUES($1,$2,$3,$4)")
            .bind(&request.package_hash).bind(&account).bind(&request.member.enrollment.device_key).bind(&request.package).execute(&mut *tx).await.map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn claim_packages(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(mut request): Json<PackageClaim>,
) -> Result<Json<Vec<KeyPackageRecord>>> {
    let _permit = state.auth.admit()?;
    authenticated(&state, &headers).await?;
    if request.device_keys.is_empty()
        || request.device_keys.len() > 32
        || request.device_keys.iter().any(|id| !valid_id(id))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    request.device_keys.sort();
    request.device_keys.dedup();
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let mut records = Vec::new();
    for device in &request.device_keys {
        let row=sqlx::query("SELECT d.account_id,a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.device_key=$1 FOR UPDATE OF d")
            .bind(device).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::NOT_FOUND)?;
        let package=sqlx::query("SELECT package_hash,package FROM mls_key_packages WHERE device_key=$1 AND NOT claimed AND expires_at>now() ORDER BY created_at,package_hash LIMIT 1 FOR UPDATE")
            .bind(device).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::CONFLICT)?;
        let hash: String = package.get("package_hash");
        sqlx::query("UPDATE mls_key_packages SET claimed=TRUE WHERE package_hash=$1")
            .bind(&hash)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        records.push(KeyPackageRecord {
            member: GroupMember {
                account_id: row.get("account_id"),
                enrollment: enrollment(&row),
            },
            package: package.get("package"),
            package_hash: hash,
        });
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(records))
}
fn conversation(row: &PgRow, accounts: Vec<String>) -> Result<Conversation> {
    Ok(Conversation {
        id: row.get("id"),
        channel_id: row.get("channel_id"),
        epoch: row.get::<i64, _>("epoch") as u64,
        members: parsed(row.get("members"))?,
        accounts,
    })
}
async fn conversations(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Conversation>>> {
    let account = authenticated(&state, &headers).await?;
    let rows=sqlx::query("SELECT c.id,c.channel_id,c.epoch,c.members FROM conversations c WHERE (c.channel_id IS NULL AND EXISTS(SELECT 1 FROM conversation_accounts a WHERE a.conversation_id=c.id AND a.account_id=$1)) OR (c.channel_id IS NOT NULL AND EXISTS(SELECT 1 FROM community_channels h JOIN community_members m ON m.community_id=h.community_id WHERE h.id=c.channel_id AND m.account_id=$1)) ORDER BY c.created_at,c.id")
        .bind(&account).fetch_all(&state.db).await.map_err(unavailable)?;
    let mut result = Vec::new();
    for row in rows {
        let id: String = row.get("id");
        if row.get::<Option<String>, _>("channel_id").is_some() {
            let mut tx = state.db.begin().await.map_err(unavailable)?;
            match crate::community::channel_access(&mut tx, &id, &account).await {
                Ok(_) => {}
                Err(StatusCode::FORBIDDEN) => continue,
                Err(error) => return Err(error),
            }
        }
        let accounts=sqlx::query_scalar("SELECT account_id FROM conversation_accounts WHERE conversation_id=$1 ORDER BY account_id").bind(&id).fetch_all(&state.db).await.map_err(unavailable)?;
        result.push(conversation(&row, accounts)?);
    }
    Ok(Json(result))
}
async fn deduplicated(
    tx: &mut PgConnection,
    id: &str,
    operation: &str,
    hash: &str,
) -> Result<bool> {
    let row = sqlx::query(
        "SELECT conversation_id,payload_hash FROM delivery_operations WHERE operation_id=$1",
    )
    .bind(operation)
    .fetch_optional(tx)
    .await
    .map_err(unavailable)?;
    if let Some(row) = row {
        if row.get::<String, _>("conversation_id") != id
            || row.get::<String, _>("payload_hash") != hash
        {
            return Err(StatusCode::CONFLICT);
        }
        Ok(true)
    } else {
        Ok(false)
    }
}
async fn record(
    tx: &mut PgConnection,
    id: &str,
    operation: &str,
    actor: (&str, &str),
    action: &str,
    target: Option<&str>,
    hash: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO delivery_operations(operation_id,conversation_id,account_id,device_key,action,target_id,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(operation).bind(id).bind(actor.0).bind(actor.1).bind(action).bind(target).bind(hash).execute(tx).await.map_err(unavailable)?;
    Ok(())
}
async fn fanout(
    tx: &mut PgConnection,
    id: &str,
    operation: &str,
    deliveries: Vec<(String, DeliveryData)>,
    ephemeral: bool,
) -> Result<()> {
    let mut deliveries = deliveries;
    deliveries.sort_by(|a, b| a.0.cmp(&b.0));
    for (device, data) in deliveries {
        sqlx::query(
            "INSERT INTO device_delivery_cursors(device_key) VALUES($1) ON CONFLICT DO NOTHING",
        )
        .bind(&device)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
        let seq:i64=sqlx::query_scalar("UPDATE device_delivery_cursors SET next_seq=next_seq+1 WHERE device_key=$1 RETURNING next_seq-1")
            .bind(&device).fetch_one(&mut *tx).await.map_err(unavailable)?;
        sqlx::query("INSERT INTO delivery_events(device_key,seq,conversation_id,operation_id,data,ephemeral) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(&device).bind(seq).bind(id).bind(operation).bind(public(&data)?).bind(ephemeral).execute(&mut *tx).await.map_err(unavailable)?;
    }
    Ok(())
}
async fn commit(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(upload): Json<CommitUpload>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    approved(&state, &account, &upload.device_key).await?;
    verify_commit(&id, &state.server_key.public().to_hex(), &upload)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&upload).map_err(|_| StatusCode::BAD_REQUEST)?,
    ));
    let mut accounts = upload
        .members
        .iter()
        .map(|m| m.account_id.clone())
        .collect::<Vec<_>>();
    accounts.sort();
    accounts.dedup();
    if accounts.is_empty() || !accounts.contains(&account) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let live = sqlx::query("SELECT deleted FROM accounts WHERE id=ANY($1) ORDER BY id FOR SHARE")
        .bind(&accounts)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
    if live.len() != accounts.len() || live.iter().any(|r| r.get::<bool, _>("deleted")) {
        return Err(StatusCode::FORBIDDEN);
    };

    // The insert's uniqueness lock and the existing-row lock order creation and all commits.
    let channel = crate::community::channel_access(&mut tx, &id, &account).await?;
    if let Some(channel) = &channel {
        let auth = upload.authorization.as_ref().ok_or(StatusCode::FORBIDDEN)?;
        if channel.authority.as_ref() != Some(&auth.authority)
            || channel.policy.as_ref() != Some(&auth.policy)
            || channel.governance != auth.governance
        {
            return Err(StatusCode::FORBIDDEN);
        }
        for member in &upload.members {
            if crate::governance::bits(
                &mut tx,
                &channel.community_id,
                &channel.owner_id,
                &member.account_id,
                Some(&id),
                channel.governance.as_ref(),
            )
            .await?
                & hearth_proto::governance::READ
                == 0
            {
                return Err(StatusCode::FORBIDDEN);
            }
            if member.account_id == auth.authority.owner.account_id {
                continue;
            }
            let grant: Option<serde_json::Value> = sqlx::query_scalar(
                "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
            )
            .bind(&channel.community_id)
            .bind(&member.account_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(unavailable)?
            .flatten();
            let grant: hearth_proto::community::CommunityAdmission =
                serde_json::from_value(grant.ok_or(StatusCode::FORBIDDEN)?)
                    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
            if !auth.admissions.contains(&grant) {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        let eligible: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM community_members WHERE community_id=$1 AND account_id=ANY($2)",
        )
        .bind(&channel.community_id)
        .bind(&accounts)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        if eligible != accounts.len() as i64 {
            return Err(StatusCode::FORBIDDEN);
        }
    } else if upload.authorization.is_some()
        || accounts.len() < 2
        || accounts.len() > 10
        || upload.members.len() > 32
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if channel.is_none() {
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_blocks WHERE account_id=ANY($1) AND blocked_id=ANY($1))").bind(&accounts).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if blocked {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let inserted = sqlx::query(
        "INSERT INTO conversations(id,epoch,members,channel_id) VALUES($1,0,'[]',$2) ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(channel.as_ref().map(|_| &id))
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?
    .rows_affected()
        == 1;
    let row =
        sqlx::query("SELECT epoch,members,channel_id FROM conversations WHERE id=$1 FOR UPDATE")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    if deduplicated(&mut tx, &id, &upload.operation_id, &hash).await? {
        tx.commit().await.map_err(unavailable)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    let old: Vec<GroupMember> = parsed(row.get("members"))?;
    if row.get::<Option<String>, _>("channel_id").is_some() != channel.is_some() {
        return Err(StatusCode::FORBIDDEN);
    }
    if row.get::<i64, _>("epoch") as u64 != upload.expected_epoch {
        return Err(StatusCode::CONFLICT);
    }
    if inserted {
        if upload.expected_epoch != 0
            || !upload
                .members
                .iter()
                .any(|m| m.account_id == account && m.enrollment.device_key == upload.device_key)
        {
            return Err(StatusCode::FORBIDDEN);
        }
        for member in &accounts {
            sqlx::query(
                "INSERT INTO conversation_accounts(conversation_id,account_id) VALUES($1,$2)",
            )
            .bind(&id)
            .bind(member)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        }
    } else {
        let expected:Vec<String>=sqlx::query_scalar("SELECT account_id FROM conversation_accounts WHERE conversation_id=$1 ORDER BY account_id").bind(&id).fetch_all(&mut *tx).await.map_err(unavailable)?;
        if (channel.is_none() && expected != accounts)
            || !old
                .iter()
                .any(|m| m.account_id == account && m.enrollment.device_key == upload.device_key)
            || (channel.is_none() && old.iter().any(|m| !upload.members.contains(m)))
        {
            return Err(StatusCode::FORBIDDEN);
        }
        if let Some(channel) = &channel {
            for removed in old.iter().filter(|m| !upload.members.contains(m)) {
                if crate::governance::bits(
                    &mut tx,
                    &channel.community_id,
                    &channel.owner_id,
                    &removed.account_id,
                    Some(&id),
                    channel.governance.as_ref(),
                )
                .await?
                    & hearth_proto::governance::READ
                    != 0
                {
                    return Err(StatusCode::FORBIDDEN);
                }
            }
            sqlx::query("DELETE FROM conversation_accounts WHERE conversation_id=$1 AND account_id<>ALL($2)").bind(&id).bind(&accounts).execute(&mut *tx).await.map_err(unavailable)?;
            let devices = upload
                .members
                .iter()
                .map(|m| m.enrollment.device_key.clone())
                .collect::<Vec<_>>();
            sqlx::query(
                "DELETE FROM conversation_devices WHERE conversation_id=$1 AND device_key<>ALL($2)",
            )
            .bind(&id)
            .bind(devices)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
            for member in &accounts {
                sqlx::query("INSERT INTO conversation_accounts(conversation_id,account_id) VALUES($1,$2) ON CONFLICT DO NOTHING")
                    .bind(&id).bind(member).execute(&mut *tx).await.map_err(unavailable)?;
            }
        }
    }
    for member in &upload.members {
        let row=sqlx::query("SELECT a.identity_key,d.device_key,d.certificate,d.account_signature,d.device_signature FROM account_devices d JOIN accounts a ON a.id=d.account_id WHERE d.account_id=$1 AND d.device_key=$2")
            .bind(&member.account_id).bind(&member.enrollment.device_key).fetch_optional(&mut *tx).await.map_err(unavailable)?.ok_or(StatusCode::FORBIDDEN)?;
        if enrollment(&row) != member.enrollment {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let mut added = upload
        .members
        .iter()
        .filter(|m| !old.contains(m) && !(inserted && m.enrollment.device_key == upload.device_key))
        .collect::<Vec<_>>();
    if added.len() != upload.welcomes.len()
        || (added.is_empty()
            && !(old.iter().any(|m| !upload.members.contains(m))
                || channel.as_ref().is_some_and(|c| c.owner_id == account)
                || (inserted && channel.is_some() && upload.members.len() == 1)))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    added.sort_by(|a, b| a.enrollment.device_key.cmp(&b.enrollment.device_key));
    let mut deliveries = Vec::new();
    for member in &added {
        sqlx::query("SELECT device_key FROM account_devices WHERE device_key=$1 FOR UPDATE")
            .bind(&member.enrollment.device_key)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
        let welcome = upload
            .welcomes
            .iter()
            .find(|w| w.device_key == member.enrollment.device_key)
            .ok_or(StatusCode::BAD_REQUEST)?;
        let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mls_key_packages WHERE package_hash=$1 AND device_key=$2 AND claimed AND expires_at>now())")
            .bind(&welcome.package_hash).bind(&welcome.device_key).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if !valid {
            return Err(StatusCode::CONFLICT);
        }
        sqlx::query("INSERT INTO consumed_mls_packages(package_hash,device_key) VALUES($1,$2)")
            .bind(&welcome.package_hash)
            .bind(&welcome.device_key)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        sqlx::query("DELETE FROM mls_key_packages WHERE package_hash=$1")
            .bind(&welcome.package_hash)
            .execute(&mut *tx)
            .await
            .map_err(unavailable)?;
        deliveries.push((
            welcome.device_key.clone(),
            DeliveryData::Welcome {
                upload: upload.clone(),
                welcome: welcome.clone(),
            },
        ));
    }
    for member in &old {
        deliveries.push((
            member.enrollment.device_key.clone(),
            DeliveryData::Commit {
                upload: upload.clone(),
            },
        ));
    }
    if inserted {
        deliveries.push((
            upload.device_key.clone(),
            DeliveryData::Commit {
                upload: upload.clone(),
            },
        ));
    }
    sqlx::query(
        "UPDATE conversations SET epoch=epoch+1,members=$2,governance_revision=$3 WHERE id=$1",
    )
    .bind(&id)
    .bind(public(&upload.members)?)
    .bind(
        channel
            .as_ref()
            .and_then(|c| c.governance.as_ref())
            .map_or(0, |p| p.revision as i64),
    )
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    for member in &upload.members {
        sqlx::query("INSERT INTO conversation_devices(conversation_id,device_key) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(&id).bind(&member.enrollment.device_key).execute(&mut *tx).await.map_err(unavailable)?;
    }
    record(
        &mut tx,
        &id,
        &upload.operation_id,
        (&account, &upload.device_key),
        "commit",
        None,
        &hash,
    )
    .await?;
    fanout(&mut tx, &id, &upload.operation_id, deliveries, false).await?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn message(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(upload): Json<MessageUpload>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    approved(&state, &account, &upload.device_key).await?;
    verify_message(&id, &state.server_key.public().to_hex(), &upload)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&upload).map_err(|_| StatusCode::BAD_REQUEST)?,
    ));
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let channel = crate::community::channel_access(&mut tx, &id, &account).await?;
    if channel.is_none() {
        crate::safety::dm_allowed(&mut tx, &id, &account).await?;
    }
    if !matches!(
        upload.action,
        MessageAction::Typing | MessageAction::Control
    ) && channel
        .as_ref()
        .and_then(|c| c.policy.as_ref())
        .is_some_and(|p| p.history != hearth_proto::community::HistoryPolicy::None)
        && upload.archive.is_none()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if upload.archive.is_some()
        && channel.as_ref().is_none_or(|c| {
            c.policy
                .as_ref()
                .is_none_or(|p| p.history == hearth_proto::community::HistoryPolicy::None)
        })
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(channel) = &channel {
        if channel.authority.is_none() || channel.policy.is_none() {
            return Err(StatusCode::FORBIDDEN);
        }
        if channel.owner_id != account {
            let admitted:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2 AND admission IS NOT NULL)").bind(&channel.community_id).bind(&account).fetch_one(&mut *tx).await.map_err(unavailable)?;
            if !admitted {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }
    if let Some(channel) = &channel
        && channel.announcement
        && channel.owner_id != account
        && !matches!(
            upload.action,
            MessageAction::Reaction | MessageAction::Control | MessageAction::Pin
        )
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(channel) = &channel {
        let required = match upload.action {
            MessageAction::Pin => hearth_proto::governance::PIN,
            MessageAction::Reaction => hearth_proto::governance::REACT,
            MessageAction::Control => hearth_proto::governance::READ,
            _ => hearth_proto::governance::SEND,
        };
        if crate::governance::bits(
            &mut tx,
            &channel.community_id,
            &channel.owner_id,
            &account,
            Some(&id),
            channel.governance.as_ref(),
        )
        .await?
            & required
            == 0
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let row = sqlx::query(
        "SELECT epoch,members,governance_revision FROM conversations WHERE id=$1 FOR UPDATE",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?
    .ok_or(StatusCode::NOT_FOUND)?;
    let members: Vec<GroupMember> = parsed(row.get("members"))?;
    let audience = members
        .iter()
        .map(|m| m.account_id.clone())
        .collect::<Vec<_>>();
    let live = sqlx::query("SELECT deleted FROM accounts WHERE id=ANY($1) ORDER BY id FOR SHARE")
        .bind(&audience)
        .fetch_all(&mut *tx)
        .await
        .map_err(unavailable)?;
    if live.iter().any(|r| r.get::<bool, _>("deleted")) {
        return Err(StatusCode::CONFLICT);
    };

    if let Some(channel) = &channel {
        for member in &members {
            if crate::governance::bits(
                &mut tx,
                &channel.community_id,
                &channel.owner_id,
                &member.account_id,
                Some(&id),
                channel.governance.as_ref(),
            )
            .await?
                & hearth_proto::governance::READ
                == 0
            {
                return Err(StatusCode::CONFLICT);
            }
        }
    }
    if let Some(archive) = &upload.archive
        && !members.contains(&archive.member)
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if !members
        .iter()
        .any(|m| m.account_id == account && m.enrollment.device_key == upload.device_key)
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if deduplicated(&mut tx, &id, &upload.operation_id, &hash).await? {
        tx.commit().await.map_err(unavailable)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if let Some(channel) = &channel
        && row.get::<i64, _>("governance_revision")
            != channel.governance.as_ref().map_or(0, |p| p.revision as i64)
    {
        return Err(StatusCode::CONFLICT);
    }
    if row.get::<i64, _>("epoch") as u64 != upload.epoch {
        return Err(StatusCode::CONFLICT);
    }
    if upload.action == MessageAction::Send
        && let Some(channel) = &channel
        && account != channel.owner_id
        && let Some(limit) = channel
            .governance
            .as_ref()
            .and_then(|p| p.limits.iter().find(|l| l.channel_id == id))
        && limit.slowmode_seconds > 0
    {
        let recent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM delivery_operations WHERE conversation_id=$1 AND account_id=$2 AND action='send' AND created_at>now()-($3 * interval '1 second'))").bind(&id).bind(&account).bind(limit.slowmode_seconds as i32).fetch_one(&mut *tx).await.map_err(unavailable)?;
        if recent {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
    }
    if let Some(target) = &upload.target_id {
        let author:Option<String>=sqlx::query_scalar("SELECT account_id FROM delivery_operations WHERE operation_id=$1 AND conversation_id=$2 AND action='send' AND NOT hearth_retention_expired(conversation_id,created_at)").bind(target).bind(&id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        if author.is_none()
            || (matches!(upload.action, MessageAction::Edit | MessageAction::Delete)
                && author.as_deref() != Some(&account))
        {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let action = match upload.action {
        MessageAction::Send => "send",
        MessageAction::Edit => "edit",
        MessageAction::Delete => "delete",
        MessageAction::Typing => "typing",
        MessageAction::Reaction => "reaction",
        MessageAction::Pin => "pin",
        MessageAction::Control => "control",
    };
    record(
        &mut tx,
        &id,
        &upload.operation_id,
        (&account, &upload.device_key),
        action,
        upload.target_id.as_deref(),
        &hash,
    )
    .await?;
    if upload.action == MessageAction::Delete {
        // Recipient copies/backups cannot be recalled. Remove retained originals and edits here.
        sqlx::query("UPDATE delivery_events SET data=$1 WHERE operation_id IN (SELECT operation_id FROM delivery_operations WHERE operation_id=$2 OR (target_id=$2 AND action='edit'))")
            .bind(public(&DeliveryData::Redacted)?).bind(&upload.target_id).execute(&mut *tx).await.map_err(unavailable)?;
        sqlx::query("DELETE FROM channel_archives WHERE operation_id=$1 OR operation_id IN (SELECT operation_id FROM delivery_operations WHERE target_id=$1 AND action='edit')").bind(&upload.target_id).execute(&mut *tx).await.map_err(unavailable)?;
    }
    if upload.archive.is_some() {
        sqlx::query("INSERT INTO channel_archives(operation_id,conversation_id,epoch,upload) VALUES($1,$2,$3,$4)").bind(&upload.operation_id).bind(&id).bind(upload.epoch as i64).bind(public(&upload)?).execute(&mut *tx).await.map_err(unavailable)?;
    }
    fanout(
        &mut tx,
        &id,
        &upload.operation_id,
        members
            .iter()
            .map(|m| {
                (
                    m.enrollment.device_key.clone(),
                    DeliveryData::Message {
                        upload: upload.clone(),
                    },
                )
            })
            .collect(),
        upload.action == MessageAction::Typing,
    )
    .await?;
    if upload.action == MessageAction::Send {
        crate::push::enqueue(
            &mut tx,
            &members
                .iter()
                .map(|m| m.account_id.clone())
                .collect::<Vec<_>>(),
            &account,
        )
        .await?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct EventsQuery {
    pub after: u64,
}
#[derive(Deserialize)]
struct HistoryQuery {
    after: u64,
    device: String,
}
async fn history(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<HistoryPage>> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    approved(&state, &account, &query.device).await?;
    if query.after > 9_007_199_254_740_991 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let access = crate::community::channel_access(&mut tx, &id, &account)
        .await?
        .ok_or(StatusCode::FORBIDDEN)?;
    let joined:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_devices WHERE conversation_id=$1 AND device_key=$2)").bind(&id).bind(&query.device).fetch_one(&mut *tx).await.map_err(unavailable)?;
    if !joined {
        return Err(StatusCode::FORBIDDEN);
    }
    let policy = access.policy.ok_or(StatusCode::FORBIDDEN)?;
    use hearth_proto::community::HistoryPolicy;
    let floor = match policy.history {
        HistoryPolicy::None => return Err(StatusCode::FORBIDDEN),
        HistoryPolicy::Full => 0,
        HistoryPolicy::SinceInvite if access.owner_id == account => 0,
        HistoryPolicy::SinceInvite => {
            let value: Option<serde_json::Value> = sqlx::query_scalar(
                "SELECT admission FROM community_members WHERE community_id=$1 AND account_id=$2",
            )
            .bind(&access.community_id)
            .bind(&account)
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
            let grant: hearth_proto::community::CommunityAdmission =
                parsed(value.ok_or(StatusCode::FORBIDDEN)?)?;
            grant
                .history_from
                .get(&id)
                .copied()
                .or_else(|| {
                    grant
                        .invitation
                        .as_ref()
                        .filter(|invite| policy.history_open_for.contains(&invite.invite_id))
                        .map(|_| 0)
                })
                .ok_or(StatusCode::FORBIDDEN)?
        }
    };
    let rows=sqlx::query("SELECT a.seq,a.upload FROM channel_archives a JOIN delivery_operations o ON o.operation_id=a.operation_id WHERE a.conversation_id=$1 AND a.seq>$2 AND a.epoch>=$3 AND NOT hearth_retention_expired(a.conversation_id,o.created_at) ORDER BY a.seq LIMIT 128").bind(&id).bind(query.after as i64).bind(floor as i64).fetch_all(&mut *tx).await.map_err(unavailable)?;
    let next = rows
        .last()
        .map_or(query.after, |r| r.get::<i64, _>("seq") as u64);
    let items = rows
        .into_iter()
        .map(|r| parsed(r.get("upload")))
        .collect::<Result<Vec<MessageUpload>>>()?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(HistoryPage { items, next }))
}
pub(crate) async fn backlog(
    state: &SharedState,
    device: &str,
    after: u64,
) -> Result<Vec<DeliveryEvent>> {
    if after > 9_007_199_254_740_991 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rows=sqlx::query("SELECT seq,conversation_id,CASE WHEN (ephemeral AND created_at<now()-interval '10 seconds') OR (data->>'kind'='message' AND hearth_retention_expired(conversation_id,created_at)) THEN '{\"kind\":\"redacted\"}'::jsonb ELSE data END AS data FROM delivery_events WHERE device_key=$1 AND seq>$2 ORDER BY seq LIMIT 128")
        .bind(device).bind(after as i64).fetch_all(&state.db).await.map_err(unavailable)?;
    let account: String =
        sqlx::query_scalar("SELECT account_id FROM account_devices WHERE device_key=$1")
            .bind(device)
            .fetch_one(&state.db)
            .await
            .map_err(unavailable)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let mut permitted = std::collections::HashMap::new();
    let mut events = Vec::new();
    for r in rows {
        let id: String = r.get("conversation_id");
        let allowed = if let Some(value) = permitted.get(&id) {
            *value
        } else {
            let value = match crate::community::channel_access(&mut tx, &id, &account).await {
                Ok(_) => true,
                Err(StatusCode::FORBIDDEN) => false,
                Err(error) => return Err(error),
            };
            permitted.insert(id.clone(), value);
            value
        };
        events.push(DeliveryEvent {
            seq: r.get::<i64, _>("seq") as u64,
            conversation_id: id,
            data: if allowed {
                parsed(r.get("data"))?
            } else {
                DeliveryData::Redacted
            },
        });
    }
    Ok(events)
}
async fn events(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(device): Path<String>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<Vec<DeliveryEvent>>> {
    let account = authenticated(&state, &headers).await?;
    approved(&state, &account, &device).await?;
    Ok(Json(backlog(&state, &device, query.after).await?))
}
