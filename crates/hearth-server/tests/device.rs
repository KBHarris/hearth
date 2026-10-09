use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hearth_crypto::vault::LocalIdentity;
use hearth_crypto::{IdentityKey, identity::Enrollment};
use hearth_server::{AppState, auth::AuthState, config::Config, keys, router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/v1/auth/{path}"));
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    if body.is_some() {
        request = request.header("Content-Type", "application/json");
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(
                    body.map(|b| Body::from(b.to_string()))
                        .unwrap_or_else(Body::empty),
                )
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
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires isolated PostgreSQL"]
async fn first_device_scope_race_immutability_and_revocation(db: PgPool) {
    let directory = tempfile::tempdir().unwrap();
    let signing_key = keys::load_or_create(&directory.path().join("server.key")).unwrap();
    let server = signing_key.public().to_hex();
    let account = "ab".repeat(32);
    let token = "cd".repeat(32);
    sqlx::query("INSERT INTO accounts (id,username,opaque_profile,password_file) VALUES ($1,'device_test',$2,$3)").bind(&account).bind(hearth_crypto::auth::PROFILE).bind(vec![0u8]).execute(&db).await.unwrap();
    sqlx::query("INSERT INTO auth_sessions (token_hash,account_id) VALUES ($1,$2)")
        .bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(&account)
        .execute(&db)
        .await
        .unwrap();
    let app = router(Arc::new(AppState {
        config: Config {
            storage: None,
            server_name: "device-test".into(),
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: "unused".into(),
            db_max_connections: 5,
            server_key_path: directory.path().join("server.key"),
            federation_enabled: false,
            client_origins: vec!["https://client.example.org".into()],
        },
        db: db.clone(),
        server_key: signing_key,
        auth: AuthState::load(directory.path()).unwrap(),
    }));
    let user = IdentityKey::generate();
    let device = IdentityKey::generate();
    let proof = Enrollment::create(&user, &device, &account, &server).unwrap();
    let value = serde_json::to_value(&proof).unwrap();
    assert_eq!(
        call(&app, "GET", "identity", None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "POST", "device/first", None, Some(value.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "GET", "identity", Some(&token), None).await.1,
        json!({"identity_key":null,"devices":[]})
    );
    let mut forged = value.clone();
    forged["device_signature"] = json!("00".repeat(64));
    assert_eq!(
        call(&app, "POST", "device/first", Some(&token), Some(forged))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let scoped = Enrollment::create(&user, &device, &"ef".repeat(32), &server).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(serde_json::to_value(scoped).unwrap())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let scoped = Enrollment::create(&user, &device, &account, &"ef".repeat(32)).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(serde_json::to_value(scoped).unwrap())
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut private = value.clone();
    private["private_key"] = json!("PRIVATE_KEY_CANARY_NEVER_ACCEPT");
    assert_eq!(
        call(&app, "POST", "device/first", Some(&token), Some(private))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let other_user = IdentityKey::generate();
    let other_device = IdentityKey::generate();
    let other = Enrollment::create(&other_user, &other_device, &account, &server).unwrap();
    let other_value = serde_json::to_value(other).unwrap();
    let (a, b) = tokio::join!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(value.clone())
        ),
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(other_value.clone())
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let accepted = if a.0 == StatusCode::OK {
        value
    } else {
        other_value
    };
    assert_eq!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(accepted.clone())
        )
        .await
        .0,
        StatusCode::OK
    );
    let identity = call(&app, "GET", "identity", Some(&token), None).await.1;
    assert_eq!(identity["identity_key"], accepted["identity_key"]);
    assert_eq!(identity["devices"], json!([accepted]));
    let replacement = Enrollment::create(
        &IdentityKey::generate(),
        &IdentityKey::generate(),
        &account,
        &server,
    )
    .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(serde_json::to_value(replacement).unwrap())
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    {
        let accepted_user = if identity["identity_key"] == json!(user.public().to_hex()) {
            &user
        } else {
            &other_user
        };
        let extra =
            Enrollment::create(accepted_user, &IdentityKey::generate(), &account, &server).unwrap();
        assert_eq!(
            call(
                &app,
                "POST",
                "device/first",
                Some(&token),
                Some(serde_json::to_value(extra).unwrap())
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM account_devices")
            .fetch_one(&db)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        call(&app, "POST", "logout", Some(&token), None).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "POST", "device/first", Some(&token), Some(accepted))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "GET", "identity", Some(&token), None).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires isolated PostgreSQL"]
async fn recovery_and_link_require_identity_possession_and_scope(db: PgPool) {
    let directory = tempfile::tempdir().unwrap();
    let signing_key = keys::load_or_create(&directory.path().join("server.key")).unwrap();
    let server = signing_key.public().to_hex();
    let account = "ab".repeat(32);
    let token = "cd".repeat(32);
    for (id, name, session) in [
        (&account, "alice", &token),
        (&"ef".repeat(32), "bob", &"12".repeat(32)),
    ] {
        sqlx::query(
            "INSERT INTO accounts(id,username,opaque_profile,password_file) VALUES($1,$2,$3,$4)",
        )
        .bind(id)
        .bind(name)
        .bind(hearth_crypto::auth::PROFILE)
        .bind(vec![0u8])
        .execute(&db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO auth_sessions(token_hash,account_id) VALUES($1,$2)")
            .bind(Sha256::digest(session.as_bytes()).to_vec())
            .bind(id)
            .execute(&db)
            .await
            .unwrap();
    }
    let app = router(Arc::new(AppState {
        config: Config {
            storage: None,
            server_name: "recovery-test".into(),
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: "unused".into(),
            db_max_connections: 5,
            server_key_path: directory.path().join("server.key"),
            federation_enabled: false,
            client_origins: vec![],
        },
        db: db.clone(),
        server_key: signing_key,
        auth: AuthState::load(directory.path()).unwrap(),
    }));
    let identity = LocalIdentity::new();
    let proof = identity.enrollment(&account, &server).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "device/first",
            Some(&token),
            Some(serde_json::to_value(&proof).unwrap())
        )
        .await
        .0,
        StatusCode::OK
    );
    let offer_body = |identity: &LocalIdentity| {
        let (_, id, envelope, signature) = identity.link_offer(&account, &server).unwrap();
        json!({"id":id,"envelope":envelope,"signature":signature,"device_key":identity.enrollment(&account,&server).unwrap().device_key})
    };
    assert_eq!(
        call(
            &app,
            "POST",
            "device/link",
            Some(&token),
            Some(offer_body(&LocalIdentity::new()))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let expired = offer_body(&identity);
    let expired_id = expired["id"].as_str().unwrap().to_owned();
    assert_eq!(
        call(&app, "POST", "device/link", Some(&token), Some(expired))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("device/link/{expired_id}"),
            Some(&"12".repeat(32)),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE device_link_offers SET expires_at=now()-interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("device/link/{expired_id}"),
            Some(&token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let phrase = "test recovery phrase never sent to the server";
    let kit = identity.recovery_kit(phrase, &account, &server).unwrap();
    let restored = LocalIdentity::restore_kit(&kit, phrase, &account, &server).unwrap();
    let body =
        json!({"enrollment":restored.enrollment(&account,&server).unwrap(),"link_id":expired_id});
    assert_eq!(
        call(&app, "POST", "device/restore", Some(&token), Some(body))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let fresh = offer_body(&identity);
    let fresh_id = fresh["id"].as_str().unwrap().to_owned();
    assert_eq!(
        call(&app, "POST", "device/link", Some(&token), Some(fresh))
            .await
            .0,
        StatusCode::OK
    );
    let body =
        json!({"enrollment":restored.enrollment(&account,&server).unwrap(),"link_id":fresh_id});
    assert_eq!(
        call(
            &app,
            "POST",
            "device/restore",
            Some(&token),
            Some(body.clone())
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "POST", "device/restore", Some(&token), Some(body))
            .await
            .0,
        StatusCode::OK
    );
    let another = LocalIdentity::restore_kit(&kit, phrase, &account, &server).unwrap();
    assert_eq!(call(&app,"POST","device/restore",Some(&token),Some(json!({"enrollment":another.enrollment(&account,&server).unwrap(),"link_id":fresh_id}))).await.0,StatusCode::CONFLICT);
    let wrong = LocalIdentity::new().enrollment(&account, &server).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "device/restore",
            Some(&token),
            Some(json!({"enrollment":wrong,"link_id":null}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut forged = serde_json::to_value(restored.enrollment(&account, &server).unwrap()).unwrap();
    forged["device_signature"] = json!("00".repeat(64));
    assert_eq!(
        call(
            &app,
            "POST",
            "device/restore",
            Some(&token),
            Some(json!({"enrollment":forged,"link_id":null}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}
