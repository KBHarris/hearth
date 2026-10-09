//! Deterministic TypeScript declarations derived from the serde wire definitions.

use ts_rs::{Config, TS};

use crate::{
    Health, HealthStatus, PROTOCOL_VERSION, SetupStatus, WellKnown,
    gateway::{ClientFrame, ServerFrame},
};

pub fn generate() -> String {
    let config = Config::new();
    let declarations = [
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
        crate::messaging::DeliveryData::decl(&config),
        crate::messaging::DeliveryEvent::decl(&config),
        crate::messaging::MessageContent::decl(&config),
        crate::messaging::LocalMessage::decl(&config),
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
