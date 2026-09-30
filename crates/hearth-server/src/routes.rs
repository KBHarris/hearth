use axum::{Json, Router, extract::State, routing::get};
use hearth_proto::{Health, HealthStatus, PROTOCOL_VERSION, WellKnown};
use serde_json::{Value, json};

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
    Json(WellKnown {
        server_name: state.config.server_name.clone(),
        protocols: vec![PROTOCOL_VERSION],
        server_key: state.server_key.public().to_hex(),
        federation: state.config.federation_enabled,
    })
}

/// Client REST API. Phase 1 adds accounts, devices, key packages, and DMs here.
pub fn api_v1() -> Router<SharedState> {
    Router::new().route("/setup", get(setup_status))
}

/// Whether the first-run admin setup has been completed.
async fn setup_status(State(state): State<SharedState>) -> Json<Value> {
    let complete: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM instance_settings WHERE key = 'setup_complete')",
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);
    Json(json!({ "setup_complete": complete }))
}
