//! Portable identity handoff. Device and message-store keys are never copied.
use crate::{IdentityKey, vault::LocalIdentity};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use ed25519_dalek::Signature;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const CONTEXT: &[u8] = b"hearth/v1/identity-recovery";
const ERROR: &str =
    "Recovery could not be verified. Check the kit, passphrase, account and server.";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Kit {
    version: u8,
    account_id: String,
    server_key: String,
    identity_key: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}
fn bytes<const N: usize>(value: &str) -> Result<[u8; N], String> {
    hex::decode(value)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| ERROR.into())
}
fn aad(kit: &Kit, account: &str, server: &str) -> Result<Vec<u8>, String> {
    if kit.version != 1 || kit.account_id != account || kit.server_key != server {
        return Err(ERROR.into());
    }
    let mut result = CONTEXT.to_vec();
    result.push(kit.version);
    for value in [&kit.account_id, &kit.server_key, &kit.identity_key] {
        result.extend_from_slice(&bytes::<32>(value)?);
    }
    Ok(result)
}
fn key(passphrase: &str, salt: &[u8; 16]) -> Result<Zeroizing<[u8; 32]>, String> {
    if !(16..=1024).contains(&passphrase.len()) {
        return Err("Use a recovery passphrase of 16–1024 bytes.".into());
    }
    let mut key = Zeroizing::new([0; 32]);
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(65536, 3, 1, Some(32)).map_err(|_| ERROR)?,
    )
    .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
    .map_err(|_| ERROR)?;
    Ok(key)
}
impl LocalIdentity {
    pub fn recovery_kit(
        &self,
        passphrase: &str,
        account: &str,
        server: &str,
    ) -> Result<String, String> {
        let mut salt = [0; 16];
        let mut nonce = [0; 24];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce);
        let mut kit = Kit {
            version: 1,
            account_id: account.into(),
            server_key: server.into(),
            identity_key: self.user.public().to_hex(),
            salt: hex::encode(salt),
            nonce: hex::encode(nonce),
            ciphertext: String::new(),
        };
        let aad = aad(&kit, account, server)?;
        let key = key(passphrase, &salt)?;
        let seed = Zeroizing::new(self.user.to_bytes());
        kit.ciphertext = hex::encode(
            XChaCha20Poly1305::new_from_slice(key.as_ref())
                .map_err(|_| ERROR)?
                .encrypt(
                    XNonce::from_slice(&nonce),
                    Payload {
                        msg: seed.as_ref(),
                        aad: &aad,
                    },
                )
                .map_err(|_| ERROR)?,
        );
        serde_json::to_string_pretty(&kit).map_err(|_| ERROR.into())
    }
    pub fn restore_kit(
        value: &str,
        passphrase: &str,
        account: &str,
        server: &str,
    ) -> Result<Self, String> {
        if value.len() > 4096 {
            return Err(ERROR.into());
        }
        let kit: Kit = serde_json::from_str(value).map_err(|_| ERROR)?;
        let aad = aad(&kit, account, server)?;
        let salt = bytes::<16>(&kit.salt)?;
        let nonce = bytes::<24>(&kit.nonce)?;
        let ciphertext = bytes::<48>(&kit.ciphertext)?;
        let key = key(passphrase, &salt)?;
        let plaintext = Zeroizing::new(
            XChaCha20Poly1305::new_from_slice(key.as_ref())
                .map_err(|_| ERROR)?
                .decrypt(
                    XNonce::from_slice(&nonce),
                    Payload {
                        msg: &ciphertext,
                        aad: &aad,
                    },
                )
                .map_err(|_| ERROR)?,
        );
        let mut seed = Zeroizing::new([0; 32]);
        seed.copy_from_slice(&plaintext);
        let mut identity = Self::new();
        identity.user = IdentityKey::from_bytes(&seed);
        if identity.user.public().to_hex() != kit.identity_key {
            return Err(ERROR.into());
        }
        Ok(identity)
    }
    pub fn link_offer(
        &self,
        account: &str,
        server: &str,
    ) -> Result<(String, String, String, String), String> {
        let mut random = Zeroizing::new([0; 16]);
        OsRng.fill_bytes(random.as_mut());
        let code = hex::encode(random.as_ref());
        let id = link_id(&code)?;
        let envelope = self.recovery_kit(&code, account, server)?;
        let proof = self
            .device
            .sign_scoped(&link_statement(&id, &envelope, account, server)?);
        Ok((code, id, envelope, hex::encode(proof)))
    }
}
pub fn link_id(code: &str) -> Result<String, String> {
    bytes::<16>(code)?;
    Ok(hex::encode(Sha256::digest(code.as_bytes())))
}
fn link_statement(
    id: &str,
    envelope: &str,
    account: &str,
    server: &str,
) -> Result<Vec<u8>, String> {
    if envelope.len() > 4096 {
        return Err(ERROR.into());
    }
    let mut result = b"hearth/v1/device-link-offer".to_vec();
    for value in [account, server, id] {
        result.extend_from_slice(&bytes::<32>(value)?);
    }
    result.extend_from_slice(&Sha256::digest(envelope.as_bytes()));
    Ok(result)
}
pub fn verify_link(
    device: &str,
    id: &str,
    envelope: &str,
    account: &str,
    server: &str,
    signature: &str,
) -> Result<(), String> {
    let key = ed25519_dalek::VerifyingKey::from_bytes(&bytes::<32>(device)?).map_err(|_| ERROR)?;
    if key.is_weak() {
        return Err(ERROR.into());
    }
    key.verify_strict(
        &link_statement(id, envelope, account, server)?,
        &Signature::from_bytes(&bytes::<64>(signature)?),
    )
    .map_err(|_| ERROR.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_identity_restores_with_new_device_and_rejects_substitution() {
        let original = LocalIdentity::new();
        let account = "ab".repeat(32);
        let server = "cd".repeat(32);
        let password = "test recovery phrase with enough entropy";
        let kit = original.recovery_kit(password, &account, &server).unwrap();
        assert!(!kit.contains(&hex::encode(original.user.to_bytes())));
        let restored = LocalIdentity::restore_kit(&kit, password, &account, &server).unwrap();
        assert_eq!(original.user.public(), restored.user.public());
        assert_ne!(original.device.public(), restored.device.public());
        assert_ne!(original.store_key.as_ref(), restored.store_key.as_ref());
        assert!(
            LocalIdentity::restore_kit(&kit, "incorrect recovery passphrase", &account, &server)
                .is_err()
        );
        assert!(LocalIdentity::restore_kit(&kit, password, &"ef".repeat(32), &server).is_err());
        let altered = kit.replace(&server, &"ef".repeat(32));
        assert!(
            LocalIdentity::restore_kit(&altered, password, &account, &"ef".repeat(32)).is_err()
        );
        let (code, id, envelope, signature) = original.link_offer(&account, &server).unwrap();
        assert_eq!(link_id(&code).unwrap(), id);
        verify_link(
            &original.device.public().to_hex(),
            &id,
            &envelope,
            &account,
            &server,
            &signature,
        )
        .unwrap();
        assert!(
            verify_link(
                &restored.device.public().to_hex(),
                &id,
                &envelope,
                &account,
                &server,
                &signature
            )
            .is_err()
        );
    }
}
