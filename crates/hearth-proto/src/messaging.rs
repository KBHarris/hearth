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
    #[serde(default)]
    pub channel_id: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub authorization: Option<crate::community::ChannelAuthorization>,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum MessageAction {
    Send,
    Edit,
    Delete,
    Typing,
    Reaction,
    Pin,
    Control,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub archive: Option<HistoryArchive>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct HistoryArchive {
    pub member: GroupMember,
    pub ciphertext: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct HistoryPage {
    pub items: Vec<MessageUpload>,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub next: u64,
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
    Attachment {
        text: String,
        files: Vec<EncryptedAttachment>,
    },
    Emoji {
        alias: String,
        asset: EncryptedAttachment,
    },
    HistoryRequest {
        request_id: String,
        device_key: String,
        public_key: String,
    },
    HistoryShare {
        request_id: String,
        device_key: String,
        public_key: String,
        ciphertext: String,
    },
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
    Thread {
        text: String,
        parent: String,
    },
    Reaction {
        id: String,
        emoji: String,
        active: bool,
    },
    Pin {
        id: String,
        active: bool,
    },
    Read {
        id: String,
    },
    Profile {
        display_name: String,
        bio: String,
    },
    Presence {
        state: String,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        until: u64,
    },
    RichText {
        text: String,
        reply_to: Option<String>,
        embed: LinkEmbed,
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
    #[serde(default)]
    pub thread: Option<String>,
    #[serde(default)]
    pub reactions: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub embed: Option<LinkEmbed>,
    #[serde(default)]
    pub attachments: Vec<LocalAttachment>,
}

/// Client-only descriptor, carried inside MLS. Never send this to object storage.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct EncryptedAttachment {
    pub file: LocalAttachment,
    pub key: String,
    pub nonce: String,
    pub thumbnail: Option<Box<EncryptedAttachment>>,
}
/// Public-to-the-local-UI descriptor. File keys stay in the crypto worker's sealed state.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LocalAttachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: u32,
    pub cipher_bytes: u32,
    pub digest: String,
    pub thumbnail: Option<Box<LocalAttachment>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct BlobReservation {
    pub id: String,
    pub device_key: String,
    pub cipher_bytes: u32,
    pub digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct BlobUrl {
    pub url: String,
    pub expires_in_seconds: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LinkEmbed {
    pub url: String,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LocalProfile {
    pub display_name: String,
    pub bio: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LocalPresence {
    pub state: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub until: u64,
}
