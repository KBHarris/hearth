use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};

use crate::CryptoError;

/// Domain separator so device certificates can never be confused with other signatures.
const DEVICE_CERT_CONTEXT: &[u8] = b"hearth/v1/device-cert";

/// A long-lived signing key: either a user identity key or a device key.
pub struct IdentityKey(SigningKey);

impl IdentityKey {
    pub fn generate() -> Self {
        Self(SigningKey::generate(&mut OsRng))
    }

    pub fn from_bytes(secret: &[u8; 32]) -> Self {
        Self(SigningKey::from_bytes(secret))
    }

    /// Secret bytes, for sealing into the OS keystore or the recovery kit only.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.0.to_bytes()
    }

    pub fn public(&self) -> PublicIdentity {
        PublicIdentity(self.0.verifying_key())
    }

    /// Cross-sign a device key with this (user identity) key.
    pub fn certify_device(&self, device: &PublicIdentity) -> DeviceCertificate {
        let sig = self.0.sign(&device_cert_message(device));
        DeviceCertificate {
            user: self.public().to_hex(),
            device: device.to_hex(),
            signature: hex::encode(sig.to_bytes()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicIdentity(VerifyingKey);

impl PublicIdentity {
    pub fn to_hex(&self) -> String {
        hex::encode(self.0.as_bytes())
    }

    pub fn from_hex(s: &str) -> Result<Self, CryptoError> {
        let bytes: [u8; 32] = hex::decode(s)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(CryptoError::InvalidKey)?;
        VerifyingKey::from_bytes(&bytes)
            .map(Self)
            .map_err(|_| CryptoError::InvalidKey)
    }
}

/// Statement "user key U vouches for device key D", published so peers can verify devices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceCertificate {
    pub user: String,
    pub device: String,
    pub signature: String,
}

impl DeviceCertificate {
    pub fn verify(&self) -> Result<(), CryptoError> {
        let user = PublicIdentity::from_hex(&self.user)?;
        let device = PublicIdentity::from_hex(&self.device)?;
        let sig_bytes: [u8; 64] = hex::decode(&self.signature)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(CryptoError::BadSignature)?;
        user.0
            .verify(
                &device_cert_message(&device),
                &Signature::from_bytes(&sig_bytes),
            )
            .map_err(|_| CryptoError::BadSignature)
    }
}

fn device_cert_message(device: &PublicIdentity) -> Vec<u8> {
    [DEVICE_CERT_CONTEXT, device.0.as_bytes()].concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_certificate_verifies() {
        let user = IdentityKey::generate();
        let device = IdentityKey::generate();
        let cert = user.certify_device(&device.public());
        cert.verify().unwrap();
    }

    #[test]
    fn tampered_certificate_fails() {
        let user = IdentityKey::generate();
        let mut cert = user.certify_device(&IdentityKey::generate().public());
        cert.device = IdentityKey::generate().public().to_hex();
        assert!(cert.verify().is_err());
    }

    #[test]
    fn secret_round_trips() {
        let key = IdentityKey::generate();
        assert_eq!(
            IdentityKey::from_bytes(&key.to_bytes()).public(),
            key.public()
        );
    }
}
