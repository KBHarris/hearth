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
fn enrollment(row: &PgRow) -> DeviceEnrollment {
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
        "SELECT EXISTS(SELECT 1 FROM account_devices WHERE account_id=$1 AND device_key=$2)",
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
    let rows=sqlx::query("SELECT c.id,c.epoch,c.members FROM conversations c JOIN conversation_accounts a ON a.conversation_id=c.id WHERE a.account_id=$1 ORDER BY c.created_at,c.id")
        .bind(&account).fetch_all(&state.db).await.map_err(unavailable)?;
    let mut result = Vec::new();
    for row in rows {
        let id: String = row.get("id");
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
    if accounts.len() < 2 || accounts.len() > 10 || !accounts.contains(&account) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    // The insert's uniqueness lock and the existing-row lock order creation and all commits.
    let inserted = sqlx::query(
        "INSERT INTO conversations(id,epoch,members) VALUES($1,0,'[]') ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?
    .rows_affected()
        == 1;
    let row = sqlx::query("SELECT epoch,members FROM conversations WHERE id=$1 FOR UPDATE")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    if deduplicated(&mut tx, &id, &upload.operation_id, &hash).await? {
        tx.commit().await.map_err(unavailable)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    let old: Vec<GroupMember> = parsed(row.get("members"))?;
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
        if expected != accounts
            || !old
                .iter()
                .any(|m| m.account_id == account && m.enrollment.device_key == upload.device_key)
            || old.iter().any(|m| !upload.members.contains(m))
        {
            return Err(StatusCode::FORBIDDEN);
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
    if added.len() != upload.welcomes.len() || added.is_empty() {
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
    sqlx::query("UPDATE conversations SET epoch=epoch+1,members=$2 WHERE id=$1")
        .bind(&id)
        .bind(public(&upload.members)?)
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
    let row = sqlx::query("SELECT epoch,members FROM conversations WHERE id=$1 FOR UPDATE")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let members: Vec<GroupMember> = parsed(row.get("members"))?;
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
    if row.get::<i64, _>("epoch") as u64 != upload.epoch {
        return Err(StatusCode::CONFLICT);
    }
    if let Some(target) = &upload.target_id {
        let author:Option<String>=sqlx::query_scalar("SELECT account_id FROM delivery_operations WHERE operation_id=$1 AND conversation_id=$2 AND action='send'").bind(target).bind(&id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
        if author.as_deref() != Some(&account) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let action = match upload.action {
        MessageAction::Send => "send",
        MessageAction::Edit => "edit",
        MessageAction::Delete => "delete",
        MessageAction::Typing => "typing",
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
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct EventsQuery {
    pub after: u64,
}
pub(crate) async fn backlog(
    state: &SharedState,
    device: &str,
    after: u64,
) -> Result<Vec<DeliveryEvent>> {
    if after > 9_007_199_254_740_991 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rows=sqlx::query("SELECT seq,conversation_id,CASE WHEN ephemeral AND created_at<now()-interval '10 seconds' THEN '{\"kind\":\"redacted\"}'::jsonb ELSE data END AS data FROM delivery_events WHERE device_key=$1 AND seq>$2 ORDER BY seq LIMIT 128")
        .bind(device).bind(after as i64).fetch_all(&state.db).await.map_err(unavailable)?;
    rows.into_iter()
        .map(|r| {
            Ok(DeliveryEvent {
                seq: r.get::<i64, _>("seq") as u64,
                conversation_id: r.get("conversation_id"),
                data: parsed(r.get("data"))?,
            })
        })
        .collect()
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
