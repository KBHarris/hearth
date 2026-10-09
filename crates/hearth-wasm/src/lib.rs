//! Browser bindings. Build with `wasm-pack build crates/hearth-wasm --target web`.

use wasm_bindgen::prelude::*;

#[cfg(feature = "auth")]
#[wasm_bindgen(js_name = OpaqueAuthClient)]
#[derive(Default)]
pub struct AuthClient {
    inner: hearth_crypto::auth::Client,
    identity: Option<hearth_crypto::vault::LocalIdentity>,
    messaging: Option<hearth_crypto::messaging::Messaging>,
}

#[cfg(feature = "auth")]
#[wasm_bindgen(js_class = OpaqueAuthClient)]
impl AuthClient {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }
    #[wasm_bindgen(js_name = registrationStart)]
    pub fn registration_start(&mut self, password: &str) -> Result<String, JsValue> {
        self.inner
            .registration_start(password)
            .map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = registrationFinish)]
    pub fn registration_finish(
        &mut self,
        password: &str,
        response: &str,
        username: &str,
        server_id: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .registration_finish(password, response, username, server_id)
            .map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = loginStart)]
    pub fn login_start(&mut self, password: &str) -> Result<String, JsValue> {
        self.identity = None;
        self.messaging = None;
        self.inner
            .login_start(password)
            .map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = loginFinish)]
    pub fn login_finish(
        &mut self,
        password: &str,
        response: &str,
        username: &str,
        server_id: &str,
    ) -> Result<String, JsValue> {
        self.inner
            .login_finish(password, response, username, server_id)
            .map_err(|e| JsValue::from_str(&e))
    }
    /// Returns only an encrypted envelope and public proof. Secrets remain in WASM.
    #[wasm_bindgen(js_name = prepareIdentity)]
    pub fn prepare_identity(
        &mut self,
        envelope: Option<String>,
        account: &str,
        server: &str,
    ) -> Result<String, JsValue> {
        self.identity = None;
        let (identity, envelope) = self
            .inner
            .prepare_identity(envelope.as_deref(), account, server)
            .map_err(|e| JsValue::from_str(&e))?;
        let enrollment = identity
            .enrollment(account, server)
            .map_err(|e| JsValue::from_str(&e))?;
        self.identity = Some(identity);
        serde_json::to_string(&serde_json::json!({"envelope":envelope,"enrollment":enrollment}))
            .map_err(|_| JsValue::from_str("Local identity encoding failed"))
    }
    #[wasm_bindgen(js_name = commitIdentity)]
    pub fn commit_identity(&mut self) {
        self.inner.lock_export_key();
    }
    #[wasm_bindgen(js_name = exportRecovery)]
    pub fn export_recovery(
        &self,
        passphrase: &str,
        account: &str,
        server: &str,
    ) -> Result<String, JsValue> {
        self.identity
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Unlock this device first"))?
            .recovery_kit(passphrase, account, server)
            .map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = restoreIdentity)]
    pub fn restore_identity(
        &mut self,
        kit: &str,
        passphrase: &str,
        account: &str,
        server: &str,
    ) -> Result<String, JsValue> {
        let identity =
            hearth_crypto::vault::LocalIdentity::restore_kit(kit, passphrase, account, server)
                .map_err(|e| JsValue::from_str(&e))?;
        let envelope = self
            .inner
            .wrap_identity(&identity, account, server)
            .map_err(|e| JsValue::from_str(&e))?;
        let enrollment = identity
            .enrollment(account, server)
            .map_err(|e| JsValue::from_str(&e))?;
        self.identity = Some(identity);
        serde_json::to_string(&serde_json::json!({"envelope":envelope,"enrollment":enrollment}))
            .map_err(|_| JsValue::from_str("Identity encoding failed"))
    }
    #[wasm_bindgen(js_name = linkOffer)]
    pub fn link_offer(&self, account: &str, server: &str) -> Result<String, JsValue> {
        let identity = self
            .identity
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Unlock this device first"))?;
        let (code, id, envelope, signature) = identity
            .link_offer(account, server)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&serde_json::json!({"code":code,"id":id,"envelope":envelope,"signature":signature,"device_key":identity.enrollment(account,server).map_err(|e| JsValue::from_str(&e))?.device_key})).map_err(|_| JsValue::from_str("Link encoding failed"))
    }
    #[wasm_bindgen(js_name = linkId)]
    pub fn link_id(&self, code: &str) -> Result<String, JsValue> {
        hearth_crypto::recovery::link_id(code).map_err(|e| JsValue::from_str(&e))
    }
    #[wasm_bindgen(js_name = openMessaging)]
    pub fn open_messaging(
        &mut self,
        envelope: Option<String>,
        account: &str,
        server: &str,
    ) -> Result<(), JsValue> {
        let identity = self
            .identity
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Unlock this device first"))?;
        self.messaging = Some(
            match envelope {
                Some(envelope) => {
                    hearth_crypto::messaging::Messaging::open(identity, account, server, &envelope)
                }
                None => hearth_crypto::messaging::Messaging::new(identity, account, server),
            }
            .map_err(|e| JsValue::from_str(&e))?,
        );
        Ok(())
    }
    #[wasm_bindgen(js_name = messagingOperation)]
    pub fn messaging_operation(&mut self, operation: &str, input: &str) -> Result<String, JsValue> {
        let engine = self
            .messaging
            .as_mut()
            .ok_or_else(|| JsValue::from_str("Open the encrypted message store first"))?;
        let error = |_: String| {
            JsValue::from_str(
                "Encrypted messaging verification failed; preserve the store and retry.",
            )
        };
        let invalid = || JsValue::from_str("Invalid encrypted messaging request");
        let result = match operation {
            "seal" => return engine.seal().map_err(error),
            "view" => serde_json::to_value(engine.view().map_err(error)?),
            "verify_peers" => {
                let peers =
                    serde_json::from_str::<Vec<hearth_proto::messaging::GroupMember>>(input)
                        .map_err(|_| invalid())?;
                engine.verify_peers(&peers).map_err(error)?;
                Ok(serde_json::Value::Null)
            }
            "package" => serde_json::to_value(engine.key_package().map_err(error)?),
            "add" | "add_channel" => {
                let value: serde_json::Value =
                    serde_json::from_str(input).map_err(|_| invalid())?;
                let id = value["id"].as_str().ok_or_else(invalid)?;
                let packages = serde_json::from_value::<
                    Vec<hearth_proto::messaging::KeyPackageRecord>,
                >(value["packages"].clone())
                .map_err(|_| invalid())?;
                let create = value["create"].as_bool().ok_or_else(invalid)?;
                serde_json::to_value(
                    if operation == "add_channel" {
                        engine.add_channel(id, &packages, create)
                    } else {
                        engine.add(id, &packages, create)
                    }
                    .map_err(error)?,
                )
            }
            "send" => {
                let value: serde_json::Value =
                    serde_json::from_str(input).map_err(|_| invalid())?;
                let content = serde_json::from_value::<hearth_proto::messaging::MessageContent>(
                    value["content"].clone(),
                )
                .map_err(|_| invalid())?;
                serde_json::to_value(
                    engine
                        .send(value["id"].as_str().ok_or_else(invalid)?, content)
                        .map_err(error)?,
                )
            }
            "accept" => {
                engine.accept(input).map_err(error)?;
                Ok(serde_json::Value::Null)
            }
            "reject" => {
                engine.reject(input).map_err(error)?;
                Ok(serde_json::Value::Null)
            }
            "receive" => {
                let event = serde_json::from_str::<hearth_proto::messaging::DeliveryEvent>(input)
                    .map_err(|_| invalid())?;
                serde_json::to_value(engine.receive(&event).map_err(error)?)
            }
            "gateway" => {
                let value: serde_json::Value =
                    serde_json::from_str(input).map_err(|_| invalid())?;
                serde_json::to_value(
                    engine
                        .gateway_proof(
                            value["token"].as_str().ok_or_else(invalid)?,
                            value["challenge"].as_str().ok_or_else(invalid)?,
                        )
                        .map_err(error)?,
                )
            }
            _ => return Err(invalid()),
        }
        .map_err(|_| invalid())?;
        serde_json::to_string(&result).map_err(|_| invalid())
    }
}

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
