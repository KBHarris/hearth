//! File keys and descriptors stay inside the sealed MLS engine. Storage sees chunks only.
use super::*;
const CHUNK: usize = 1024 * 1024;
pub(super) const MAX_FILE: usize = 8 * 1024 * 1024;

pub(super) fn validate(file: &EncryptedAttachment, nested: bool) -> Result<(), String> {
    let f = &file.file;
    require(
        valid_id(&f.id)
            && valid_id(&f.digest)
            && valid_id(&file.key)
            && file.nonce.len() == 32
            && hex::decode(&file.nonce).is_ok()
            && f.bytes > 0
            && f.bytes as usize <= MAX_FILE
            && f.cipher_bytes as usize
                == f.bytes as usize + (f.bytes as usize).div_ceil(CHUNK) * 16
            && !f.name.is_empty()
            && f.name.len() <= 160
            && !f
                .name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
            && f.mime.len() <= 128
            && !f.mime.chars().any(char::is_control),
    )?;
    match (&file.thumbnail, &f.thumbnail) {
        (None, None) => Ok(()),
        (Some(t), Some(public)) if !nested => {
            require(
                public.id == t.file.id
                    && t.file.bytes <= 128 * 1024
                    && ["image/png", "image/jpeg", "image/webp"].contains(&t.file.mime.as_str()),
            )?;
            validate(t, true)
        }
        _ => Err(ERROR.into()),
    }
}
fn nonce(prefix: &[u8], index: usize) -> [u8; 24] {
    let mut n = [0; 24];
    n[..16].copy_from_slice(prefix);
    n[16..].copy_from_slice(&(index as u64).to_le_bytes());
    n
}
fn aad(server: &str, group: &str, f: &LocalAttachment, index: usize) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/file-chunk",
        server,
        group,
        &f.id,
        f.bytes,
        CHUNK,
        index,
    )))
}
#[derive(Serialize)]
pub struct PreparedFile {
    pub file: LocalAttachment,
    pub ciphertext: String,
}
impl Messaging {
    pub fn prepare_file(
        &mut self,
        group: &str,
        name: &str,
        mime: &str,
        plaintext: &str,
    ) -> Result<PreparedFile, String> {
        self.transaction(|this| {
            require(this.groups.contains_key(group) && plaintext.len() <= MAX_FILE * 2)?;
            if let Some(auth) = this.state.channels.get(group) {
                require(channel_action_allowed(
                    auth,
                    &this.own.account_id,
                    MessageAction::Send,
                ))?;
            }
            let bytes = Zeroizing::new(fail(hex::decode(plaintext))?);
            require(!bytes.is_empty() && bytes.len() <= MAX_FILE)?;
            let files = this.state.files.entry(group.into()).or_default();
            require(files.len() < 2048)?;
            let mut key = Zeroizing::new([0; 32]);
            let mut prefix = [0; 16];
            OsRng.fill_bytes(&mut *key);
            OsRng.fill_bytes(&mut prefix);
            let mut file = LocalAttachment {
                id: random_id(),
                name: name.into(),
                mime: mime.into(),
                bytes: bytes.len() as u32,
                cipher_bytes: (bytes.len() + bytes.len().div_ceil(CHUNK) * 16) as u32,
                digest: "0".repeat(64),
                thumbnail: None,
            };
            let cipher = XChaCha20Poly1305::new_from_slice(&*key).map_err(|_| ERROR)?;
            let mut encrypted = Vec::with_capacity(file.cipher_bytes as usize);
            for (i, chunk) in bytes.chunks(CHUNK).enumerate() {
                encrypted.extend(fail(cipher.encrypt(
                    XNonce::from_slice(&nonce(&prefix, i)),
                    Payload {
                        msg: chunk,
                        aad: &aad(&this.server, group, &file, i)?,
                    },
                ))?);
            }
            file.digest = hex::encode(Sha256::digest(&encrypted));
            let descriptor = EncryptedAttachment {
                file: file.clone(),
                key: hex::encode(*key),
                nonce: hex::encode(prefix),
                thumbnail: None,
            };
            validate(&descriptor, false)?;
            this.state
                .files
                .entry(group.into())
                .or_default()
                .insert(file.id.clone(), descriptor);
            Ok(PreparedFile {
                file,
                ciphertext: hex::encode(encrypted),
            })
        })
    }
    pub fn send_file(
        &mut self,
        group: &str,
        id: &str,
        thumbnail: Option<&str>,
        text: &str,
        emoji: Option<&str>,
    ) -> Result<MessageUpload, String> {
        self.transaction(|this| {
            if emoji.is_some() {
                require(
                    this.state
                        .channels
                        .get(group)
                        .is_some_and(|a| a.authority.owner.account_id == this.own.account_id),
                )?;
            }
            let files = this.state.files.get(group).ok_or(ERROR)?;
            let mut asset = files.get(id).cloned().ok_or(ERROR)?;
            if let Some(t) = thumbnail {
                let t = files.get(t).cloned().ok_or(ERROR)?;
                asset.file.thumbnail = Some(Box::new(t.file.clone()));
                asset.thumbnail = Some(Box::new(t));
            }
            validate(&asset, false)?;
            let content = if let Some(alias) = emoji {
                MessageContent::Emoji {
                    alias: alias.into(),
                    asset,
                }
            } else {
                MessageContent::Attachment {
                    text: text.into(),
                    files: vec![asset],
                }
            };
            this.send(group, content)
        })
    }
    pub fn open_file(&self, group: &str, id: &str, ciphertext: &str) -> Result<String, String> {
        let asset = self
            .state
            .files
            .get(group)
            .and_then(|f| f.get(id))
            .ok_or(ERROR)?;
        validate(asset, false)?;
        require(ciphertext.len() == asset.file.cipher_bytes as usize * 2)?;
        let encrypted = fail(hex::decode(ciphertext))?;
        require(hex::encode(Sha256::digest(&encrypted)) == asset.file.digest)?;
        let key = Zeroizing::new(fail(hex::decode(&asset.key))?);
        let prefix = fail(hex::decode(&asset.nonce))?;
        let cipher = fail(XChaCha20Poly1305::new_from_slice(&key))?;
        let mut plaintext = Zeroizing::new(Vec::with_capacity(asset.file.bytes as usize));
        for (i, chunk) in encrypted.chunks(CHUNK + 16).enumerate() {
            plaintext.extend(fail(cipher.decrypt(
                XNonce::from_slice(&nonce(&prefix, i)),
                Payload {
                    msg: chunk,
                    aad: &aad(&self.server, group, &asset.file, i)?,
                },
            ))?);
        }
        require(plaintext.len() == asset.file.bytes as usize)?;
        Ok(hex::encode(&*plaintext))
    }
    pub(super) fn remember_file(
        &mut self,
        group: &str,
        asset: EncryptedAttachment,
    ) -> Result<LocalAttachment, String> {
        validate(&asset, false)?;
        let files = self.state.files.entry(group.into()).or_default();
        require(files.len() < 2048 || files.contains_key(&asset.file.id))?;
        if let Some(t) = &asset.thumbnail {
            files.insert(t.file.id.clone(), *t.clone());
        }
        if let Some(prior) = files.get(&asset.file.id) {
            require(
                prior.key == asset.key
                    && prior.nonce == asset.nonce
                    && prior.file.digest == asset.file.digest,
            )?;
        }
        let public = asset.file.clone();
        files.insert(public.id.clone(), asset);
        Ok(public)
    }
}
