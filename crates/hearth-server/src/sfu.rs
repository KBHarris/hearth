//! SFU admission only. No media keys, content or client key-wrapping secrets.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hearth_proto::voice::{SfuAccess, VoiceRoom};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use zeroize::Zeroizing;

#[derive(Clone)]
pub struct SfuConfig {
    url: String,
    local_url: Option<String>,
    api_key: String,
    secret: Zeroizing<String>,
}
impl std::fmt::Debug for SfuConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SfuConfig").finish_non_exhaustive()
    }
}
impl SfuConfig {
    pub(crate) fn from_env() -> anyhow::Result<Option<Self>> {
        let mut result = Self::parse(
            std::env::var("HEARTH_SFU_URL").ok(),
            std::env::var("HEARTH_SFU_API_KEY").ok(),
            std::env::var("HEARTH_SFU_API_SECRET").ok(),
        )?;
        if let Ok(local) = std::env::var("HEARTH_SFU_LOCAL_URL") {
            let endpoint = reqwest::Url::parse(&local)
                .map_err(|_| anyhow::anyhow!("Invalid local SFU URL"))?;
            anyhow::ensure!(
                endpoint.scheme() == "ws"
                    && matches!(
                        endpoint.host_str(),
                        Some("127.0.0.1" | "localhost" | "[::1]")
                    )
                    && endpoint.path() == "/"
                    && endpoint.username().is_empty()
                    && endpoint.password().is_none()
                    && endpoint.query().is_none()
                    && endpoint.fragment().is_none(),
                "Local SFU URL must be loopback WS"
            );
            let config = result.as_mut().ok_or_else(|| {
                anyhow::anyhow!("Local SFU URL requires the complete SFU configuration")
            })?;
            config.local_url = Some(local);
        }
        Ok(result)
    }
    fn parse(
        url: Option<String>,
        api_key: Option<String>,
        secret: Option<String>,
    ) -> anyhow::Result<Option<Self>> {
        if url.is_none() && api_key.is_none() && secret.is_none() {
            return Ok(None);
        }
        let (Some(url), Some(api_key), Some(secret)) = (url, api_key, secret) else {
            anyhow::bail!("SFU URL, API key and API secret must be configured together")
        };
        let endpoint = reqwest::Url::parse(&url).map_err(|_| anyhow::anyhow!("Invalid SFU URL"))?;
        anyhow::ensure!(
            endpoint.host_str().is_some()
                && endpoint.username().is_empty()
                && endpoint.password().is_none()
                && endpoint.query().is_none()
                && endpoint.fragment().is_none()
                && matches!(endpoint.path(), "/" | "/hearth-media" | "/hearth-media/")
                && (endpoint.scheme() == "wss"
                    || endpoint.scheme() == "ws"
                        && matches!(
                            endpoint.host_str(),
                            Some("localhost" | "127.0.0.1" | "[::1]")
                        )),
            "SFU URL requires WSS or loopback WS"
        );
        anyhow::ensure!(
            !api_key.is_empty()
                && api_key.len() <= 128
                && api_key
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
                && (32..=256).contains(&secret.len())
                && !secret.chars().any(char::is_control),
            "Invalid private SFU credentials"
        );
        Ok(Some(Self {
            url,
            local_url: None,
            api_key,
            secret: Zeroizing::new(secret),
        }))
    }
    pub(crate) fn access(
        &self,
        room: &VoiceRoom,
        device: &str,
        now: u64,
        permissions: u32,
    ) -> anyhow::Result<SfuAccess> {
        anyhow::ensure!(room.sfu == Some(true), "Not an SFU room");
        let own = room
            .participants
            .iter()
            .find(|peer| peer.device_key == device && peer.active && peer.expires_at > now)
            .ok_or_else(|| anyhow::anyhow!("Join the room first"))?;
        let name = format!("hearth-{}-{}", room.room_id, room.revision);
        let identity = format!("{}-{}", device, own.incarnation);
        let expires = now / 1000 + 60;
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        use hearth_proto::governance::{CAMERA, CONNECT, LISTEN, SCREEN, SPEAK};
        anyhow::ensure!(
            permissions & (CONNECT | LISTEN) == CONNECT | LISTEN,
            "Room access denied"
        );
        let mut sources = vec![];
        if permissions & SPEAK != 0 {
            sources.push("microphone");
        }
        if permissions & CAMERA != 0 {
            sources.push("camera");
        }
        if permissions & SCREEN != 0 {
            sources.extend(["screen_share", "screen_share_audio"]);
        }
        let claims = serde_json::json!({"iss":self.api_key,"sub":identity,"iat":now/1000,"nbf":(now/1000).saturating_sub(5),"exp":expires,"video":{"roomJoin":true,"room":name,"canPublish":!sources.is_empty(),"canSubscribe":true,"canPublishData":false,"canUpdateOwnMetadata":false,"canPublishSources":sources}});
        let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims)?);
        let signed = format!("{header}.{body}");
        let mut mac = Hmac::<Sha256>::new_from_slice(self.secret.as_bytes())
            .map_err(|_| anyhow::anyhow!("SFU admission unavailable"))?;
        mac.update(signed.as_bytes());
        Ok(SfuAccess {
            local_url: self.local_url.clone(),
            channel_id: room.channel_id.clone(),
            room_id: room.room_id.clone(),
            revision: room.revision,
            url: self.url.clone(),
            room: name,
            identity,
            token: format!(
                "{signed}.{}",
                URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
            ),
            expires_at: expires * 1000,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_are_explicit_scoped_and_redacted() {
        assert!(SfuConfig::parse(None, None, None).unwrap().is_none());
        for url in [
            "ws://public.example",
            "wss://user:secret@example.org",
            "wss://example.org?secret=x",
            "https://example.org",
        ] {
            assert!(
                SfuConfig::parse(
                    Some(url.into()),
                    Some("key".into()),
                    Some("secret".repeat(8))
                )
                .is_err()
            );
        }
        let config = SfuConfig::parse(
            Some("ws://127.0.0.1:17880".into()),
            Some("local-key".into()),
            Some("secret".repeat(8)),
        )
        .unwrap()
        .unwrap();
        assert!(!format!("{config:?}").contains("secret"));
        let presence = hearth_proto::voice::VoicePresence {
            channel_id: "a".repeat(64),
            room_id: "b".repeat(64),
            epoch: 1,
            device_key: "c".repeat(64),
            incarnation: "d".repeat(64),
            public_key: format!("04{}", "ab".repeat(64)),
            relay_only: false,
            sfu: Some(true),
            active: true,
            issued_at: 1000,
            expires_at: 31000,
            signature: String::new(),
        };
        let mut room = VoiceRoom {
            channel_id: presence.channel_id.clone(),
            room_id: presence.room_id.clone(),
            epoch: 1,
            revision: 7,
            relay_only: false,
            sfu: Some(true),
            capacity: 25,
            participants: vec![presence],
        };
        let token = config
            .access(
                &room,
                &"c".repeat(64),
                2000,
                hearth_proto::governance::MEDIA,
            )
            .unwrap();
        let parts = token.token.split('.').collect::<Vec<_>>();
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(
            claims["video"]["room"],
            format!("hearth-{}-7", room.room_id)
        );
        assert_eq!(claims["exp"], 62);
        assert_eq!(claims["video"]["canPublishData"], false);
        let audience = config
            .access(
                &room,
                &"c".repeat(64),
                2000,
                hearth_proto::governance::CONNECT | hearth_proto::governance::LISTEN,
            )
            .unwrap();
        let audience: serde_json::Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(audience.token.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(audience["video"]["canPublish"], false);
        assert_eq!(
            audience["video"]["canPublishSources"],
            serde_json::json!([])
        );
        assert!(
            config
                .access(
                    &room,
                    &"c".repeat(64),
                    2000,
                    hearth_proto::governance::CONNECT
                )
                .is_err()
        );
        assert!(
            config
                .access(
                    &room,
                    &"e".repeat(64),
                    2000,
                    hearth_proto::governance::MEDIA
                )
                .is_err()
        );
        room.revision += 1;
        assert_ne!(
            token.token,
            config
                .access(
                    &room,
                    &"c".repeat(64),
                    2000,
                    hearth_proto::governance::MEDIA
                )
                .unwrap()
                .token
        );
    }
}
