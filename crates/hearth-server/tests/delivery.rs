//! Actual PostgreSQL ordering/ACL/rollback with product MLS, not mocked ciphertext.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hearth_crypto::{
    messaging::{Messaging, random_id},
    vault::LocalIdentity,
};
use hearth_proto::messaging::*;
use hearth_server::{AppState, auth::AuthState, config::Config, keys, router};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
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
        .uri(format!("/api/v1/chat/{path}"));
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
                    body.map(|v| Body::from(v.to_string()))
                        .unwrap_or_else(Body::empty),
                )
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn account(
    db: &PgPool,
    id: &str,
    username: &str,
    token: &str,
    identity: &LocalIdentity,
    server: &str,
) {
    let proof = identity.enrollment(id, server).unwrap();
    sqlx::query("INSERT INTO accounts(id,username,opaque_profile,password_file,identity_key) VALUES($1,$2,$3,$4,$5)")
        .bind(id).bind(username).bind(hearth_crypto::auth::PROFILE).bind(vec![0u8]).bind(&proof.identity_key).execute(db).await.unwrap();
    device(db, id, identity, server).await;
    sqlx::query("INSERT INTO auth_sessions(token_hash,account_id) VALUES($1,$2)")
        .bind(Sha256::digest(token.as_bytes()).to_vec())
        .bind(id)
        .execute(db)
        .await
        .unwrap();
}
async fn device(db: &PgPool, id: &str, identity: &LocalIdentity, server: &str) {
    let proof = identity.enrollment(id, server).unwrap();
    sqlx::query("INSERT INTO account_devices(account_id,device_key,certificate,account_signature,device_signature) VALUES($1,$2,$3,$4,$5)")
        .bind(id).bind(&proof.device_key).bind(&proof.certificate).bind(&proof.account_signature).bind(&proof.device_signature).execute(db).await.unwrap();
}
async fn receive(
    app: &Router,
    token: &str,
    identity: &LocalIdentity,
    account: &str,
    server: &str,
    engine: &mut Messaging,
) -> Vec<DeliveryEvent> {
    let last = engine.view().unwrap().last_seq;
    let path = format!(
        "events/{}?after={last}",
        identity.enrollment(account, server).unwrap().device_key
    );
    let (status, value) = call(app, "GET", &path, Some(token), None).await;
    assert_eq!(status, StatusCode::OK);
    let events: Vec<DeliveryEvent> = serde_json::from_value(value).unwrap();
    for event in &events {
        engine.receive(event).unwrap();
    }
    events
}
#[sqlx::test(migrations = "./migrations")]
#[ignore = "requires isolated PostgreSQL"]
async fn ordered_ciphertext_delivery_is_atomic_idempotent_and_authorized(db: PgPool) {
    let directory = tempfile::tempdir().unwrap();
    let signing = keys::load_or_create(&directory.path().join("server.key")).unwrap();
    let server = signing.public().to_hex();
    let alice_identity = LocalIdentity::new();
    let bob_identity = LocalIdentity::new();
    let outsider_identity = LocalIdentity::new();
    let alice_id = random_id();
    let bob_id = random_id();
    let outsider_id = random_id();
    let alice_token = random_id();
    let bob_token = random_id();
    let outsider_token = random_id();
    account(
        &db,
        &alice_id,
        "alice",
        &alice_token,
        &alice_identity,
        &server,
    )
    .await;
    account(&db, &bob_id, "bob", &bob_token, &bob_identity, &server).await;
    account(
        &db,
        &outsider_id,
        "outsider",
        &outsider_token,
        &outsider_identity,
        &server,
    )
    .await;
    let app = router(Arc::new(AppState {
        config: Config {
            server_name: "delivery-test".into(),
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: "unused".into(),
            db_max_connections: 5,
            server_key_path: directory.path().join("server.key"),
            federation_enabled: false,
            client_origins: vec!["https://client.example.org".into()],
        },
        db: db.clone(),
        server_key: signing,
        auth: AuthState::load(directory.path()).unwrap(),
    }));
    let mut alice = Messaging::new(&alice_identity, &alice_id, &server).unwrap();
    let mut bob = Messaging::new(&bob_identity, &bob_id, &server).unwrap();
    let package = bob.key_package().unwrap();
    assert_eq!(
        call(&app, "POST", "packages", None, Some(json!(package)))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "packages",
            Some(&alice_token),
            Some(json!(package))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "packages",
            Some(&bob_token),
            Some(json!(package))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let claim = json!({"device_keys":[package.member.enrollment.device_key]});
    let (one, two) = tokio::join!(
        call(
            &app,
            "POST",
            "packages/claim",
            Some(&alice_token),
            Some(claim.clone())
        ),
        call(
            &app,
            "POST",
            "packages/claim",
            Some(&alice_token),
            Some(claim)
        )
    );
    let claimed = if one.0 == StatusCode::OK {
        assert_eq!(two.0, StatusCode::CONFLICT);
        one.1
    } else {
        assert_eq!(one.0, StatusCode::CONFLICT);
        assert_eq!(two.0, StatusCode::OK);
        two.1
    };
    let packages: Vec<KeyPackageRecord> = serde_json::from_value(claimed).unwrap();
    let id = random_id();
    let commit = alice.add(&id, &packages, true).unwrap();
    let path = format!("conversations/{id}/commit");
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            Some(&outsider_token),
            Some(json!(commit))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "POST", &path, Some(&alice_token), Some(json!(commit)))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "POST", &path, Some(&alice_token), Some(json!(commit)))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    alice.accept(&commit.operation_id).unwrap();
    // An upload acknowledgement lost before the Welcome must not re-advertise its
    // single-use secrets after consumption (even when retried much later).
    assert_eq!(
        call(
            &app,
            "POST",
            "packages",
            Some(&bob_token),
            Some(json!(package))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let available = format!("packages/{}", package.member.enrollment.device_key);
    assert_eq!(
        call(&app, "GET", &available, Some(&bob_token), None)
            .await
            .1["available"],
        0
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "packages/claim",
            Some(&alice_token),
            Some(json!({"device_keys":[package.member.enrollment.device_key]}))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    receive(
        &app,
        &alice_token,
        &alice_identity,
        &alice_id,
        &server,
        &mut alice,
    )
    .await;
    receive(&app, &bob_token, &bob_identity, &bob_id, &server, &mut bob).await;
    assert_eq!(
        call(&app, "GET", "conversations", Some(&outsider_token), None)
            .await
            .1,
        json!([])
    );
    let canary = "HEARTH_SERVER_PRIVATE_MESSAGE_CANARY_never_on_server";
    let upload = alice
        .send(
            &id,
            MessageContent::Text {
                text: canary.into(),
                reply_to: None,
            },
        )
        .unwrap();
    let message_path = format!("conversations/{id}/message");
    let (first, retry) = tokio::join!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&alice_token),
            Some(json!(upload))
        ),
        call(
            &app,
            "POST",
            &message_path,
            Some(&alice_token),
            Some(json!(upload))
        )
    );
    assert_eq!(first.0, StatusCode::NO_CONTENT);
    assert_eq!(retry.0, StatusCode::NO_CONTENT);
    alice.accept(&upload.operation_id).unwrap();
    let received = receive(&app, &bob_token, &bob_identity, &bob_id, &server, &mut bob).await;
    assert_eq!(received.len(), 1);
    assert_eq!(bob.view().unwrap().messages[0].text, canary);
    let wrong_device_path = format!("events/{}?after=0", package.member.enrollment.device_key);
    assert_eq!(
        call(&app, "GET", &wrong_device_path, Some(&alice_token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let mut malicious = bob
        .send(
            &id,
            MessageContent::Edit {
                id: upload.operation_id.clone(),
                text: "forged edit".into(),
            },
        )
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&bob_token),
            Some(json!(malicious))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    bob.reject(&malicious.operation_id).unwrap();
    malicious.signature = "00".repeat(64);
    assert_eq!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&bob_token),
            Some(json!(malicious))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let kit = bob_identity
        .recovery_kit("test device restore passphrase", &bob_id, &server)
        .unwrap();
    let linked_identity =
        LocalIdentity::restore_kit(&kit, "test device restore passphrase", &bob_id, &server)
            .unwrap();
    device(&db, &bob_id, &linked_identity, &server).await;
    let mut linked = Messaging::new(&linked_identity, &bob_id, &server).unwrap();
    let package = linked.key_package().unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "packages",
            Some(&bob_token),
            Some(json!(package))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let packages = call(
        &app,
        "POST",
        "packages/claim",
        Some(&alice_token),
        Some(json!({"device_keys":[package.member.enrollment.device_key]})),
    )
    .await;
    let add = alice
        .add(
            &id,
            &serde_json::from_value::<Vec<KeyPackageRecord>>(packages.1).unwrap(),
            false,
        )
        .unwrap();
    let stale = bob
        .send(
            &id,
            MessageContent::Text {
                text: "old epoch pending".into(),
                reply_to: None,
            },
        )
        .unwrap();
    assert_eq!(
        call(&app, "POST", &path, Some(&alice_token), Some(json!(add)))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    alice.accept(&add.operation_id).unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&bob_token),
            Some(json!(stale))
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    bob.reject(&stale.operation_id).unwrap();
    receive(&app, &bob_token, &bob_identity, &bob_id, &server, &mut bob).await;
    receive(
        &app,
        &bob_token,
        &linked_identity,
        &bob_id,
        &server,
        &mut linked,
    )
    .await;
    assert!(linked.view().unwrap().messages.is_empty());
    let next = alice
        .send(
            &id,
            MessageContent::Text {
                text: "new device can read this".into(),
                reply_to: None,
            },
        )
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&alice_token),
            Some(json!(next))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    alice.accept(&next.operation_id).unwrap();
    linked = Messaging::open(&linked_identity, &bob_id, &server, &linked.seal().unwrap()).unwrap();
    receive(
        &app,
        &bob_token,
        &linked_identity,
        &bob_id,
        &server,
        &mut linked,
    )
    .await;
    assert_eq!(
        linked.view().unwrap().messages[0].text,
        "new device can read this"
    );
    let delete = alice
        .send(
            &id,
            MessageContent::Delete {
                id: upload.operation_id.clone(),
            },
        )
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            &message_path,
            Some(&alice_token),
            Some(json!(delete))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    alice.accept(&delete.operation_id).unwrap();
    receive(&app, &bob_token, &bob_identity, &bob_id, &server, &mut bob).await;
    assert!(bob.view().unwrap().messages[0].deleted);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM delivery_events WHERE operation_id=$1 AND data->>'kind'='redacted'",
    )
    .bind(&upload.operation_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 2);
    for table in [
        "conversations",
        "delivery_events",
        "delivery_operations",
        "mls_key_packages",
    ] {
        let rows = sqlx::query(&format!(
            "SELECT row_to_json(t)::text AS data FROM {table} t"
        ))
        .fetch_all(&db)
        .await
        .unwrap();
        assert!(
            rows.iter()
                .all(|row| !row.get::<String, _>("data").contains(canary))
        );
    }
}
