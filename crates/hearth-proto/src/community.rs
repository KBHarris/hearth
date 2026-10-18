//! Community structure is authenticated routing metadata, never message content.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ChannelRoster {
    pub community: Community,
    pub channel: Channel,
    pub people: Vec<crate::messaging::Person>,
    pub authority: Option<CommunityAuthority>,
    pub policy: Option<ChannelPolicy>,
    pub admissions: Vec<CommunityAdmission>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "typescript", ts(optional, as = "Option<_>"))]
    pub departures: Vec<crate::lifecycle::AccountDeparture>,
    pub invitations: Vec<MemberInvitation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub governance: Option<crate::governance::Governance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub rules_accepted: Option<bool>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommunityAuthority {
    pub community_id: String,
    pub owner: crate::messaging::GroupMember,
    pub signature: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub handoff: Option<Box<OwnershipHandoff>>,
}
/// The outgoing owner endorses an exact predecessor and existing signed objects.
/// The successor accepts by signing the new CommunityAuthority containing this offer.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct OwnershipHandoff {
    pub previous: CommunityAuthority,
    pub issuer: crate::messaging::GroupMember,
    pub successor: crate::messaging::GroupMember,
    pub endorsed: Vec<String>,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct OwnershipAcceptance {
    pub authority: CommunityAuthority,
    pub former_owner: CommunityAdmission,
    pub governance: crate::governance::Governance,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct OwnershipState {
    pub authority: CommunityAuthority,
    pub endorsed: Vec<String>,
    pub offer: Option<OwnershipHandoff>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommunityAdmission {
    pub community_id: String,
    pub account_id: String,
    pub identity_key: String,
    pub owner: crate::messaging::GroupMember,
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, number>"))]
    pub history_from: std::collections::BTreeMap<String, u64>,
    pub signature: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub invitation: Option<CommunityInvitation>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CommunityInvitation {
    pub community_id: String,
    pub invite_id: String,
    pub owner: crate::messaging::GroupMember,
    #[cfg_attr(feature = "typescript", ts(type = "Record<string, number>"))]
    pub history_from: std::collections::BTreeMap<String, u64>,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub issued_at: u64,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct MemberInvitation {
    pub account_id: String,
    pub invitation: CommunityInvitation,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum HistoryPolicy {
    None,
    SinceInvite,
    Full,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ChannelPolicy {
    pub channel_id: String,
    pub community_id: String,
    pub kind: ChannelKind,
    pub history: HistoryPolicy,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub revision: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub created_at: u64,
    pub history_open_for: Vec<String>,
    pub owner: crate::messaging::GroupMember,
    pub signature: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ChannelAuthorization {
    pub authority: CommunityAuthority,
    pub policy: ChannelPolicy,
    pub admissions: Vec<CommunityAdmission>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "typescript", ts(optional, as = "Option<_>"))]
    pub departures: Vec<crate::lifecycle::AccountDeparture>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub governance: Option<crate::governance::Governance>,
}

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
    Forum,
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
    pub authority: Option<CommunityAuthority>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CreateCommunityInvite {
    pub expires_in_seconds: u32,
    pub max_uses: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub authorization: Option<CommunityInvitation>,
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
