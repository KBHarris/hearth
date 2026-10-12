//! Device-bound MLS and an authenticated, encrypted transaction snapshot.
//! Hosts must CAS-save `seal()` before sending any queued operation or acknowledging receive.
use crate::{IdentityKey, identity::Enrollment, vault::LocalIdentity};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use ed25519_dalek::{Signature, VerifyingKey};
use hearth_proto::community::*;
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

#[path = "messaging_attachments.rs"]
mod attachments;
#[path = "messaging_history.rs"]
mod history;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const ERROR: &str =
    "Encrypted messaging state or device verification failed; preserve the local store.";
const MAX_STATE: usize = 8 * 1024 * 1024;
const MAX_WIRE: usize = 256 * 1024;
const MAX_MEMBERS: usize = 128;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingOperation {
    Commit {
        conversation_id: String,
        upload: Box<CommitUpload>,
    },
    Message {
        conversation_id: String,
        upload: Box<MessageUpload>,
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
    #[serde(default)]
    community_owners: BTreeMap<String, (String, String)>,
    #[serde(default)]
    channels: BTreeMap<String, ChannelAuthorization>,
    #[serde(default)]
    governance: BTreeMap<String, hearth_proto::governance::Governance>,
    #[serde(default)]
    epoch_authorizations: BTreeMap<String, BTreeMap<u64, ChannelAuthorization>>,
    #[serde(default)]
    epoch_rosters: BTreeMap<String, BTreeMap<u64, Vec<GroupMember>>>,
    #[serde(default)]
    profiles: BTreeMap<String, LocalProfile>,
    #[serde(default)]
    presence: BTreeMap<String, LocalPresence>,
    #[serde(default)]
    read: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    history_keys: BTreeMap<String, BTreeMap<u64, String>>,
    #[serde(default)]
    history_requests: BTreeMap<String, Vec<history::Request>>,
    #[serde(default)]
    history_secrets: BTreeMap<String, (String, String)>,
    #[serde(default)]
    history_seen: std::collections::BTreeSet<String>,
    #[serde(default)]
    history_live: std::collections::BTreeSet<String>,
    #[serde(default)]
    joined_invites: BTreeMap<String, CommunityInvitation>,
    #[serde(default)]
    history_backfill: std::collections::BTreeSet<String>,
    #[serde(default)]
    files: BTreeMap<String, BTreeMap<String, EncryptedAttachment>>,
    #[serde(default)]
    emoji: BTreeMap<String, BTreeMap<String, LocalAttachment>>,
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
    pub governance_epochs: BTreeMap<String, u64>,
    pub messages: Vec<LocalMessage>,
    pub pending: Vec<PendingOperation>,
    pub pending_packages: Vec<KeyPackageRecord>,
    pub groups: Vec<Conversation>,
    pub profiles: BTreeMap<String, LocalProfile>,
    pub presence: BTreeMap<String, LocalPresence>,
    pub read: BTreeMap<String, BTreeMap<String, String>>,
    pub history_backfill: Vec<String>,
    pub history_waiting: Vec<String>,
    pub emoji: BTreeMap<String, BTreeMap<String, LocalAttachment>>,
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
fn channel_action_allowed(
    auth: &ChannelAuthorization,
    account: &str,
    action: MessageAction,
) -> bool {
    if account == auth.authority.owner.account_id {
        return true;
    }
    let required = match action {
        MessageAction::Pin => hearth_proto::governance::PIN,
        MessageAction::Reaction => hearth_proto::governance::REACT,
        MessageAction::Control => hearth_proto::governance::READ,
        _ => hearth_proto::governance::SEND,
    };
    if hearth_proto::governance::permissions(
        auth.governance.as_ref(),
        &auth.authority.owner.account_id,
        account,
        Some(&auth.policy.channel_id),
        u64::MAX,
    ) & required
        == 0
    {
        return false;
    }
    auth.policy.kind != ChannelKind::Announcement
        || matches!(
            action,
            MessageAction::Reaction | MessageAction::Control | MessageAction::Pin
        )
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
    if let Some(auth) = &upload.authorization {
        return fail(serde_json::to_vec(&(
            "hearth/v1/mls-channel-commit",
            group,
            &upload.operation_id,
            upload.expected_epoch,
            &upload.members,
            auth,
        )));
    }
    fail(serde_json::to_vec(&(
        "hearth/v1/mls-commit",
        group,
        &upload.operation_id,
        upload.expected_epoch,
        &upload.members,
    )))
}
fn message_aad(group: &str, upload: &MessageUpload) -> Result<Vec<u8>, String> {
    if let Some(archive) = &upload.archive {
        return fail(serde_json::to_vec(&(
            "hearth/v1/mls-archived-message",
            group,
            &upload.operation_id,
            upload.epoch,
            upload.action,
            &upload.target_id,
            hex::encode(Sha256::digest(fail(serde_json::to_vec(archive))?)),
        )));
    }
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
pub(crate) fn verify_signature(key: &str, signature: &str, bytes: &[u8]) -> Result<(), String> {
    let public: [u8; 32] = fail(fail(hex::decode(key))?.try_into())?;
    let signature: [u8; 64] = fail(fail(hex::decode(signature))?.try_into())?;
    let key = fail(VerifyingKey::from_bytes(&public))?;
    require(!key.is_weak())?;
    fail(key.verify_strict(bytes, &Signature::from_bytes(&signature)))
}
pub fn verify_commit(group: &str, server: &str, upload: &CommitUpload) -> Result<(), String> {
    if let Some(auth) = &upload.authorization {
        crate::community::verify_authorization(server, group, auth, &upload.members)?;
    }
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
    if let Some(archive) = &upload.archive {
        verify_member(&archive.member, server)?;
        require(
            archive.member.enrollment.device_key == upload.device_key
                && !matches!(
                    upload.action,
                    MessageAction::Control | MessageAction::Typing
                ),
        )?;
        let bytes = decode(&archive.ciphertext)?;
        require(bytes.len() >= 40 && bytes.len() <= 64 * 1024)?;
    }
    require(
        valid_id(group)
            && valid_id(&upload.operation_id)
            && valid_id(&upload.device_key)
            && upload.epoch <= 9_007_199_254_740_991
            && upload.target_id.as_ref().is_none_or(|id| valid_id(id))
            && matches!(
                upload.action,
                MessageAction::Edit
                    | MessageAction::Delete
                    | MessageAction::Reaction
                    | MessageAction::Pin
            ) == upload.target_id.is_some(),
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
    pub fn sign_authority(&mut self, community_id: &str) -> Result<CommunityAuthority, String> {
        require(valid_id(community_id))?;
        let mut authority = CommunityAuthority {
            community_id: community_id.into(),
            owner: self.own.clone(),
            signature: String::new(),
        };
        authority.signature = hex::encode(self.device.sign_scoped(
            &crate::community::authority_statement(&self.server, &authority)?,
        ));
        self.pin_authority(&authority)?;
        Ok(authority)
    }
    pub fn pin_authority(&mut self, authority: &CommunityAuthority) -> Result<(), String> {
        crate::community::verify_authority(&self.server, authority)?;
        let pin = (
            authority.owner.account_id.clone(),
            authority.owner.enrollment.identity_key.clone(),
        );
        require(
            self.state
                .community_owners
                .get(&authority.community_id)
                .is_none_or(|old| *old == pin),
        )?;
        self.pin(&authority.owner)?;
        self.state
            .community_owners
            .insert(authority.community_id.clone(), pin);
        Ok(())
    }
    fn record_epoch(
        &mut self,
        id: &str,
        authorization: Option<&ChannelAuthorization>,
    ) -> Result<(), String> {
        let epoch = self.groups.get(id).ok_or(ERROR)?.epoch().as_u64();
        let roster = self.roster(id)?;
        let rosters = self.state.epoch_rosters.entry(id.into()).or_default();
        rosters.insert(epoch, roster);
        rosters.retain(|e, _| *e + 1 >= epoch);
        if let Some(auth) = authorization {
            let snapshots = self
                .state
                .epoch_authorizations
                .entry(id.into())
                .or_default();
            require(snapshots.get(&epoch).is_none_or(|old| old == auth))?;
            snapshots.insert(epoch, auth.clone());
            if auth.policy.history == HistoryPolicy::None {
                snapshots.retain(|e, _| *e + 1 >= epoch);
            }
            require(snapshots.len() <= 512)?;
        }
        Ok(())
    }
    pub fn pin_governance(
        &mut self,
        authority: &CommunityAuthority,
        policy: Option<&hearth_proto::governance::Governance>,
    ) -> Result<(), String> {
        self.transaction(|this| {
            this.pin_authority(authority)?;
            if let Some(policy) = policy {
                crate::community::verify_governance(&this.server, authority, policy)?;
                if let Some(old) = this.state.governance.get(&policy.community_id) {
                    require(
                        policy.revision >= old.revision
                            && (policy.revision != old.revision || policy == old),
                    )?;
                }
                this.state
                    .governance
                    .insert(policy.community_id.clone(), policy.clone());
            } else {
                require(!this.state.governance.contains_key(&authority.community_id))?;
            }
            Ok(())
        })
    }
    pub fn sign_governance(
        &mut self,
        authority: &CommunityAuthority,
        mut policy: hearth_proto::governance::Governance,
    ) -> Result<hearth_proto::governance::Governance, String> {
        self.pin_authority(authority)?;
        require(
            authority.owner.account_id == self.own.account_id
                && authority.owner.enrollment.identity_key == self.own.enrollment.identity_key,
        )?;
        require(
            policy.revision
                == self
                    .state
                    .governance
                    .get(&policy.community_id)
                    .map_or(1, |p| p.revision + 1),
        )?;
        policy.owner = self.own.clone();
        policy.signature.clear();
        policy.signature = hex::encode(self.device.sign_scoped(
            &crate::community::governance_statement(&self.server, &policy)?,
        ));
        crate::community::verify_governance(&self.server, authority, &policy)?;
        Ok(policy)
    }
    pub fn sign_admission(
        &mut self,
        authority: &CommunityAuthority,
        account_id: &str,
        identity_key: &str,
        history_from: BTreeMap<String, u64>,
    ) -> Result<CommunityAdmission, String> {
        self.pin_authority(authority)?;
        require(
            authority.owner.account_id == self.own.account_id
                && authority.owner.enrollment.identity_key == self.own.enrollment.identity_key,
        )?;
        let mut grant = CommunityAdmission {
            community_id: authority.community_id.clone(),
            account_id: account_id.into(),
            identity_key: identity_key.into(),
            owner: self.own.clone(),
            history_from,
            signature: String::new(),
            invitation: None,
        };
        grant.signature = hex::encode(self.device.sign_scoped(
            &crate::community::admission_statement(&self.server, &grant)?,
        ));
        crate::community::verify_admission(&self.server, authority, &grant)?;
        Ok(grant)
    }
    pub fn sign_invitation(
        &mut self,
        authority: &CommunityAuthority,
        history_from: BTreeMap<String, u64>,
        issued_at: u64,
    ) -> Result<(String, CommunityInvitation), String> {
        self.pin_authority(authority)?;
        require(authority.owner.account_id == self.own.account_id)?;
        let code = random_id();
        let mut value = CommunityInvitation {
            community_id: authority.community_id.clone(),
            invite_id: hex::encode(Sha256::digest(code.as_bytes())),
            owner: self.own.clone(),
            history_from,
            issued_at,
            signature: String::new(),
        };
        value.signature = hex::encode(self.device.sign_scoped(
            &crate::community::invitation_statement(&self.server, &value)?,
        ));
        crate::community::verify_invitation(&self.server, authority, &value)?;
        Ok((code, value))
    }
    pub fn pin_invitation(
        &mut self,
        authority: &CommunityAuthority,
        code: &str,
        value: &CommunityInvitation,
    ) -> Result<(), String> {
        self.transaction(|this| {
            this.pin_authority(authority)?;
            crate::community::verify_invitation(&this.server, authority, value)?;
            require(
                valid_id(code) && value.invite_id == hex::encode(Sha256::digest(code.as_bytes())),
            )?;
            require(
                this.state
                    .joined_invites
                    .get(&value.community_id)
                    .is_none_or(|old| old == value),
            )?;
            this.state
                .joined_invites
                .insert(value.community_id.clone(), value.clone());
            Ok(())
        })
    }
    pub fn sign_invited_admission(
        &mut self,
        authority: &CommunityAuthority,
        account: &str,
        identity: &str,
        invitation: &CommunityInvitation,
    ) -> Result<CommunityAdmission, String> {
        crate::community::verify_invitation(&self.server, authority, invitation)?;
        let mut grant = self.sign_admission(
            authority,
            account,
            identity,
            invitation.history_from.clone(),
        )?;
        grant.invitation = Some(invitation.clone());
        grant.signature = hex::encode(self.device.sign_scoped(
            &crate::community::admission_statement(&self.server, &grant)?,
        ));
        crate::community::verify_admission(&self.server, authority, &grant)?;
        Ok(grant)
    }
    pub fn sign_policy(
        &mut self,
        authority: &CommunityAuthority,
        channel_id: &str,
        kind: ChannelKind,
        history: HistoryPolicy,
        revision: u64,
    ) -> Result<ChannelPolicy, String> {
        self.pin_authority(authority)?;
        require(
            authority.owner.account_id == self.own.account_id
                && authority.owner.enrollment.identity_key == self.own.enrollment.identity_key,
        )?;
        let mut policy = ChannelPolicy {
            community_id: authority.community_id.clone(),
            channel_id: channel_id.into(),
            kind,
            history,
            revision,
            created_at: self
                .state
                .channels
                .get(channel_id)
                .map_or(0, |a| a.policy.created_at),
            history_open_for: self
                .state
                .channels
                .get(channel_id)
                .map_or_else(Vec::new, |a| a.policy.history_open_for.clone()),
            owner: self.own.clone(),
            signature: String::new(),
        };
        policy.signature = hex::encode(
            self.device
                .sign_scoped(&crate::community::policy_statement(&self.server, &policy)?),
        );
        crate::community::verify_policy(&self.server, authority, &policy)?;
        Ok(policy)
    }
    pub fn sign_policy_details(
        &mut self,
        authority: &CommunityAuthority,
        mut policy: ChannelPolicy,
        created_at: u64,
        history_open_for: Vec<String>,
    ) -> Result<ChannelPolicy, String> {
        crate::community::verify_policy(&self.server, authority, &policy)?;
        require(
            policy.owner == self.own
                && self
                    .state
                    .channels
                    .get(&policy.channel_id)
                    .is_none_or(|old| {
                        old.policy.created_at == created_at
                            && old.policy.history_open_for == history_open_for
                    }),
        )?;
        policy.created_at = created_at;
        policy.history_open_for = history_open_for;
        policy.signature = hex::encode(
            self.device
                .sign_scoped(&crate::community::policy_statement(&self.server, &policy)?),
        );
        crate::community::verify_policy(&self.server, authority, &policy)?;
        Ok(policy)
    }
    pub fn authorize_channel(
        &mut self,
        id: &str,
        auth: &ChannelAuthorization,
    ) -> Result<(), String> {
        self.transaction(|this| {
            crate::community::verify_authorization(&this.server, id, auth, &[])?;
            if let Some(expected) = this.state.joined_invites.get(&auth.authority.community_id)
                && let Some(grant) = auth
                    .admissions
                    .iter()
                    .find(|a| a.account_id == this.own.account_id)
            {
                require(grant.invitation.as_ref() == Some(expected))?;
            }
            this.pin_authority(&auth.authority)?;
            // Capture a legacy group's current epoch before accepting a newer policy.
            if this.groups.contains_key(id)
                && this
                    .state
                    .epoch_rosters
                    .get(id)
                    .is_none_or(|r| r.is_empty())
            {
                let old = this.state.channels.get(id).cloned();
                this.record_epoch(id, old.as_ref())?;
            }
            if let Some(old) = this.state.channels.get(id) {
                require(
                    old.authority.community_id == auth.authority.community_id
                        && old.policy.created_at == auth.policy.created_at
                        && old.policy.history_open_for == auth.policy.history_open_for
                        && auth.policy.revision >= old.policy.revision
                        && (auth.policy.revision != old.policy.revision
                            || auth.policy == old.policy),
                )?;
            }
            if let Some(governance) = &auth.governance {
                if let Some(old) = this.state.governance.get(&governance.community_id) {
                    require(
                        governance.revision >= old.revision
                            && (governance.revision != old.revision || governance == old),
                    )?;
                }
                this.state
                    .governance
                    .insert(governance.community_id.clone(), governance.clone());
            } else {
                require(
                    !this
                        .state
                        .governance
                        .contains_key(&auth.authority.community_id),
                )?;
            }
            if this.groups.contains_key(id) {
                require(this.state.channels.contains_key(id))?;
            }
            this.state.channels.insert(id.into(), auth.clone());
            if this.groups.contains_key(id) {
                this.capture_history_key(id)?;
            }
            Ok(())
        })
    }
    fn accept_authorization(
        &mut self,
        id: &str,
        auth: Option<&ChannelAuthorization>,
    ) -> Result<(), String> {
        match auth {
            Some(auth) => self.authorize_channel(id, auth),
            None => require(!self.state.channels.contains_key(id)),
        }
    }
    /// Queue a creation/addition. Persist the snapshot before submitting this envelope.
    pub fn add(
        &mut self,
        id: &str,
        packages: &[KeyPackageRecord],
        create: bool,
    ) -> Result<CommitUpload, String> {
        self.add_audience(id, packages, create, false)
    }
    /// The host authorizes channel audience expansion; certificates remain locally pinned.
    pub fn add_channel(
        &mut self,
        id: &str,
        packages: &[KeyPackageRecord],
        create: bool,
    ) -> Result<CommitUpload, String> {
        self.add_audience(id, packages, create, true)
    }
    fn add_audience(
        &mut self,
        id: &str,
        packages: &[KeyPackageRecord],
        create: bool,
        channel: bool,
    ) -> Result<CommitUpload, String> {
        self.transaction(|this| {
            require(
                valid_id(id)
                    && (!packages.is_empty() || channel)
                    && packages.len() < MAX_MEMBERS
                    && !this
                        .state
                        .pending
                        .iter()
                        .any(|pending| pending.conversation() == id),
            )?;
            if !create && !channel {
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
                members.len() <= if channel { MAX_MEMBERS } else { 32 }
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
                authorization: if channel {
                    Some(this.state.channels.get(id).ok_or(ERROR)?.clone())
                } else {
                    None
                },
            };
            if let Some(auth) = &upload.authorization {
                crate::community::verify_authorization(&this.server, id, auth, &upload.members)?;
            }
            group.set_aad(commit_aad(id, &upload)?);
            let (commit, welcome) = if verified.is_empty() {
                let (commit, welcome, _) = fail(group.self_update(
                    &this.provider,
                    &this.signer,
                    LeafNodeParameters::default(),
                ))?
                .into_messages();
                (commit, welcome)
            } else {
                let (commit, welcome, _) =
                    fail(group.add_members(&this.provider, &this.signer, &verified))?;
                (commit, Some(welcome))
            };
            upload.commit = hex::encode(fail(commit.tls_serialize_detached())?);
            let ciphertext = match welcome {
                Some(welcome) => hex::encode(fail(welcome.tls_serialize_detached())?),
                None => String::new(),
            };
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
                upload: Box::new(upload.clone()),
            });
            Ok(upload)
        })
    }
    /// Rotate the epoch and remove only accounts denied by the verified owner policy.
    pub fn prune_channel(&mut self, id: &str) -> Result<Option<CommitUpload>, String> {
        self.transaction(|this| {
            require(!this.state.pending.iter().any(|p| p.conversation() == id))?;
            let auth = this.state.channels.get(id).ok_or(ERROR)?.clone();
            require(crate::community::authorized(&auth, &this.own))?;
            let group = this.groups.get_mut(id).ok_or(ERROR)?;
            let leaves = group
                .members()
                .map(|leaf| {
                    Ok((
                        leaf.index,
                        member(&leaf.credential, &leaf.signature_key, &this.server)?,
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            let removed = leaves
                .iter()
                .filter(|(_, m)| !crate::community::authorized(&auth, m))
                .map(|(index, _)| *index)
                .collect::<Vec<_>>();
            if removed.is_empty() {
                return Ok(None);
            }
            let mut members = leaves
                .into_iter()
                .filter(|(_, m)| crate::community::authorized(&auth, m))
                .map(|(_, m)| m)
                .collect::<Vec<_>>();
            members.sort_by(|a, b| a.enrollment.device_key.cmp(&b.enrollment.device_key));
            let mut upload = CommitUpload {
                operation_id: random_id(),
                device_key: this.own.enrollment.device_key.clone(),
                expected_epoch: group.epoch().as_u64(),
                members,
                commit: String::new(),
                welcomes: vec![],
                signature: String::new(),
                authorization: Some(auth),
            };
            group.set_aad(commit_aad(id, &upload)?);
            let (commit, _, _) =
                fail(group.remove_members(&this.provider, &this.signer, &removed))?;
            upload.commit = hex::encode(fail(commit.tls_serialize_detached())?);
            upload.signature = hex::encode(this.device.sign_scoped(&signed_commit(
                id,
                &this.server,
                &upload,
            )?));
            verify_commit(id, &this.server, &upload)?;
            this.state.pending.push(PendingOperation::Commit {
                conversation_id: id.into(),
                upload: Box::new(upload.clone()),
            });
            Ok(Some(upload))
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
                this.record_epoch(conversation_id, upload.authorization.as_ref())?;
                this.capture_history_key(conversation_id)?;
            } else {
                let content = this.state.pending_contents.remove(operation).ok_or(ERROR)?;
                if matches!(
                    content,
                    MessageContent::Text { .. }
                        | MessageContent::RichText { .. }
                        | MessageContent::Thread { .. }
                ) {
                    this.state.history_live.insert(operation.into());
                }
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
            if let Some(MessageContent::HistoryRequest { request_id, .. }) =
                this.state.pending_contents.get(operation)
            {
                this.state.history_secrets.remove(request_id);
            }
            this.state.pending_contents.remove(operation);
            Ok(())
        })
    }
    pub fn send(&mut self, id: &str, content: MessageContent) -> Result<MessageUpload, String> {
        self.transaction(|this| {
            require(!this.state.pending.iter().any(|p| p.conversation() == id))?;
            let (action, target_id) = content_metadata(&content);
            if let Some(auth) = this.state.channels.get(id) {
                let epoch = this.groups.get(id).ok_or(ERROR)?.epoch().as_u64();
                let bound = this
                    .state
                    .epoch_authorizations
                    .get(id)
                    .and_then(|e| e.get(&epoch))
                    .unwrap_or(auth);
                require(bound.governance == auth.governance)?;
                require(crate::community::authorized(auth, &this.own))?;
                if matches!(content, MessageContent::Attachment { .. }) {
                    require(
                        hearth_proto::governance::permissions(
                            auth.governance.as_ref(),
                            &auth.authority.owner.account_id,
                            &this.own.account_id,
                            Some(id),
                            u64::MAX,
                        ) & hearth_proto::governance::ATTACH
                            != 0,
                    )?;
                }
                require(channel_action_allowed(auth, &this.own.account_id, action))?;
            }
            validate_content(&content)?;
            if matches!(content, MessageContent::Emoji { .. }) {
                require(
                    this.state
                        .channels
                        .get(id)
                        .is_some_and(|a| a.authority.owner.account_id == this.own.account_id),
                )?;
            }
            let mut upload = MessageUpload {
                operation_id: random_id(),
                device_key: this.own.enrollment.device_key.clone(),
                epoch: this.groups.get(id).ok_or(ERROR)?.epoch().as_u64(),
                action,
                target_id,
                ciphertext: String::new(),
                signature: String::new(),
                archive: None,
            };
            let plaintext = Zeroizing::new(fail(serde_json::to_vec(&content))?);
            upload.archive = this.archive_content(id, &upload, &plaintext)?;
            let group = this.groups.get_mut(id).ok_or(ERROR)?;
            group.set_aad(message_aad(id, &upload)?);
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
                upload: Box::new(upload.clone()),
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
            MessageContent::Attachment { text, files } => {
                let mut public = Vec::new();
                for file in files {
                    public.push(self.remember_file(group, file)?);
                }
                self.apply(
                    group,
                    operation,
                    author,
                    MessageContent::Text {
                        text: if text.trim().is_empty() {
                            "Attachment".into()
                        } else {
                            text
                        },
                        reply_to: None,
                    },
                )?;
                self.state.messages.last_mut().ok_or(ERROR)?.attachments = public;
            }
            MessageContent::Emoji { alias, asset } => {
                let auth = self.state.channels.get(group).ok_or(ERROR)?;
                require(auth.authority.owner.account_id == author)?;
                let public = self.remember_file(group, asset)?;
                let emoji = self.state.emoji.entry(group.into()).or_default();
                require(emoji.len() < 32 || emoji.contains_key(&alias))?;
                emoji.insert(alias, public);
            }
            history @ (MessageContent::HistoryRequest { .. }
            | MessageContent::HistoryShare { .. }) => self.apply_history(group, author, history)?,
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
                    thread: None,
                    reactions: BTreeMap::new(),
                    pinned: false,
                    embed: None,
                    attachments: Vec::new(),
                });
            }
            MessageContent::RichText {
                text,
                reply_to,
                embed,
            } => {
                self.apply(
                    group,
                    operation,
                    author,
                    MessageContent::Text { text, reply_to },
                )?;
                self.state.messages.last_mut().ok_or(ERROR)?.embed = Some(embed);
            }
            MessageContent::Thread { text, parent } => {
                self.apply(
                    group,
                    operation,
                    author,
                    MessageContent::Text {
                        text,
                        reply_to: None,
                    },
                )?;
                self.state.messages.last_mut().ok_or(ERROR)?.thread = Some(parent);
            }
            MessageContent::Reaction { id, emoji, active } => {
                if let Some(message) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id && m.conversation_id == group && !m.deleted)
                {
                    let actors = message.reactions.entry(emoji.clone()).or_default();
                    actors.retain(|actor| actor != author);
                    if active {
                        actors.push(author.into());
                        actors.sort();
                    }
                    if actors.is_empty() {
                        message.reactions.remove(&emoji);
                    }
                    require(message.reactions.len() <= 32)?;
                }
            }
            MessageContent::Pin { id, active } => {
                // send/receive/history validate the role against the originating epoch.
                if let Some(message) = self
                    .state
                    .messages
                    .iter_mut()
                    .find(|m| m.id == id && m.conversation_id == group && !m.deleted)
                {
                    message.pinned = active;
                }
            }
            MessageContent::Read { id } => {
                self.state
                    .read
                    .entry(group.into())
                    .or_default()
                    .insert(author.into(), id);
            }
            MessageContent::Profile { display_name, bio } => {
                self.state
                    .profiles
                    .insert(author.into(), LocalProfile { display_name, bio });
            }
            MessageContent::Presence { state, until } => {
                self.state
                    .presence
                    .insert(author.into(), LocalPresence { state, until });
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
                    message.reactions.clear();
                    message.pinned = false;
                    message.embed = None;
                    message.attachments.clear();
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
                    this.accept_authorization(id, upload.authorization.as_ref())?;
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
                    this.record_epoch(id, upload.authorization.as_ref())?;
                    this.capture_history_key(id)?;
                    this.state
                        .pending_packages
                        .retain(|package| package.package_hash != consumed_package);
                }
                DeliveryData::Commit { upload } => {
                    verify_commit(id, &this.server, upload)?;
                    this.accept_authorization(id, upload.authorization.as_ref())?;
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
                        this.record_epoch(id, upload.authorization.as_ref())?;
                        this.capture_history_key(id)?;
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
                        let peers = match this
                            .state
                            .epoch_rosters
                            .get(id)
                            .and_then(|r| r.get(&upload.epoch))
                        {
                            Some(peers) => peers.clone(),
                            None => this.roster(id)?,
                        };
                        let peer = peers
                            .iter()
                            .find(|p| p.enrollment.device_key == upload.device_key)
                            .ok_or(ERROR)?;
                        require(
                            upload
                                .archive
                                .as_ref()
                                .is_none_or(|archive| archive.member == *peer),
                        )?;
                        let bound = this
                            .state
                            .epoch_authorizations
                            .get(id)
                            .and_then(|e| e.get(&upload.epoch))
                            .or_else(|| this.state.channels.get(id));
                        if let Some(auth) = bound {
                            require(crate::community::authorized(auth, peer))?;
                            require(channel_action_allowed(
                                auth,
                                &peer.account_id,
                                upload.action,
                            ))?;
                        }
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
                        if matches!(content, MessageContent::Attachment { .. })
                            && let Some(auth) = bound
                        {
                            require(
                                hearth_proto::governance::permissions(
                                    auth.governance.as_ref(),
                                    &auth.authority.owner.account_id,
                                    &peer.account_id,
                                    Some(id),
                                    u64::MAX,
                                ) & hearth_proto::governance::ATTACH
                                    != 0,
                            )?;
                        }
                        require(
                            content_metadata(&content) == (upload.action, upload.target_id.clone()),
                        )?;
                        if let MessageContent::Typing { active } = &content {
                            typing = Some((peer.account_id.clone(), *active));
                        }
                        if upload.action == MessageAction::Send {
                            this.state.history_live.insert(upload.operation_id.clone());
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
                channel_id: None,
                accounts,
                epoch: self.groups[&id].epoch().as_u64(),
                members,
            });
        }
        Ok(MessagingView {
            last_seq: self.state.last_seq,
            governance_epochs: self
                .groups
                .iter()
                .map(|(id, g)| {
                    (
                        id.clone(),
                        self.state
                            .epoch_authorizations
                            .get(id)
                            .and_then(|e| e.get(&g.epoch().as_u64()))
                            .and_then(|a| a.governance.as_ref())
                            .map_or(0, |p| p.revision),
                    )
                })
                .collect(),
            messages: self.state.messages.clone(),
            pending: self.state.pending.clone(),
            pending_packages: self.state.pending_packages.clone(),
            groups,
            emoji: self.state.emoji.clone(),
            profiles: self.state.profiles.clone(),
            presence: self.state.presence.clone(),
            read: self.state.read.clone(),
            history_backfill: self.state.history_backfill.iter().cloned().collect(),
            history_waiting: self
                .state
                .history_secrets
                .values()
                .map(|(id, _)| id.clone())
                .collect(),
        })
    }
    /// A bounded local full-text query. Neither query nor results reach the delivery host.
    pub fn search(
        &self,
        query: &str,
        conversation: Option<&str>,
    ) -> Result<Vec<LocalMessage>, String> {
        require(query.len() <= 256 && conversation.is_none_or(valid_id))?;
        let terms = words(query);
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .state
            .messages
            .iter()
            .rev()
            .filter(|message| {
                if message.deleted || conversation.is_some_and(|id| id != message.conversation_id) {
                    return false;
                }
                let tokens = words(&message.text);
                terms.iter().all(|term| tokens.contains(term))
            })
            .take(100)
            .cloned()
            .collect())
    }
}
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}
fn peer_device(credential: &Credential) -> Result<String, String> {
    let member: GroupMember = fail(serde_json::from_slice(credential.serialized_content()))?;
    Ok(member.enrollment.device_key)
}
fn content_metadata(content: &MessageContent) -> (MessageAction, Option<String>) {
    match content {
        MessageContent::Attachment { .. } => (MessageAction::Send, None),
        MessageContent::Emoji { .. } => (MessageAction::Send, None),
        MessageContent::Text { .. } => (MessageAction::Send, None),
        MessageContent::Edit { id, .. } => (MessageAction::Edit, Some(id.clone())),
        MessageContent::Delete { id } => (MessageAction::Delete, Some(id.clone())),
        MessageContent::Typing { .. } => (MessageAction::Typing, None),
        MessageContent::Thread { .. } | MessageContent::RichText { .. } => {
            (MessageAction::Send, None)
        }
        MessageContent::Reaction { id, .. } => (MessageAction::Reaction, Some(id.clone())),
        MessageContent::Pin { id, .. } => (MessageAction::Pin, Some(id.clone())),
        MessageContent::Read { .. }
        | MessageContent::Profile { .. }
        | MessageContent::Presence { .. }
        | MessageContent::HistoryRequest { .. }
        | MessageContent::HistoryShare { .. } => (MessageAction::Control, None),
    }
}
fn validate_content(content: &MessageContent) -> Result<(), String> {
    match content {
        MessageContent::Attachment { text, files } => {
            require(text.len() <= 16_000 && !files.is_empty() && files.len() <= 4)?;
            for file in files {
                attachments::validate(file, false)?;
            }
            Ok(())
        }
        MessageContent::Emoji { alias, asset } => {
            require(
                !alias.is_empty()
                    && alias.len() <= 32
                    && alias
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                    && asset.file.bytes <= 128 * 1024
                    && ["image/png", "image/jpeg", "image/webp"]
                        .contains(&asset.file.mime.as_str()),
            )?;
            attachments::validate(asset, false)
        }
        MessageContent::HistoryRequest {
            request_id,
            device_key,
            public_key,
        } => require(valid_id(request_id) && valid_id(device_key) && valid_id(public_key)),
        MessageContent::HistoryShare {
            request_id,
            device_key,
            public_key,
            ciphertext,
        } => require(
            valid_id(request_id)
                && valid_id(device_key)
                && valid_id(public_key)
                && ciphertext.len() >= 80
                && ciphertext.len() <= 240_000
                && hex::decode(ciphertext).is_ok(),
        ),
        MessageContent::RichText {
            text,
            reply_to,
            embed,
        } => {
            validate_content(&MessageContent::Text {
                text: text.clone(),
                reply_to: reply_to.clone(),
            })?;
            require(
                embed.url.len() <= 2048
                    && (embed.url.starts_with("https://") || embed.url.starts_with("http://"))
                    && !embed
                        .url
                        .chars()
                        .any(|c| c.is_control() || c.is_whitespace())
                    && !embed.title.trim().is_empty()
                    && embed.title.len() <= 160
                    && embed.description.len() <= 512,
            )
        }
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
        MessageContent::Thread { text, parent } => {
            require(valid_id(parent) && !text.trim().is_empty() && text.len() <= 16_000)
        }
        MessageContent::Reaction { id, emoji, .. } => require(
            valid_id(id)
                && !emoji.is_empty()
                && emoji.len() <= 64
                && !emoji.chars().any(char::is_control),
        ),
        MessageContent::Pin { id, .. } | MessageContent::Read { id } => require(valid_id(id)),
        MessageContent::Profile { display_name, bio } => require(
            display_name.len() <= 80
                && bio.len() <= 512
                && !display_name.chars().any(char::is_control),
        ),
        MessageContent::Presence { state, until } => require(
            ["online", "idle", "offline"].contains(&state.as_str())
                && *until <= 9_007_199_254_740_991,
        ),
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
    fn governance_epoch_binding_preserves_queued_messages_and_removes_denied_members() {
        use hearth_proto::governance::*;
        let server = random_id();
        let community = random_id();
        let id = random_id();
        let owner_id = random_id();
        let member_id = random_id();
        let owner_identity = LocalIdentity::new();
        let member_identity = LocalIdentity::new();
        let mut owner = Messaging::new(&owner_identity, &owner_id, &server).unwrap();
        let mut member = Messaging::new(&member_identity, &member_id, &server).unwrap();
        let authority = owner.sign_authority(&community).unwrap();
        let policy = owner
            .sign_policy(&authority, &id, ChannelKind::Text, HistoryPolicy::None, 1)
            .unwrap();
        let package = member.key_package().unwrap();
        let grant = owner
            .sign_admission(
                &authority,
                &member_id,
                &package.member.enrollment.identity_key,
                BTreeMap::new(),
            )
            .unwrap();
        let mut auth = ChannelAuthorization {
            authority: authority.clone(),
            policy,
            admissions: vec![grant],
            governance: None,
        };
        owner.authorize_channel(&id, &auth).unwrap();
        let initial = owner.add_channel(&id, &[package], true).unwrap();
        owner.accept(&initial.operation_id).unwrap();
        member
            .receive(&event(
                1,
                &id,
                DeliveryData::Welcome {
                    welcome: initial.welcomes[0].clone(),
                    upload: initial,
                },
            ))
            .unwrap();
        let g = owner
            .sign_governance(
                &authority,
                Governance {
                    community_id: community,
                    revision: 1,
                    everyone: DEFAULT,
                    roles: vec![],
                    assignments: vec![],
                    overrides: vec![],
                    sanctions: vec![],
                    limits: vec![],
                    rules: String::new(),
                    screening: false,
                    owner: authority.owner.clone(),
                    signature: String::new(),
                },
            )
            .unwrap();
        auth.governance = Some(g);
        owner.authorize_channel(&id, &auth).unwrap();
        assert!(
            owner
                .send(
                    &id,
                    MessageContent::Text {
                        text: "wait for rotation".into(),
                        reply_to: None
                    }
                )
                .is_err()
        );
        let rotate = owner.add_channel(&id, &[], false).unwrap();
        owner.accept(&rotate.operation_id).unwrap();
        member
            .receive(&event(2, &id, DeliveryData::Commit { upload: rotate }))
            .unwrap();
        let inflight = member
            .send(
                &id,
                MessageContent::Text {
                    text: "accepted before role change".into(),
                    reply_to: None,
                },
            )
            .unwrap();
        member.accept(&inflight.operation_id).unwrap();
        let mut next = auth.governance.clone().unwrap();
        next.revision = 2;
        next.overrides.push(PermissionOverride {
            channel_id: id.clone(),
            kind: OverrideKind::Member,
            target_id: member_id.clone(),
            allow: 0,
            deny: SEND,
        });
        auth.governance = Some(owner.sign_governance(&authority, next).unwrap());
        owner.authorize_channel(&id, &auth).unwrap();
        let rotate = owner.add_channel(&id, &[], false).unwrap();
        owner.accept(&rotate.operation_id).unwrap();
        member
            .receive(&event(3, &id, DeliveryData::Commit { upload: rotate }))
            .unwrap();
        owner
            .receive(&event(1, &id, DeliveryData::Message { upload: inflight }))
            .unwrap();
        assert_eq!(
            owner.view().unwrap().messages[0].text,
            "accepted before role change"
        );
        assert!(
            member
                .send(
                    &id,
                    MessageContent::Text {
                        text: "new denied post".into(),
                        reply_to: None
                    }
                )
                .is_err()
        );
        member.state.channels.remove(&id);
        let attack = member
            .send(
                &id,
                MessageContent::Text {
                    text: "bypassed own client".into(),
                    reply_to: None,
                },
            )
            .unwrap();
        assert!(
            owner
                .receive(&event(2, &id, DeliveryData::Message { upload: attack }))
                .is_err()
        );
        let mut next = auth.governance.clone().unwrap();
        next.revision = 3;
        next.overrides[0].deny = READ;
        auth.governance = Some(owner.sign_governance(&authority, next).unwrap());
        owner.authorize_channel(&id, &auth).unwrap();
        let removed = owner.prune_channel(&id).unwrap().unwrap();
        assert_eq!(removed.members.len(), 1);
        owner.accept(&removed.operation_id).unwrap();
        assert_eq!(owner.view().unwrap().groups[0].members.len(), 1);
        let preserved = owner.seal().unwrap();
        let restored = Messaging::open(&owner_identity, &owner_id, &server, &preserved).unwrap();
        assert_eq!(
            restored.state.governance.values().next().unwrap().revision,
            3
        );
    }
    #[test]
    fn later_channel_history_requires_explicit_signed_invite_id() {
        for permitted in [false, true] {
            let owner_identity = LocalIdentity::new();
            let member_identity = LocalIdentity::new();
            let server = random_id();
            let owner_id = random_id();
            let member_id = random_id();
            let id = random_id();
            let mut owner = Messaging::new(&owner_identity, &owner_id, &server).unwrap();
            let mut member = Messaging::new(&member_identity, &member_id, &server).unwrap();
            let authority = owner.sign_authority(&random_id()).unwrap();
            let (code, invite) = owner
                .sign_invitation(&authority, BTreeMap::new(), 100)
                .unwrap();
            member.pin_invitation(&authority, &code, &invite).unwrap();
            let policy = owner
                .sign_policy(
                    &authority,
                    &id,
                    ChannelKind::Text,
                    HistoryPolicy::SinceInvite,
                    1,
                )
                .unwrap();
            // Even a later timestamp is insufficient. Only the signed digest list grants access.
            let policy = owner
                .sign_policy_details(
                    &authority,
                    policy,
                    200,
                    if permitted {
                        vec![invite.invite_id.clone()]
                    } else {
                        vec![]
                    },
                )
                .unwrap();
            let grant = owner
                .sign_invited_admission(
                    &authority,
                    &member_id,
                    &member.own.enrollment.identity_key,
                    &invite,
                )
                .unwrap();
            owner
                .authorize_channel(
                    &id,
                    &ChannelAuthorization {
                        authority,
                        policy,
                        governance: None,
                        admissions: vec![grant],
                    },
                )
                .unwrap();
            let package = member.key_package().unwrap();
            let commit = owner.add_channel(&id, &[package], true).unwrap();
            owner.accept(&commit.operation_id).unwrap();
            member
                .receive(&event(
                    1,
                    &id,
                    DeliveryData::Welcome {
                        welcome: commit.welcomes[0].clone(),
                        upload: commit,
                    },
                ))
                .unwrap();
            assert_eq!(member.request_history(&id).is_ok(), permitted);
        }
    }
    #[test]
    fn wrapped_history_enforces_none_full_since_cutoff_and_recipient_binding() {
        for policy in [
            HistoryPolicy::None,
            HistoryPolicy::Full,
            HistoryPolicy::SinceInvite,
        ] {
            let owner_identity = LocalIdentity::new();
            let member_identity = LocalIdentity::new();
            let spy_identity = LocalIdentity::new();
            let server = random_id();
            let owner_id = random_id();
            let member_id = random_id();
            let spy_id = random_id();
            let id = random_id();
            let community = random_id();
            let mut owner = Messaging::new(&owner_identity, &owner_id, &server).unwrap();
            let mut member = Messaging::new(&member_identity, &member_id, &server).unwrap();
            let mut spy = Messaging::new(&spy_identity, &spy_id, &server).unwrap();
            let authority = owner.sign_authority(&community).unwrap();
            let policy = owner
                .sign_policy(&authority, &id, ChannelKind::Text, policy, 1)
                .unwrap();
            let mut auth = ChannelAuthorization {
                authority: authority.clone(),
                policy,
                governance: None,
                admissions: vec![],
            };
            owner.authorize_channel(&id, &auth).unwrap();
            let solo = owner.add_channel(&id, &[], true).unwrap();
            owner.accept(&solo.operation_id).unwrap();
            let before = owner
                .send(
                    &id,
                    MessageContent::Text {
                        text: "before signed invitation".into(),
                        reply_to: None,
                    },
                )
                .unwrap();
            owner.accept(&before.operation_id).unwrap();
            let rotate = owner.add_channel(&id, &[], false).unwrap();
            owner.accept(&rotate.operation_id).unwrap();
            let after = owner
                .send(
                    &id,
                    MessageContent::Text {
                        text: "after invitation before join".into(),
                        reply_to: None,
                    },
                )
                .unwrap();
            owner.accept(&after.operation_id).unwrap();
            let a = member.key_package().unwrap();
            let b = spy.key_package().unwrap();
            for package in [&a, &b] {
                auth.admissions.push(
                    owner
                        .sign_admission(
                            &authority,
                            &package.member.account_id,
                            &package.member.enrollment.identity_key,
                            BTreeMap::from([(id.clone(), 2)]),
                        )
                        .unwrap(),
                );
            }
            owner.authorize_channel(&id, &auth).unwrap();
            let join = owner.add_channel(&id, &[a, b], false).unwrap();
            owner.accept(&join.operation_id).unwrap();
            for client in [&mut member, &mut spy] {
                let welcome = join
                    .welcomes
                    .iter()
                    .find(|w| w.device_key == client.own.enrollment.device_key)
                    .unwrap()
                    .clone();
                client
                    .receive(&event(
                        1,
                        &id,
                        DeliveryData::Welcome {
                            upload: join.clone(),
                            welcome,
                        },
                    ))
                    .unwrap();
            }
            if auth.policy.history == HistoryPolicy::None {
                assert!(member.request_history(&id).is_err());
                assert!(before.archive.is_none());
                continue;
            }
            let request = member.request_history(&id).unwrap();
            member.accept(&request.operation_id).unwrap();
            owner
                .receive(&event(1, &id, DeliveryData::Message { upload: request }))
                .unwrap();
            let share = owner.offer_history(&id).unwrap().unwrap();
            owner.accept(&share.operation_id).unwrap();
            member
                .receive(&event(
                    2,
                    &id,
                    DeliveryData::Message {
                        upload: share.clone(),
                    },
                ))
                .unwrap();
            spy.receive(&event(2, &id, DeliveryData::Message { upload: share }))
                .unwrap();
            assert_eq!(
                spy.import_history(&id, &[before.clone(), after.clone()])
                    .unwrap(),
                0
            );
            let disk = member.seal().unwrap();
            member = Messaging::open(&member_identity, &member_id, &server, &disk).unwrap();
            member
                .import_history(&id, &[before.clone(), after.clone()])
                .unwrap();
            let view = member.view().unwrap();
            assert!(view.messages.iter().any(|m| m.id == after.operation_id));
            assert_eq!(
                view.messages.iter().any(|m| m.id == before.operation_id),
                auth.policy.history == HistoryPolicy::Full
            );
            assert_eq!(
                member
                    .import_history(&id, &[before.clone(), after.clone()])
                    .unwrap(),
                0
            );
            // A later linked device of an ordinary member inherits the signed account
            // cutoff. It must not be treated as a fresh, unrestricted owner device.
            let mut linked_identity = LocalIdentity::new();
            linked_identity.user = IdentityKey::from_bytes(&member_identity.user.to_bytes());
            let mut linked = Messaging::new(&linked_identity, &member_id, &server).unwrap();
            let package = linked.key_package().unwrap();
            let commit = owner.add_channel(&id, &[package], false).unwrap();
            owner.accept(&commit.operation_id).unwrap();
            linked
                .receive(&event(
                    1,
                    &id,
                    DeliveryData::Welcome {
                        welcome: commit.welcomes[0].clone(),
                        upload: commit,
                    },
                ))
                .unwrap();
            let request = linked.request_history(&id).unwrap();
            linked.accept(&request.operation_id).unwrap();
            owner
                .receive(&event(2, &id, DeliveryData::Message { upload: request }))
                .unwrap();
            let share = owner.offer_history(&id).unwrap().unwrap();
            owner.accept(&share.operation_id).unwrap();
            linked
                .receive(&event(2, &id, DeliveryData::Message { upload: share }))
                .unwrap();
            linked
                .import_history(&id, &[before.clone(), after.clone()])
                .unwrap();
            let mut restored = Messaging::open(
                &linked_identity,
                &member_id,
                &server,
                &linked.seal().unwrap(),
            )
            .unwrap();
            assert!(
                restored
                    .view()
                    .unwrap()
                    .messages
                    .iter()
                    .any(|m| m.id == after.operation_id)
            );
            assert_eq!(
                restored
                    .view()
                    .unwrap()
                    .messages
                    .iter()
                    .any(|m| m.id == before.operation_id),
                auth.policy.history == HistoryPolicy::Full
            );
        }
    }
    #[test]
    fn channel_admission_and_announcement_rules_survive_a_malicious_delivery_host() {
        let owner_identity = LocalIdentity::new();
        let member_identity = LocalIdentity::new();
        let rogue_identity = LocalIdentity::new();
        let owner_id = random_id();
        let member_id = random_id();
        let rogue_id = random_id();
        let server = random_id();
        let community = random_id();
        let id = random_id();
        let mut owner = Messaging::new(&owner_identity, &owner_id, &server).unwrap();
        let mut member = Messaging::new(&member_identity, &member_id, &server).unwrap();
        let mut rogue = Messaging::new(&rogue_identity, &rogue_id, &server).unwrap();
        let authority = owner.sign_authority(&community).unwrap();
        let policy = owner
            .sign_policy(
                &authority,
                &id,
                ChannelKind::Announcement,
                HistoryPolicy::None,
                1,
            )
            .unwrap();
        let mut authorization = ChannelAuthorization {
            authority: authority.clone(),
            policy,
            governance: None,
            admissions: vec![],
        };
        owner.authorize_channel(&id, &authorization).unwrap();
        let package = member.key_package().unwrap();
        assert!(
            owner
                .add_channel(&id, std::slice::from_ref(&package), true)
                .is_err()
        );
        let grant = owner
            .sign_admission(
                &authority,
                &member_id,
                &package.member.enrollment.identity_key,
                BTreeMap::new(),
            )
            .unwrap();
        let mut forged = grant.clone();
        forged.account_id = rogue_id.clone();
        authorization.admissions.push(forged);
        assert!(owner.authorize_channel(&id, &authorization).is_err());
        authorization.admissions = vec![grant];
        owner.authorize_channel(&id, &authorization).unwrap();
        let upload = owner.add_channel(&id, &[package], true).unwrap();
        owner.accept(&upload.operation_id).unwrap();
        member
            .receive(&event(
                1,
                &id,
                DeliveryData::Welcome {
                    welcome: upload.welcomes[0].clone(),
                    upload,
                },
            ))
            .unwrap();
        let preserved = member.seal().unwrap();
        member = Messaging::open(&member_identity, &member_id, &server, &preserved).unwrap();
        let replacement = rogue.sign_authority(&community).unwrap();
        assert!(member.pin_authority(&replacement).is_err());
        assert!(
            member
                .send(
                    &id,
                    MessageContent::Text {
                        text: "unauthorized announcement".into(),
                        reply_to: None
                    }
                )
                .is_err()
        );
        // A hostile member bypasses its own client checks; receiving clients still enforce policy.
        member.state.channels.remove(&id);
        let attack = member
            .send(
                &id,
                MessageContent::Text {
                    text: "host relayed unauthorized content".into(),
                    reply_to: None,
                },
            )
            .unwrap();
        assert!(verify_message(&id, &server, &attack).is_ok());
        assert!(
            owner
                .receive(&event(1, &id, DeliveryData::Message { upload: attack }))
                .is_err()
        );
        assert_eq!(owner.view().unwrap().last_seq, 0);
        assert!(owner.view().unwrap().messages.is_empty());
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
