//! Public community governance metadata. Content and report evidence remain encrypted.
use crate::messaging::GroupMember;
use serde::{Deserialize, Serialize};

pub const READ: u32 = 1;
pub const SEND: u32 = 2;
pub const REACT: u32 = 4;
pub const ATTACH: u32 = 8;
pub const PIN: u32 = 16;
pub const INVITE: u32 = 32;
pub const MANAGE_CHANNELS: u32 = 64;
pub const MANAGE_ROLES: u32 = 128;
pub const MODERATE: u32 = 256;
pub const AUDIT: u32 = 512;
pub const ALL: u32 = 1023;
pub const DEFAULT: u32 = READ | SEND | REACT | ATTACH;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Role {
    pub id: String,
    pub name: String,
    pub permissions: u32,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RoleAssignment {
    pub account_id: String,
    pub role_ids: Vec<String>,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum OverrideKind {
    Everyone,
    Role,
    Member,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PermissionOverride {
    pub channel_id: String,
    pub kind: OverrideKind,
    pub target_id: String,
    pub allow: u32,
    pub deny: u32,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SanctionKind {
    Ban,
    Kick,
    Timeout,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Sanction {
    pub account_id: String,
    pub channel_id: Option<String>,
    pub kind: SanctionKind,
    #[cfg_attr(feature = "typescript", ts(type = "number | null"))]
    pub until: Option<u64>,
    /// Kicks deny every admission tied to an invitation issued at or before this cutoff.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional, type = "number"))]
    pub kick_after: Option<u64>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ChannelLimits {
    pub channel_id: String,
    pub slowmode_seconds: u32,
    pub retention_days: Option<u32>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Governance {
    pub community_id: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub revision: u64,
    pub everyone: u32,
    pub roles: Vec<Role>,
    pub assignments: Vec<RoleAssignment>,
    pub overrides: Vec<PermissionOverride>,
    pub sanctions: Vec<Sanction>,
    pub limits: Vec<ChannelLimits>,
    pub rules: String,
    pub screening: bool,
    pub owner: GroupMember,
    pub signature: String,
    /// A delegated moderator signs a restricted successor of this verified policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub delegation: Option<Box<Governance>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub moderator_admission: Option<Box<crate::community::CommunityAdmission>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GovernanceView {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub admission: Option<Box<crate::community::CommunityAdmission>>,
    pub governance: Option<Governance>,
    pub members: Vec<crate::auth::Account>,
    pub rules_accepted: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RulesAcceptance {
    pub digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AuditEntry {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub revision: u64,
    pub actor_id: String,
    pub action: String,
    pub digest: String,
}

pub fn kicks_preserved(old: &Governance, new: &Governance) -> bool {
    old.sanctions
        .iter()
        .filter(|s| s.kind == SanctionKind::Kick)
        .all(|previous| {
            new.sanctions.iter().any(|s| {
                s.kind == SanctionKind::Kick
                    && s.account_id == previous.account_id
                    && s.channel_id == previous.channel_id
                    && match (previous.kick_after, s.kick_after) {
                        (Some(before), Some(after)) => after >= before,
                        (None, _) => true,
                        _ => false,
                    }
            })
        })
}
/// Owner bypass, base role union, everyone override, aggregated role override, member override.
/// Sanctions are applied last and never grant permissions. Time is Unix milliseconds.
pub fn permissions(
    policy: Option<&Governance>,
    owner: &str,
    account: &str,
    channel: Option<&str>,
    now: u64,
) -> u32 {
    permissions_with_invite(policy, owner, account, channel, now, None)
}
pub fn permissions_with_invite(
    policy: Option<&Governance>,
    owner: &str,
    account: &str,
    channel: Option<&str>,
    now: u64,
    invite_issued_at: Option<u64>,
) -> u32 {
    if account == owner {
        return ALL;
    }
    let Some(p) = policy else {
        return DEFAULT;
    };
    let roles = p
        .assignments
        .iter()
        .find(|a| a.account_id == account)
        .map(|a| a.role_ids.as_slice())
        .unwrap_or(&[]);
    let mut bits = p.everyone;
    for role in &p.roles {
        if roles.contains(&role.id) {
            bits |= role.permissions;
        }
    }
    if let Some(channel) = channel {
        for kind in [
            OverrideKind::Everyone,
            OverrideKind::Role,
            OverrideKind::Member,
        ] {
            let mut allow = 0;
            let mut deny = 0;
            for o in &p.overrides {
                if o.channel_id == channel
                    && o.kind == kind
                    && match kind {
                        OverrideKind::Everyone => true,
                        OverrideKind::Role => roles.contains(&o.target_id),
                        OverrideKind::Member => o.target_id == account,
                    }
                {
                    allow |= o.allow;
                    deny |= o.deny;
                }
            }
            bits = (bits & !deny) | allow;
        }
    }
    for s in &p.sanctions {
        if s.account_id == account
            && s.until.is_none_or(|until| now < until)
            && (s.channel_id.is_none() || s.channel_id.as_deref() == channel)
        {
            match s.kind {
                SanctionKind::Ban => return 0,
                SanctionKind::Kick => {
                    if !s.kick_after.is_some_and(|cutoff| {
                        invite_issued_at.is_some_and(|issued| issued > cutoff)
                    }) {
                        return 0;
                    }
                }
                SanctionKind::Timeout => bits &= !(SEND | REACT | ATTACH | PIN),
            }
        }
    }
    bits & ALL
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy() -> Governance {
        serde_json::from_value(serde_json::json!({"community_id":"c","revision":1,"everyone":DEFAULT,"roles":[],"assignments":[],"overrides":[],"sanctions":[],"limits":[],"rules":"","screening":false,"owner":{"account_id":"owner","enrollment":{"identity_key":"i","device_key":"d","certificate":"c","account_signature":"a","device_signature":"s"}},"signature":""})).unwrap()
    }
    #[test]
    fn matrix_override_precedence_and_sanctions() {
        let mut p = policy();
        p.roles.push(Role {
            id: "mod".into(),
            name: "Moderator".into(),
            permissions: MODERATE | PIN,
        });
        p.assignments.push(RoleAssignment {
            account_id: "member".into(),
            role_ids: vec!["mod".into()],
        });
        p.overrides.push(PermissionOverride {
            channel_id: "room".into(),
            kind: OverrideKind::Everyone,
            target_id: "".into(),
            allow: 0,
            deny: READ | SEND,
        });
        assert_eq!(
            permissions(Some(&p), "owner", "member", Some("room"), 0) & READ,
            0
        );
        p.overrides.push(PermissionOverride {
            channel_id: "room".into(),
            kind: OverrideKind::Role,
            target_id: "mod".into(),
            allow: READ,
            deny: 0,
        });
        assert_ne!(
            permissions(Some(&p), "owner", "member", Some("room"), 0) & READ,
            0
        );
        p.overrides.push(PermissionOverride {
            channel_id: "room".into(),
            kind: OverrideKind::Member,
            target_id: "member".into(),
            allow: SEND,
            deny: PIN,
        });
        assert_eq!(
            permissions(Some(&p), "owner", "member", Some("room"), 0) & (READ | SEND | PIN),
            READ | SEND
        );
        p.sanctions.push(Sanction {
            account_id: "member".into(),
            channel_id: None,
            kind: SanctionKind::Timeout,
            until: Some(100),
            kick_after: None,
        });
        assert_eq!(
            permissions(Some(&p), "owner", "member", Some("room"), 99) & SEND,
            0
        );
        assert_ne!(
            permissions(Some(&p), "owner", "member", Some("room"), 100) & SEND,
            0
        );
        p.sanctions.push(Sanction {
            account_id: "member".into(),
            channel_id: Some("room".into()),
            kind: SanctionKind::Ban,
            until: None,
            kick_after: None,
        });
        assert_eq!(
            permissions(Some(&p), "owner", "member", Some("room"), 101),
            0
        );
        assert_eq!(
            permissions(Some(&p), "owner", "owner", Some("room"), 101),
            ALL
        );
        assert_eq!(
            permissions(None, "owner", "other", Some("room"), 0),
            DEFAULT
        );
    }
}
