//! Phase 0 feasibility experiment. Fresh, in-memory groups only; no product keystore,
//! identity verification, networking, history sharing, or persistent state.

use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde::{Deserialize, Serialize};

const CANARY: &[u8] = b"HEARTH_MLS_SPIKE_PRIVATE_MESSAGE_2026";
const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

#[derive(Debug, Serialize, Deserialize)]
pub struct MlsSpikeReport {
    pub members_after_join: usize,
    pub bidirectional_round_trip: bool,
    pub ciphertext_hides_canary: bool,
    pub tampering_rejected: bool,
    pub replay_rejected: bool,
    pub exporter_matches: bool,
    pub removal_rotates_exporter: bool,
    pub removed_member_rejected: bool,
}

trait Phase<T> {
    fn phase(self, label: &str) -> Result<T, String>;
}

impl<T, E> Phase<T> for Result<T, E> {
    fn phase(self, label: &str) -> Result<T, String> {
        // Do not include third-party error Debug output that might carry key material.
        self.map_err(|_| format!("MLS spike failed during {label}"))
    }
}

fn credential(
    provider: &OpenMlsRustCrypto,
    name: &[u8],
) -> Result<(CredentialWithKey, SignatureKeyPair), String> {
    let signer =
        SignatureKeyPair::new(SUITE.signature_algorithm()).phase("credential generation")?;
    signer
        .store(provider.storage())
        .phase("credential storage")?;
    Ok((
        CredentialWithKey {
            credential: BasicCredential::new(name.to_vec()).into(),
            signature_key: signer.public().into(),
        },
        signer,
    ))
}

fn protocol(bytes: &[u8]) -> Result<ProtocolMessage, String> {
    MlsMessageIn::tls_deserialize_exact(bytes)
        .phase("wire decoding")?
        .try_into_protocol_message()
        .phase("protocol decoding")
}

fn decrypt(
    group: &mut MlsGroup,
    provider: &OpenMlsRustCrypto,
    bytes: &[u8],
) -> Result<Vec<u8>, String> {
    // OpenMLS can consume ratchet state before authentication fails. A production
    // receiver needs a transaction spanning both the group and its storage provider.
    // This in-memory spike models rollback with a snapshot; it is not a production store.
    let snapshot = provider
        .storage()
        .values
        .read()
        .map_err(|_| "MLS spike storage lock failed")?
        .clone();
    let group_id = group.group_id().clone();
    let result = (|| {
        let processed = group
            .process_message(provider, protocol(bytes)?)
            .phase("message processing")?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(message.into_bytes()),
            _ => Err("MLS spike received a non-application message".into()),
        }
    })();
    if result.is_err() {
        *provider
            .storage()
            .values
            .write()
            .map_err(|_| "MLS spike storage lock failed")? = snapshot;
        *group = MlsGroup::load(provider.storage(), &group_id)
            .phase("receive rollback")?
            .ok_or("MLS spike group missing during rollback")?;
    }
    result
}

fn exporter(group: &MlsGroup, provider: &OpenMlsRustCrypto) -> Result<Vec<u8>, String> {
    group
        .export_secret(
            provider.crypto(),
            "hearth/spike/exporter/v1",
            b"test-only",
            32,
        )
        .phase("exporter")
}

/// Run the same adversarial round trip in native desktop and WebAssembly builds.
/// Only a report is returned; no keys, plaintext, or ciphertext leave this function.
pub fn run() -> Result<MlsSpikeReport, String> {
    let alice_provider = OpenMlsRustCrypto::default();
    let bob_provider = OpenMlsRustCrypto::default();
    let (alice_credential, alice_signer) = credential(&alice_provider, b"alice-test-device")?;
    let (bob_credential, bob_signer) = credential(&bob_provider, b"bob-test-device")?;
    let bob_package = KeyPackage::builder()
        .build(SUITE, &bob_provider, &bob_signer, bob_credential)
        .phase("key package")?;
    let config = MlsGroupCreateConfig::builder().ciphersuite(SUITE).build();
    let mut alice = MlsGroup::new(&alice_provider, &alice_signer, &config, alice_credential)
        .phase("group creation")?;
    let (_, welcome, _) = alice
        .add_members(
            &alice_provider,
            &alice_signer,
            &[bob_package.key_package().clone()],
        )
        .phase("member addition")?;
    // The delivery service must accept a commit before a real client forwards its Welcome.
    alice
        .merge_pending_commit(&alice_provider)
        .phase("add commit merge")?;
    let welcome_bytes = welcome
        .tls_serialize_detached()
        .phase("welcome serialization")?;
    let welcome = match MlsMessageIn::tls_deserialize_exact(&welcome_bytes)
        .phase("welcome decoding")?
        .extract()
    {
        MlsMessageBodyIn::Welcome(welcome) => welcome,
        _ => return Err("MLS spike expected a Welcome".into()),
    };
    let mut bob =
        ProcessedWelcome::new_from_welcome(&bob_provider, &MlsGroupJoinConfig::default(), welcome)
            .phase("welcome processing")?
            .into_staged_welcome(&bob_provider, Some(alice.export_ratchet_tree().into()))
            .phase("welcome staging")?
            .into_group(&bob_provider)
            .phase("group join")?;
    let members_after_join = bob.members().count();
    let alice_exporter = exporter(&alice, &alice_provider)?;
    let exporter_matches = alice_exporter == exporter(&bob, &bob_provider)?;

    let ciphertext = alice
        .create_message(&alice_provider, &alice_signer, CANARY)
        .phase("encryption")?
        .tls_serialize_detached()
        .phase("ciphertext serialization")?;
    let ciphertext_hides_canary = !ciphertext
        .windows(CANARY.len())
        .any(|window| window == CANARY);
    let private_message = matches!(
        MlsMessageIn::tls_deserialize_exact(&ciphertext)
            .phase("ciphertext decoding")?
            .extract(),
        MlsMessageBodyIn::PrivateMessage(_)
    );
    let mut tampered = ciphertext.clone();
    let last = tampered
        .last_mut()
        .ok_or("MLS spike produced empty ciphertext")?;
    *last ^= 1;
    let tampering_rejected = decrypt(&mut bob, &bob_provider, &tampered).is_err();
    let alice_to_bob = decrypt(&mut bob, &bob_provider, &ciphertext)
        .phase("valid message after tampering")?
        == CANARY;
    let replay_rejected = decrypt(&mut bob, &bob_provider, &ciphertext).is_err();
    let reply = bob
        .create_message(&bob_provider, &bob_signer, b"reply from Bob")
        .phase("reply encryption")?
        .tls_serialize_detached()
        .phase("reply serialization")?;
    let bidirectional_round_trip = alice_to_bob
        && decrypt(&mut alice, &alice_provider, &reply).phase("valid reply")? == b"reply from Bob";

    let (remove_commit, _, _) = alice
        .remove_members(&alice_provider, &alice_signer, &[bob.own_leaf_index()])
        .phase("member removal")?;
    alice
        .merge_pending_commit(&alice_provider)
        .phase("remove commit merge")?;
    let removal_rotates_exporter = exporter(&alice, &alice_provider)? != alice_exporter;
    let remove_bytes = remove_commit
        .tls_serialize_detached()
        .phase("remove serialization")?;
    let processed = bob
        .process_message(&bob_provider, protocol(&remove_bytes)?)
        .phase("remove processing")?;
    match processed.into_content() {
        ProcessedMessageContent::StagedCommitMessage(commit) => bob
            .merge_staged_commit(&bob_provider, *commit)
            .phase("remove reception")?,
        _ => return Err("MLS spike expected a removal commit".into()),
    }
    let after_removal = alice
        .create_message(&alice_provider, &alice_signer, b"after removal")
        .phase("post-removal encryption")?
        .tls_serialize_detached()
        .phase("post-removal serialization")?;
    let removed_member_rejected =
        !bob.is_active() && decrypt(&mut bob, &bob_provider, &after_removal).is_err();
    if members_after_join != 2
        || !private_message
        || !bidirectional_round_trip
        || !ciphertext_hides_canary
        || !tampering_rejected
        || !replay_rejected
        || !exporter_matches
        || !removal_rotates_exporter
        || !removed_member_rejected
    {
        return Err("MLS spike scenario did not meet its acceptance checks".into());
    }
    Ok(MlsSpikeReport {
        members_after_join,
        bidirectional_round_trip,
        ciphertext_hides_canary,
        tampering_rejected,
        replay_rejected,
        exporter_matches,
        removal_rotates_exporter,
        removed_member_rejected,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn encrypted_group_survives_adversarial_round_trip() {
        super::run().expect("MLS spike acceptance checks");
    }
}
