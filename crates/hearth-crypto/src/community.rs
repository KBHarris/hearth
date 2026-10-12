//! Owner-authenticated admission and jointly signed ownership lineage.
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
    verify_authority_depth(server, value, 0)
}
fn verify_authority_depth(server: &str, value: &CommunityAuthority, depth: usize) -> Result<()> {
    require(depth <= 8)?;
    require(valid_id(server) && valid_id(&value.community_id))?;
    verify_member(&value.owner, server)?;
    if let Some(handoff) = &value.handoff {
        require(
            handoff.successor == value.owner && handoff.previous.community_id == value.community_id,
        )?;
        verify_handoff_depth(server, handoff, depth + 1)?;
    }
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &authority_statement(server, value)?,
    )
}
pub fn object_digest(value: &impl serde::Serialize) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(value).map_err(|_| "Invalid signed object")?,
    )))
}
pub(crate) fn handoff_statement(server: &str, value: &OwnershipHandoff) -> Result<Vec<u8>> {
    let mut value = value.clone();
    value.signature.clear();
    serde_json::to_vec(&("hearth/v1/ownership-handoff", server, value))
        .map_err(|_| "Invalid handoff".into())
}
pub fn verify_handoff(server: &str, value: &OwnershipHandoff) -> Result<()> {
    verify_handoff_depth(server, value, 1)
}
fn verify_handoff_depth(server: &str, value: &OwnershipHandoff, depth: usize) -> Result<()> {
    verify_authority_depth(server, &value.previous, depth)?;
    verify_member(&value.issuer, server)?;
    verify_member(&value.successor, server)?;
    require(
        value.issuer.account_id == value.previous.owner.account_id
            && value.issuer.enrollment.identity_key == value.previous.owner.enrollment.identity_key
            && value.successor.account_id != value.previous.owner.account_id
            && value.successor.enrollment.identity_key
                != value.previous.owner.enrollment.identity_key
            && value.endorsed.len() <= 2048
            && value.endorsed.iter().all(|d| valid_id(d))
            && value.endorsed.windows(2).all(|w| w[0] < w[1]),
    )?;
    verify_signature(
        &value.issuer.enrollment.device_key,
        &value.signature,
        &handoff_statement(server, value)?,
    )
}
/// Equality or exact ancestor; an ancestor may verify old epochs, never roll back a pin.
pub fn authority_descends(value: &CommunityAuthority, ancestor: &CommunityAuthority) -> bool {
    let mut current = value;
    for _ in 0..=8 {
        if current == ancestor {
            return true;
        }
        let Some(handoff) = &current.handoff else {
            return false;
        };
        current = &handoff.previous;
    }
    false
}
fn object_authority<'a>(
    authority: &'a CommunityAuthority,
    owner: &GroupMember,
    object: &impl serde::Serialize,
) -> Result<&'a CommunityAuthority> {
    if owner.account_id == authority.owner.account_id
        && owner.enrollment.identity_key == authority.owner.enrollment.identity_key
    {
        return Ok(authority);
    }
    let digest = object_digest(object)?;
    let mut current = authority;
    for _ in 0..8 {
        let handoff = current
            .handoff
            .as_ref()
            .ok_or("Object is not endorsed by the new owner")?;
        require(handoff.endorsed.contains(&digest))?;
        current = &handoff.previous;
        if owner.account_id == current.owner.account_id
            && owner.enrollment.identity_key == current.owner.enrollment.identity_key
        {
            return Ok(current);
        }
    }
    Err("Ownership lineage limit exceeded".into())
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
    verify_authority(server, authority)?;
    let authority = object_authority(authority, &value.owner, value)?;
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
    verify_authority(server, authority)?;
    let authority = object_authority(authority, &value.owner, value)?;
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
pub fn permissions(value: &ChannelAuthorization, account: &str, now: u64) -> u32 {
    let issued = value
        .admissions
        .iter()
        .find(|a| a.account_id == account)
        .and_then(|a| a.invitation.as_ref())
        .map(|i| i.issued_at);
    hearth_proto::governance::permissions_with_invite(
        value.governance.as_ref(),
        &value.authority.owner.account_id,
        account,
        Some(&value.policy.channel_id),
        now,
        issued,
    )
}
pub fn authorized(value: &ChannelAuthorization, member: &GroupMember) -> bool {
    if value.departures.iter().any(|d| {
        d.member.account_id == member.account_id
            && d.member.enrollment.identity_key == member.enrollment.identity_key
    }) {
        return false;
    }
    let admitted = (member.account_id == value.authority.owner.account_id
        && member.enrollment.identity_key == value.authority.owner.enrollment.identity_key)
        || value.admissions.iter().any(|a| {
            a.account_id == member.account_id && a.identity_key == member.enrollment.identity_key
        });
    admitted
        && permissions(value, &member.account_id, u64::MAX) & hearth_proto::governance::READ != 0
}
pub fn verify_authorization(
    server: &str,
    id: &str,
    value: &ChannelAuthorization,
    members: &[GroupMember],
) -> Result<()> {
    verify_policy(server, &value.authority, &value.policy)?;
    require(value.departures.len() <= 128)?;
    let mut departed = std::collections::HashSet::new();
    for d in &value.departures {
        crate::messaging::reports::verify_departure(server, d)?;
        require(departed.insert(&d.member.account_id))?;
    }
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
    verify_governance_depth(server, authority, value, 0)
}
fn verify_governance_depth(
    server: &str,
    authority: &CommunityAuthority,
    value: &hearth_proto::governance::Governance,
    depth: usize,
) -> Result<()> {
    use hearth_proto::governance::*;
    require(depth <= 8)?;
    if let Some(parent) = &value.delegation {
        verify_governance_depth(server, authority, parent, depth + 1)?;
        verify_member(&value.owner, server)?;
        require(value.revision == parent.revision + 1 && kicks_preserved(parent, value))?;
        let mut baseline = parent.as_ref().clone();
        baseline.owner = value.owner.clone();
        baseline.signature = value.signature.clone();
        baseline.revision = value.revision;
        baseline.sanctions = value.sanctions.clone();
        baseline.limits = value.limits.clone();
        baseline.delegation = None;
        baseline.moderator_admission = value.moderator_admission.clone();
        let mut candidate = value.clone();
        candidate.delegation = None;
        require(baseline == candidate)?;
        if let Some(grant) = &value.moderator_admission {
            verify_admission(server, authority, grant)?;
            require(
                grant.account_id == value.owner.account_id
                    && grant.identity_key == value.owner.enrollment.identity_key,
            )?;
        }
        let issued = value
            .moderator_admission
            .as_ref()
            .and_then(|a| a.invitation.as_ref())
            .map(|i| i.issued_at);
        let allowed = |scope: Option<&str>, target: Option<&str>| {
            let actor = permissions_with_invite(
                Some(parent),
                &authority.owner.account_id,
                &value.owner.account_id,
                scope,
                u64::MAX,
                issued,
            );
            let mut unconstrained = parent.as_ref().clone();
            unconstrained.sanctions.clear();
            actor & MODERATE != 0
                && target.is_none_or(|target| {
                    target != authority.owner.account_id
                        && permissions(
                            Some(&unconstrained),
                            &authority.owner.account_id,
                            target,
                            scope,
                            u64::MAX,
                        ) & MODERATE
                            == 0
                })
        };
        for sanction in value
            .sanctions
            .iter()
            .filter(|s| !parent.sanctions.contains(s))
            .chain(
                parent
                    .sanctions
                    .iter()
                    .filter(|s| !value.sanctions.contains(s)),
            )
        {
            require(allowed(
                sanction.channel_id.as_deref(),
                Some(&sanction.account_id),
            ))?;
        }
        for limit in value
            .limits
            .iter()
            .filter(|l| !parent.limits.contains(l))
            .chain(parent.limits.iter().filter(|l| !value.limits.contains(l)))
        {
            require(allowed(Some(&limit.channel_id), None))?;
            let before = parent
                .limits
                .iter()
                .find(|l| l.channel_id == limit.channel_id)
                .and_then(|l| l.retention_days);
            let after = value
                .limits
                .iter()
                .find(|l| l.channel_id == limit.channel_id)
                .and_then(|l| l.retention_days);
            require(before == after)?;
        }
        // A delegated signature must carry an actual authorized moderation change.
        require(value.sanctions != parent.sanctions || value.limits != parent.limits)?;
    } else {
        issuer(server, authority, &value.owner)?;
        require(value.moderator_admission.is_none())?;
    }
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
                && sanctions.insert((
                    &sanction.account_id,
                    &sanction.channel_id,
                    sanction.kind == SanctionKind::Kick,
                ))
                && match sanction.kind {
                    SanctionKind::Timeout => {
                        sanction.kick_after.is_none()
                            && sanction.until.is_some_and(|t| t < 9_007_199_254_740_991)
                    }
                    SanctionKind::Kick => {
                        sanction.until.is_none()
                            && sanction.channel_id.is_none()
                            && sanction
                                .kick_after
                                .is_none_or(|t| t > 0 && t < 9_007_199_254_740_991)
                    }
                    _ => sanction.until.is_none() && sanction.kick_after.is_none(),
                },
        )?;
    }
    verify_signature(
        &value.owner.enrollment.device_key,
        &value.signature,
        &governance_statement(server, value)?,
    )
}
