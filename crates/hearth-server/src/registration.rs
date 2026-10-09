//! Owner-controlled account creation. Invitations are hashed, expiring and single-use.
use crate::SharedState;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use hearth_proto::auth::*;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;
type ResultJson<T> = Result<Json<T>, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
async fn mode(db: &sqlx::PgPool) -> Result<RegistrationMode, StatusCode> {
    let value: serde_json::Value =
        sqlx::query_scalar("SELECT value FROM instance_settings WHERE key='registration_mode'")
            .fetch_one(db)
            .await
            .map_err(unavailable)?;
    serde_json::from_value(value).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}
pub async fn status(State(state): State<SharedState>) -> ResultJson<RegistrationStatus> {
    Ok(Json(RegistrationStatus {
        registration_mode: mode(&state.db).await?,
    }))
}
async fn owner(state: &SharedState, headers: &HeaderMap) -> Result<String, StatusCode> {
    let id = crate::device::account_id(state, headers).await?;
    let is_owner: bool = sqlx::query_scalar("SELECT owner FROM accounts WHERE id=$1")
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .map_err(unavailable)?;
    if !is_owner {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(id)
}
pub async fn settings(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ResultJson<ServerSettings> {
    owner(&state, &headers).await?;
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM instance_settings WHERE key='server_name'")
            .fetch_optional(&state.db)
            .await
            .map_err(unavailable)?;
    let name = value
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| state.config.server_name.clone());
    Ok(Json(ServerSettings {
        server_name: name,
        registration_mode: mode(&state.db).await?,
    }))
}
pub async fn configure(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(request): Json<ServerSettings>,
) -> ResultJson<ServerSettings> {
    let id = owner(&state, &headers).await?;
    let _permit = state.auth.admit()?;
    state.auth.limit(&id)?;
    let name = request.server_name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT pg_advisory_xact_lock(1212502601)")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    for (key, value) in [
        ("server_name", serde_json::json!(name)),
        (
            "registration_mode",
            serde_json::to_value(request.registration_mode).map_err(|_| StatusCode::BAD_REQUEST)?,
        ),
    ] {
        sqlx::query("INSERT INTO instance_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()").bind(key).bind(value).execute(&mut *tx).await.map_err(unavailable)?;
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(ServerSettings {
        server_name: name.into(),
        registration_mode: request.registration_mode,
    }))
}
pub async fn invite(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> ResultJson<AccountInvite> {
    let id = owner(&state, &headers).await?;
    let _permit = state.auth.admit()?;
    state.auth.limit(&id)?;
    let code = crate::auth::random_token();
    sqlx::query("INSERT INTO account_invites(code_hash,issuer_id) VALUES($1,$2)")
        .bind(Sha256::digest(code.as_bytes()).to_vec())
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(unavailable)?;
    Ok(Json(AccountInvite {
        code,
        expires_in_seconds: 86400,
    }))
}
fn invite_hash(code: Option<&str>) -> Result<Vec<u8>, StatusCode> {
    let code = code.ok_or(StatusCode::FORBIDDEN)?;
    if code.len() != 64
        || !code
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(Sha256::digest(code.as_bytes()).to_vec())
}
async fn allowed(state: &SharedState, code: Option<&str>) -> Result<(), StatusCode> {
    let initialized: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE owner)")
        .fetch_one(&state.db)
        .await
        .map_err(unavailable)?;
    if !initialized {
        return Err(StatusCode::FORBIDDEN);
    }
    match mode(&state.db).await? {
        RegistrationMode::Closed => Err(StatusCode::FORBIDDEN),
        RegistrationMode::Open => Ok(()),
        RegistrationMode::Invite => {
            let hash = invite_hash(code)?;
            let valid:bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM account_invites WHERE code_hash=$1 AND NOT used AND expires_at>now())").bind(hash).fetch_one(&state.db).await.map_err(unavailable)?;
            if valid {
                Ok(())
            } else {
                Err(StatusCode::FORBIDDEN)
            }
        }
    }
}
pub async fn start(
    State(state): State<SharedState>,
    Json(request): Json<RegistrationStart>,
) -> ResultJson<AuthResponse> {
    let _permit = state.auth.admit()?;
    crate::auth::username(&request.username)?;
    state.auth.limit(&request.username)?;
    allowed(&state, request.invite_code.as_deref()).await?;
    let message = state
        .auth
        .server
        .registration_start(&request.username, &request.message)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Json(AuthResponse {
        message,
        profile: hearth_crypto::auth::PROFILE.into(),
    }))
}
pub async fn finish(
    State(state): State<SharedState>,
    Json(request): Json<RegistrationFinish>,
) -> ResultJson<Account> {
    let _permit = state.auth.admit()?;
    crate::auth::username(&request.username)?;
    state.auth.limit(&request.username)?;
    let record = Zeroizing::new(
        hearth_crypto::auth::Server::registration_finish(&request.message)
            .map_err(|_| StatusCode::BAD_REQUEST)?,
    );
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT pg_advisory_xact_lock(1212502601)")
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    let initialized: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts WHERE owner)")
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    if !initialized {
        return Err(StatusCode::FORBIDDEN);
    }
    let mode_value: serde_json::Value =
        sqlx::query_scalar("SELECT value FROM instance_settings WHERE key='registration_mode'")
            .fetch_one(&mut *tx)
            .await
            .map_err(unavailable)?;
    let mode: RegistrationMode =
        serde_json::from_value(mode_value).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    match mode {
        RegistrationMode::Closed => return Err(StatusCode::FORBIDDEN),
        RegistrationMode::Invite => {
            let hash = invite_hash(request.invite_code.as_deref())?;
            let claimed = sqlx::query("UPDATE account_invites SET used=TRUE WHERE code_hash=$1 AND NOT used AND expires_at>now() RETURNING code_hash").bind(hash).fetch_optional(&mut *tx).await.map_err(unavailable)?;
            if claimed.is_none() {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        RegistrationMode::Open => {}
    }
    let account = Account {
        id: crate::auth::random_token(),
        username: request.username,
        owner: false,
    };
    sqlx::query(
        "INSERT INTO accounts(id,username,opaque_profile,password_file) VALUES($1,$2,$3,$4)",
    )
    .bind(&account.id)
    .bind(&account.username)
    .bind(hearth_crypto::auth::PROFILE)
    .bind(record.as_slice())
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            StatusCode::CONFLICT
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        }
    })?;
    tx.commit().await.map_err(unavailable)?;
    Ok(Json(account))
}
