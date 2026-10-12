//! Selected report evidence is client plaintext; only ReportEnvelope reaches the host.
use crate::messaging::{GroupMember, MessageContent};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SenderProof {
    pub server: String,
    pub channel_id: String,
    pub operation_id: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub epoch: u64,
    pub member: GroupMember,
    pub content: MessageContent,
    pub signature: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ReportKey {
    pub community_id: String,
    pub member: GroupMember,
    pub public_key: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ReportEvidence {
    pub reason: String,
    pub selected: Vec<SenderProof>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ReportEnvelope {
    pub id: String,
    pub channel_id: String,
    pub reporter: GroupMember,
    pub recipient: ReportKey,
    pub ephemeral: String,
    pub ciphertext: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct QueuedReport {
    pub envelope: ReportEnvelope,
    pub resolved: bool,
}
