//! Owner bootstrap and bounded OPAQUE exchanges. Authentication bodies are never logged.
use crate::SharedState;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware,
    response::Response,
    routing::{get, post},
};
use hearth_crypto::auth::{PROFILE, Server};
use hearth_proto::auth::*;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::Write,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tower_http::cors::CorsLayer;
use zeroize::Zeroizing;

type ApiResult<T> = Result<Json<T>, StatusCode>;
const SESSION_SECONDS: u32 = 86400;

struct Budget {
    since: Instant,
    total: u32,
    users: HashMap<String, u32>,
}
pub struct AuthState {
    server: Server,
    setup_digest: [u8; 32],
    budget: Mutex<Budget>,
    admission: tokio::sync::Semaphore,
}
impl AuthState {
    pub fn new(server: Server, setup_code: &[u8]) -> Self {
        Self {
            server,
            setup_digest: Sha256::digest(setup_code).into(),
            admission: tokio::sync::Semaphore::new(16),
            budget: Mutex::new(Budget {
                since: Instant::now(),
                total: 0,
                users: HashMap::new(),
            }),
        }
    }
    pub fn load(directory: &Path) -> anyhow::Result<Self> {
        let setup = Zeroizing::new(secret_file(&directory.join("opaque.setup"), || {
            Server::default().serialize()
        })?);
        let code = Zeroizing::new(secret_file(&directory.join("setup.code"), || {
            random_token().into_bytes()
        })?);
        if code.len() != 64 || !code.iter().all(u8::is_ascii_hexdigit) {
            anyhow::bail!("invalid setup code file; refusing to overwrite it");
        }
        Ok(Self::new(
            Server::deserialize(&setup).map_err(anyhow::Error::msg)?,
            &code,
        ))
    }
    fn authorize_setup(&self, code: &str) -> Result<(), StatusCode> {
        let digest: [u8; 32] = Sha256::digest(code.as_bytes()).into();
        if code.len() != 64 || !bool::from(self.setup_digest.ct_eq(&digest)) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(())
    }
    pub(crate) fn limit(&self, username: &str) -> Result<(), StatusCode> {
        let mut budget = self
            .budget
            .lock()
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        if budget.since.elapsed() >= Duration::from_secs(60) {
            budget.since = Instant::now();
            budget.total = 0;
            budget.users.clear();
        }
        if budget.total >= 120
            || (!username.is_empty() && budget.users.get(username).copied().unwrap_or(0) >= 10)
        {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        budget.total += 1;
        if !username.is_empty() {
            *budget.users.entry(username.to_owned()).or_default() += 1;
        }
        Ok(())
    }
    pub(crate) fn admit(&self) -> Result<tokio::sync::SemaphorePermit<'_>, StatusCode> {
        self.admission
            .try_acquire()
            .map_err(|_| StatusCode::TOO_MANY_REQUESTS)
    }
}

pub async fn cleanup_expired(db: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auth_login_exchanges WHERE expires_at <= now()")
        .execute(db)
        .await?;
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= now()")
        .execute(db)
        .await?;
    Ok(())
}

// Create with restrictive permissions before writing. Existing malformed files fail
// closed; they are never silently rotated. A concurrent first process may need retry.
pub(crate) fn secret_file(
    path: &Path,
    generate: impl FnOnce() -> Vec<u8>,
) -> anyhow::Result<Vec<u8>> {
    if path.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if std::fs::metadata(path)?.permissions().mode() & 0o077 != 0 {
                anyhow::bail!("authentication secret file must be accessible only to its owner");
            }
        }
        return Ok(std::fs::read(path)?);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => {
            let bytes = Zeroizing::new(generate());
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok(bytes.to_vec())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(std::fs::read(path)?),
        Err(error) => Err(error.into()),
    }
}
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
fn hash_token(value: &str) -> Result<Vec<u8>, StatusCode> {
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Sha256::digest(value.as_bytes()).to_vec())
}
fn username(value: &str) -> Result<(), StatusCode> {
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
fn account(row: &sqlx::postgres::PgRow) -> Account {
    Account {
        id: row.get("id"),
        username: row.get("username"),
        owner: row.get("owner"),
    }
}

pub fn routes(origins: &[String]) -> Router<SharedState> {
    let origins: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();
    Router::new()
        .route("/owner/start", post(owner_start))
        .route("/owner/finish", post(owner_finish))
        .route("/login/start", post(login_start))
        .route("/login/finish", post(login_finish))
        .route("/session", get(session))
        .route("/logout", post(logout))
        .route("/identity", get(crate::device::identity))
        .route("/device/first", post(crate::device::enroll_first))
        .layer(DefaultBodyLimit::max(16384))
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
        .layer(middleware::map_response(no_store))
}
async fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
    }
    response
}

async fn owner_start(
    State(state): State<SharedState>,
    Json(request): Json<OwnerRegistrationStart>,
) -> ApiResult<AuthResponse> {
    let _permit = state.auth.admit()?;
    username(&request.username)?;
    state.auth.limit(&request.username)?;
    state.auth.authorize_setup(&request.setup_code)?;
    let complete: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE key='setup_complete')",
    )
    .fetch_one(&state.db)
    .await
    .map_err(unavailable)?;
    if complete {
        return Err(StatusCode::CONFLICT);
    }
    let message = state
        .auth
        .server
        .registration_start(&request.username, &request.message)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(AuthResponse {
        message,
        profile: PROFILE.into(),
    }))
}
async fn owner_finish(
    State(state): State<SharedState>,
    Json(request): Json<OwnerRegistrationFinish>,
) -> ApiResult<Account> {
    let _permit = state.auth.admit()?;
    username(&request.username)?;
    state.auth.limit(&request.username)?;
    state.auth.authorize_setup(&request.setup_code)?;
    let record = Zeroizing::new(
        Server::registration_finish(&request.message).map_err(|_| StatusCode::BAD_REQUEST)?,
    );
    let mut transaction = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT pg_advisory_xact_lock(1212502600)")
        .execute(&mut *transaction)
        .await
        .map_err(unavailable)?;
    let complete: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM instance_settings WHERE key='setup_complete') OR EXISTS (SELECT 1 FROM accounts WHERE owner)").fetch_one(&mut *transaction).await.map_err(unavailable)?;
    if complete {
        return Err(StatusCode::CONFLICT);
    }
    let owner = Account {
        id: random_token(),
        username: request.username,
        owner: true,
    };
    sqlx::query("INSERT INTO accounts (id,username,owner,opaque_profile,password_file) VALUES ($1,$2,TRUE,$3,$4)")
        .bind(&owner.id).bind(&owner.username).bind(PROFILE).bind(record.as_slice()).execute(&mut *transaction).await.map_err(unavailable)?;
    sqlx::query(
        "INSERT INTO instance_settings (key,value) VALUES ('setup_complete','true'::jsonb)",
    )
    .execute(&mut *transaction)
    .await
    .map_err(unavailable)?;
    transaction.commit().await.map_err(unavailable)?;
    Ok(Json(owner))
}
async fn login_start(
    State(state): State<SharedState>,
    Json(request): Json<LoginStart>,
) -> ApiResult<LoginResponse> {
    let _permit = state.auth.admit()?;
    username(&request.username)?;
    state.auth.limit(&request.username)?;
    sqlx::query("DELETE FROM auth_login_exchanges WHERE expires_at <= now()")
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM auth_login_exchanges")
        .fetch_one(&state.db)
        .await
        .map_err(unavailable)?;
    if count >= 512 {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let row = sqlx::query(
        "SELECT id,password_file FROM accounts WHERE username=$1 AND opaque_profile=$2",
    )
    .bind(&request.username)
    .bind(PROFILE)
    .fetch_optional(&state.db)
    .await
    .map_err(unavailable)?;
    let record: Option<Zeroizing<Vec<u8>>> = row
        .as_ref()
        .map(|row| Zeroizing::new(row.get("password_file")));
    let server_id = state.server_key.public().to_hex();
    let (message, secret) = state
        .auth
        .server
        .login_start(
            &request.username,
            &server_id,
            record.as_ref().map(|r| r.as_slice()),
            &request.message,
        )
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let secret = Zeroizing::new(secret);
    let exchange_id = random_token();
    let account_id: Option<String> = row.as_ref().map(|r| r.get("id"));
    sqlx::query("INSERT INTO auth_login_exchanges (id_hash,account_id,username,opaque_state) VALUES ($1,$2,$3,$4)")
        .bind(hash_token(&exchange_id)?).bind(account_id).bind(&request.username).bind(secret.as_slice()).execute(&state.db).await.map_err(unavailable)?;
    Ok(Json(LoginResponse {
        message,
        profile: PROFILE.into(),
        exchange_id,
    }))
}
async fn login_finish(
    State(state): State<SharedState>,
    Json(request): Json<LoginFinish>,
) -> ApiResult<Session> {
    let _permit = state.auth.admit()?;
    state.auth.limit("")?;
    // DELETE atomically consumes even invalid/expired proofs; replay cannot win a race.
    let row = sqlx::query("DELETE FROM auth_login_exchanges WHERE id_hash=$1 RETURNING account_id,username,opaque_state,expires_at > now() AS valid")
        .bind(hash_token(&request.exchange_id)?).fetch_optional(&state.db).await.map_err(unavailable)?.ok_or(StatusCode::UNAUTHORIZED)?;
    if !row.get::<bool, _>("valid") {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let secret: Zeroizing<Vec<u8>> = Zeroizing::new(row.get("opaque_state"));
    Server::login_finish(
        &secret,
        &row.get::<String, _>("username"),
        &state.server_key.public().to_hex(),
        &request.message,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;
    let id: String = row
        .get::<Option<String>, _>("account_id")
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let row = sqlx::query("SELECT id,username,owner FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .map_err(unavailable)?;
    let token = random_token();
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= now()")
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    sqlx::query("INSERT INTO auth_sessions (token_hash,account_id) VALUES ($1,$2)")
        .bind(hash_token(&token)?)
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    Ok(Json(Session {
        token,
        expires_in_seconds: SESSION_SECONDS,
        account: account(&row),
    }))
}
pub(crate) fn bearer(headers: &HeaderMap) -> Result<Vec<u8>, StatusCode> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    hash_token(token)
}
async fn session(State(state): State<SharedState>, headers: HeaderMap) -> ApiResult<Account> {
    let row = sqlx::query("SELECT a.id,a.username,a.owner FROM accounts a JOIN auth_sessions s ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at > now()")
        .bind(bearer(&headers)?).fetch_optional(&state.db).await.map_err(unavailable)?.ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(account(&row)))
}
async fn logout(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    sqlx::query("DELETE FROM auth_sessions WHERE token_hash=$1")
        .bind(bearer(&headers)?)
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
