use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hearth_crypto::auth::Client;
use hearth_server::{AppState, auth::AuthState, config::Config, keys, router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::{path::Path, sync::Arc};
use tower::ServiceExt;

fn app(db: PgPool, directory: &Path) -> Router {
    router(Arc::new(AppState {
        config: Config {
            media: Default::default(),
            storage: None,
            server_name: "auth-test".into(),
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: "unused".into(),
            db_max_connections: 5,
            server_key_path: directory.join("server.key"),
            federation_enabled: false,
            client_origins: vec!["https://client.example.org".into()],
        },
        db,
        server_key: keys::load_or_create(&directory.join("server.key")).unwrap(),
        auth: AuthState::load(directory).unwrap(),
    }))
}
async fn post(app: &Router, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/auth/{path}"))
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 16384).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn session(app: &Router, token: &str, logout: bool) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method(if logout { "POST" } else { "GET" })
                .uri(if logout {
                    "/api/v1/auth/logout"
                } else {
                    "/api/v1/auth/session"
                })
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}
async fn proof(app: &Router, server_id: &str, password: &str) -> Value {
    let mut client = Client::default();
    let message = client.login_start(password).unwrap();
    let (status, response) = post(
        app,
        "login/start",
        json!({ "username":"owner", "message":message }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let message = client
        .login_finish(
            password,
            response["message"].as_str().unwrap(),
            "owner",
            server_id,
        )
        .unwrap();
    json!({"exchange_id":response["exchange_id"], "message":message})
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires isolated PostgreSQL; run cargo test -p hearth-server --test auth -- --ignored"]
async fn owner_race_replay_expiry_revocation_and_restart(db: PgPool) {
    let directory = tempfile::tempdir().unwrap();
    let app = app(db.clone(), directory.path());
    let server_id = keys::load_or_create(&directory.path().join("server.key"))
        .unwrap()
        .public()
        .to_hex();
    let code = std::fs::read_to_string(directory.path().join("setup.code")).unwrap();
    let password = "PHASE1_PASSWORD_CANARY_private_only";
    let mut client = Client::default();
    let request = client.registration_start(password).unwrap();
    assert_eq!(
        post(
            &app,
            "owner/start",
            json!({"username":"owner", "message":request, "setup_code":"0".repeat(64)})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, response) = post(
        &app,
        "owner/start",
        json!({"username":"owner", "message":request, "setup_code":code}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let upload = client
        .registration_finish(
            password,
            response["message"].as_str().unwrap(),
            "owner",
            &server_id,
        )
        .unwrap();
    let finish = json!({"username":"owner", "message":upload, "setup_code":code});
    let (a, b) = tokio::join!(
        post(&app, "owner/finish", finish.clone()),
        post(&app, "owner/finish", finish)
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM accounts WHERE owner")
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
    let record: Vec<u8> = sqlx::query_scalar("SELECT password_file FROM accounts")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(
        !record
            .windows(password.len())
            .any(|v| v == password.as_bytes())
    );
    assert_eq!(
        post(
            &app,
            "owner/start",
            json!({"username":"owner", "message":request, "setup_code":code})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let body = proof(&app, &server_id, password).await;
    let (a, b) = tokio::join!(
        post(&app, "login/finish", body.clone()),
        post(&app, "login/finish", body)
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 401]);
    let response = if a.0 == StatusCode::OK { a.1 } else { b.1 };
    let token = response["token"].as_str().unwrap();
    let hash: Vec<u8> = sqlx::query_scalar("SELECT token_hash FROM auth_sessions")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(hash, Sha256::digest(token.as_bytes()).to_vec());
    assert_ne!(hash, token.as_bytes());
    assert_eq!(session(&app, token, false).await, StatusCode::OK);
    let restarted = self::app(db.clone(), directory.path());
    assert_eq!(session(&restarted, token, false).await, StatusCode::OK);
    assert_eq!(
        session(&restarted, token, true).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(session(&app, token, false).await, StatusCode::UNAUTHORIZED);
    let body = proof(&restarted, &server_id, password).await;
    sqlx::query("UPDATE auth_login_exchanges SET expires_at=now()-interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        post(&restarted, "login/finish", body).await.0,
        StatusCode::UNAUTHORIZED
    );
    let body = proof(&restarted, &server_id, password).await;
    let response = post(&restarted, "login/finish", body).await.1;
    let token = response["token"].as_str().unwrap();
    sqlx::query("UPDATE auth_sessions SET expires_at=now()-interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        session(&restarted, token, false).await,
        StatusCode::UNAUTHORIZED
    );
    // Invalid finalization consumes the challenge before verification.
    let body = proof(&restarted, &server_id, password).await;
    assert_eq!(
        post(
            &restarted,
            "login/finish",
            json!({"exchange_id":body["exchange_id"],"message":"00"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post(&restarted, "login/finish", body).await.0,
        StatusCode::UNAUTHORIZED
    );
    let mut wrong = Client::default();
    let message = wrong.login_start("wrong password").unwrap();
    let response = post(
        &restarted,
        "login/start",
        json!({"username":"owner","message":message}),
    )
    .await
    .1;
    assert!(
        wrong
            .login_finish(
                "wrong password",
                response["message"].as_str().unwrap(),
                "owner",
                &server_id
            )
            .is_err()
    );
    let message = wrong.login_start(password).unwrap();
    let response = post(
        &restarted,
        "login/start",
        json!({"username":"nobody","message":message}),
    )
    .await
    .1;
    assert!(
        wrong
            .login_finish(
                password,
                response["message"].as_str().unwrap(),
                "nobody",
                &server_id
            )
            .is_err()
    );
    assert_eq!(
        post(
            &restarted,
            "login/start",
            json!({"username":"owner","message":message,"password":password})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for _ in 0..10 {
        assert_eq!(
            post(
                &restarted,
                "login/start",
                json!({"username":"limited","message":message})
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        post(
            &restarted,
            "login/start",
            json!({"username":"limited","message":message})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    let row = sqlx::query("SELECT value FROM instance_settings WHERE key='setup_complete'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(row.get::<Value, _>("value"), json!(true));
}

#[tokio::test]
async fn auth_cors_does_not_inherit_public_discovery_policy() {
    let directory = tempfile::tempdir().unwrap();
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
        .unwrap();
    let app = app(db, directory.path());
    for (origin, allowed) in [
        ("https://client.example.org", true),
        ("https://untrusted.example.org", false),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/v1/auth/login/start")
                    .header("Origin", origin)
                    .header("Access-Control-Request-Method", "POST")
                    .header("Access-Control-Request-Headers", "content-type")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_some(),
            allowed
        );
        assert!(
            response
                .headers()
                .get("access-control-allow-credentials")
                .is_none()
        );
    }
}
