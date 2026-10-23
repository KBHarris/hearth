use std::{net::SocketAddr, path::PathBuf};

use anyhow::Context;

/// Server configuration, read from `HEARTH_*` environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Public domain, used in `/.well-known/hearth` and federation.
    pub server_name: String,
    pub bind: SocketAddr,
    pub database_url: String,
    pub db_max_connections: u32,
    /// Where the Ed25519 server signing key is persisted.
    pub server_key_path: PathBuf,
    pub federation_enabled: bool,
    /// Explicit frontend origins. Bearer requests never use credentialed CORS.
    pub client_origins: Vec<String>,
    pub storage: Option<crate::attachments::StorageConfig>,
    pub media: crate::media::MediaConfig,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            server_name: var_or("HEARTH_SERVER_NAME", "localhost"),
            bind: var_or("HEARTH_BIND", "127.0.0.1:8080")
                .parse()
                .context("HEARTH_BIND must be host:port")?,
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            db_max_connections: var_or("HEARTH_DB_MAX_CONNECTIONS", "10")
                .parse()
                .context("HEARTH_DB_MAX_CONNECTIONS must be a number")?,
            server_key_path: var_or("HEARTH_SERVER_KEY_PATH", "data/server.key").into(),
            federation_enabled: var_or("HEARTH_FEDERATION", "false") == "true",
            client_origins: parse_origins(&var_or(
                "HEARTH_CLIENT_ORIGINS",
                "http://127.0.0.1:5173,http://localhost:5173,http://tauri.localhost,tauri://localhost",
            ))?,
            storage: crate::attachments::StorageConfig::from_env()?,
            media: crate::media::MediaConfig::from_env()?,
        })
    }
}

fn parse_origins(value: &str) -> anyhow::Result<Vec<String>> {
    value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|value| {
            let uri: axum::http::Uri = value
                .parse()
                .context("invalid HEARTH_CLIENT_ORIGINS origin")?;
            let local = matches!(
                uri.host(),
                Some("localhost" | "127.0.0.1" | "[::1]" | "tauri.localhost")
            );
            if uri.authority().is_none()
                || uri.path() != "/"
                || uri.query().is_some()
                || value.contains('@')
                || !(uri.scheme_str() == Some("https")
                    || (local && matches!(uri.scheme_str(), Some("http" | "tauri"))))
            {
                anyhow::bail!(
                    "HEARTH_CLIENT_ORIGINS requires HTTPS origins or loopback development origins"
                );
            }
            Ok(value.to_owned())
        })
        .collect()
}

fn var_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn auth_origins_reject_wildcards_credentials_and_insecure_public_hosts() {
        for value in [
            "*",
            "http://public.example.org",
            "https://user:secret@example.org",
            "https://example.org/path",
            "https://example.org?token=x",
        ] {
            assert!(super::parse_origins(value).is_err());
        }
        assert!(
            super::parse_origins(
                "https://client.example.org,http://127.0.0.1:5173,tauri://localhost"
            )
            .is_ok()
        );
    }
}
