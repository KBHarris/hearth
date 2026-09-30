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
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            server_name: var_or("HEARTH_SERVER_NAME", "localhost"),
            bind: var_or("HEARTH_BIND", "0.0.0.0:8080")
                .parse()
                .context("HEARTH_BIND must be host:port")?,
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            db_max_connections: var_or("HEARTH_DB_MAX_CONNECTIONS", "10")
                .parse()
                .context("HEARTH_DB_MAX_CONNECTIONS must be a number")?,
            server_key_path: var_or("HEARTH_SERVER_KEY_PATH", "data/server.key").into(),
            federation_enabled: var_or("HEARTH_FEDERATION", "false") == "true",
        })
    }
}

fn var_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}
