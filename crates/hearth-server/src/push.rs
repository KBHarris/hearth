//! Opt-in generic Web Push. No conversation identifiers or content enter a push payload.
use crate::{SharedState, device::account_id};
use aes_gcm::{Aes128Gcm, KeyInit, Nonce, aead::Aead};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hkdf::Hkdf;
use p256::{
    PublicKey, SecretKey,
    ecdh::diffie_hellman,
    ecdsa::{Signature, SigningKey, signature::Signer},
    elliptic_curve::sec1::ToEncodedPoint,
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{
    net::{IpAddr, SocketAddr},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;
const PAYLOAD: &[u8] = b"New activity in Hearth.";
type Result<T> = std::result::Result<T, StatusCode>;
fn unavailable(_: sqlx::Error) -> StatusCode {
    StatusCode::SERVICE_UNAVAILABLE
}
#[derive(Serialize)]
pub(crate) struct Configuration {
    public_key: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Subscription {
    device_key: String,
    endpoint: String,
    p256dh: String,
    auth: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Disable {
    device_key: String,
    endpoint: String,
}
fn vapid(state: &SharedState) -> SigningKey {
    // Separate derived key from all Ed25519 protocols. Counter handles the vanishingly
    // unlikely invalid scalar; public key stays stable across server-data restores.
    let secret = Zeroizing::new(state.server_key.to_bytes());
    for counter in 0u32.. {
        let mut hash = Sha256::new();
        hash.update(b"hearth/v1/vapid-key");
        hash.update(*secret);
        hash.update(counter.to_be_bytes());
        let bytes = Zeroizing::new(<[u8; 32]>::from(hash.finalize()));
        if let Ok(key) = SigningKey::from_slice(bytes.as_ref()) {
            return key;
        }
    }
    unreachable!()
}
pub(crate) async fn configuration(
    State(state): State<SharedState>,
    headers: HeaderMap,
) -> Result<Json<Configuration>> {
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    Ok(Json(Configuration {
        public_key: B64.encode(vapid(&state).verifying_key().to_encoded_point(false)),
    }))
}
fn endpoint(value: &str) -> Result<reqwest::Url> {
    if value.len() > 4096 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let url = reqwest::Url::parse(value).map_err(|_| StatusCode::BAD_REQUEST)?;
    let allowed = match url.host_str() {
        Some("fcm.googleapis.com") => {
            url.path().starts_with("/fcm/send/") || url.path().starts_with("/wp/")
        }
        Some("updates.push.services.mozilla.com") => {
            url.path().starts_with("/wpush/v1/") || url.path().starts_with("/wpush/v2/")
        }
        Some("web.push.apple.com") => url.path().starts_with('/'),
        _ => false,
    };
    if !allowed
        || url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(url)
}
fn subscription_keys(value: &Subscription) -> Result<(PublicKey, Vec<u8>)> {
    let public = B64
        .decode(&value.p256dh)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let auth = B64
        .decode(&value.auth)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if public.len() != 65 || public[0] != 4 || auth.len() != 16 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok((
        PublicKey::from_sec1_bytes(&public).map_err(|_| StatusCode::BAD_REQUEST)?,
        auth,
    ))
}
fn subscription_id(endpoint: &str) -> String {
    hex::encode(Sha256::digest(endpoint.as_bytes()))
}
pub(crate) async fn subscribe(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(value): Json<Subscription>,
) -> Result<StatusCode> {
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    crate::delivery::approved(&state, &account, &value.device_key).await?;
    endpoint(&value.endpoint)?;
    subscription_keys(&value)?;
    let mut tx = state.db.begin().await.map_err(unavailable)?;
    sqlx::query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE")
        .bind(&account)
        .fetch_one(&mut *tx)
        .await
        .map_err(unavailable)?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM push_subscriptions WHERE account_id=$1 AND endpoint<>$2",
    )
    .bind(&account)
    .bind(&value.endpoint)
    .fetch_one(&mut *tx)
    .await
    .map_err(unavailable)?;
    if count >= 16 {
        return Err(StatusCode::CONFLICT);
    }
    let result=sqlx::query("INSERT INTO push_subscriptions(id,account_id,device_key,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth WHERE push_subscriptions.account_id=excluded.account_id AND push_subscriptions.device_key=excluded.device_key")
        .bind(subscription_id(&value.endpoint)).bind(account).bind(value.device_key).bind(value.endpoint).bind(value.p256dh).bind(value.auth).execute(&mut *tx).await.map_err(unavailable)?;
    if result.rows_affected() != 1 {
        return Err(StatusCode::CONFLICT);
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn unsubscribe(
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(value): Json<Disable>,
) -> Result<StatusCode> {
    let account = account_id(&state, &headers).await?;
    state.auth.limit_delivery(&account)?;
    crate::delivery::approved(&state, &account, &value.device_key).await?;
    sqlx::query(
        "DELETE FROM push_subscriptions WHERE account_id=$1 AND device_key=$2 AND endpoint=$3",
    )
    .bind(account)
    .bind(value.device_key)
    .bind(value.endpoint)
    .execute(&state.db)
    .await
    .map_err(unavailable)?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn enqueue(
    tx: &mut sqlx::PgConnection,
    accounts: &[String],
    author: &str,
) -> Result<()> {
    sqlx::query("UPDATE push_subscriptions SET pending_at=coalesce(pending_at,now()) WHERE account_id=ANY($1) AND account_id<>$2 AND NOT EXISTS(SELECT 1 FROM server_bans b WHERE b.account_id=push_subscriptions.account_id)").bind(accounts).bind(author).execute(tx).await.map_err(unavailable)?;
    Ok(())
}
fn keys(
    shared: &[u8],
    auth: &[u8],
    ua: &[u8],
    as_public: &[u8],
    salt: &[u8],
) -> Result<([u8; 16], [u8; 12])> {
    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(ua);
    info.extend_from_slice(as_public);
    let mut ikm = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(auth), shared)
        .expand(&info, ikm.as_mut())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let hkdf = Hkdf::<Sha256>::new(Some(salt), ikm.as_ref());
    let mut key = [0u8; 16];
    let mut nonce = [0u8; 12];
    hkdf.expand(b"Content-Encoding: aes128gcm\0", &mut key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    hkdf.expand(b"Content-Encoding: nonce\0", &mut nonce)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((key, nonce))
}
fn encrypt(value: &Subscription, secret: &SecretKey, salt: &[u8; 16]) -> Result<Vec<u8>> {
    let (ua, auth) = subscription_keys(value)?;
    let public = secret.public_key().to_encoded_point(false);
    let ua_public = ua.to_encoded_point(false);
    let shared = diffie_hellman(secret.to_nonzero_scalar(), ua.as_affine());
    let (key, nonce) = keys(
        shared.raw_secret_bytes(),
        &auth,
        ua_public.as_bytes(),
        public.as_bytes(),
        salt,
    )?;
    let key = Zeroizing::new(key);
    let mut plain = PAYLOAD.to_vec();
    plain.push(2); // RFC 8188 final record delimiter.
    let encrypted = Aes128Gcm::new_from_slice(key.as_ref())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .encrypt(Nonce::from_slice(&nonce), plain.as_ref())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut body = salt.to_vec();
    body.extend_from_slice(&4096u32.to_be_bytes());
    body.push(65);
    body.extend_from_slice(public.as_bytes());
    body.extend(encrypted);
    Ok(body)
}
fn authorization(key: &SigningKey, url: &reqwest::Url) -> Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .as_secs();
    let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims=B64.encode(serde_json::to_vec(&serde_json::json!({"aud":url.origin().ascii_serialization(),"exp":now+3600,"sub":"mailto:push@hearth.invalid"})).map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?);
    let unsigned = format!("{header}.{claims}");
    let signature: Signature = key.sign(unsigned.as_bytes());
    Ok(format!(
        "vapid t={unsigned}.{}, k={}",
        B64.encode(signature.to_bytes()),
        B64.encode(key.verifying_key().to_encoded_point(false))
    ))
}
fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 2 && c == 0)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            s[0] & 0xe000 == 0x2000 && !(s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x200))
        }
    }
}
async fn send(state: &SharedState, value: &Subscription) -> Result<bool> {
    let url = endpoint(&value.endpoint)?;
    let host = url.host_str().ok_or(StatusCode::BAD_REQUEST)?;
    let addresses =
        tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, 443)))
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            .collect::<Vec<SocketAddr>>();
    if addresses.is_empty() || addresses.iter().any(|a| !public_address(a.ip())) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Pin validated DNS results, do not follow redirects or environment proxy routes.
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let body = encrypt(value, &SecretKey::random(&mut OsRng), &salt)?;
    let response = client
        .post(url.clone())
        .header("Authorization", authorization(&vapid(state), &url)?)
        .header("TTL", "600")
        .header("Topic", "hearth_activity")
        .header("Urgency", "normal")
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .body(body)
        .send()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if response.status() == reqwest::StatusCode::GONE
        || response.status() == reqwest::StatusCode::NOT_FOUND
    {
        return Ok(false);
    }
    if !response.status().is_success() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(true)
}
pub async fn dispatch(state: &SharedState) -> std::result::Result<(), sqlx::Error> {
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE push_subscriptions SET pending_at=NULL WHERE pending_at<now()-interval '10 minutes'").execute(&mut *tx).await?;
    let rows=sqlx::query("SELECT id,device_key,endpoint,p256dh,auth FROM push_subscriptions p WHERE pending_at IS NOT NULL AND last_attempt<now()-interval '30 seconds' AND NOT EXISTS(SELECT 1 FROM server_bans b WHERE b.account_id=p.account_id) ORDER BY last_attempt LIMIT 8 FOR UPDATE SKIP LOCKED").fetch_all(&mut *tx).await?;
    for row in &rows {
        sqlx::query("UPDATE push_subscriptions SET last_attempt=now() WHERE id=$1")
            .bind(row.get::<String, _>("id"))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    for row in rows {
        let id: String = row.get("id");
        let value = Subscription {
            device_key: row.get("device_key"),
            endpoint: row.get("endpoint"),
            p256dh: row.get("p256dh"),
            auth: row.get("auth"),
        };
        match send(state, &value).await {
            Ok(false) => {
                sqlx::query("DELETE FROM push_subscriptions WHERE id=$1")
                    .bind(&id)
                    .execute(&state.db)
                    .await?;
            }
            Ok(true) => {
                sqlx::query("UPDATE push_subscriptions SET pending_at=NULL WHERE id=$1 AND pending_at<=last_attempt").bind(&id).execute(&state.db).await?;
            }
            Err(_) => {} // Bounded retry without logging subscription secrets or provider response.
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;
    #[test]
    fn rejects_ssrf_and_bad_keys() {
        for value in [
            "https://127.0.0.1/a",
            "https://fcm.googleapis.com.evil.test/wp/a",
            "http://fcm.googleapis.com/wp/a",
            "https://user@fcm.googleapis.com/wp/a",
            "https://fcm.googleapis.com:444/wp/a",
            "https://fcm.googleapis.com/wp/a#secret",
        ] {
            assert!(endpoint(value).is_err());
        }
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "198.18.0.1",
            "203.0.113.1",
            "::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "fc00::1",
        ] {
            assert!(!public_address(value.parse().unwrap()));
        }
        assert!(public_address("8.8.8.8".parse().unwrap()));
    }
    #[test]
    fn rfc8291_appendix_a_known_key_and_nonce() {
        // Published independent interoperability vector, https://www.rfc-editor.org/rfc/rfc8291#appendix-A.
        let decode = |s: &str| B64.decode(s).unwrap();
        let ua = decode(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        );
        let public = decode(
            "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
        );
        let secret =
            SecretKey::from_slice(&decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")).unwrap();
        assert_eq!(
            secret.public_key().to_encoded_point(false).as_bytes(),
            public
        );
        let shared = diffie_hellman(
            secret.to_nonzero_scalar(),
            PublicKey::from_sec1_bytes(&ua).unwrap().as_affine(),
        );
        assert_eq!(
            B64.encode(shared.raw_secret_bytes()),
            "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"
        );
        let (key, nonce) = keys(
            shared.raw_secret_bytes(),
            &decode("BTBZMqHH6r4Tts7J_aSIgg"),
            &ua,
            &public,
            &decode("DGv6ra1nlYgDCS1FRnbzlw"),
        )
        .unwrap();
        assert_eq!(B64.encode(key), "oIhVW04MRdy2XN9CiKLxTg");
        assert_eq!(B64.encode(nonce), "4h_95klXJ5E_qnoN");
    }
    #[test]
    fn ciphertext_decrypts_to_only_fixed_generic_body_and_jwt_verifies() {
        let ua = SecretKey::random(&mut OsRng);
        let as_secret = SecretKey::random(&mut OsRng);
        let value = Subscription {
            device_key: "".into(),
            endpoint: "https://fcm.googleapis.com/wp/test".into(),
            p256dh: B64.encode(ua.public_key().to_encoded_point(false)),
            auth: B64.encode([23u8; 16]),
        };
        let body = encrypt(&value, &as_secret, &[17; 16]).unwrap();
        let as_public = PublicKey::from_sec1_bytes(&body[21..86]).unwrap();
        let shared = diffie_hellman(ua.to_nonzero_scalar(), as_public.as_affine());
        let (key, nonce) = keys(
            shared.raw_secret_bytes(),
            &[23; 16],
            ua.public_key().to_encoded_point(false).as_bytes(),
            &body[21..86],
            &body[..16],
        )
        .unwrap();
        let plain = Aes128Gcm::new_from_slice(&key)
            .unwrap()
            .decrypt(Nonce::from_slice(&nonce), &body[86..])
            .unwrap();
        assert_eq!(&plain[..plain.len() - 1], PAYLOAD);
        assert_eq!(plain.last(), Some(&2));
        let key = SigningKey::random(&mut OsRng);
        let auth = authorization(&key, &endpoint(&value.endpoint).unwrap()).unwrap();
        let token = auth
            .strip_prefix("vapid t=")
            .unwrap()
            .split(", k=")
            .next()
            .unwrap();
        let (unsigned, signature) = token.rsplit_once('.').unwrap();
        key.verifying_key()
            .verify(
                unsigned.as_bytes(),
                &Signature::from_slice(&B64.decode(signature).unwrap()).unwrap(),
            )
            .unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&B64.decode(unsigned.split('.').nth(1).unwrap()).unwrap())
                .unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
    }
}
