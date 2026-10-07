use std::{sync::Arc, time::Duration};

use axum::{body::Body, http::Request};
use hearth_crypto::IdentityKey;
use hearth_server::{AppState, config::Config, router};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

fn app() -> axum::Router {
    let database_url = "postgres://hearth:unused@127.0.0.1:1/hearth";
    router(Arc::new(AppState {
        config: Config {
            server_name: "test.hearth".into(),
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: database_url.into(),
            db_max_connections: 1,
            server_key_path: "unused.key".into(),
            federation_enabled: false,
        },
        db: PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(30))
            .connect_lazy(database_url)
            .unwrap(),
        server_key: IdentityKey::generate(),
    }))
}

#[tokio::test]
async fn public_discovery_can_be_read_cross_origin_without_credentials() {
    for path in ["/health", "/.well-known/hearth", "/api/v1/setup"] {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("Origin", "https://client.example.org")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["access-control-allow-origin"], "*");
        assert!(
            response
                .headers()
                .get("access-control-allow-credentials")
                .is_none()
        );
    }
}

#[tokio::test]
async fn unavailable_database_does_not_advertise_incomplete_setup() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/setup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    );
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    assert!(body.is_empty());
}

#[tokio::test]
async fn health_reports_degraded_when_database_is_unavailable() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let health: hearth_proto::Health = serde_json::from_slice(&body).unwrap();
    assert_eq!(health.status, hearth_proto::HealthStatus::Degraded);
}

#[tokio::test]
async fn gateway_does_not_inherit_public_discovery_cors() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/gateway")
                .header("Origin", "https://client.example.org")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response
            .headers()
            .get("access-control-allow-origin")
            .is_none()
    );
}
