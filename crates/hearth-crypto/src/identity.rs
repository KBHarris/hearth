use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
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
    #[cfg(feature = "local-vault")]
    pub(crate) fn sign_scoped(&self, statement: &[u8]) -> [u8; 64] {
        self.0.sign(statement).to_bytes()
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
        let key = VerifyingKey::from_bytes(&bytes).map_err(|_| CryptoError::InvalidKey)?;
        if key.is_weak() {
            return Err(CryptoError::InvalidKey);
        }
        Ok(Self(key))
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
            .verify_strict(
                &device_cert_message(&device),
                &Signature::from_bytes(&sig_bytes),
            )
            .map_err(|_| CryptoError::BadSignature)
    }
}

/// Public proof binding an initial device to an authenticated account and home server.
/// Both keys sign the scoped statement; the server receives no private material.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enrollment {
    pub identity_key: String,
    pub device_key: String,
    pub certificate: String,
    pub account_signature: String,
    pub device_signature: String,
}
impl Enrollment {
    pub fn create(
        user: &IdentityKey,
        device: &IdentityKey,
        account: &str,
        server: &str,
    ) -> Result<Self, CryptoError> {
        let certificate = user.certify_device(&device.public());
        let message = enrollment_message(account, server, &device.public())?;
        Ok(Self {
            identity_key: certificate.user,
            device_key: certificate.device,
            certificate: certificate.signature,
            account_signature: hex::encode(user.0.sign(&message).to_bytes()),
            device_signature: hex::encode(device.0.sign(&message).to_bytes()),
        })
    }
    pub fn verify(&self, account: &str, server: &str) -> Result<(), CryptoError> {
        DeviceCertificate {
            user: self.identity_key.clone(),
            device: self.device_key.clone(),
            signature: self.certificate.clone(),
        }
        .verify()?;
        let user = PublicIdentity::from_hex(&self.identity_key)?;
        let device = PublicIdentity::from_hex(&self.device_key)?;
        let message = enrollment_message(account, server, &device)?;
        for (key, signature) in [
            (user, &self.account_signature),
            (device, &self.device_signature),
        ] {
            let bytes: [u8; 64] = hex::decode(signature)
                .ok()
                .and_then(|b| b.try_into().ok())
                .ok_or(CryptoError::BadSignature)?;
            key.0
                .verify_strict(&message, &Signature::from_bytes(&bytes))
                .map_err(|_| CryptoError::BadSignature)?;
        }
        Ok(())
    }
}
fn enrollment_message(
    account: &str,
    server: &str,
    device: &PublicIdentity,
) -> Result<Vec<u8>, CryptoError> {
    let mut message = b"hearth/v1/first-device-enrollment".to_vec();
    for id in [account, server] {
        let bytes: [u8; 32] = hex::decode(id)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(CryptoError::InvalidKey)?;
        message.extend_from_slice(&bytes);
    }
    message.extend_from_slice(device.0.as_bytes());
    Ok(message)
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
