//! Client-encrypted short invite envelopes. Admission capabilities remain private.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct InviteEnvelope {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(deny_unknown_fields)]
pub struct StoreInviteEnvelope {
    pub id: String,
    pub envelope: InviteEnvelope,
}
