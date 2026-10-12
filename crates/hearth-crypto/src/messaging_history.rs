//! History retains exporter-derived archive keys separately from live MLS ratchets.
use super::*;
use hkdf::Hkdf;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Request {
    pub request_id: String,
    pub public_key: String,
    pub member: GroupMember,
}
#[derive(Clone, Serialize, Deserialize)]
struct EpochKey {
    epoch: u64,
    key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    authorization: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryBundle {
    keys: Vec<EpochKey>,
    authorizations: BTreeMap<String, ChannelAuthorization>,
}

fn array(value: &str) -> Result<[u8; 32], String> {
    fail(decode(value)?.try_into())
}
fn scope(server: &str, id: &str, request: &str, device: &str) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/history-wrap",
        server,
        id,
        request,
        device,
    )))
}
fn shared(secret: &StaticSecret, public: &str, aad: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let shared = Zeroizing::new(
        secret
            .diffie_hellman(&PublicKey::from(array(public)?))
            .to_bytes(),
    );
    require(*shared != [0; 32])?;
    let mut key = Zeroizing::new([0; 32]);
    fail(Hkdf::<Sha256>::new(None, &*shared).expand(aad, &mut *key))?;
    Ok(key)
}
fn encrypt(key: &[u8; 32], aad: &[u8], plaintext: &[u8]) -> Result<String, String> {
    let mut nonce = [0; 24];
    OsRng.fill_bytes(&mut nonce);
    let mut wire = nonce.to_vec();
    wire.extend(fail(XChaCha20Poly1305::new(key.into()).encrypt(
        XNonce::from_slice(&nonce),
        Payload {
            msg: plaintext,
            aad,
        },
    ))?);
    Ok(hex::encode(wire))
}
fn decrypt(key: &[u8; 32], aad: &[u8], wire: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let wire = decode(wire)?;
    require(wire.len() >= 40)?;
    Ok(Zeroizing::new(fail(
        XChaCha20Poly1305::new(key.into()).decrypt(
            XNonce::from_slice(&wire[..24]),
            Payload {
                msg: &wire[24..],
                aad,
            },
        ),
    )?))
}
impl Messaging {
    pub(super) fn history_floor(&self, id: &str, member: &GroupMember) -> Result<u64, String> {
        let auth = self.state.channels.get(id).ok_or(ERROR)?;
        require(crate::community::authorized(auth, member))?;
        match auth.policy.history {
            HistoryPolicy::None => Err(ERROR.into()),
            HistoryPolicy::Full => Ok(0),
            HistoryPolicy::SinceInvite if member.account_id == auth.authority.owner.account_id => {
                Ok(0)
            }
            HistoryPolicy::SinceInvite => auth
                .admissions
                .iter()
                .find(|a| {
                    a.account_id == member.account_id
                        && a.identity_key == member.enrollment.identity_key
                })
                .and_then(|a| {
                    a.history_from.get(id).copied().or_else(|| {
                        a.invitation
                            .as_ref()
                            .filter(|invite| {
                                auth.policy.history_open_for.contains(&invite.invite_id)
                            })
                            .map(|_| 0)
                    })
                })
                .ok_or(ERROR.into()),
        }
    }
    pub(super) fn capture_history_key(&mut self, id: &str) -> Result<(), String> {
        if !self
            .state
            .channels
            .get(id)
            .is_some_and(|a| a.policy.history != HistoryPolicy::None)
        {
            return Ok(());
        }
        let group = self.groups.get(id).ok_or(ERROR)?;
        let epoch = group.epoch().as_u64();
        let keys = self.state.history_keys.entry(id.into()).or_default();
        if keys.contains_key(&epoch) {
            return Ok(());
        }
        require(keys.len() < 512)?;
        let secret = Zeroizing::new(fail(group.export_secret(
            self.provider.crypto(),
            "hearth/v1/channel-archive",
            id.as_bytes(),
            32,
        ))?);
        keys.insert(epoch, hex::encode(&*secret));
        Ok(())
    }
    pub(super) fn archive_content(
        &mut self,
        id: &str,
        upload: &MessageUpload,
        plaintext: &[u8],
    ) -> Result<Option<HistoryArchive>, String> {
        if matches!(
            upload.action,
            MessageAction::Control | MessageAction::Typing
        ) || !self
            .state
            .channels
            .get(id)
            .is_some_and(|a| a.policy.history != HistoryPolicy::None)
        {
            return Ok(None);
        }
        self.capture_history_key(id)?;
        let key = Zeroizing::new(array(
            self.state
                .history_keys
                .get(id)
                .and_then(|k| k.get(&upload.epoch))
                .ok_or(ERROR)?,
        )?);
        Ok(Some(HistoryArchive {
            member: self.own.clone(),
            ciphertext: encrypt(&key, &archive_aad(&self.server, id, upload)?, plaintext)?,
        }))
    }
    pub fn request_history(&mut self, id: &str) -> Result<MessageUpload, String> {
        self.transaction(|this| {
            this.history_floor(id, &this.own)?;
            require(
                this.state.history_secrets.len() < 16
                    && !this
                        .state
                        .history_secrets
                        .values()
                        .any(|(group, _)| group == id),
            )?;
            let secret = StaticSecret::random_from_rng(OsRng);
            let request_id = random_id();
            let public_key = hex::encode(PublicKey::from(&secret).as_bytes());
            this.state.history_secrets.insert(
                request_id.clone(),
                (id.into(), hex::encode(secret.to_bytes())),
            );
            this.send(
                id,
                MessageContent::HistoryRequest {
                    request_id,
                    device_key: this.own.enrollment.device_key.clone(),
                    public_key,
                },
            )
        })
    }
    pub fn offer_history(&mut self, id: &str) -> Result<Option<MessageUpload>, String> {
        self.transaction(|this| {
            let auth = this.state.channels.get(id).ok_or(ERROR)?;
            require(auth.authority.owner.account_id == this.own.account_id)?;
            let Some(request) = this
                .state
                .history_requests
                .get(id)
                .and_then(|r| r.first())
                .cloned()
            else {
                return Ok(None);
            };
            let Ok(floor) = this.history_floor(id, &request.member) else {
                this.state
                    .history_requests
                    .get_mut(id)
                    .ok_or(ERROR)?
                    .remove(0);
                return Ok(None);
            };
            let mut keys = this
                .state
                .history_keys
                .get(id)
                .map(|keys| {
                    keys.range(floor..)
                        .map(|(&epoch, key)| EpochKey {
                            epoch,
                            key: key.clone(),
                            authorization: None,
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let plaintext = if auth.governance.is_none() {
                fail(serde_json::to_vec(&keys))?
            } else {
                let snapshots = this.state.epoch_authorizations.get(id).ok_or(ERROR)?;
                let mut authorizations = BTreeMap::new();
                for key in &mut keys {
                    let bound = snapshots
                        .get(&key.epoch)
                        .or_else(|| snapshots.values().find(|a| a.governance.is_none()))
                        .ok_or(ERROR)?;
                    let hash = hex::encode(Sha256::digest(fail(serde_json::to_vec(bound))?));
                    authorizations.insert(hash.clone(), bound.clone());
                    key.authorization = Some(hash);
                }
                fail(serde_json::to_vec(&HistoryBundle {
                    keys,
                    authorizations,
                }))?
            };
            require(plaintext.len() <= 100_000)?;
            let plaintext = Zeroizing::new(plaintext);
            let secret = StaticSecret::random_from_rng(OsRng);
            let public_key = hex::encode(PublicKey::from(&secret).as_bytes());
            let device_key = request.member.enrollment.device_key.clone();
            let aad = scope(&this.server, id, &request.request_id, &device_key)?;
            let key = shared(&secret, &request.public_key, &aad)?;
            let ciphertext = encrypt(&key, &aad, &plaintext)?;
            let upload = this.send(
                id,
                MessageContent::HistoryShare {
                    request_id: request.request_id,
                    device_key,
                    public_key,
                    ciphertext,
                },
            )?;
            this.state
                .history_requests
                .get_mut(id)
                .ok_or(ERROR)?
                .remove(0);
            Ok(Some(upload))
        })
    }
    pub(super) fn apply_history(
        &mut self,
        id: &str,
        author: &str,
        content: MessageContent,
    ) -> Result<(), String> {
        match content {
            MessageContent::HistoryRequest {
                request_id,
                device_key,
                public_key,
            } => {
                if self
                    .state
                    .channels
                    .get(id)
                    .is_some_and(|a| a.authority.owner.account_id == self.own.account_id)
                {
                    let member = self
                        .roster(id)?
                        .into_iter()
                        .find(|m| m.account_id == author && m.enrollment.device_key == device_key)
                        .ok_or(ERROR)?;
                    let requests = self.state.history_requests.entry(id.into()).or_default();
                    if requests.len() < 32 && !requests.iter().any(|r| r.request_id == request_id) {
                        requests.push(Request {
                            request_id,
                            public_key,
                            member,
                        });
                    }
                }
            }
            MessageContent::HistoryShare {
                request_id,
                device_key,
                public_key,
                ciphertext,
            } => {
                require(
                    self.state
                        .channels
                        .get(id)
                        .is_some_and(|a| a.authority.owner.account_id == author),
                )?;
                if device_key != self.own.enrollment.device_key {
                    return Ok(());
                }
                let Some(secret) = self.state.history_secrets.get(&request_id) else {
                    return Ok(());
                };
                require(secret.0 == id)?;
                let secret = StaticSecret::from(array(&secret.1)?);
                let aad = scope(&self.server, id, &request_id, &device_key)?;
                let key = shared(&secret, &public_key, &aad)?;
                let plaintext = decrypt(&key, &aad, &ciphertext)?;
                let value: serde_json::Value = fail(serde_json::from_slice(&plaintext))?;
                let (keys, authorizations) = if value.is_array() {
                    (
                        fail(serde_json::from_value::<Vec<EpochKey>>(value))?,
                        BTreeMap::new(),
                    )
                } else {
                    let bundle: HistoryBundle = fail(serde_json::from_value(value))?;
                    (bundle.keys, bundle.authorizations)
                };
                require(authorizations.len() <= 512)?;
                let current = self.state.channels.get(id).ok_or(ERROR)?.clone();
                for (hash, auth) in &authorizations {
                    require(
                        *hash == hex::encode(Sha256::digest(fail(serde_json::to_vec(auth))?))
                            && auth.authority == current.authority,
                    )?;
                    crate::community::verify_authorization(&self.server, id, auth, &[])?;
                }
                for record in &keys {
                    if let Some(hash) = &record.authorization {
                        let auth = authorizations.get(hash).ok_or(ERROR)?;
                        let saved = self
                            .state
                            .epoch_authorizations
                            .entry(id.into())
                            .or_default();
                        require(saved.get(&record.epoch).is_none_or(|old| old == auth))?;
                        saved.insert(record.epoch, auth.clone());
                        require(saved.len() <= 512)?;
                    } else {
                        require(current.governance.is_none())?;
                    }
                }
                require(keys.len() <= 512)?;
                let floor = self.history_floor(id, &self.own)?;
                for record in &keys {
                    require(
                        record.epoch >= floor
                            && record.epoch <= 9_007_199_254_740_991
                            && valid_id(&record.key),
                    )?;
                }
                let saved = self.state.history_keys.entry(id.into()).or_default();
                for record in keys {
                    if let Some(old) = saved.get(&record.epoch) {
                        require(old == &record.key)?;
                    } else {
                        require(saved.len() < 512)?;
                        saved.insert(record.epoch, record.key);
                    }
                }
                self.state.history_secrets.remove(&request_id);
                self.state.history_backfill.insert(id.into());
            }
            _ => return Err(ERROR.into()),
        }
        Ok(())
    }
    pub fn import_history(&mut self, id: &str, uploads: &[MessageUpload]) -> Result<usize, String> {
        self.transaction(|this| {
            require(uploads.len() <= 128)?;
            let floor = this.history_floor(id, &this.own)?;
            let mut imported = 0;
            for upload in uploads {
                if upload.epoch < floor || this.state.history_seen.contains(&upload.operation_id) {
                    continue;
                }
                let Some(key) = this
                    .state
                    .history_keys
                    .get(id)
                    .and_then(|k| k.get(&upload.epoch))
                else {
                    continue;
                };
                verify_message(id, &this.server, upload)?;
                let archive = upload.archive.as_ref().ok_or(ERROR)?;
                verify_member(&archive.member, &this.server)?;
                require(archive.member.enrollment.device_key == upload.device_key)?;
                let auth = this
                    .state
                    .epoch_authorizations
                    .get(id)
                    .and_then(|e| e.get(&upload.epoch))
                    .or_else(|| {
                        this.state
                            .channels
                            .get(id)
                            .filter(|a| a.governance.is_none())
                    })
                    .ok_or(ERROR)?;
                require(
                    crate::community::authorized(auth, &archive.member)
                        && channel_action_allowed(auth, &archive.member.account_id, upload.action),
                )?;
                require(!matches!(
                    upload.action,
                    MessageAction::Control | MessageAction::Typing
                ))?;
                let key = Zeroizing::new(array(key)?);
                let plaintext = decrypt(
                    &key,
                    &archive_aad(&this.server, id, upload)?,
                    &archive.ciphertext,
                )?;
                let content: MessageContent = fail(serde_json::from_slice(&plaintext))?;
                validate_content(&content)?;
                if matches!(content, MessageContent::Attachment { .. }) {
                    require(
                        hearth_proto::governance::permissions(
                            auth.governance.as_ref(),
                            &auth.authority.owner.account_id,
                            &archive.member.account_id,
                            Some(id),
                            u64::MAX,
                        ) & hearth_proto::governance::ATTACH
                            != 0,
                    )?;
                }
                require(content_metadata(&content) == (upload.action, upload.target_id.clone()))?;
                let already_live = this
                    .state
                    .messages
                    .iter()
                    .any(|m| m.id == upload.operation_id)
                    || upload
                        .target_id
                        .as_ref()
                        .is_some_and(|t| this.state.history_live.contains(t));
                if !already_live {
                    this.apply(
                        id,
                        &upload.operation_id,
                        &archive.member.account_id,
                        content,
                    )?;
                    imported += 1;
                }
                this.state.history_seen.insert(upload.operation_id.clone());
            }
            Ok(imported)
        })
    }
    pub fn finish_history(&mut self, id: &str) -> Result<(), String> {
        require(valid_id(id))?;
        self.state.history_backfill.remove(id);
        Ok(())
    }
}
pub(super) fn archive_aad(
    server: &str,
    id: &str,
    upload: &MessageUpload,
) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/archive-message",
        server,
        id,
        &upload.operation_id,
        &upload.device_key,
        upload.epoch,
        upload.action,
        &upload.target_id,
    )))
}
