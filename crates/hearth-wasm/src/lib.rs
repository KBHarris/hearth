//! Browser bindings. Build with `wasm-pack build crates/hearth-wasm --target web`.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = protocolVersion)]
pub fn protocol_version() -> u32 {
    hearth_proto::PROTOCOL_VERSION
}

/// Generates a throwaway identity and returns its device certificate as JSON.
/// Spike A (Phase 0) replaces this with the real keystore-backed flow.
#[wasm_bindgen(js_name = demoDeviceCertificate)]
pub fn demo_device_certificate() -> String {
    let install = hearth_client_core::create_identity();
    serde_json::to_string(&install.certificate).expect("certificate serializes")
}
