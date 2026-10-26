//! Owner-only structural deletion. No decrypted content or client keys are erased.
use super::*;
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Confirmation {
    expected_name: String,
}

pub(super) async fn channel(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((community, channel)): Path<(String, String)>,
    Json(request): Json<Confirmation>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    id(&channel)?;
    name(&request.expected_name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &community, &account).await?;
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT name FROM community_channels WHERE id=$1 AND community_id=$2 FOR UPDATE",
    )
    .bind(&channel)
    .bind(&community)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if stored.as_deref() != Some(request.expected_name.as_str()) {
        return Err(if stored.is_some() {
            StatusCode::CONFLICT
        } else {
            StatusCode::NOT_FOUND
        });
    }
    sqlx::query("UPDATE community_channels SET deleted=TRUE WHERE id=$1 AND community_id=$2")
        .bind(&channel)
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("UPDATE communities SET ownership_offer=NULL WHERE id=$1")
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("DELETE FROM voice_rooms WHERE channel_id=$1")
        .bind(&channel)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn category(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path((community, category)): Path<(String, String)>,
    Json(request): Json<Confirmation>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    id(&category)?;
    name(&request.expected_name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    owner(&mut tx, &community, &account).await?;
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT name FROM community_categories WHERE id=$1 AND community_id=$2 FOR UPDATE",
    )
    .bind(&category)
    .bind(&community)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if stored.as_deref() != Some(request.expected_name.as_str()) {
        return Err(if stored.is_some() {
            StatusCode::CONFLICT
        } else {
            StatusCode::NOT_FOUND
        });
    }
    sqlx::query(
        "UPDATE community_channels SET category_id=NULL WHERE community_id=$1 AND category_id=$2",
    )
    .bind(&community)
    .bind(&category)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    sqlx::query("DELETE FROM community_categories WHERE id=$1 AND community_id=$2")
        .bind(&category)
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn community(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Path(community): Path<String>,
    Json(request): Json<Confirmation>,
) -> Result<StatusCode> {
    let _permit = state.auth.admit()?;
    let account = authenticated(&state, &headers).await?;
    id(&community)?;
    name(&request.expected_name)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    let stored = sqlx::query("SELECT owner_id,name FROM communities WHERE id=$1 FOR UPDATE")
        .bind(&community)
        .fetch_optional(&mut *tx)
        .await
        .map_err(unavailable)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if stored.get::<String, _>("owner_id") != account {
        return Err(StatusCode::FORBIDDEN);
    }
    if stored.get::<String, _>("name") != request.expected_name {
        return Err(StatusCode::CONFLICT);
    }
    sqlx::query("UPDATE communities SET deleted=TRUE,ownership_offer=NULL WHERE id=$1")
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("UPDATE community_channels SET deleted=TRUE WHERE community_id=$1")
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    sqlx::query("DELETE FROM voice_rooms WHERE channel_id IN (SELECT id FROM community_channels WHERE community_id=$1)").bind(&community).execute(&mut *tx).await.map_err(unavailable)?;
    sqlx::query("DELETE FROM community_invites WHERE community_id=$1")
        .bind(&community)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use serde_json::{Value, json};
    use std::sync::Arc;
    use tower::ServiceExt;
    struct Fixture {
        router: Router,
        state: SharedState,
        owner: String,
        member: String,
        community: String,
        other: String,
        category: String,
        channel: String,
        peer_channel: String,
        member_id: String,
    }
    impl Fixture {
        async fn new(db: sqlx::PgPool) -> Self {
            let ids = (0..7)
                .map(|_| crate::auth::random_token())
                .collect::<Vec<_>>();
            for (index, account) in ids[..2].iter().enumerate() {
                sqlx::query("INSERT INTO accounts(id,username,opaque_profile,password_file) VALUES($1,$2,'fixture',$3)").bind(account).bind(format!("delete_user_{index}")).bind(vec![0u8]).execute(&db).await.unwrap();
            }
            for (community, owner) in [(&ids[2], &ids[0]), (&ids[3], &ids[1])] {
                sqlx::query(
                    "INSERT INTO communities(id,name,owner_id) VALUES($1,'Fixture community',$2)",
                )
                .bind(community)
                .bind(owner)
                .execute(&db)
                .await
                .unwrap();
                for account in &ids[..2] {
                    sqlx::query(
                        "INSERT INTO community_members(community_id,account_id) VALUES($1,$2)",
                    )
                    .bind(community)
                    .bind(account)
                    .execute(&db)
                    .await
                    .unwrap();
                }
            }
            sqlx::query("INSERT INTO community_categories(id,community_id,name) VALUES($1,$2,'Fixture category')").bind(&ids[4]).bind(&ids[2]).execute(&db).await.unwrap();
            for (channel, community, category) in
                [(&ids[5], &ids[2], Some(&ids[4])), (&ids[6], &ids[3], None)]
            {
                sqlx::query("INSERT INTO community_channels(id,community_id,category_id,name,kind) VALUES($1,$2,$3,'Fixture room','voice')").bind(channel).bind(community).bind(category).execute(&db).await.unwrap();
                sqlx::query(
                    "INSERT INTO conversations(id,channel_id,epoch,members) VALUES($1,$1,1,'[]')",
                )
                .bind(channel)
                .execute(&db)
                .await
                .unwrap();
                sqlx::query("INSERT INTO voice_rooms(channel_id,room_id,epoch) VALUES($1,$2,1)")
                    .bind(channel)
                    .bind(crate::auth::random_token())
                    .execute(&db)
                    .await
                    .unwrap();
            }
            let tokens = [crate::auth::random_token(), crate::auth::random_token()];
            for (account, token) in ids[..2].iter().zip(&tokens) {
                sqlx::query("INSERT INTO auth_sessions(token_hash,account_id) VALUES($1,$2)")
                    .bind(Sha256::digest(token.as_bytes()).to_vec())
                    .bind(account)
                    .execute(&db)
                    .await
                    .unwrap();
            }
            let state = Arc::new(crate::AppState {
                config: crate::config::Config {
                    server_name: "fixture.local".into(),
                    bind: "127.0.0.1:0".parse().unwrap(),
                    database_url: String::new(),
                    db_max_connections: 10,
                    server_key_path: "unused".into(),
                    federation_enabled: false,
                    client_origins: vec!["http://fixture.local".into()],
                    storage: None,
                    media: Default::default(),
                },
                db,
                server_key: hearth_crypto::IdentityKey::generate(),
                auth: crate::auth::AuthState::new(Default::default(), &[7; 32]),
            });
            Self {
                router: crate::router(state.clone()),
                state,
                owner: tokens[0].clone(),
                member: tokens[1].clone(),
                community: ids[2].clone(),
                other: ids[3].clone(),
                category: ids[4].clone(),
                channel: ids[5].clone(),
                peer_channel: ids[6].clone(),
                member_id: ids[1].clone(),
            }
        }
        async fn request(
            &self,
            path: &str,
            token: Option<&str>,
            body: Option<Value>,
        ) -> (StatusCode, Value) {
            let mut request =
                Request::builder()
                    .uri(path)
                    .method(if body.is_some() { "POST" } else { "GET" });
            if let Some(token) = token {
                request = request.header("Authorization", format!("Bearer {token}"))
            }
            let body = if let Some(value) = body {
                request = request.header("Content-Type", "application/json");
                Body::from(value.to_string())
            } else {
                Body::empty()
            };
            let response = self
                .router
                .clone()
                .oneshot(request.body(body).unwrap())
                .await
                .unwrap();
            let status = response.status();
            let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
            (
                status,
                serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            )
        }
    }
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires isolated PostgreSQL"]
    async fn owner_only_deletion_keeps_category_channels_and_blocks_channel_reanimation(
        db: sqlx::PgPool,
    ) {
        let f = Fixture::new(db).await;
        let path = format!(
            "/api/v1/communities/{}/categories/{}/delete",
            f.community, f.category
        );
        let confirm = json!({"expected_name":"Fixture category"});
        assert_eq!(
            f.request(&path, None, Some(confirm.clone())).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            f.request(&path, Some(&f.member), Some(confirm.clone()))
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            f.request(
                &path,
                Some(&f.owner),
                Some(json!({"expected_name":"wrong"}))
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            f.request(&path, Some(&f.owner), Some(confirm)).await.0,
            StatusCode::NO_CONTENT
        );
        let structure = f
            .request(
                &format!("/api/v1/communities/{}", f.community),
                Some(&f.owner),
                None,
            )
            .await
            .1;
        assert_eq!(structure["categories"].as_array().unwrap().len(), 0);
        assert_eq!(structure["channels"][0]["id"], f.channel);
        assert!(structure["channels"][0]["category_id"].is_null());
        let cross = format!(
            "/api/v1/communities/{}/channels/{}/delete",
            f.community, f.peer_channel
        );
        assert_eq!(
            f.request(
                &cross,
                Some(&f.owner),
                Some(json!({"expected_name":"Fixture room"}))
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        let channel = format!(
            "/api/v1/communities/{}/channels/{}/delete",
            f.community, f.channel
        );
        assert_eq!(
            f.request(
                &channel,
                Some(&f.owner),
                Some(json!({"expected_name":"Fixture room"}))
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        let mut tx = f.state.db.begin().await.unwrap();
        assert!(matches!(
            channel_access(&mut tx, &f.channel, &f.member_id).await,
            Err(StatusCode::FORBIDDEN)
        ));
        drop(tx);
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM conversations WHERE id=$1 AND channel_id=$1"
            )
            .bind(&f.channel)
            .fetch_one(&f.state.db)
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM voice_rooms WHERE channel_id=$1")
                .bind(&f.channel)
                .fetch_one(&f.state.db)
                .await
                .unwrap(),
            0
        );
        assert!(
            !sqlx::query_scalar::<_, bool>("SELECT deleted FROM community_channels WHERE id=$1")
                .bind(&f.peer_channel)
                .fetch_one(&f.state.db)
                .await
                .unwrap()
        );
    }
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires isolated PostgreSQL"]
    async fn community_deletion_blocks_members_invites_management_and_old_owner(db: sqlx::PgPool) {
        let f = Fixture::new(db).await;
        let path = format!("/api/v1/communities/{}/delete", f.community);
        assert_eq!(
            f.request(
                &path,
                Some(&f.member),
                Some(json!({"expected_name":"Fixture community"}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let invite = f
            .request(
                &format!("/api/v1/communities/{}/invites", f.community),
                Some(&f.owner),
                Some(json!({"expires_in_seconds":3600,"max_uses":2})),
            )
            .await;
        assert_eq!(invite.0, StatusCode::OK);
        assert_eq!(
            f.request(
                &path,
                Some(&f.owner),
                Some(json!({"expected_name":"Fixture community"}))
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            f.request(
                &format!("/api/v1/communities/{}", f.community),
                Some(&f.member),
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let list = f
            .request("/api/v1/communities", Some(&f.owner), None)
            .await
            .1;
        assert!(
            !list
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value["id"] == f.community)
        );
        assert_eq!(
            f.request(
                "/api/v1/communities/join",
                Some(&f.member),
                Some(json!({"code":invite.1["code"]}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            f.request(
                &format!("/api/v1/communities/{}/channels", f.community),
                Some(&f.owner),
                Some(json!({"name":"resurrect","kind":"text","category_id":null}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            f.request(
                &format!("/api/v1/communities/{}/ownership", f.community),
                Some(&f.owner),
                None
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            f.request(
                &format!("/api/v1/communities/{}", f.other),
                Some(&f.member),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
        let other = format!("/api/v1/communities/{}/delete", f.other);
        sqlx::query("UPDATE communities SET owner_id=$2 WHERE id=$1")
            .bind(&f.other)
            .bind(
                sqlx::query_scalar::<_, String>("SELECT owner_id FROM communities WHERE id=$1")
                    .bind(&f.community)
                    .fetch_one(&f.state.db)
                    .await
                    .unwrap(),
            )
            .execute(&f.state.db)
            .await
            .unwrap();
        assert_eq!(
            f.request(
                &other,
                Some(&f.member),
                Some(json!({"expected_name":"Fixture community"}))
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    #[sqlx::test(migrations = "./migrations")]
    #[ignore = "requires isolated PostgreSQL"]
    async fn access_waiting_on_delete_cannot_authorize_a_stale_channel(db: sqlx::PgPool) {
        let f = Fixture::new(db).await;
        let mut tx = f.state.db.begin().await.unwrap();
        sqlx::query("SELECT id FROM communities WHERE id=$1 FOR UPDATE")
            .bind(&f.community)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        let pool = f.state.db.clone();
        let channel = f.channel.clone();
        let account = f.member_id.clone();
        let waiting = tokio::spawn(async move {
            let mut reader = pool.begin().await.unwrap();
            channel_access(&mut reader, &channel, &account)
                .await
                .map(|value| value.is_some())
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(!waiting.is_finished());
        sqlx::query("UPDATE community_channels SET deleted=TRUE WHERE id=$1")
            .bind(&f.channel)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("UPDATE communities SET ownership_offer=NULL WHERE id=$1")
            .bind(&f.community)
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(waiting.await.unwrap(), Err(StatusCode::FORBIDDEN));
    }
}
