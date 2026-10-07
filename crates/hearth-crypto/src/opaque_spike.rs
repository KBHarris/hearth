//! Test-only, ephemeral OPAQUE flows. No accounts, sessions, or persistent secrets.

use argon2::Argon2;
use opaque_ke::{
    CipherSuite, ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialFinalization, CredentialRequest,
    CredentialResponse, RegistrationRequest, RegistrationResponse, RegistrationUpload, ServerLogin,
    ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand_core::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha512};
use zeroize::Zeroizing;

const CONTEXT: &[u8] = b"hearth/opaque-spike/v1";
const USER: &[u8] = b"alice-spike";
const ERROR: &str = "OPAQUE spike operation rejected";

struct SpikeSuite;

impl CipherSuite for SpikeSuite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, Sha512>;
    // Actual Argon2 stretching, not the fast Identity KSF used in upstream doc examples.
    // Library defaults are a spike profile, not a product password-cost decision.
    type Ksf = Argon2<'static>;
}

fn wire(value: &str) -> Result<Vec<u8>, String> {
    if value.len() > 8192 {
        return Err(ERROR.into());
    }
    hex::decode(value).map_err(|_| ERROR.into())
}

fn session_tag(key: &[u8]) -> String {
    // Test-only comparison; production must define reviewed session/channel binding.
    let mut digest = Sha512::new();
    digest.update(b"hearth/opaque-spike/session-comparison/v1");
    digest.update(key);
    hex::encode(digest.finalize())
}

#[derive(Default)]
pub struct SpikeClient {
    registration: Option<ClientRegistration<SpikeSuite>>,
    login: Option<ClientLogin<SpikeSuite>>,
    export_key: Option<Zeroizing<Vec<u8>>>,
    server_key: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct LoginProof {
    pub message: String,
    pub session_tag: String,
    pub export_key_matches: bool,
    pub server_key_matches: bool,
}

impl SpikeClient {
    pub fn registration_start(&mut self, password: &str) -> Result<String, String> {
        self.registration = None;
        self.login = None;
        self.export_key = None;
        self.server_key = None;
        let result = ClientRegistration::<SpikeSuite>::start(&mut OsRng, password.as_bytes())
            .map_err(|_| ERROR)?;
        self.registration = Some(result.state);
        Ok(hex::encode(result.message.serialize()))
    }

    pub fn registration_finish(
        &mut self,
        password: &str,
        response: &str,
    ) -> Result<String, String> {
        let state = self.registration.take().ok_or(ERROR)?;
        let response = RegistrationResponse::deserialize(&wire(response)?).map_err(|_| ERROR)?;
        let result = state
            .finish(
                &mut OsRng,
                password.as_bytes(),
                response,
                ClientRegistrationFinishParameters::default(),
            )
            .map_err(|_| ERROR)?;
        self.export_key = Some(Zeroizing::new(result.export_key.to_vec()));
        self.server_key = Some(result.server_s_pk.serialize().to_vec());
        Ok(hex::encode(result.message.serialize()))
    }

    pub fn login_start(&mut self, password: &str) -> Result<String, String> {
        self.login = None;
        let result =
            ClientLogin::<SpikeSuite>::start(&mut OsRng, password.as_bytes()).map_err(|_| ERROR)?;
        self.login = Some(result.state);
        Ok(hex::encode(result.message.serialize()))
    }

    pub fn login_finish(&mut self, password: &str, response: &str) -> Result<LoginProof, String> {
        let state = self.login.take().ok_or(ERROR)?;
        let response = CredentialResponse::deserialize(&wire(response)?).map_err(|_| ERROR)?;
        let result = state
            .finish(
                &mut OsRng,
                password.as_bytes(),
                response,
                ClientLoginFinishParameters {
                    context: Some(CONTEXT),
                    ..Default::default()
                },
            )
            .map_err(|_| ERROR)?;
        Ok(LoginProof {
            message: hex::encode(result.message.serialize()),
            session_tag: session_tag(&result.session_key),
            export_key_matches: self
                .export_key
                .as_ref()
                .is_some_and(|key| key.as_slice() == result.export_key.as_slice()),
            server_key_matches: self
                .server_key
                .as_ref()
                .is_some_and(|key| key.as_slice() == result.server_s_pk.serialize().as_slice()),
        })
    }
}

pub struct SpikeServer {
    setup: ServerSetup<SpikeSuite>,
    record: Option<Zeroizing<Vec<u8>>>,
    login: Option<ServerLogin<SpikeSuite>>,
}

impl Default for SpikeServer {
    fn default() -> Self {
        Self {
            setup: ServerSetup::new(&mut OsRng),
            record: None,
            login: None,
        }
    }
}

fn login_parameters() -> ServerLoginParameters<'static, 'static> {
    ServerLoginParameters {
        context: Some(CONTEXT),
        ..Default::default()
    }
}

impl SpikeServer {
    pub fn registration_start(&self, message: &str) -> Result<String, String> {
        let request = RegistrationRequest::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let result = ServerRegistration::<SpikeSuite>::start(&self.setup, request, USER)
            .map_err(|_| ERROR)?;
        Ok(hex::encode(result.message.serialize()))
    }

    pub fn registration_finish(&mut self, message: &str) -> Result<(), String> {
        let upload = RegistrationUpload::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let record = ServerRegistration::<SpikeSuite>::finish(upload);
        self.record = Some(Zeroizing::new(record.serialize().to_vec()));
        Ok(())
    }

    pub fn login_start(&mut self, message: &str, known_user: bool) -> Result<String, String> {
        self.login = None;
        let request = CredentialRequest::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        // Unknown usernames must still receive a dummy OPAQUE response.
        let record = if known_user {
            self.record
                .as_ref()
                .map(|bytes| ServerRegistration::deserialize(bytes))
                .transpose()
                .map_err(|_| ERROR)?
        } else {
            None
        };
        let result = ServerLogin::<SpikeSuite>::start(
            &mut OsRng,
            &self.setup,
            record,
            request,
            USER,
            login_parameters(),
        )
        .map_err(|_| ERROR)?;
        self.login = Some(result.state);
        Ok(hex::encode(result.message.serialize()))
    }

    pub fn login_finish(&mut self, message: &str, expected_tag: &str) -> Result<bool, String> {
        // Consume before parsing, so rejected or replayed finalizations cannot reuse state.
        let state = self.login.take().ok_or(ERROR)?;
        let finalization =
            CredentialFinalization::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let result = state
            .finish(finalization, login_parameters())
            .map_err(|_| ERROR)?;
        Ok(session_tag(&result.session_key) == expected_tag)
    }

    /// Canary check without exporting the sensitive password file.
    pub fn record_contains(&self, canary: &[u8]) -> bool {
        !canary.is_empty()
            && self
                .record
                .as_ref()
                .is_some_and(|record| record.windows(canary.len()).any(|window| window == canary))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn server_authenticates_without_a_password_parameter() {
        let mut client = super::SpikeClient::default();
        let mut server = super::SpikeServer::default();
        let password = "HEARTH_OPAQUE_PRIVATE_PASSWORD_CANARY";
        let request = client.registration_start(password).unwrap();
        let response = server.registration_start(&request).unwrap();
        let upload = client.registration_finish(password, &response).unwrap();
        server.registration_finish(&upload).unwrap();
        assert!(!server.record_contains(password.as_bytes()));
        let request = client.login_start(password).unwrap();
        let response = server.login_start(&request, true).unwrap();
        let proof = client.login_finish(password, &response).unwrap();
        assert!(proof.export_key_matches && proof.server_key_matches);
        assert!(
            server
                .login_finish(&proof.message, &proof.session_tag)
                .unwrap()
        );
        assert!(
            server
                .login_finish(&proof.message, &proof.session_tag)
                .is_err()
        );
        let request = client.login_start("wrong password").unwrap();
        let response = server.login_start(&request, true).unwrap();
        assert!(client.login_finish("wrong password", &response).is_err());
    }
}
