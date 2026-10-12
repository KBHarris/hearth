//! A device signature inside MLS lets a recipient disclose only selected evidence.
use super::*;
use hearth_proto::reports::*;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignedContent {
    version: u8,
    proof: SenderProof,
}
fn proof_bytes(proof: &SenderProof) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/report-sender-proof",
        &proof.server,
        &proof.channel_id,
        &proof.operation_id,
        proof.epoch,
        &proof.member,
        &proof.content,
    )))
}
fn key_bytes(server: &str, key: &ReportKey) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/report-key",
        server,
        &key.community_id,
        &key.member,
        &key.public_key,
    )))
}
fn aad(server: &str, envelope: &ReportEnvelope) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/report-wrap",
        server,
        &envelope.id,
        &envelope.channel_id,
        &envelope.reporter,
        &envelope.recipient,
        &envelope.ephemeral,
    )))
}
fn envelope_bytes(server: &str, envelope: &ReportEnvelope) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/report-envelope",
        aad(server, envelope)?,
        &envelope.ciphertext,
    )))
}
pub fn verify_proof(server: &str, proof: &SenderProof) -> Result<(), String> {
    require(
        proof.server == server && valid_id(&proof.channel_id) && valid_id(&proof.operation_id),
    )?;
    verify_member(&proof.member, server)?;
    validate_content(&proof.content)?;
    verify_signature(
        &proof.member.enrollment.device_key,
        &proof.signature,
        &proof_bytes(proof)?,
    )
}
pub fn verify_report_key(server: &str, key: &ReportKey) -> Result<(), String> {
    require(valid_id(&key.community_id) && valid_id(&key.public_key))?;
    verify_member(&key.member, server)?;
    verify_signature(
        &key.member.enrollment.device_key,
        &key.signature,
        &key_bytes(server, key)?,
    )
}
pub fn verify_envelope(server: &str, envelope: &ReportEnvelope) -> Result<(), String> {
    require(
        valid_id(&envelope.id)
            && valid_id(&envelope.channel_id)
            && valid_id(&envelope.ephemeral)
            && envelope.ciphertext.len() >= 80
            && envelope.ciphertext.len() <= 256 * 1024,
    )?;
    verify_member(&envelope.reporter, server)?;
    verify_report_key(server, &envelope.recipient)?;
    verify_signature(
        &envelope.reporter.enrollment.device_key,
        &envelope.signature,
        &envelope_bytes(server, envelope)?,
    )
}
fn reportable(content: &MessageContent) -> bool {
    matches!(
        content,
        MessageContent::Text { .. }
            | MessageContent::RichText { .. }
            | MessageContent::Thread { .. }
            | MessageContent::ForumPost { .. }
            | MessageContent::Poll { .. }
            | MessageContent::Edit { .. }
    )
}
impl Messaging {
    pub(super) fn signed_content(
        &mut self,
        id: &str,
        upload: &MessageUpload,
        content: &MessageContent,
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        let mut proof = SenderProof {
            server: self.server.clone(),
            channel_id: id.into(),
            operation_id: upload.operation_id.clone(),
            epoch: upload.epoch,
            member: self.own.clone(),
            content: content.clone(),
            signature: String::new(),
        };
        proof.signature = hex::encode(self.device.sign_scoped(&proof_bytes(&proof)?));
        if reportable(content) {
            self.state
                .proofs
                .insert(proof.operation_id.clone(), proof.clone());
        }
        Ok(Zeroizing::new(fail(serde_json::to_vec(&SignedContent {
            version: 1,
            proof,
        }))?))
    }
    pub(super) fn decode_content(
        &mut self,
        id: &str,
        upload: &MessageUpload,
        member: &GroupMember,
        plaintext: &[u8],
    ) -> Result<MessageContent, String> {
        let value: serde_json::Value = fail(serde_json::from_slice(plaintext))?;
        // Legacy messages have a `kind`; malformed signed messages never fall back.
        if value.get("kind").is_some() {
            return fail(serde_json::from_value(value));
        }
        let signed: SignedContent = fail(serde_json::from_value(value))?;
        let proof = signed.proof;
        require(
            signed.version == 1
                && proof.channel_id == id
                && proof.operation_id == upload.operation_id
                && proof.epoch == upload.epoch
                && proof.member == *member,
        )?;
        verify_proof(&self.server, &proof)?;
        let content = proof.content.clone();
        if reportable(&content) {
            self.state.proofs.insert(proof.operation_id.clone(), proof);
        }
        Ok(content)
    }
    fn report_secret(&self) -> StaticSecret {
        let mut hash = Sha256::new();
        hash.update(b"hearth/v1/report-private-key");
        hash.update(self.device.to_bytes());
        StaticSecret::from(<[u8; 32]>::from(hash.finalize()))
    }
    pub fn report_key(&self, community: &str) -> Result<ReportKey, String> {
        require(valid_id(community))?;
        let mut key = ReportKey {
            community_id: community.into(),
            member: self.own.clone(),
            public_key: hex::encode(PublicKey::from(&self.report_secret()).as_bytes()),
            signature: String::new(),
        };
        key.signature = hex::encode(self.device.sign_scoped(&key_bytes(&self.server, &key)?));
        Ok(key)
    }
    /// Preview is exactly what will be disclosed; no automatic surrounding messages.
    pub fn report_preview(
        &self,
        id: &str,
        selected: &[String],
        reason: &str,
    ) -> Result<ReportEvidence, String> {
        require(
            !selected.is_empty()
                && selected.len() <= 10
                && !reason.trim().is_empty()
                && reason.len() <= 1024,
        )?;
        let mut proofs = Vec::new();
        let mut operations = std::collections::BTreeSet::new();
        for message in selected {
            require(
                self.state
                    .messages
                    .iter()
                    .any(|m| m.id == *message && m.conversation_id == id && !m.deleted),
            )?;
            let original=self.state.proofs.get(message).ok_or("This message predates verifiable reporting or contains a file. Select a supported text message.")?;
            if operations.insert(original.operation_id.clone()) {
                proofs.push(original.clone());
            }
            // Include edits of explicitly selected messages so the moderator sees their provenance.
            for proof in self.state.proofs.values() {
                if proof.channel_id == id
                    && matches!(&proof.content,MessageContent::Edit{id,..} if id==message)
                    && operations.insert(proof.operation_id.clone())
                {
                    proofs.push(proof.clone());
                }
            }
        }
        require(proofs.len() <= 20)?;
        let evidence = ReportEvidence {
            reason: reason.into(),
            selected: proofs,
        };
        require(fail(serde_json::to_vec(&evidence))?.len() <= 64 * 1024)?;
        Ok(evidence)
    }
    pub fn prepare_report(
        &self,
        id: &str,
        selected: &[String],
        reason: &str,
        key: ReportKey,
    ) -> Result<ReportEnvelope, String> {
        verify_report_key(&self.server, &key)?;
        let auth = self.state.channels.get(id).ok_or(ERROR)?;
        require(
            key.community_id == auth.authority.community_id
                && crate::community::authorized(auth, &key.member)
                && hearth_proto::governance::permissions(
                    auth.governance.as_ref(),
                    &auth.authority.owner.account_id,
                    &key.member.account_id,
                    Some(id),
                    0,
                ) & hearth_proto::governance::MODERATE
                    != 0,
        )?;
        let evidence = self.report_preview(id, selected, reason)?;
        let secret = StaticSecret::random_from_rng(OsRng);
        let mut envelope = ReportEnvelope {
            id: random_id(),
            channel_id: id.into(),
            reporter: self.own.clone(),
            recipient: key,
            ephemeral: hex::encode(PublicKey::from(&secret).as_bytes()),
            ciphertext: String::new(),
            signature: String::new(),
        };
        let scope = aad(&self.server, &envelope)?;
        let shared = history::shared(&secret, &envelope.recipient.public_key, &scope)?;
        let plaintext = Zeroizing::new(fail(serde_json::to_vec(&evidence))?);
        envelope.ciphertext = history::encrypt(&shared, &scope, &plaintext)?;
        envelope.signature = hex::encode(
            self.device
                .sign_scoped(&envelope_bytes(&self.server, &envelope)?),
        );
        Ok(envelope)
    }
    pub fn open_report(&self, envelope: &ReportEnvelope) -> Result<ReportEvidence, String> {
        verify_envelope(&self.server, envelope)?;
        require(envelope.recipient == self.report_key(&envelope.recipient.community_id)?)?;
        let scope = aad(&self.server, envelope)?;
        let shared = history::shared(&self.report_secret(), &envelope.ephemeral, &scope)?;
        let plaintext = history::decrypt(&shared, &scope, &envelope.ciphertext)?;
        require(plaintext.len() <= 64 * 1024)?;
        let evidence: ReportEvidence = fail(serde_json::from_slice(&plaintext))?;
        require(
            !evidence.selected.is_empty()
                && evidence.selected.len() <= 20
                && !evidence.reason.trim().is_empty()
                && evidence.reason.len() <= 1024,
        )?;
        let mut ids = std::collections::BTreeSet::new();
        for proof in &evidence.selected {
            require(
                proof.channel_id == envelope.channel_id
                    && ids.insert(&proof.operation_id)
                    && reportable(&proof.content),
            )?;
            verify_proof(&self.server, proof)?;
        }
        Ok(evidence)
    }
}

pub fn verify_departure(
    server: &str,
    value: &hearth_proto::lifecycle::AccountDeparture,
) -> Result<(), String> {
    require(valid_id(&value.operation_id))?;
    verify_member(&value.member, server)?;
    verify_signature(
        &value.member.enrollment.device_key,
        &value.signature,
        &departure_bytes(server, value)?,
    )
}
fn departure_bytes(
    server: &str,
    value: &hearth_proto::lifecycle::AccountDeparture,
) -> Result<Vec<u8>, String> {
    fail(serde_json::to_vec(&(
        "hearth/v1/account-delete",
        server,
        &value.member,
        &value.operation_id,
    )))
}
impl Messaging {
    pub fn sign_departure(&mut self) -> Result<hearth_proto::lifecycle::AccountDeparture, String> {
        if let Some(saved) = &self.state.departure_outbox {
            return Ok(saved.clone());
        }
        let mut value = hearth_proto::lifecycle::AccountDeparture {
            member: self.own.clone(),
            operation_id: random_id(),
            signature: String::new(),
        };
        value.signature = hex::encode(
            self.device
                .sign_scoped(&departure_bytes(&self.server, &value)?),
        );
        self.state.departure_outbox = Some(value.clone());
        Ok(value)
    }
}
