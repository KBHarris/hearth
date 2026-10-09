//! Bounded native OpenMLS load measurement, never a product capacity claim.
use openmls::prelude::{
    tls_codec::{Deserialize as _, Serialize as _},
    *,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use serde::Serialize;
use std::time::Instant;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
fn credential(provider: &OpenMlsRustCrypto, index: usize) -> (CredentialWithKey, SignatureKeyPair) {
    let signer = SignatureKeyPair::new(SUITE.signature_algorithm()).expect("benchmark signer");
    signer
        .store(provider.storage())
        .expect("benchmark signer storage");
    (
        CredentialWithKey {
            credential: BasicCredential::new(format!("benchmark-only-{index}").into_bytes()).into(),
            signature_key: signer.public().into(),
        },
        signer,
    )
}
fn protocol(message: MlsMessageOut) -> ProtocolMessage {
    MlsMessageIn::tls_deserialize_exact(message.tls_serialize_detached().expect("benchmark wire"))
        .expect("benchmark decode")
        .try_into_protocol_message()
        .expect("benchmark protocol")
}
#[derive(Serialize)]
struct Report {
    members: usize,
    suite: &'static str,
    runtime: &'static str,
    product_device_limit: usize,
    key_packages_ms: f64,
    add_batch_members: usize,
    add_commits_ms: Vec<f64>,
    rotation_samples_ms: Vec<f64>,
    rotation_p50_ms: f64,
    rotation_p95_ms: f64,
    largest_commit_bytes: usize,
    largest_welcome_bytes: usize,
    provider_serialized_bytes: usize,
    last_member_decrypts: bool,
}
fn main() {
    let provider = OpenMlsRustCrypto::default();
    let (owner, signer) = credential(&provider, 0);
    let config = MlsGroupCreateConfig::builder()
        .ciphersuite(SUITE)
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .build();
    let mut group = MlsGroup::new(&provider, &signer, &config, owner).expect("benchmark group");
    let started = Instant::now();
    let mut packages = Vec::new();
    let mut recipient = None;
    for index in 1..1000 {
        let peer = OpenMlsRustCrypto::default();
        let (proof, peer_signer) = credential(&peer, index);
        let bundle = KeyPackage::builder()
            .build(SUITE, &peer, &peer_signer, proof)
            .expect("benchmark package");
        packages.push(bundle.key_package().clone());
        if index == 999 {
            recipient = Some(peer);
        }
    }
    let key_packages_ms = started.elapsed().as_secs_f64() * 1000.;
    let mut add_commits_ms = Vec::new();
    let mut largest_commit_bytes = 0;
    let mut largest_welcome_bytes = 0;
    let mut last_welcome = None;
    for batch in packages.chunks(50) {
        let started = Instant::now();
        let (commit, welcome, _) = group
            .add_members(&provider, &signer, batch)
            .expect("benchmark add");
        group
            .merge_pending_commit(&provider)
            .expect("benchmark merge");
        add_commits_ms.push(started.elapsed().as_secs_f64() * 1000.);
        largest_commit_bytes = largest_commit_bytes.max(
            commit
                .tls_serialize_detached()
                .expect("benchmark commit wire")
                .len(),
        );
        largest_welcome_bytes = largest_welcome_bytes.max(
            welcome
                .tls_serialize_detached()
                .expect("benchmark welcome wire")
                .len(),
        );
        last_welcome = Some(welcome);
    }
    let recipient = recipient.expect("last recipient");
    let config = MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .build();
    let welcome = MlsMessageIn::tls_deserialize_exact(
        last_welcome
            .expect("last welcome")
            .tls_serialize_detached()
            .expect("benchmark welcome wire"),
    )
    .expect("benchmark welcome decode");
    let MlsMessageBodyIn::Welcome(welcome) = welcome.extract() else {
        panic!("benchmark expected Welcome")
    };
    let mut last = StagedWelcome::new_from_welcome(&recipient, &config, welcome, None)
        .expect("benchmark welcome")
        .into_group(&recipient)
        .expect("benchmark join");
    let mut rotation_samples_ms = Vec::new();
    for _ in 0..10 {
        let started = Instant::now();
        let (commit, _, _) = group
            .self_update(&provider, &signer, LeafNodeParameters::default())
            .expect("benchmark rotate")
            .into_messages();
        group
            .merge_pending_commit(&provider)
            .expect("benchmark rotation merge");
        rotation_samples_ms.push(started.elapsed().as_secs_f64() * 1000.);
        let processed = last
            .process_message(&recipient, protocol(commit))
            .expect("benchmark receive commit");
        if let ProcessedMessageContent::StagedCommitMessage(commit) = processed.into_content() {
            last.merge_staged_commit(&recipient, *commit)
                .expect("benchmark recipient merge");
        } else {
            panic!("benchmark expected commit");
        }
    }
    let canary = b"HEARTH_LOAD_BENCHMARK_CANARY";
    let message = group
        .create_message(&provider, &signer, canary)
        .expect("benchmark message");
    let processed = last
        .process_message(&recipient, protocol(message))
        .expect("benchmark decrypt");
    let last_member_decrypts = match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(message) => message.into_bytes() == canary,
        _ => false,
    };
    assert_eq!(group.members().count(), 1000);
    assert!(last_member_decrypts);
    let mut sorted = rotation_samples_ms.clone();
    sorted.sort_by(f64::total_cmp);
    let provider_serialized_bytes = provider
        .storage()
        .values
        .read()
        .expect("benchmark storage")
        .iter()
        .map(|(key, value)| key.len() + value.len())
        .sum();
    let report = Report {
        members: 1000,
        suite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
        runtime: "native OpenMLS 0.9, in-memory test credentials",
        product_device_limit: 128,
        key_packages_ms,
        add_batch_members: 50,
        add_commits_ms,
        rotation_samples_ms,
        rotation_p50_ms: sorted[4],
        rotation_p95_ms: sorted[9],
        largest_commit_bytes,
        largest_welcome_bytes,
        provider_serialized_bytes,
        last_member_decrypts,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("benchmark report")
    );
}
