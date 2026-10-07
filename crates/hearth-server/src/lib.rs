//! Hearth home server.
//!
//! The server never sees plaintext content. It stores ciphertext envelopes and opaque
//! blobs, enforces membership and permissions, and orders MLS commits for groups it hosts.

pub mod config;
pub mod gateway;
pub mod keys;
pub mod routes;

use std::sync::Arc;

use axum::{Router, routing::get};
use hearth_crypto::IdentityKey;
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub config: config::Config,
    pub db: sqlx::PgPool,
    pub server_key: IdentityKey,
}

pub type SharedState = Arc<AppState>;

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route(
            "/health",
            get(routes::health).layer(routes::discovery_cors()),
        )
        .route(
            "/.well-known/hearth",
            get(routes::well_known).layer(routes::discovery_cors()),
        )
        .route("/gateway", get(gateway::upgrade))
        .nest("/api/v1", routes::api_v1())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
