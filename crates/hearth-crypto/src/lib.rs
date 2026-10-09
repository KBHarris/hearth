//! Hearth cryptographic core.
//!
//! Key hierarchy (see PLAN.md, "Identity model"):
//! user identity key --signs--> device keys, which are the MLS leaf credentials.
//!
//! The identity layer is available by default. Phase 0's optional `mls-spike` and
//! `opaque-spike` features run ephemeral feasibility flows; product MLS, encrypted storage,
//! attachment encryption, and SFrame key export land in Phases 1-4.

pub mod identity;
#[cfg(feature = "messaging")]
pub mod messaging;
#[cfg(feature = "local-vault")]
pub mod recovery;
#[cfg(feature = "local-vault")]
pub mod vault;

#[cfg(feature = "auth")]
pub mod auth;

#[cfg(feature = "mls-spike")]
pub mod mls_spike;

#[cfg(feature = "opaque-spike")]
pub mod opaque_spike;

pub use identity::{DeviceCertificate, IdentityKey, PublicIdentity};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("invalid key encoding")]
    InvalidKey,
    #[error("signature verification failed")]
    BadSignature,
}
