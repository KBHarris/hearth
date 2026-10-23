//! Operator-selected ICE endpoints; TURN authorization is not a media decryption key.
use base64::{Engine, engine::general_purpose::STANDARD};
use hearth_proto::messaging::{IceConfiguration, IceServer};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

#[derive(Clone, Default)]
pub struct MediaConfig {
    pub(crate) sfu: Option<crate::sfu::SfuConfig>,
    live_devices: Arc<Mutex<HashMap<String, Instant>>>,
    stun: Vec<String>,
    turn: Vec<String>,
    secret: Option<Zeroizing<String>>,
}
impl std::fmt::Debug for MediaConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MediaConfig")
            .field("stun_count", &self.stun.len())
            .field("turn_count", &self.turn.len())
            .finish_non_exhaustive()
    }
}
impl MediaConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let mut config = Self::parse(
            std::env::var("HEARTH_STUN_URLS").ok().as_deref(),
            std::env::var("HEARTH_TURN_URLS").ok().as_deref(),
            std::env::var("HEARTH_TURN_SECRET").ok(),
        )?;
        config.sfu = crate::sfu::SfuConfig::from_env()?;
        Ok(config)
    }
    fn parse(
        stun: Option<&str>,
        turn: Option<&str>,
        secret: Option<String>,
    ) -> anyhow::Result<Self> {
        fn urls(input: Option<&str>, relay: bool) -> anyhow::Result<Vec<String>> {
            let Some(input) = input else {
                return Ok(Vec::new());
            };
            let values: Vec<_> = input.split(',').map(str::trim).collect();
            anyhow::ensure!(
                !values.is_empty() && values.len() <= 4,
                "Invalid media endpoint configuration"
            );
            for value in &values {
                let (scheme, address) = value
                    .split_once(':')
                    .ok_or_else(|| anyhow::anyhow!("Invalid media endpoint configuration"))?;
                anyhow::ensure!(
                    if relay {
                        matches!(scheme, "turn" | "turns")
                    } else {
                        matches!(scheme, "stun" | "stuns")
                    },
                    "Invalid media endpoint configuration"
                );
                let url = reqwest::Url::parse(&format!("{scheme}://{address}"))
                    .map_err(|_| anyhow::anyhow!("Invalid media endpoint configuration"))?;
                anyhow::ensure!(url.host_str().is_some() && url.username().is_empty() && url.password().is_none() && url.path().is_empty() && url.fragment().is_none() && url.query().is_none_or(|q| relay && matches!(q,"transport=udp"|"transport=tcp")), "Invalid media endpoint configuration");
            }
            Ok(values.into_iter().map(String::from).collect())
        }
        let stun = urls(stun, false)?;
        let turn = urls(turn, true)?;
        anyhow::ensure!(
            turn.is_empty() == secret.is_none()
                && secret.as_ref().is_none_or(|s| s.len() >= 32
                    && s.len() <= 256
                    && !s.chars().any(char::is_control)),
            "TURN endpoints require a matching private shared secret of 32-256 bytes"
        );
        Ok(Self {
            sfu: None,
            live_devices: Default::default(),
            stun,
            turn,
            secret: secret.map(Zeroizing::new),
        })
    }
    pub(crate) fn credentials(&self) -> anyhow::Result<IceConfiguration> {
        let expires = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 3600;
        let mut servers = Vec::new();
        if !self.stun.is_empty() {
            servers.push(IceServer {
                urls: self.stun.clone(),
                username: None,
                credential: None,
            });
        }
        if let Some(secret) = &self.secret {
            // coturn REST credentials. Random scope prevents correlation to an account/device.
            let username = format!("{expires}:{}", hearth_crypto::messaging::random_id());
            let mut mac = Hmac::<Sha1>::new_from_slice(secret.as_bytes())
                .map_err(|_| anyhow::anyhow!("TURN credential generation failed"))?;
            mac.update(username.as_bytes());
            servers.push(IceServer {
                urls: self.turn.clone(),
                username: Some(username),
                credential: Some(STANDARD.encode(mac.finalize().into_bytes())),
            });
        }
        Ok(IceConfiguration {
            ice_servers: servers,
            expires_at: expires * 1000,
        })
    }
    pub(crate) fn announce(&self, device: &str) -> Result<(), ()> {
        Self::announce_into(&self.live_devices, device)
    }
    fn announce_into(registry: &Mutex<HashMap<String, Instant>>, device: &str) -> Result<(), ()> {
        let mut devices = registry.lock().map_err(|_| ())?;
        devices.retain(|_, at| at.elapsed().as_secs() < 90);
        if devices.len() >= 4096 && !devices.contains_key(device) {
            return Err(());
        }
        devices.insert(device.into(), Instant::now());
        Ok(())
    }
    pub(crate) fn compatible(&self, devices: &[String]) -> bool {
        Self::compatible_in(&self.live_devices, devices)
    }
    fn compatible_in(registry: &Mutex<HashMap<String, Instant>>, devices: &[String]) -> bool {
        registry.lock().is_ok_and(|live| {
            devices.iter().all(|device| {
                live.get(device)
                    .is_some_and(|at| at.elapsed().as_secs() < 90)
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn media_configuration_is_explicit_redacted_and_scoped() {
        assert!(
            MediaConfig::parse(None, None, None)
                .unwrap()
                .credentials()
                .unwrap()
                .ice_servers
                .is_empty()
        );
        let config = MediaConfig::parse(
            Some("stun:localhost:3478"),
            Some("turn:localhost:3478?transport=udp,turns:relay.example.org:5349?transport=tcp"),
            Some("private-shared-canary-material-123456".into()),
        )
        .unwrap();
        assert!(!config.compatible(&["device-a".into()]));
        config.announce("device-a").unwrap();
        assert!(config.compatible(&["device-a".into()]));
        assert!(!config.compatible(&["device-a".into(), "device-b".into()]));
        let a = config.credentials().unwrap();
        let b = config.credentials().unwrap();
        assert_ne!(a.ice_servers[1].username, b.ice_servers[1].username);
        assert!(!format!("{config:?}").contains("canary"));
        let mut mac =
            Hmac::<Sha1>::new_from_slice(b"private-shared-canary-material-123456").unwrap();
        mac.update(a.ice_servers[1].username.as_ref().unwrap().as_bytes());
        assert_eq!(
            a.ice_servers[1].credential.as_ref().unwrap(),
            &STANDARD.encode(mac.finalize().into_bytes())
        );
        for url in [
            "https://relay.example.org",
            "turn:user:secret@relay.example.org",
            "turn:relay.example.org/path",
            "turn:relay.example.org?token=private",
            "turn:",
            "",
        ] {
            assert!(MediaConfig::parse(None, Some(url), Some("x".repeat(32))).is_err());
        }
        assert!(MediaConfig::parse(None, Some("turn:localhost:3478"), None).is_err());
        assert!(MediaConfig::parse(None, None, Some("x".repeat(32))).is_err());
    }
}
