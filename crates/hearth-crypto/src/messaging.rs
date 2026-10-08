//! Device-bound MLS and an authenticated, encrypted transaction snapshot.
//! Hosts must CAS-save `seal()` before sending any queued operation or acknowledging receive.
use crate::{IdentityKey, identity::Enrollment, vault::LocalIdentity};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use ed25519_dalek::{Signature, VerifyingKey};
use hearth_proto::messaging::*;
use openmls::prelude::{
    tls_codec::{Deserialize as _, Serialize as _},
    *,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use zeroize::Zeroizing;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const ERROR: &str =
    "Encrypted messaging state or device verification failed; preserve the local store.";
const MAX_STATE: usize = 8 * 1024 * 1024;
const MAX_WIRE: usize = 256 * 1024;
const MAX_MEMBERS: usize = 32;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingOperation {
    Commit {
        conversation_id: String,
        upload: CommitUpload,
    },
    Message {
        conversation_id: String,
        upload: MessageUpload,
    },
}
impl PendingOperation {
    pub fn id(&self) -> &str {
        match self {
            Self::Commit { upload, .. } => &upload.operation_id,
            Self::Message { upload, .. } => &upload.operation_id,
        }
    }
    fn conversation(&self) -> &str {
        match self {
            Self::Commit {
                conversation_id, ..
            }
            | Self::Message {
                conversation_id, ..
            } => conversation_id,
        }
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct ClientState {
    groups: Vec<String>,
    pins: BTreeMap<String, String>,
    pending: Vec<PendingOperation>,
    #[serde(default)]
    pending_packages: Vec<KeyPackageRecord>,
    pending_contents: BTreeMap<String, MessageContent>,
    own_operations: BTreeMap<String, String>,
    messages: Vec<LocalMessage>,
    last_seq: u64,
}
#[derive(Serialize, Deserialize)]
struct Snapshot {
    version: u8,
    values: Vec<(Vec<u8>, Vec<u8>)>,
    state: ClientState,
}
#[derive(Serialize)]
pub struct MessagingView {
    pub last_seq: u64,
    pub messages: Vec<LocalMessage>,
    pub pending: Vec<PendingOperation>,
    pub pending_packages: Vec<KeyPackageRecord>,
    pub groups: Vec<Conversation>,
}
pub struct Messaging {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    device: IdentityKey,
    key: Zeroizing<[u8; 32]>,
    own: GroupMember,
    server: String,
    groups: HashMap<String, MlsGroup>,
    state: ClientState,
}

pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn random_id() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
fn fail<T, E>(value: Result<T, E>) -> Result<T, String> {
    value.map_err(|_| ERROR.into())
}
fn require(condition: bool) -> Result<(), String> {
    if condition { Ok(()) } else { Err(ERROR.into()) }
}
fn decode(wire: &str) -> Result<Vec<u8>, String> {
    require(!wire.is_empty() && wire.len() <= MAX_WIRE * 2)?;
    fail(hex::decode(wire))
}
fn protocol(wire: &str) -> Result<ProtocolMessage, String> {
    fail(fail(MlsMessageIn::tls_deserialize_exact(decode(wire)?))?.try_into_protocol_message())
}
fn member(credential: &Credential, signature: &[u8], server: &str) -> Result<GroupMember, String> {
    require(credential.credential_type() == CredentialType::Basic)?;
    let member: GroupMember = fail(serde_json::from_slice(credential.serialized_content()))?;
    verify_member(&member, server)?;
    require(hex::encode(signature) == member.enrollment.device_key)?;
    Ok(member)
}
pub fn verify_member(member: &GroupMember, server: &str) -> Result<(), String> {
    require(
        valid_id(&member.account_id)
            && valid_id(server)
            && member.enrollment.identity_key != member.enrollment.device_key,
    )?;
    let proof: Enrollment = fail(serde_json::from_value(fail(serde_json::to_value(
        &member.enrollment,
    ))?))?;
    fail(proof.verify(&member.account_id, server))
}
pub fn verify_package(record: &KeyPackageRecord, server: &str) -> Result<(), String> {
    checked_package(record, server).map(|_| ())
}
fn checked_package(record: &KeyPackageRecord, server: &str) -> Result<KeyPackage, String> {
    let provider = OpenMlsRustCrypto::default();
    let bytes = decode(&record.package)?;
    require(hex::encode(Sha256::digest(&bytes)) == record.package_hash)?;
    let package = fail(
        fail(KeyPackageIn::tls_deserialize_exact(bytes))?
            .validate(provider.crypto(), ProtocolVersion::Mls10),
    )?;
    require(package.ciphersuite() == SUITE)?;
    let leaf = package.leaf_node();
    let parsed = member(leaf.credential(), leaf.signature_key().as_slice(), server)?;
    require(parsed == record.member)?;
    Ok(package)
}
pub fn check_message_header(
    ciphertext: &str,
    group: &str,
    epoch: u64,
    commit: bool,
) -> Result<(), String> {
    let message = protocol(ciphertext)?;
    require(
        message.wire_format() == WireFormat::PrivateMessage
            && hex::encode(message.group_id().as_slice()) == group
            && message.epoch().as_u64() == epoch
            && message.content_type()
                == if commit {
                    ContentType::Commit
                } else {
                    ContentType::Application
                },
    )
}
fn commit_aad(group: &str, upload: &CommitUpload) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/mls-commit",
        group,
        &upload.operation_id,
        upload.expected_epoch,
        &upload.members,
    )))
}
fn message_aad(group: &str, upload: &MessageUpload) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/mls-message",
        group,
        &upload.operation_id,
        upload.epoch,
        upload.action,
        &upload.target_id,
    )))
}
fn signed_commit(group: &str, server: &str, upload: &CommitUpload) -> Result<Vec<u8>, String> {
    let mut unsigned = upload.clone();
    unsigned.signature.clear();
    fail(serde_json::to_vec(&(
        "hearth/v1/mls-delivery-commit",
        server,
        group,
        unsigned,
    )))
}
fn signed_message(group: &str, server: &str, upload: &MessageUpload) -> Result<Vec<u8>, String> {
    let mut unsigned = upload.clone();
    unsigned.signature.clear();
    fail(serde_json::to_vec(&(
        "hearth/v1/mls-delivery-message",
        server,
        group,
        unsigned,
    )))
}
fn verify_signature(key: &str, signature: &str, bytes: &[u8]) -> Result<(), String> {
    let public: [u8; 32] = fail(fail(hex::decode(key))?.try_into())?;
    let signature: [u8; 64] = fail(fail(hex::decode(signature))?.try_into())?;
    let key = fail(VerifyingKey::from_bytes(&public))?;
    require(!key.is_weak())?;
    fail(key.verify_strict(bytes, &Signature::from_bytes(&signature)))
}
pub fn verify_commit(group: &str, server: &str, upload: &CommitUpload) -> Result<(), String> {
    require(
        valid_id(group)
            && valid_id(&upload.operation_id)
            && valid_id(&upload.device_key)
            && !upload.members.is_empty()
            && upload.members.len() <= MAX_MEMBERS
            && upload.welcomes.len() <= MAX_MEMBERS
            && upload.expected_epoch < 9_007_199_254_740_991,
    )?;
    let mut keys = std::collections::HashSet::new();
    for peer in &upload.members {
        verify_member(peer, server)?;
        require(keys.insert(&peer.enrollment.device_key))?;
    }
    require(keys.contains(&upload.device_key))?;
    for welcome in &upload.welcomes {
        require(keys.contains(&welcome.device_key) && valid_id(&welcome.package_hash))?;
        let message = fail(MlsMessageIn::tls_deserialize_exact(decode(
            &welcome.ciphertext,
        )?))?;
        require(matches!(message.extract(), MlsMessageBodyIn::Welcome(_)))?;
    }
    check_message_header(&upload.commit, group, upload.expected_epoch, true)?;
    verify_signature(
        &upload.device_key,
        &upload.signature,
        &signed_commit(group, server, upload)?,
    )
}
pub fn verify_message(group: &str, server: &str, upload: &MessageUpload) -> Result<(), String> {
    require(
        valid_id(group)
            && valid_id(&upload.operation_id)
            && valid_id(&upload.device_key)
            && upload.epoch <= 9_007_199_254_740_991
            && upload.target_id.as_ref().is_none_or(|id| valid_id(id))
            && matches!(upload.action, MessageAction::Edit | MessageAction::Delete)
                == upload.target_id.is_some(),
    )?;
    check_message_header(&upload.ciphertext, group, upload.epoch, false)?;
    verify_signature(
        &upload.device_key,
        &upload.signature,
        &signed_message(group, server, upload)?,
    )
}
fn gateway_statement(token: &str, challenge: &str, server: &str) -> Result<Vec<u8>, String> {
    require(valid_id(token) && valid_id(challenge) && valid_id(server))?;
    let mut statement = b"hearth/v1/gateway-identify".to_vec();
    statement.extend_from_slice(&Sha256::digest(token.as_bytes()));
    statement.extend_from_slice(&decode(challenge)?);
    statement.extend_from_slice(&decode(server)?);
    Ok(statement)
}
pub fn verify_gateway(
    device: &str,
    signature: &str,
    token: &str,
    challenge: &str,
    server: &str,
) -> Result<(), String> {
    verify_signature(
        device,
        signature,
        &gateway_statement(token, challenge, server)?,
    )
}

impl Messaging {
    pub fn gateway_proof(&self, token: &str, challenge: &str) -> Result<String, String> {
        Ok(hex::encode(self.device.sign_scoped(&gateway_statement(
            token,
            challenge,
            &self.server,
        )?)))
    }
    pub fn new(identity: &LocalIdentity, account: &str, server: &str) -> Result<Self, String> {
        let proof = identity.enrollment(account, server)?;
        let own = GroupMember {
            account_id: account.into(),
            enrollment: fail(serde_json::from_value(fail(serde_json::to_value(proof))?))?,
        };
        verify_member(&own, server)?;
        let provider = OpenMlsRustCrypto::default();
        let secret = Zeroizing::new(identity.device.to_bytes());
        let signer = SignatureKeyPair::from_raw(
            SUITE.signature_algorithm(),
            secret.to_vec(),
            decode(&own.enrollment.device_key)?,
        );
        fail(signer.store(provider.storage()))?;
        Ok(Self {
            provider,
            signer,
            device: IdentityKey::from_bytes(&secret),
            key: Zeroizing::new(*identity.store_key),
            own,
            server: server.into(),
            groups: HashMap::new(),
            state: ClientState::default(),
        })
    }
    fn scope(&self) -> Result<Vec<u8>, String> {
        let mut aad = b"hearth/v1/mls-state".to_vec();
        aad.push(1);
        for id in [
            &self.own.account_id,
            &self.server,
            &self.own.enrollment.device_key,
        ] {
            aad.extend_from_slice(&decode(id)?);
        }
        Ok(aad)
    }
    fn snapshot(&self) -> Result<Snapshot, String> {
        Ok(Snapshot {
            version: 1,
            values: fail(self.provider.storage().values.read())?
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            state: self.state.clone(),
        })
    }
    fn restore(&mut self, snapshot: Snapshot) -> Result<(), String> {
        require(snapshot.version == 1)?;
        *fail(self.provider.storage().values.write())? = snapshot.values.into_iter().collect();
        let mut groups = HashMap::new();
        for id in &snapshot.state.groups {
            let group = fail(MlsGroup::load(
                self.provider.storage(),
                &GroupId::from_slice(&decode(id)?),
            ))?
            .ok_or(ERROR)?;
            require(hex::encode(group.group_id().as_slice()) == *id)?;
            groups.insert(id.clone(), group);
        }
        self.groups = groups;
        self.state = snapshot.state;
        Ok(())
    }
    fn transaction<T>(
        &mut self,
        action: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        let before = self.snapshot()?;
        let result = action(self);
        if result.is_err() {
            self.restore(before)?;
        }
        result
    }
    pub fn seal(&self) -> Result<String, String> {
        let plaintext = Zeroizing::new(fail(serde_json::to_vec(&self.snapshot()?))?);
        require(plaintext.len() <= MAX_STATE)?;
        let mut nonce = [0; 24];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = fail(
            fail(XChaCha20Poly1305::new_from_slice(self.key.as_ref()))?.encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: &self.scope()?,
                },
            ),
        )?;
        let mut bytes = vec![1];
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&ciphertext);
        Ok(hex::encode(bytes))
    }
    pub fn open(
        identity: &LocalIdentity,
        account: &str,
        server: &str,
        envelope: &str,
    ) -> Result<Self, String> {
        require(envelope.len() >= 82 && envelope.len() <= (MAX_STATE + 41) * 2)?;
        let bytes = fail(hex::decode(envelope))?;
        require(bytes[0] == 1)?;
        let mut engine = Self::new(identity, account, server)?;
        let plaintext = Zeroizing::new(fail(
            fail(XChaCha20Poly1305::new_from_slice(engine.key.as_ref()))?.decrypt(
                XNonce::from_slice(&bytes[1..25]),
                Payload {
                    msg: &bytes[25..],
                    aad: &engine.scope()?,
                },
            ),
        )?);
        engine.restore(fail(serde_json::from_slice(&plaintext))?)?;
        Ok(engine)
    }
    fn credential(&self) -> Result<CredentialWithKey, String> {
        Ok(CredentialWithKey {
            credential: BasicCredential::new(fail(serde_json::to_vec(&self.own))?).into(),
            signature_key: self.signer.public().into(),
        })
    }
    fn pin(&mut self, peer: &GroupMember) -> Result<(), String> {
        verify_member(peer, &self.server)?;
        let expected = if peer.account_id == self.own.account_id {
            Some(&self.own.enrollment.identity_key)
        } else {
            self.state.pins.get(&peer.account_id)
        };
        require(expected.is_none_or(|key| *key == peer.enrollment.identity_key))?;
        self.state.pins.insert(
            peer.account_id.clone(),
            peer.enrollment.identity_key.clone(),
        );
        Ok(())
    }
    fn roster(&mut self, id: &str) -> Result<Vec<GroupMember>, String> {
        let group = self.groups.get(id).ok_or(ERROR)?;
        let mut peers = group
            .members()
            .map(|leaf| member(&leaf.credential, &leaf.signature_key, &self.server))
            .collect::<Result<Vec<_>, _>>()?;
        require(!peers.is_empty() && peers.len() <= MAX_MEMBERS)?;
        peers.sort_by(|a, b| a.enrollment.device_key.cmp(&b.enrollment.device_key));
        for pair in peers.windows(2) {
            require(pair[0].enrollment.device_key != pair[1].enrollment.device_key)?;
        }
        for peer in &peers {
            self.pin(peer)?;
        }
        Ok(peers)
    }
    fn match_roster(&mut self, id: &str, expected: &[GroupMember]) -> Result<(), String> {
        let mut expected = expected.to_vec();
        expected.sort_by(|a, b| a.enrollment.device_key.cmp(&b.enrollment.device_key));
        require(self.roster(id)? == expected)
    }
    pub fn key_package(&mut self) -> Result<KeyPackageRecord, String> {
        self.transaction(|this| {
            require(this.state.pending_packages.len() < 4)?;
            let package = fail(KeyPackage::builder().build(
                SUITE,
                &this.provider,
                &this.signer,
                this.credential()?,
            ))?;
            let bytes = fail(package.key_package().tls_serialize_detached())?;
            let record = KeyPackageRecord {
                member: this.own.clone(),
                package: hex::encode(&bytes),
                package_hash: hex::encode(Sha256::digest(bytes)),
            };
            this.state.pending_packages.push(record.clone());
            Ok(record)
        })
    }
    pub fn verify_peers(&mut self, peers: &[GroupMember]) -> Result<(), String> {
        self.transaction(|this| {
            require(peers.len() <= 160)?;
            for peer in peers {
                this.pin(peer)?;
            }
            Ok(())
        })
    }
    /// Queue a creation/addition. Persist the snapshot before submitting this envelope.
    pub fn add(
        &mut self,
        id: &str,
        packages: &[KeyPackageRecord],
        create: bool,
    ) -> Result<CommitUpload, String> {
        self.transaction(|this| {
            require(
                valid_id(id)
                    && !packages.is_empty()
                    && packages.len() < MAX_MEMBERS
                    && !this
                        .state
                        .pending
                        .iter()
                        .any(|pending| pending.conversation() == id),
            )?;
            if !create {
                let accounts = this
                    .roster(id)?
                    .iter()
                    .map(|peer| peer.account_id.clone())
                    .collect::<std::collections::HashSet<_>>();
                require(
                    packages
                        .iter()
                        .all(|package| accounts.contains(&package.member.account_id)),
                )?;
            }
            let mut verified = Vec::new();
            for package in packages {
                this.pin(&package.member)?;
                verified.push(checked_package(package, &this.server)?);
            }
            if create {
                require(!this.groups.contains_key(id))?;
                let config = MlsGroupCreateConfig::builder()
                    .ciphersuite(SUITE)
                    .max_past_epochs(1)
                    .use_ratchet_tree_extension(true)
                    .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
                    .build();
                let group = fail(MlsGroup::new_with_group_id(
                    &this.provider,
                    &this.signer,
                    &config,
                    GroupId::from_slice(&decode(id)?),
                    this.credential()?,
                ))?;
                this.groups.insert(id.into(), group);
                this.state.groups.push(id.into());
            }
            let mut members = this.roster(id)?;
            members.extend(packages.iter().map(|package| package.member.clone()));
            members.sort_by(|a, b| a.enrollment.device_key.cmp(&b.enrollment.device_key));
            require(
                members.len() <= MAX_MEMBERS
                    && members
                        .windows(2)
                        .all(|w| w[0].enrollment.device_key != w[1].enrollment.device_key),
            )?;
            let group = this.groups.get_mut(id).ok_or(ERROR)?;
            let mut upload = CommitUpload {
                operation_id: random_id(),
                device_key: this.own.enrollment.device_key.clone(),
                expected_epoch: group.epoch().as_u64(),
                members,
                commit: String::new(),
                welcomes: vec![],
                signature: String::new(),
            };
            group.set_aad(commit_aad(id, &upload)?);
            let (commit, welcome, _) =
                fail(group.add_members(&this.provider, &this.signer, &verified))?;
            upload.commit = hex::encode(fail(commit.tls_serialize_detached())?);
            let ciphertext = hex::encode(fail(welcome.tls_serialize_detached())?);
            upload.welcomes = packages
                .iter()
                .map(|package| WelcomeEnvelope {
                    device_key: package.member.enrollment.device_key.clone(),
                    package_hash: package.package_hash.clone(),
                    ciphertext: ciphertext.clone(),
                })
                .collect();
            upload.signature = hex::encode(this.device.sign_scoped(&signed_commit(
                id,
                &this.server,
                &upload,
            )?));
            verify_commit(id, &this.server, &upload)?;
            this.state.pending.push(PendingOperation::Commit {
                conversation_id: id.into(),
                upload: upload.clone(),
            });
            Ok(upload)
        })
    }
    pub fn accept(&mut self, operation: &str) -> Result<(), String> {
        self.transaction(|this| {
            if let Some(index) = this
                .state
                .pending_packages
                .iter()
                .position(|package| package.package_hash == operation)
            {
                this.state.pending_packages.remove(index);
                return Ok(());
            }
            let Some(index) = this.state.pending.iter().position(|p| p.id() == operation) else {
                return require(this.state.own_operations.contains_key(operation));
            };
            let pending = this.state.pending[index].clone();
            if let PendingOperation::Commit {
                conversation_id,
                upload,
            } = &pending
            {
                let group = this.groups.get_mut(conversation_id).ok_or(ERROR)?;
                fail(group.merge_pending_commit(&this.provider))?;
                require(group.epoch().as_u64() == upload.expected_epoch + 1)?;
                this.match_roster(conversation_id, &upload.members)?;
            } else {
                let content = this.state.pending_contents.remove(operation).ok_or(ERROR)?;
                this.apply(
                    pending.conversation(),
                    operation,
                    &this.own.account_id.clone(),
                    content,
                )?;
            }
            this.state
                .own_operations
                .insert(operation.into(), pending.conversation().into());
            this.state.pending.remove(index);
            this.state.pending_contents.remove(operation);
            Ok(())
        })
    }
    /// Only after a definite rejection, never after a timeout with unknown server outcome.
    pub fn reject(&mut self, operation: &str) -> Result<(), String> {
        self.transaction(|this| {
            let index = this
                .state
                .pending
                .iter()
                .position(|p| p.id() == operation)
                .ok_or(ERROR)?;
            if let PendingOperation::Commit {
                conversation_id,
                upload,
            } = &this.state.pending[index]
            {
                fail(
                    this.groups
                        .get_mut(conversation_id)
                        .ok_or(ERROR)?
                        .clear_pending_commit(this.provider.storage()),
                )?;
                if upload.expected_epoch == 0 {
                    let id = conversation_id.clone();
                    fail(
                        this.groups
                            .get_mut(&id)
                            .ok_or(ERROR)?
                            .delete(this.provider.storage()),
                    )?;
                    this.groups.remove(&id);
                    this.state.groups.retain(|group| group != &id);
                }
            }
            this.state.pending.remove(index);
            this.state.pending_contents.remove(operation);
            Ok(())
        })
    }
    pub fn send(&mut self, id: &str, content: MessageContent) -> Result<MessageUpload, String> {
        self.transaction(|this| {
            require(!this.state.pending.iter().any(|p| p.conversation() == id))?;
            validate_content(&content)?;
            let (action, target_id) = content_metadata(&content);
            let group = this.groups.get_mut(id).ok_or(ERROR)?;
            let mut upload = MessageUpload {
                operation_id: random_id(),
                device_key: this.own.enrollment.device_key.clone(),
                epoch: group.epoch().as_u64(),
                action,
                target_id,
                ciphertext: String::new(),
                signature: String::new(),
            };
            group.set_aad(message_aad(id, &upload)?);
            let plaintext = Zeroizing::new(fail(serde_json::to_vec(&content))?);
            upload.ciphertext = hex::encode(fail(
                fail(group.create_message(&this.provider, &this.signer, &plaintext))?
                    .tls_serialize_detached(),
            )?);
            upload.signature = hex::encode(this.device.sign_scoped(&signed_message(
                id,
                &this.server,
                &upload,
            )?));
            this.state
                .pending_contents
                .insert(upload.operation_id.clone(), content);
            this.state.pending.push(PendingOperation::Message {
                conversation_id: id.into(),
                upload: upload.clone(),
            });
            Ok(upload)
        })
    }
    fn apply(
        &mut self,
        group: &str,
        operation: &str,
        author: &str,
        content: MessageContent,
    ) -> Result<(), String> {
        match content {
            MessageContent::Text { text, reply_to } => {
                require(!self.state.messages.iter().any(|m| m.id == operation))?;
                self.state.messages.push(LocalMessage {
                    id: operation.into(),
                    conversation_id: group.into(),
                    author_id: author.into(),
                    text,
                    reply_to,
                    edited: false,
                    deleted: false,
                });
            }
            MessageContent::Edit { id, text } => {
                // Missing history is normal after linking; do not stall delivery on it.
                if let Some(message) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id && m.conversation_id == group)
                {
                    require(message.author_id == author && !message.deleted)?;
                    message.text = text;
                    message.edited = true;
                }
            }
            MessageContent::Delete { id } => {
                if let Some(message) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id && m.conversation_id == group)
                {
                    require(message.author_id == author)?;
                    message.text.clear();
                    message.deleted = true;
                }
            }
            MessageContent::Typing { .. } => {}
        }
        Ok(())
    }
    pub fn receive(&mut self, event: &DeliveryEvent) -> Result<Option<(String, bool)>, String> {
        self.transaction(|this| {
            require(event.seq == this.state.last_seq + 1 && valid_id(&event.conversation_id))?;
            let id = &event.conversation_id;
            let mut typing = None;
            match &event.data {
                DeliveryData::Welcome { upload, welcome } => {
                    verify_commit(id, &this.server, upload)?;
                    require(
                        !this.groups.contains_key(id)
                            && welcome.device_key == this.own.enrollment.device_key
                            && upload.welcomes.iter().any(|w| {
                                w.device_key == welcome.device_key
                                    && w.package_hash == welcome.package_hash
                                    && w.ciphertext == welcome.ciphertext
                            }),
                    )?;
                    for peer in &upload.members {
                        this.pin(peer)?;
                    }
                    let consumed_package = welcome.package_hash.clone();
                    let wire = fail(MlsMessageIn::tls_deserialize_exact(decode(
                        &welcome.ciphertext,
                    )?))?;
                    let MlsMessageBodyIn::Welcome(welcome) = wire.extract() else {
                        return Err(ERROR.into());
                    };
                    let config = MlsGroupJoinConfig::builder()
                        .max_past_epochs(1)
                        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
                        .use_ratchet_tree_extension(true)
                        .build();
                    let group = fail(
                        fail(
                            fail(ProcessedWelcome::new_from_welcome(
                                &this.provider,
                                &config,
                                welcome,
                            ))?
                            .into_staged_welcome(&this.provider, None),
                        )?
                        .into_group(&this.provider),
                    )?;
                    require(
                        hex::encode(group.group_id().as_slice()) == *id
                            && group.epoch().as_u64() == upload.expected_epoch + 1,
                    )?;
                    this.groups.insert(id.clone(), group);
                    this.state.groups.push(id.clone());
                    this.match_roster(id, &upload.members)?;
                    this.state
                        .pending_packages
                        .retain(|package| package.package_hash != consumed_package);
                }
                DeliveryData::Commit { upload } => {
                    verify_commit(id, &this.server, upload)?;
                    if upload.device_key == this.own.enrollment.device_key {
                        require(
                            this.state
                                .pending
                                .iter()
                                .any(|p| p.id() == upload.operation_id)
                                || this.state.own_operations.get(&upload.operation_id) == Some(id),
                        )?;
                        if this
                            .state
                            .pending
                            .iter()
                            .any(|p| p.id() == upload.operation_id)
                        {
                            this.accept(&upload.operation_id)?;
                        }
                    } else {
                        let peers = this.roster(id)?;
                        require(
                            peers
                                .iter()
                                .any(|p| p.enrollment.device_key == upload.device_key),
                        )?;
                        let group = this.groups.get_mut(id).ok_or(ERROR)?;
                        require(
                            group.epoch().as_u64() == upload.expected_epoch
                                && group.pending_commit().is_none(),
                        )?;
                        let processed =
                            fail(group.process_message(&this.provider, protocol(&upload.commit)?))?;
                        require(
                            processed.aad() == commit_aad(id, upload)?
                                && peer_device(processed.credential())? == upload.device_key,
                        )?;
                        let ProcessedMessageContent::StagedCommitMessage(commit) =
                            processed.into_content()
                        else {
                            return Err(ERROR.into());
                        };
                        fail(group.merge_staged_commit(&this.provider, *commit))?;
                        require(group.epoch().as_u64() == upload.expected_epoch + 1)?;
                        this.match_roster(id, &upload.members)?;
                    }
                }
                DeliveryData::Message { upload } => {
                    verify_message(id, &this.server, upload)?;
                    if upload.device_key == this.own.enrollment.device_key {
                        require(
                            this.state
                                .pending
                                .iter()
                                .any(|p| p.id() == upload.operation_id)
                                || this.state.own_operations.get(&upload.operation_id) == Some(id),
                        )?;
                        if this
                            .state
                            .pending
                            .iter()
                            .any(|p| p.id() == upload.operation_id)
                        {
                            this.accept(&upload.operation_id)?;
                        }
                    } else {
                        let peers = this.roster(id)?;
                        let peer = peers
                            .iter()
                            .find(|p| p.enrollment.device_key == upload.device_key)
                            .ok_or(ERROR)?;
                        let group = this.groups.get_mut(id).ok_or(ERROR)?;
                        let processed = fail(
                            group.process_message(&this.provider, protocol(&upload.ciphertext)?),
                        )?;
                        require(
                            processed.aad() == message_aad(id, upload)?
                                && peer_device(processed.credential())? == upload.device_key,
                        )?;
                        let ProcessedMessageContent::ApplicationMessage(message) =
                            processed.into_content()
                        else {
                            return Err(ERROR.into());
                        };
                        let plaintext = Zeroizing::new(message.into_bytes());
                        let content: MessageContent = fail(serde_json::from_slice(&plaintext))?;
                        validate_content(&content)?;
                        require(
                            content_metadata(&content) == (upload.action, upload.target_id.clone()),
                        )?;
                        if let MessageContent::Typing { active } = &content {
                            typing = Some((peer.account_id.clone(), *active));
                        }
                        this.apply(id, &upload.operation_id, &peer.account_id, content)?;
                    }
                }
                DeliveryData::Redacted => {}
            }
            this.state.last_seq = event.seq;
            Ok(typing)
        })
    }
    pub fn view(&mut self) -> Result<MessagingView, String> {
        let mut groups = Vec::new();
        for id in self.state.groups.clone() {
            let members = self.roster(&id)?;
            let mut accounts = members
                .iter()
                .map(|m| m.account_id.clone())
                .collect::<Vec<_>>();
            accounts.sort();
            accounts.dedup();
            groups.push(Conversation {
                id: id.clone(),
                accounts,
                epoch: self.groups[&id].epoch().as_u64(),
                members,
            });
        }
        Ok(MessagingView {
            last_seq: self.state.last_seq,
            messages: self.state.messages.clone(),
            pending: self.state.pending.clone(),
            pending_packages: self.state.pending_packages.clone(),
            groups,
        })
    }
}
fn peer_device(credential: &Credential) -> Result<String, String> {
    let member: GroupMember = fail(serde_json::from_slice(credential.serialized_content()))?;
    Ok(member.enrollment.device_key)
}
fn content_metadata(content: &MessageContent) -> (MessageAction, Option<String>) {
    match content {
        MessageContent::Text { .. } => (MessageAction::Send, None),
        MessageContent::Edit { id, .. } => (MessageAction::Edit, Some(id.clone())),
        MessageContent::Delete { id } => (MessageAction::Delete, Some(id.clone())),
        MessageContent::Typing { .. } => (MessageAction::Typing, None),
    }
}
fn validate_content(content: &MessageContent) -> Result<(), String> {
    match content {
        MessageContent::Text { text, reply_to } => require(
            !text.trim().is_empty()
                && text.len() <= 16_000
                && reply_to.as_ref().is_none_or(|id| valid_id(id)),
        ),
        MessageContent::Edit { id, text } => {
            require(valid_id(id) && !text.trim().is_empty() && text.len() <= 16_000)
        }
        MessageContent::Delete { id } => require(valid_id(id)),
        MessageContent::Typing { .. } => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(seq: u64, id: &str, data: DeliveryData) -> DeliveryEvent {
        DeliveryEvent {
            seq,
            conversation_id: id.into(),
            data,
        }
    }
    #[test]
    fn pending_creation_rejection_and_inflight_previous_epoch_are_recoverable() {
        let alice_identity = LocalIdentity::new();
        let bob_identity = LocalIdentity::new();
        let alice_id = random_id();
        let bob_id = random_id();
        let server = random_id();
        let id = random_id();
        let mut alice = Messaging::new(&alice_identity, &alice_id, &server).unwrap();
        let mut bob = Messaging::new(&bob_identity, &bob_id, &server).unwrap();
        let rejected = alice
            .add(&random_id(), &[bob.key_package().unwrap()], true)
            .unwrap();
        alice.reject(&rejected.operation_id).unwrap();
        assert!(alice.view().unwrap().groups.is_empty());
        let commit = alice.add(&id, &[bob.key_package().unwrap()], true).unwrap();
        alice.accept(&commit.operation_id).unwrap();
        bob.receive(&event(
            1,
            &id,
            DeliveryData::Welcome {
                welcome: commit.welcomes[0].clone(),
                upload: commit,
            },
        ))
        .unwrap();
        let inflight = bob
            .send(
                &id,
                MessageContent::Text {
                    text: "sent just before rekey".into(),
                    reply_to: None,
                },
            )
            .unwrap();
        bob.accept(&inflight.operation_id).unwrap();
        let linked_identity = LocalIdentity::restore_kit(
            &alice_identity
                .recovery_kit("passphrase long enough", &alice_id, &server)
                .unwrap(),
            "passphrase long enough",
            &alice_id,
            &server,
        )
        .unwrap();
        let mut linked = Messaging::new(&linked_identity, &alice_id, &server).unwrap();
        let addition = alice
            .add(&id, &[linked.key_package().unwrap()], false)
            .unwrap();
        alice.accept(&addition.operation_id).unwrap();
        alice =
            Messaging::open(&alice_identity, &alice_id, &server, &alice.seal().unwrap()).unwrap();
        alice
            .receive(&event(1, &id, DeliveryData::Message { upload: inflight }))
            .unwrap();
        assert_eq!(
            alice.view().unwrap().messages[0].text,
            "sent just before rekey"
        );
    }
    #[test]
    fn gateway_proof_is_bound_to_nonce_token_device_and_server() {
        let identity = LocalIdentity::new();
        let account = random_id();
        let server = random_id();
        let engine = Messaging::new(&identity, &account, &server).unwrap();
        let token = random_id();
        let challenge = random_id();
        let proof = engine.gateway_proof(&token, &challenge).unwrap();
        let device = identity.enrollment(&account, &server).unwrap().device_key;
        assert!(verify_gateway(&device, &proof, &token, &challenge, &server).is_ok());
        assert!(verify_gateway(&device, &proof, &token, &random_id(), &server).is_err());
        assert!(verify_gateway(&device, &proof, &random_id(), &challenge, &server).is_err());
        assert!(verify_gateway(&device, &proof, &token, &challenge, &random_id()).is_err());
        assert!(verify_gateway(&random_id(), &proof, &token, &challenge, &server).is_err());
    }
    #[test]
    fn durable_device_bound_groups_reject_adversaries_without_losing_ratchets() {
        let alice_identity = LocalIdentity::new();
        let bob_identity = LocalIdentity::new();
        let alice_id = "a1".repeat(32);
        let bob_id = "b2".repeat(32);
        let server = "cc".repeat(32);
        let id = random_id();
        let mut alice = Messaging::new(&alice_identity, &alice_id, &server).unwrap();
        let mut bob = Messaging::new(&bob_identity, &bob_id, &server).unwrap();
        let package = bob.key_package().unwrap();
        verify_package(&package, &server).unwrap();
        let mut swapped = package.clone();
        swapped.member.account_id = alice_id.clone();
        assert!(verify_package(&swapped, &server).is_err());
        bob = Messaging::open(&bob_identity, &bob_id, &server, &bob.seal().unwrap()).unwrap();
        let commit = alice.add(&id, &[package], true).unwrap();
        assert_eq!(alice.view().unwrap().groups[0].epoch, 0);
        alice =
            Messaging::open(&alice_identity, &alice_id, &server, &alice.seal().unwrap()).unwrap();
        assert_eq!(alice.view().unwrap().pending[0].id(), commit.operation_id);
        alice.accept(&commit.operation_id).unwrap();
        alice.accept(&commit.operation_id).unwrap();
        bob.receive(&event(
            1,
            &id,
            DeliveryData::Welcome {
                welcome: commit.welcomes[0].clone(),
                upload: commit,
            },
        ))
        .unwrap();
        let canary = "HEARTH_PRIVATE_DURABLE_MLS_CANARY";
        let message = alice
            .send(
                &id,
                MessageContent::Text {
                    text: canary.into(),
                    reply_to: None,
                },
            )
            .unwrap();
        assert!(
            !hex::decode(&message.ciphertext)
                .unwrap()
                .windows(canary.len())
                .any(|w| w == canary.as_bytes())
        );
        let disk = alice.seal().unwrap();
        assert!(
            !hex::decode(&disk)
                .unwrap()
                .windows(canary.len())
                .any(|w| w == canary.as_bytes())
        );
        assert!(Messaging::open(&LocalIdentity::new(), &alice_id, &server, &disk).is_err());
        assert!(Messaging::open(&alice_identity, &bob_id, &server, &disk).is_err());
        alice = Messaging::open(&alice_identity, &alice_id, &server, &disk).unwrap();
        let retry = alice.view().unwrap().pending[0].clone();
        let PendingOperation::Message { upload: retry, .. } = retry else {
            panic!("message")
        };
        assert_eq!(retry.ciphertext, message.ciphertext);
        alice.accept(&message.operation_id).unwrap();
        bob.receive(&event(
            2,
            &id,
            DeliveryData::Message {
                upload: message.clone(),
            },
        ))
        .unwrap();
        assert_eq!(bob.view().unwrap().messages[0].text, canary);
        assert!(
            bob.receive(&event(3, &id, DeliveryData::Message { upload: message }))
                .is_err()
        );
        assert_eq!(bob.view().unwrap().last_seq, 2);
        bob = Messaging::open(&bob_identity, &bob_id, &server, &bob.seal().unwrap()).unwrap();
        let reply = bob
            .send(
                &id,
                MessageContent::Text {
                    text: "reply".into(),
                    reply_to: Some(alice.view().unwrap().messages[0].id.clone()),
                },
            )
            .unwrap();
        bob.accept(&reply.operation_id).unwrap();
        let mut malicious = reply.clone();
        let mut bytes = hex::decode(&malicious.ciphertext).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        malicious.ciphertext = hex::encode(bytes);
        malicious.signature = hex::encode(
            bob.device
                .sign_scoped(&signed_message(&id, &server, &malicious).unwrap()),
        );
        assert!(
            alice
                .receive(&event(1, &id, DeliveryData::Message { upload: malicious }))
                .is_err()
        );
        alice
            .receive(&event(1, &id, DeliveryData::Message { upload: reply }))
            .unwrap();
        assert_eq!(alice.view().unwrap().messages[1].text, "reply");
        // A fresh linked device joins at the new epoch; no history or old group keys transfer.
        let kit = bob_identity
            .recovery_kit("passphrase for test recovery", &bob_id, &server)
            .unwrap();
        let linked_identity =
            LocalIdentity::restore_kit(&kit, "passphrase for test recovery", &bob_id, &server)
                .unwrap();
        let mut linked = Messaging::new(&linked_identity, &bob_id, &server).unwrap();
        let addition = alice
            .add(&id, &[linked.key_package().unwrap()], false)
            .unwrap();
        let mut wrong_manifest = addition.clone();
        wrong_manifest
            .members
            .retain(|peer| peer.enrollment.device_key != bob.own.enrollment.device_key);
        wrong_manifest.signature = hex::encode(
            alice
                .device
                .sign_scoped(&signed_commit(&id, &server, &wrong_manifest).unwrap()),
        );
        assert!(
            bob.receive(&event(
                3,
                &id,
                DeliveryData::Commit {
                    upload: wrong_manifest
                }
            ))
            .is_err()
        );
        bob.receive(&event(
            3,
            &id,
            DeliveryData::Commit {
                upload: addition.clone(),
            },
        ))
        .unwrap();
        linked
            .receive(&event(
                1,
                &id,
                DeliveryData::Welcome {
                    welcome: addition.welcomes[0].clone(),
                    upload: addition.clone(),
                },
            ))
            .unwrap();
        alice.accept(&addition.operation_id).unwrap();
        assert!(linked.view().unwrap().messages.is_empty());
        let next = alice
            .send(
                &id,
                MessageContent::Text {
                    text: "after device linking".into(),
                    reply_to: None,
                },
            )
            .unwrap();
        alice.accept(&next.operation_id).unwrap();
        linked
            .receive(&event(
                2,
                &id,
                DeliveryData::Message {
                    upload: next.clone(),
                },
            ))
            .unwrap();
        bob.receive(&event(4, &id, DeliveryData::Message { upload: next }))
            .unwrap();
        assert_eq!(
            linked.view().unwrap().messages[0].text,
            "after device linking"
        );
        let original = alice.view().unwrap().messages[0].id.clone();
        let edit = alice
            .send(
                &id,
                MessageContent::Edit {
                    id: original.clone(),
                    text: "edited".into(),
                },
            )
            .unwrap();
        alice.accept(&edit.operation_id).unwrap();
        bob.receive(&event(
            5,
            &id,
            DeliveryData::Message {
                upload: edit.clone(),
            },
        ))
        .unwrap();
        linked
            .receive(&event(3, &id, DeliveryData::Message { upload: edit }))
            .unwrap();
        assert_eq!(bob.view().unwrap().messages[0].text, "edited");
        let delete = alice
            .send(&id, MessageContent::Delete { id: original })
            .unwrap();
        alice.accept(&delete.operation_id).unwrap();
        bob.receive(&event(6, &id, DeliveryData::Message { upload: delete }))
            .unwrap();
        assert!(bob.view().unwrap().messages[0].deleted);
    }
}
