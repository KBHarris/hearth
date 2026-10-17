//! Deterministic TypeScript declarations derived from the serde wire definitions.

use ts_rs::{Config, TS};

use crate::{
    Health, HealthStatus, PROTOCOL_VERSION, SetupStatus, WellKnown,
    gateway::{ClientFrame, ServerFrame},
};

pub fn generate() -> String {
    let config = Config::new();
    let declarations = [
        crate::invite::InviteEnvelope::decl(&config),
        crate::invite::StoreInviteEnvelope::decl(&config),
        crate::lifecycle::AccountDeparture::decl(&config),
        crate::lifecycle::ExportRecord::decl(&config),
        crate::lifecycle::AccountExport::decl(&config),
        crate::reports::SenderProof::decl(&config),
        crate::reports::ReportKey::decl(&config),
        crate::reports::ReportEvidence::decl(&config),
        crate::reports::ReportEnvelope::decl(&config),
        crate::reports::QueuedReport::decl(&config),
        crate::governance::Role::decl(&config),
        crate::governance::RoleAssignment::decl(&config),
        crate::governance::OverrideKind::decl(&config),
        crate::governance::PermissionOverride::decl(&config),
        crate::governance::SanctionKind::decl(&config),
        crate::governance::Sanction::decl(&config),
        crate::governance::ChannelLimits::decl(&config),
        crate::governance::Governance::decl(&config),
        crate::governance::GovernanceView::decl(&config),
        crate::governance::RulesAcceptance::decl(&config),
        crate::governance::AuditEntry::decl(&config),
        crate::community::CreateCommunity::decl(&config),
        crate::community::Community::decl(&config),
        crate::community::Category::decl(&config),
        crate::community::ChannelKind::decl(&config),
        crate::community::CreateChannel::decl(&config),
        crate::community::Channel::decl(&config),
        crate::community::ChannelRoster::decl(&config),
        crate::community::CommunityAuthority::decl(&config),
        crate::community::OwnershipHandoff::decl(&config),
        crate::community::OwnershipAcceptance::decl(&config),
        crate::community::OwnershipState::decl(&config),
        crate::community::CommunityAdmission::decl(&config),
        crate::community::CommunityInvitation::decl(&config),
        crate::community::MemberInvitation::decl(&config),
        crate::community::HistoryPolicy::decl(&config),
        crate::community::ChannelPolicy::decl(&config),
        crate::community::ChannelAuthorization::decl(&config),
        crate::community::CommunityStructure::decl(&config),
        crate::community::CreateCommunityInvite::decl(&config),
        crate::community::CommunityInvite::decl(&config),
        crate::community::JoinCommunity::decl(&config),
        crate::auth::OwnerRegistrationStart::decl(&config),
        crate::auth::OwnerRegistrationFinish::decl(&config),
        crate::auth::LoginStart::decl(&config),
        crate::auth::LoginFinish::decl(&config),
        crate::auth::AuthResponse::decl(&config),
        crate::auth::LoginResponse::decl(&config),
        crate::auth::Account::decl(&config),
        crate::auth::Session::decl(&config),
        crate::auth::RegistrationMode::decl(&config),
        crate::auth::RegistrationStatus::decl(&config),
        crate::auth::RegistrationStart::decl(&config),
        crate::auth::RegistrationFinish::decl(&config),
        crate::auth::ServerSettings::decl(&config),
        crate::auth::AccountInvite::decl(&config),
        crate::device::DeviceEnrollment::decl(&config),
        crate::device::AccountIdentity::decl(&config),
        crate::device::DeviceRestore::decl(&config),
        crate::device::DeviceLinkOffer::decl(&config),
        crate::device::DeviceLinkEnvelope::decl(&config),
        crate::messaging::GroupMember::decl(&config),
        crate::messaging::KeyPackageRecord::decl(&config),
        crate::messaging::PackageClaim::decl(&config),
        crate::messaging::Person::decl(&config),
        crate::messaging::Conversation::decl(&config),
        crate::messaging::WelcomeEnvelope::decl(&config),
        crate::messaging::CommitUpload::decl(&config),
        crate::messaging::MessageAction::decl(&config),
        crate::messaging::MessageUpload::decl(&config),
        crate::messaging::HistoryArchive::decl(&config),
        crate::messaging::HistoryPage::decl(&config),
        crate::messaging::DeliveryData::decl(&config),
        crate::messaging::DeliveryEvent::decl(&config),
        crate::messaging::MessageContent::decl(&config),
        crate::messaging::LocalMessage::decl(&config),
        crate::messaging::LocalPoll::decl(&config),
        crate::messaging::LocalProfile::decl(&config),
        crate::messaging::LocalPresence::decl(&config),
        crate::messaging::LinkEmbed::decl(&config),
        crate::messaging::EncryptedAttachment::decl(&config),
        crate::messaging::LocalAttachment::decl(&config),
        crate::messaging::BlobReservation::decl(&config),
        crate::messaging::BlobUrl::decl(&config),
        HealthStatus::decl(&config),
        Health::decl(&config),
        WellKnown::decl(&config),
        SetupStatus::decl(&config),
        ClientFrame::decl(&config),
        ServerFrame::decl(&config),
    ];
    let mut output = format!(
        "// Generated from hearth-proto. Do not edit by hand.\n\
         // Regenerate: npm run protocol:generate\n\
         // SPDX-License-Identifier: Apache-2.0 OR MIT\n\n\
         export const PROTOCOL_VERSION = {PROTOCOL_VERSION} as const\n\n"
    );
    for declaration in declarations {
        output.push_str("export ");
        output.push_str(&declaration);
        output.push_str("\n\n");
    }
    let mut normalized = output
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_owned();
    normalized.push('\n');
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_types_match_rust_wire_definitions() {
        let committed = include_str!("../../../packages/sdk/src/protocol.ts");
        assert_eq!(
            committed.replace("\r\n", "\n"),
            generate(),
            "Run npm run protocol:generate"
        );
    }
}
