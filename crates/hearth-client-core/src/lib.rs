//! Platform-independent client state.
//!
//! This crate must stay free of I/O so it compiles to both native and `wasm32`.
//! Transport (HTTP, WebSocket) and storage (SQLCipher, IndexedDB) are injected by the
//! host shell through traits added in Phase 1.

use hearth_crypto::{DeviceCertificate, IdentityKey};
use hearth_proto::PROTOCOL_VERSION;

/// Identity material for a freshly set-up install.
pub struct NewInstall {
    pub user_key: IdentityKey,
    pub device_key: IdentityKey,
    pub certificate: DeviceCertificate,
}

/// Create a brand-new user identity plus this device's key, cross-signed.
pub fn create_identity() -> NewInstall {
    let user_key = IdentityKey::generate();
    let device_key = IdentityKey::generate();
    let certificate = user_key.certify_device(&device_key.public());
    NewInstall {
        user_key,
        device_key,
        certificate,
    }
}

/// Whether a server advertising `protocols` can be spoken to.
pub fn is_compatible(protocols: &[u32]) -> bool {
    protocols.contains(&PROTOCOL_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_identity_is_self_consistent() {
        let install = create_identity();
        install.certificate.verify().unwrap();
        assert_eq!(
            install.certificate.device,
            install.device_key.public().to_hex()
        );
    }

    #[test]
    fn compatibility_requires_current_version() {
        assert!(is_compatible(&[PROTOCOL_VERSION]));
        assert!(!is_compatible(&[PROTOCOL_VERSION + 1]));
    }
}
