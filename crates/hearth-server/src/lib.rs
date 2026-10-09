//! Hearth home server.
//!
//! The server never sees plaintext content. It stores ciphertext envelopes and opaque
//! blobs, enforces membership and permissions, and orders MLS commits for groups it hosts.

pub mod auth;
pub mod community;
pub mod config;
pub mod delivery;
pub mod device;
pub mod gateway;
pub mod keys;
pub mod registration;
pub mod routes;

use std::sync::Arc;

use axum::{Router, routing::get};
use hearth_crypto::IdentityKey;
use tower_http::trace::TraceLayer;

pub struct AppState {
    pub config: config::Config,
    pub db: sqlx::PgPool,
    pub server_key: IdentityKey,
    pub auth: auth::AuthState,
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
        .nest("/api/v1/auth", auth::routes(&state.config.client_origins))
        .nest(
            "/api/v1/communities",
            community::routes(&state.config.client_origins),
        )
        .nest(
            "/api/v1/chat",
            delivery::routes(&state.config.client_origins),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
