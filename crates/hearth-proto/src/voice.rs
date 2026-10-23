//! Public, device-signed room occupancy. Private media keys never cross this API.
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct VoicePresence {
    pub channel_id: String,
    pub room_id: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub epoch: u64,
    pub device_key: String,
    pub incarnation: String,
    /// Public P-256 contribution, never an exporter, shared secret or frame key.
    pub public_key: String,
    pub relay_only: bool,
    /// True binds the SFU topology. Absent retains the original mesh transcript.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub sfu: Option<bool>,
    pub active: bool,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub issued_at: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub expires_at: u64,
    pub signature: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct VoiceRoom {
    pub channel_id: String,
    pub room_id: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub epoch: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub revision: u64,
    pub relay_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub sfu: Option<bool>,
    pub capacity: u8,
    pub participants: Vec<VoicePresence>,
}

/// Short-lived SFU admission; contains no media encryption material.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SfuAccess {
    /// Optional same-machine signaling endpoint. Clients use it only when their
    /// authenticated Hearth API itself is on loopback, never for remote servers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub local_url: Option<String>,
    pub channel_id: String,
    pub room_id: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub revision: u64,
    pub url: String,
    pub room: String,
    pub identity: String,
    pub token: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub expires_at: u64,
}

/// Inside encrypted MLS controls only; AES-GCM-wrapped publisher material.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct WrappedMediaKey {
    pub recipient: String,
    pub nonce: String,
    pub ciphertext: String,
}
