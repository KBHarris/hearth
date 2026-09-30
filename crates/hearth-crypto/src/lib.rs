//! Hearth cryptographic core.
//!
//! Key hierarchy (see PLAN.md, "Identity model"):
//! user identity key --signs--> device keys, which are the MLS leaf credentials.
//!
//! Phase 0 contains only the identity layer. OpenMLS, attachment encryption, and the
//! SFrame key export land in Phases 1-4.

pub mod identity;

pub use identity::{DeviceCertificate, IdentityKey, PublicIdentity};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("invalid key encoding")]
    InvalidKey,
    #[error("signature verification failed")]
    BadSignature,
}
