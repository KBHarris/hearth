//! Deterministic TypeScript declarations derived from the serde wire definitions.

use ts_rs::{Config, TS};

use crate::{
    Health, HealthStatus, PROTOCOL_VERSION, SetupStatus, WellKnown,
    gateway::{ClientFrame, ServerFrame},
};

pub fn generate() -> String {
    let config = Config::new();
    let declarations = [
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
