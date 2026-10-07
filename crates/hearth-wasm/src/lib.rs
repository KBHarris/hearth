//! Browser bindings. Build with `wasm-pack build crates/hearth-wasm --target web`.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = protocolVersion)]
pub fn protocol_version() -> u32 {
    hearth_proto::PROTOCOL_VERSION
}

/// Generates a throwaway identity and returns its device certificate as JSON.
/// Phase 1 replaces this with the real keystore-backed flow.
#[wasm_bindgen(js_name = demoDeviceCertificate)]
pub fn demo_device_certificate() -> String {
    let install = hearth_client_core::create_identity();
    serde_json::to_string(&install.certificate).expect("certificate serializes")
}

/// Test-only, in-memory MLS scenario. Available only in an explicit spike build.
#[cfg(feature = "mls-spike")]
#[wasm_bindgen(js_name = mlsSpike)]
pub fn mls_spike() -> Result<String, JsValue> {
    let report = hearth_crypto::mls_spike::run().map_err(|error| JsValue::from_str(&error))?;
    serde_json::to_string(&report).map_err(|_| JsValue::from_str("MLS report serialization failed"))
}

#[cfg(feature = "opaque-spike")]
mod opaque {
    use super::*;
    use hearth_crypto::opaque_spike::SpikeClient;

    /// Test-only WASM client state. Never use this experiment as a product keystore.
    #[wasm_bindgen(js_name = OpaqueSpikeClient)]
    #[derive(Default)]
    pub struct OpaqueClient {
        inner: SpikeClient,
    }

    #[wasm_bindgen(js_class = OpaqueSpikeClient)]
    impl OpaqueClient {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self::default()
        }

        #[wasm_bindgen(js_name = registrationStart)]
        pub fn registration_start(&mut self, password: &str) -> Result<String, JsValue> {
            self.inner.registration_start(password).map_err(error)
        }

        #[wasm_bindgen(js_name = registrationFinish)]
        pub fn registration_finish(
            &mut self,
            password: &str,
            response: &str,
        ) -> Result<String, JsValue> {
            self.inner
                .registration_finish(password, response)
                .map_err(error)
        }

        #[wasm_bindgen(js_name = loginStart)]
        pub fn login_start(&mut self, password: &str) -> Result<String, JsValue> {
            self.inner.login_start(password).map_err(error)
        }

        #[wasm_bindgen(js_name = loginFinish)]
        pub fn login_finish(&mut self, password: &str, response: &str) -> Result<String, JsValue> {
            let proof = self.inner.login_finish(password, response).map_err(error)?;
            serde_json::to_string(&proof)
                .map_err(|_| JsValue::from_str("OPAQUE spike report serialization failed"))
        }
    }

    fn error(message: String) -> JsValue {
        JsValue::from_str(&message)
    }
}
