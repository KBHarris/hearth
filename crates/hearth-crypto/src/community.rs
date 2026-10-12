//! Owner-authenticated channel admission. First authority use is TOFU; later pins are immutable.
use crate::messaging::{valid_id, verify_member, verify_signature};
use hearth_proto::{community::*, messaging::GroupMember};

type Result<T> = std::result::Result<T, String>;
fn require(value: bool) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err("Community authorization failed; preserve the pinned owner identity.".into())
    }
}
pub(crate) fn authority_statement(server: &str, value: &CommunityAuthority) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/community-authority", server, value))
        .map_err(|_| "Invalid authority".into())
}
pub(crate) fn admission_statement(server: &str, value: &CommunityAdmission) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/community-admission", server, value))
        .map_err(|_| "Invalid admission".into())
}
pub(crate) fn policy_statement(server: &str, value: &ChannelPolicy) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/channel-policy", server, value))
        .map_err(|_| "Invalid policy".into())
}
pub(crate) fn invitation_statement(server: &str, value: &CommunityInvitation) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/community-invitation", server, value))
        .map_err(|_| "Invalid invitation".into())
}
pub fn verify_invitation(
    server: &str,
    authority: &CommunityAuthority,
    value: &CommunityInvitation,
) -> Result<()> {
    issuer(server, authority, &value.owner)?;
    require(
        value.community_id == authority.community_id
            && valid_id(&value.invite_id)
            && value.issued_at < 9_007_199_254_740_991
            && value.history_from.len() <= 512
            && value
                .history_from
                .iter()
                .all(|(id, epoch)| valid_id(id) && *epoch < 9_007_199_254_740_991),
    )?;
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &invitation_statement(server, value)?,
    )
}
pub fn verify_authority(server: &str, value: &CommunityAuthority) -> Result<()> {
    require(valid_id(server) && valid_id(&value.community_id))?;
    verify_member(&value.owner, server)?;
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &authority_statement(server, value)?,
    )
}
fn issuer(server: &str, authority: &CommunityAuthority, owner: &GroupMember) -> Result<()> {
    verify_authority(server, authority)?;
    verify_member(owner, server)?;
    require(
        owner.account_id == authority.owner.account_id
            && owner.enrollment.identity_key == authority.owner.enrollment.identity_key,
    )
}
pub fn verify_admission(
    server: &str,
    authority: &CommunityAuthority,
    value: &CommunityAdmission,
) -> Result<()> {
    issuer(server, authority, &value.owner)?;
    if let Some(invitation) = &value.invitation {
        verify_invitation(server, authority, invitation)?;
        require(invitation.history_from == value.history_from)?;
    }
    require(
        value.community_id == authority.community_id
            && valid_id(&value.account_id)
            && valid_id(&value.identity_key)
            && value.history_from.len() <= 512
            && value
                .history_from
                .iter()
                .all(|(id, epoch)| valid_id(id) && *epoch < 9_007_199_254_740_991),
    )?;
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &admission_statement(server, value)?,
    )
}
pub fn verify_policy(
    server: &str,
    authority: &CommunityAuthority,
    value: &ChannelPolicy,
) -> Result<()> {
    issuer(server, authority, &value.owner)?;
    require(
        value.community_id == authority.community_id
            && valid_id(&value.channel_id)
            && value.revision > 0
            && value.created_at < 9_007_199_254_740_991
            && value.history_open_for.len() <= 128
            && value.history_open_for.iter().all(|id| valid_id(id))
            && value.revision < 9_007_199_254_740_991,
    )?;
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &policy_statement(server, value)?,
    )
}
pub fn authorized(value: &ChannelAuthorization, member: &GroupMember) -> bool {
    let admitted = (member.account_id == value.authority.owner.account_id
        && member.enrollment.identity_key == value.authority.owner.enrollment.identity_key)
        || value.admissions.iter().any(|a| {
            a.account_id == member.account_id && a.identity_key == member.enrollment.identity_key
        });
    admitted
        && hearth_proto::governance::permissions(
            value.governance.as_ref(),
            &value.authority.owner.account_id,
            &member.account_id,
            Some(&value.policy.channel_id),
            u64::MAX,
        ) & hearth_proto::governance::READ
            != 0
}
pub fn verify_authorization(
    server: &str,
    id: &str,
    value: &ChannelAuthorization,
    members: &[GroupMember],
) -> Result<()> {
    verify_policy(server, &value.authority, &value.policy)?;
    if let Some(governance) = &value.governance {
        verify_governance(server, &value.authority, governance)?;
    }
    require(value.policy.channel_id == id && value.admissions.len() <= 1024)?;
    let mut seen = std::collections::HashSet::new();
    for grant in &value.admissions {
        verify_admission(server, &value.authority, grant)?;
        require(seen.insert(&grant.account_id))?;
    }
    for member in members {
        verify_member(member, server)?;
        require(authorized(value, member))?;
    }
    Ok(())
}

pub(crate) fn governance_statement(
    server: &str,
    value: &hearth_proto::governance::Governance,
) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/community-governance", server, value))
        .map_err(|_| "Invalid governance".into())
}
pub fn verify_governance(
    server: &str,
    authority: &CommunityAuthority,
    value: &hearth_proto::governance::Governance,
) -> Result<()> {
    use hearth_proto::governance::*;
    issuer(server, authority, &value.owner)?;
    require(
        value.community_id == authority.community_id
            && value.revision > 0
            && value.revision < 9_007_199_254_740_991
            && value.everyone & !ALL == 0
            && value.roles.len() <= 64
            && value.assignments.len() <= 128
            && value.overrides.len() <= 512
            && value.sanctions.len() <= 128
            && value.limits.len() <= 512
            && value.rules.len() <= 4096
            && (!value.screening || !value.rules.trim().is_empty())
            && !value
                .rules
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t'),
    )?;
    let mut ids = std::collections::HashSet::new();
    for r in &value.roles {
        require(
            valid_id(&r.id)
                && ids.insert(&r.id)
                && !r.name.trim().is_empty()
                && r.name.len() <= 80
                && !r.name.chars().any(char::is_control)
                && r.permissions & !ALL == 0,
        )?;
    }
    let mut accounts = std::collections::HashSet::new();
    for a in &value.assignments {
        require(
            valid_id(&a.account_id)
                && accounts.insert(&a.account_id)
                && a.role_ids.len() <= 64
                && a.role_ids.iter().all(|r| ids.contains(r)),
        )?;
        let mut seen = std::collections::HashSet::new();
        require(a.role_ids.iter().all(|r| seen.insert(r)))?;
    }
    let mut overrides = std::collections::HashSet::new();
    for o in &value.overrides {
        require(
            valid_id(&o.channel_id)
                && o.allow & !ALL == 0
                && o.deny & !ALL == 0
                && o.allow & o.deny == 0
                && match o.kind {
                    OverrideKind::Everyone => o.target_id.is_empty(),
                    OverrideKind::Role => ids.contains(&o.target_id),
                    OverrideKind::Member => valid_id(&o.target_id),
                }
                && overrides.insert((&o.channel_id, o.kind as u8, &o.target_id)),
        )?;
    }
    let mut limits = std::collections::HashSet::new();
    for l in &value.limits {
        require(
            valid_id(&l.channel_id)
                && limits.insert(&l.channel_id)
                && l.slowmode_seconds <= 21600
                && l.retention_days.is_none_or(|d| (1..=3650).contains(&d)),
        )?;
    }
    let mut sanctions = std::collections::HashSet::new();
    for sanction in &value.sanctions {
        require(
            valid_id(&sanction.account_id)
                && sanction.account_id != authority.owner.account_id
                && sanction.channel_id.as_ref().is_none_or(|c| valid_id(c))
                && sanctions.insert((&sanction.account_id, &sanction.channel_id))
                && match sanction.kind {
                    SanctionKind::Timeout => {
                        sanction.until.is_some_and(|t| t < 9_007_199_254_740_991)
                    }
                    _ => sanction.until.is_none(),
                },
        )?;
    }
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &governance_statement(server, value)?,
    )
}
