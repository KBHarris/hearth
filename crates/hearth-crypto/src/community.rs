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
    (member.account_id == value.authority.owner.account_id
        && member.enrollment.identity_key == value.authority.owner.enrollment.identity_key)
        || value.admissions.iter().any(|a| {
            a.account_id == member.account_id && a.identity_key == member.enrollment.identity_key
        })
}
pub fn verify_authorization(
    server: &str,
    id: &str,
    value: &ChannelAuthorization,
    members: &[GroupMember],
) -> Result<()> {
    verify_policy(server, &value.authority, &value.policy)?;
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
