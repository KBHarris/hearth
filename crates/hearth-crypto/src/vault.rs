//! Client-only encrypted identity vault. No storage, network, or plaintext key exports.
use crate::{IdentityKey, identity::Enrollment};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use zeroize::Zeroizing;

const CONTEXT: &[u8] = b"hearth/v1/local-identity-vault";
const ERROR: &str = "The local identity could not be unlocked. Preserve it and use the original account and server.";
pub const ENVELOPE_HEX_LENGTH: usize = 274;

pub struct LocalIdentity {
    user: IdentityKey,
    device: IdentityKey,
    // Reserved client-only storage key; SQLCipher/message storage is a later integration.
    store_key: Zeroizing<[u8; 32]>,
}
impl Default for LocalIdentity {
    fn default() -> Self {
        Self::new()
    }
}
impl LocalIdentity {
    pub fn new() -> Self {
        let mut store_key = Zeroizing::new([0; 32]);
        OsRng.fill_bytes(store_key.as_mut());
        Self {
            user: IdentityKey::generate(),
            device: IdentityKey::generate(),
            store_key,
        }
    }
    pub fn enrollment(&self, account: &str, server: &str) -> Result<Enrollment, String> {
        Enrollment::create(&self.user, &self.device, account, server).map_err(|_| ERROR.into())
    }
    pub fn seal(&self, export_key: &[u8], account: &str, server: &str) -> Result<String, String> {
        let aad = scope(account, server)?;
        let key = wrapping_key(export_key, &aad)?;
        let mut plaintext = Zeroizing::new([0u8; 96]);
        let user = Zeroizing::new(self.user.to_bytes());
        let device = Zeroizing::new(self.device.to_bytes());
        plaintext[..32].copy_from_slice(user.as_ref());
        plaintext[32..64].copy_from_slice(device.as_ref());
        plaintext[64..].copy_from_slice(self.store_key.as_ref());
        let mut nonce = [0u8; 24];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = XChaCha20Poly1305::new_from_slice(key.as_ref())
            .map_err(|_| ERROR)?
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext.as_ref(),
                    aad: &aad,
                },
            )
            .map_err(|_| ERROR)?;
        let mut envelope = vec![1];
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&ciphertext);
        Ok(hex::encode(envelope))
    }
    pub fn open(
        envelope: &str,
        export_key: &[u8],
        account: &str,
        server: &str,
    ) -> Result<Self, String> {
        if envelope.len() != ENVELOPE_HEX_LENGTH {
            return Err(ERROR.into());
        }
        let bytes = hex::decode(envelope).map_err(|_| ERROR)?;
        if bytes[0] != 1 {
            return Err(ERROR.into());
        }
        let aad = scope(account, server)?;
        let key = wrapping_key(export_key, &aad)?;
        let plaintext = Zeroizing::new(
            XChaCha20Poly1305::new_from_slice(key.as_ref())
                .map_err(|_| ERROR)?
                .decrypt(
                    XNonce::from_slice(&bytes[1..25]),
                    Payload {
                        msg: &bytes[25..],
                        aad: &aad,
                    },
                )
                .map_err(|_| ERROR)?,
        );
        if plaintext.len() != 96 {
            return Err(ERROR.into());
        }
        let mut user = Zeroizing::new([0; 32]);
        user.copy_from_slice(&plaintext[..32]);
        let mut device = Zeroizing::new([0; 32]);
        device.copy_from_slice(&plaintext[32..64]);
        let mut store_key = Zeroizing::new([0; 32]);
        store_key.copy_from_slice(&plaintext[64..]);
        Ok(Self {
            user: IdentityKey::from_bytes(&user),
            device: IdentityKey::from_bytes(&device),
            store_key,
        })
    }
}
fn scope(account: &str, server: &str) -> Result<Vec<u8>, String> {
    let mut aad = CONTEXT.to_vec();
    aad.push(1);
    for id in [account, server] {
        let bytes: [u8; 32] = hex::decode(id)
            .ok()
            .and_then(|b| b.try_into().ok())
            .ok_or(ERROR)?;
        aad.extend_from_slice(&bytes);
    }
    Ok(aad)
}
fn wrapping_key(export_key: &[u8], scope: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    if export_key.len() != 64 {
        return Err(ERROR.into());
    }
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<sha2::Sha512>::new(Some(scope), export_key)
        .expand(CONTEXT, key.as_mut())
        .map_err(|_| ERROR)?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_vault_rejects_tampering_and_context_substitution() {
        let identity = LocalIdentity::new();
        let key = [7u8; 64];
        let account = "ab".repeat(32);
        let server = "cd".repeat(32);
        let envelope = identity.seal(&key, &account, &server).unwrap();
        assert_eq!(envelope.len(), ENVELOPE_HEX_LENGTH);
        assert_ne!(envelope, identity.seal(&key, &account, &server).unwrap());
        let before = identity.enrollment(&account, &server).unwrap();
        let restored = LocalIdentity::open(&envelope, &key, &account, &server).unwrap();
        let after = restored.enrollment(&account, &server).unwrap();
        assert_eq!(before.identity_key, after.identity_key);
        assert_eq!(before.device_key, after.device_key);
        after.verify(&account, &server).unwrap();
        assert!(after.verify(&"ef".repeat(32), &server).is_err());
        assert!(after.verify(&account, &"ef".repeat(32)).is_err());
        assert!(LocalIdentity::open(&envelope, &[8u8; 64], &account, &server).is_err());
        assert!(LocalIdentity::open(&envelope, &key, &"ef".repeat(32), &server).is_err());
        assert!(LocalIdentity::open(&envelope, &key, &account, &"ef".repeat(32)).is_err());
        let mut tampered = hex::decode(&envelope).unwrap();
        tampered[40] ^= 1;
        assert!(LocalIdentity::open(&hex::encode(tampered), &key, &account, &server).is_err());
        let mut wrong_version = envelope.clone();
        wrong_version.replace_range(..2, "02");
        assert!(LocalIdentity::open(&wrong_version, &key, &account, &server).is_err());
        let secret = hex::encode(identity.user.to_bytes());
        assert!(!envelope.contains(&secret));
        let mut forged = after.clone();
        forged.device_signature = "00".repeat(64);
        assert!(forged.verify(&account, &server).is_err());
        assert!(crate::PublicIdentity::from_hex(&format!("01{}", "00".repeat(31))).is_err());
    }
}
