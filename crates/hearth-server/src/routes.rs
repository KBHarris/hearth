use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use hearth_proto::{Health, HealthStatus, PROTOCOL_VERSION, SetupStatus, WellKnown};
use tower_http::cors::{Any, CorsLayer};

use crate::SharedState;

pub async fn health(State(state): State<SharedState>) -> Json<Health> {
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    Json(Health {
        status: if db_ok {
            HealthStatus::Ok
        } else {
            HealthStatus::Degraded
        },
        version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: PROTOCOL_VERSION,
    })
}

pub async fn well_known(State(state): State<SharedState>) -> Json<WellKnown> {
    let configured: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM instance_settings WHERE key='server_name'")
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();
    Json(WellKnown {
        server_name: configured
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| state.config.server_name.clone()),
        protocols: vec![PROTOCOL_VERSION],
        server_key: state.server_key.public().to_hex(),
        federation: state.config.federation_enabled,
    })
}

/// Client REST API. Phase 1 adds accounts, devices, key packages, and DMs here.
pub fn api_v1() -> Router<SharedState> {
    Router::new().route("/setup", get(setup_status).layer(discovery_cors()))
}

/// Only public discovery GETs are readable by alternative web clients. Never apply
/// this policy to authenticated API routes, and never allow credentials here.
pub fn discovery_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([axum::http::Method::GET])
}

/// Whether the first-run admin setup has been completed.
async fn setup_status(State(state): State<SharedState>) -> Result<Json<SetupStatus>, StatusCode> {
    let complete: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE key = 'setup_complete')",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(SetupStatus {
        setup_complete: complete,
    }))
}
