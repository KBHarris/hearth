//! Hearth wire protocol types.
//!
//! Everything that crosses a process boundary (client REST, gateway frames, federation
//! events, bot events) is defined here so every implementation shares one schema.
//! Breaking changes bump [`PROTOCOL_VERSION`].

pub mod auth;
pub mod community;
pub mod device;
pub mod gateway;
pub mod governance;
pub mod invite;
pub mod lifecycle;
pub mod messaging;
pub mod reports;

#[cfg(feature = "typescript")]
pub mod typescript;

use serde::{Deserialize, Serialize};

/// Major protocol version. Clients and peers reject mismatched majors.
pub const PROTOCOL_VERSION: u32 = 1;

/// Response body of `GET /health`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Health {
    pub status: HealthStatus,
    pub version: String,
    pub protocol: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
    Degraded,
}

/// Response body of `GET /.well-known/hearth`, used for discovery and federation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct WellKnown {
    /// Public domain of this server.
    pub server_name: String,
    /// Supported protocol versions, newest first.
    pub protocols: Vec<u32>,
    /// Hex-encoded Ed25519 server signing key.
    pub server_key: String,
    /// Whether this server accepts federation traffic at all.
    pub federation: bool,
}

/// Public readiness response for `GET /api/v1/setup`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SetupStatus {
    pub setup_complete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_uses_snake_case_status() {
        let h = Health {
            status: HealthStatus::Ok,
            version: "0.1.0".into(),
            protocol: PROTOCOL_VERSION,
        };
        let json = serde_json::to_string(&h).unwrap();
        assert!(json.contains(r#""status":"ok""#), "{json}");
    }
}
