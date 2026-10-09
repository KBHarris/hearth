//! Private S3 leases. No file names, MIME types, thumbnails, content or file keys cross here.
use crate::{SharedState, delivery::approved, device::account_id};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware,
    routing::{get, post},
};
use hearth_crypto::messaging::valid_id;
use hearth_proto::messaging::{BlobReservation, BlobUrl};
use s3::{Bucket, Region, bucket_ops::BucketConfiguration, creds::Credentials};
use serde::Deserialize;
use sqlx::Row;
type Result<T> = std::result::Result<T, StatusCode>;
const BUCKET: &str = "hearth-blobs";
const EXPIRY: u32 = 300;
#[derive(Clone)]
pub struct StorageConfig {
    pub endpoint: String,
    pub public_endpoint: String,
    pub access_key: String,
    pub secret_key: String,
}
impl std::fmt::Debug for StorageConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StorageConfig([redacted])")
    }
}
impl StorageConfig {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let Ok(endpoint) = std::env::var("HEARTH_S3_ENDPOINT") else {
            return Ok(None);
        };
        let public_endpoint = std::env::var("HEARTH_S3_PUBLIC_ENDPOINT")?;
        let access_key = std::env::var("HEARTH_S3_ACCESS_KEY")?;
        let secret_key = std::env::var("HEARTH_S3_SECRET_KEY")?;
        for value in [&endpoint, &public_endpoint] {
            let uri: axum::http::Uri = value.parse()?;
            anyhow::ensure!(
                uri.authority().is_some()
                    && uri.path() == "/"
                    && uri.query().is_none()
                    && !value.contains('@')
                    && matches!(uri.scheme_str(), Some("http" | "https")),
                "S3 endpoint must be an HTTP(S) origin"
            );
        }
        let uri: axum::http::Uri = public_endpoint.parse()?;
        anyhow::ensure!(
            uri.scheme_str() == Some("https")
                || matches!(uri.host(), Some("127.0.0.1" | "localhost" | "[::1]")),
            "Public S3 endpoint requires HTTPS or loopback"
        );
        anyhow::ensure!(
            access_key.len() >= 16 && secret_key.len() >= 32,
            "S3 credentials must be randomly generated"
        );
        Ok(Some(Self {
            endpoint,
            public_endpoint,
            access_key,
            secret_key,
        }))
    }
    fn credentials(&self) -> Result<Credentials> {
        Credentials::new(
            Some(&self.access_key),
            Some(&self.secret_key),
            None,
            None,
            None,
        )
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
    }
    fn bucket(&self, public: bool) -> Result<Box<Bucket>> {
        Bucket::new(
            BUCKET,
            Region::Custom {
                region: "us-east-1".into(),
                endpoint: if public {
                    &self.public_endpoint
                } else {
                    &self.endpoint
                }
                .clone(),
            },
            self.credentials()?,
        )
        .map(|b| b.with_path_style())
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
    }
    async fn ensure_bucket(&self) -> Result<()> {
        let (_, status) = self
            .bucket(false)?
            .head_object("")
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if status == 404 {
            let result = Bucket::create_with_path_style(
                BUCKET,
                Region::Custom {
                    region: "us-east-1".into(),
                    endpoint: self.endpoint.clone(),
                },
                self.credentials()?,
                BucketConfiguration::default(),
            )
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
            if !matches!(result.response_code, 200 | 204 | 409) {
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        } else if status != 200 {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok(())
    }
}
pub fn routes(origins: &[String]) -> Router<SharedState> {
    Router::new()
        .route("/{conversation}", post(reserve))
        .route("/{conversation}/{id}/complete", post(complete))
        .route("/{conversation}/{id}", get(download))
        .layer(DefaultBodyLimit::max(4096))
        .layer(
            tower_http::cors::CorsLayer::new()
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
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
async fn access(
    state: &SharedState,
    headers: &HeaderMap,
    conversation: &str,
    device: &str,
    publishing: bool,
) -> Result<String> {
    if !valid_id(conversation) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let account = account_id(state, headers).await?;
    state.auth.limit_delivery(&account)?;
    approved(state, &account, device).await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    if let Some(channel) = crate::community::channel_access(&mut tx, conversation, &account).await?
    {
        if channel.authority.is_none()
            || channel.policy.is_none()
            || (publishing && channel.announcement && channel.owner_id != account)
        {
            return Err(StatusCode::FORBIDDEN);
        }
        if channel.owner_id != account {
            let admitted: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM community_members WHERE community_id=$1 AND account_id=$2 AND admission IS NOT NULL)").bind(channel.community_id).bind(&account).fetch_one(&mut *tx).await.map_err(unavailable)?;
            if !admitted {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }
    let joined: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_devices WHERE conversation_id=$1 AND device_key=$2)").bind(conversation).bind(device).fetch_one(&mut *tx).await.map_err(unavailable)?;
    if !joined {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(account)
}
async fn reserve(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(conversation): Path<String>,
    Json(request): Json<BlobReservation>,
) -> Result<Json<BlobUrl>> {
    let _permit = state.auth.admit()?;
    if !valid_id(&request.id)
        || !valid_id(&request.digest)
        || !(17..=8_388_736).contains(&request.cipher_bytes)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let account = access(&state, &headers, &conversation, &request.device_key, true).await?;
    let storage = state
        .config
        .storage
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    storage.ensure_bucket().await?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    // One account lock serializes quotas, including leases that were abandoned.
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&account)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let prior = sqlx::query("SELECT conversation_id,account_id,device_key,cipher_bytes,digest,ready,created_at > now()-interval '5 minutes' AS valid FROM encrypted_blobs WHERE id=$1").bind(&request.id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    if let Some(row) = prior {
        if row.get::<String, _>("conversation_id") != conversation
            || row.get::<String, _>("account_id") != account
            || row.get::<String, _>("device_key") != request.device_key
            || row.get::<i64, _>("cipher_bytes") != request.cipher_bytes as i64
            || row.get::<String, _>("digest") != request.digest
            || row.get::<bool, _>("ready")
            || !row.get::<bool, _>("valid")
        {
            return Err(StatusCode::CONFLICT);
        }
    } else {
        let used: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(cipher_bytes),0)::BIGINT FROM encrypted_blobs WHERE account_id=$1",
        )
        .bind(&account)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM encrypted_blobs WHERE account_id=$1 AND NOT ready",
        )
        .bind(&account)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
        let objects: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM encrypted_blobs WHERE account_id=$1")
                .bind(&account)
                .fetch_one(&mut *tx)
                .await
                .map_err(unavailable)?;
        if used + request.cipher_bytes as i64 > 128 * 1024 * 1024 || count >= 16 || objects >= 2048
        {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        sqlx::query("INSERT INTO encrypted_blobs(id,conversation_id,account_id,device_key,cipher_bytes,digest) VALUES($1,$2,$3,$4,$5,$6)").bind(&request.id).bind(&conversation).bind(&account).bind(&request.device_key).bind(request.cipher_bytes as i64).bind(&request.digest).execute(&mut *tx).await.map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    let mut signed = HeaderMap::new();
    signed.insert(
        header::CONTENT_LENGTH,
        request
            .cipher_bytes
            .to_string()
            .parse()
            .map_err(|_| StatusCode::BAD_REQUEST)?,
    );
    signed.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    let url = storage
        .bucket(true)?
        .presign_put(
            format!("{conversation}/{}", request.id),
            EXPIRY,
            Some(signed),
            None,
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(BlobUrl {
        url,
        expires_in_seconds: EXPIRY,
    }))
}
#[derive(Deserialize)]
struct Device {
    device: String,
}
async fn complete(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((conversation, id)): Path<(String, String)>,
    Json(query): Json<Device>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = access(&state, &headers, &conversation, &query.device, true).await?;
    if !valid_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let row = sqlx::query("SELECT cipher_bytes,created_at > now()-interval '10 minutes' AS valid FROM encrypted_blobs WHERE id=$1 AND conversation_id=$2 AND account_id=$3 AND device_key=$4").bind(&id).bind(&conversation).bind(&account).bind(&query.device).fetch_optional(&state.db).await.map_err(unavailable)?.ok_or(StatusCode::NOT_FOUND)?;
    if !row.get::<bool, _>("valid") {
        return Err(StatusCode::CONFLICT);
    }
    let storage = state
        .config
        .storage
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let (object, status) = storage
        .bucket(false)?
        .head_object(format!("{conversation}/{id}"))
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if status != 200 || object.content_length != Some(row.get("cipher_bytes")) {
        return Err(StatusCode::BAD_REQUEST);
    }
    sqlx::query("UPDATE encrypted_blobs SET ready=TRUE WHERE id=$1")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn download(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((conversation, id)): Path<(String, String)>,
    Query(query): Query<Device>,
) -> Result<Json<BlobUrl>> {
    let _permit = state.auth.admit()?;
    access(&state, &headers, &conversation, &query.device, false).await?;
    if !valid_id(&id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM encrypted_blobs WHERE id=$1 AND conversation_id=$2 AND ready)",
    )
    .bind(&id)
    .bind(&conversation)
    .fetch_one(&state.db)
    .await
    .map_err(unavailable)?;
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }
    let storage = state
        .config
        .storage
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let url = storage
        .bucket(true)?
        .presign_get(format!("{conversation}/{id}"), EXPIRY, None)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(BlobUrl {
        url,
        expires_in_seconds: EXPIRY,
    }))
}

/// Expired incomplete leases are safe to remove after every issued PUT URL has expired.
pub async fn cleanup_expired(state: &SharedState) -> std::result::Result<(), StatusCode> {
    let Some(storage) = &state.config.storage else {
        return Ok(());
    };
    let rows = sqlx::query("SELECT id,conversation_id FROM encrypted_blobs WHERE NOT ready AND created_at < now()-interval '20 minutes' ORDER BY created_at LIMIT 32").fetch_all(&state.db).await.map_err(unavailable)?;
    for row in rows {
        let id: String = row.get("id");
        let conversation: String = row.get("conversation_id");
        let deleted = storage
            .bucket(false)?
            .delete_object(format!("{conversation}/{id}"))
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if matches!(deleted.status_code(), 200 | 204 | 404) {
            sqlx::query("DELETE FROM encrypted_blobs WHERE id=$1 AND NOT ready")
                .bind(id)
                .execute(&state.db)
                .await
                .map_err(unavailable)?;
        }
    }
    Ok(())
}
