//! Community structure is authenticated routing metadata, never message content.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CreateCommunity {
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Community {
    pub id: String,
    pub name: String,
    pub owner_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Category {
    pub id: String,
    pub community_id: String,
    pub name: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ChannelKind {
    Text,
    Announcement,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CreateChannel {
    pub name: String,
    pub category_id: Option<String>,
    pub kind: ChannelKind,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Channel {
    pub id: String,
    pub community_id: String,
    pub name: String,
    pub category_id: Option<String>,
    pub kind: ChannelKind,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommunityStructure {
    pub community: Community,
    pub categories: Vec<Category>,
    pub channels: Vec<Channel>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CreateCommunityInvite {
    pub expires_in_seconds: u32,
    pub max_uses: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommunityInvite {
    pub code: String,
    pub expires_in_seconds: u32,
    pub max_uses: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct JoinCommunity {
    pub code: String,
}
