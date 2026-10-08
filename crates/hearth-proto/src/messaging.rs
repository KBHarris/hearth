//! Public routing metadata and encrypted MLS envelopes. MessageContent is client-only.
use crate::{auth::Account, device::DeviceEnrollment};
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GroupMember {
    pub account_id: String,
    pub enrollment: DeviceEnrollment,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct KeyPackageRecord {
    pub member: GroupMember,
    pub package: String,
    pub package_hash: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PackageClaim {
    pub device_keys: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Person {
    pub account: Account,
    pub devices: Vec<DeviceEnrollment>,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Conversation {
    pub id: String,
    pub accounts: Vec<String>,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub epoch: u64,
    pub members: Vec<GroupMember>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct WelcomeEnvelope {
    pub device_key: String,
    pub package_hash: String,
    pub ciphertext: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommitUpload {
    pub operation_id: String,
    pub device_key: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub expected_epoch: u64,
    pub members: Vec<GroupMember>,
    pub commit: String,
    pub welcomes: Vec<WelcomeEnvelope>,
    pub signature: String,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MessageAction {
    Send,
    Edit,
    Delete,
    Typing,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MessageUpload {
    pub operation_id: String,
    pub device_key: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub epoch: u64,
    pub action: MessageAction,
    pub target_id: Option<String>,
    pub ciphertext: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DeliveryData {
    Commit {
        upload: CommitUpload,
    },
    Welcome {
        upload: CommitUpload,
        welcome: WelcomeEnvelope,
    },
    Message {
        upload: MessageUpload,
    },
    Redacted,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DeliveryEvent {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub seq: u64,
    pub conversation_id: String,
    pub data: DeliveryData,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MessageContent {
    Text {
        text: String,
        reply_to: Option<String>,
    },
    Edit {
        id: String,
        text: String,
    },
    Delete {
        id: String,
    },
    Typing {
        active: bool,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LocalMessage {
    pub id: String,
    pub conversation_id: String,
    pub author_id: String,
    pub text: String,
    pub reply_to: Option<String>,
    pub edited: bool,
    pub deleted: bool,
}
