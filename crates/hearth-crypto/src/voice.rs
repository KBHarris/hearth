//! Device-signed public voice presence; media secrets remain in client WebCrypto/MLS.
use crate::messaging::{valid_id, verify_signature};
use hearth_proto::voice::VoicePresence;

pub(crate) fn statement(server: &str, value: &VoicePresence) -> Result<Vec<u8>, String> {
    let mut public = value.clone();
    public.signature.clear();
    serde_json::to_vec(&("hearth/v1/voice-presence", server, public))
        .map_err(|_| "Invalid voice presence".into())
}
pub fn validate(value: &VoicePresence) -> Result<(), String> {
    if [
        &value.channel_id,
        &value.room_id,
        &value.device_key,
        &value.incarnation,
    ]
    .iter()
    .all(|id| valid_id(id))
        && value.epoch < 9_007_199_254_740_991
        && value.sfu != Some(false)
        && value.public_key.len() == 130
        && value.public_key.starts_with("04")
        && value
            .public_key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && value.issued_at < value.expires_at
        && value.expires_at < 9_007_199_254_740_991
        && value.expires_at - value.issued_at <= 30_000
    {
        Ok(())
    } else {
        Err("Invalid voice presence".into())
    }
}
pub fn verify(server: &str, value: &VoicePresence) -> Result<(), String> {
    validate(value)?;
    verify_signature(
        &value.device_key,
        &value.signature,
        &statement(server, value)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IdentityKey, messaging::random_id};
    #[test]
    fn presence_signature_binds_room_epoch_privacy_contribution_lifetime_and_departure() {
        let device = IdentityKey::generate();
        let server = random_id();
        let mut value = VoicePresence {
            channel_id: random_id(),
            room_id: random_id(),
            epoch: 1,
            device_key: device.public().to_hex(),
            incarnation: random_id(),
            public_key: format!("04{}", "ab".repeat(64)),
            relay_only: true,
            sfu: None,
            active: true,
            issued_at: 1_000,
            expires_at: 31_000,
            signature: String::new(),
        };
        value.signature = hex::encode(device.sign_scoped(&statement(&server, &value).unwrap()));
        assert!(verify(&server, &value).is_ok());
        assert!(verify(&random_id(), &value).is_err());
        for field in 0..9 {
            let mut changed = value.clone();
            match field {
                0 => changed.channel_id = random_id(),
                1 => changed.room_id = random_id(),
                2 => changed.epoch += 1,
                3 => changed.incarnation = random_id(),
                4 => changed.public_key = format!("04{}", "cd".repeat(64)),
                5 => changed.relay_only = false,
                6 => changed.active = false,
                7 => changed.issued_at += 1,
                _ => changed.expires_at -= 1,
            };
            assert!(verify(&server, &changed).is_err());
        }
        value.expires_at = 31_001;
        assert!(validate(&value).is_err());
    }
}
