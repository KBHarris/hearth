//! Versioned product OPAQUE profile. No I/O, passwords on the wire, or bearer tokens.
use argon2::{Algorithm, Argon2, Params, Version};
use opaque_ke::*;
use rand_core::OsRng;
use zeroize::Zeroize;

pub const PROFILE: &str = "hearth-opaque-r255-sha512-argon2id-m19456-t2-p1-v1";
const CONTEXT: &[u8] = b"hearth/auth/opaque/v1";
const ERROR: &str = "Authentication exchange rejected";

pub struct Suite;
impl CipherSuite for Suite {
    type OprfCs = Ristretto255;
    type KeyExchange = TripleDh<Ristretto255, sha2::Sha512>;
    type Ksf = Argon2<'static>;
}

fn ksf() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19456, 2, 1, None).expect("fixed profile"),
    )
}
fn wire(value: &str) -> Result<Vec<u8>, String> {
    if value.len() > 4096 {
        return Err(ERROR.into());
    }
    hex::decode(value).map_err(|_| ERROR.into())
}
fn identifiers<'a>(username: &'a str, server_id: &'a str) -> Identifiers<'a> {
    Identifiers {
        client: Some(username.as_bytes()),
        server: Some(server_id.as_bytes()),
    }
}

#[derive(Default)]
pub struct Client {
    registration: Option<ClientRegistration<Suite>>,
    login: Option<ClientLogin<Suite>>,
    // Client-only, retained until the local vault is opened. Never serialized or exported.
    export_key: Option<zeroize::Zeroizing<Vec<u8>>>,
}
impl Client {
    pub fn registration_start(&mut self, password: &str) -> Result<String, String> {
        self.registration = None;
        self.login = None;
        self.export_key = None;
        let result = ClientRegistration::<Suite>::start(&mut OsRng, password.as_bytes())
            .map_err(|_| ERROR)?;
        self.registration = Some(result.state);
        Ok(hex::encode(result.message.serialize()))
    }
    pub fn registration_finish(
        &mut self,
        password: &str,
        response: &str,
        username: &str,
        server_id: &str,
    ) -> Result<String, String> {
        let state = self.registration.take().ok_or(ERROR)?;
        let response = RegistrationResponse::deserialize(&wire(response)?).map_err(|_| ERROR)?;
        let mut result = state
            .finish(
                &mut OsRng,
                password.as_bytes(),
                response,
                ClientRegistrationFinishParameters::new(
                    identifiers(username, server_id),
                    Some(&ksf()),
                ),
            )
            .map_err(|_| ERROR)?;
        result.export_key.zeroize();
        Ok(hex::encode(result.message.serialize()))
    }
    pub fn login_start(&mut self, password: &str) -> Result<String, String> {
        self.login = None;
        self.export_key = None;
        let result =
            ClientLogin::<Suite>::start(&mut OsRng, password.as_bytes()).map_err(|_| ERROR)?;
        self.login = Some(result.state);
        Ok(hex::encode(result.message.serialize()))
    }
    pub fn login_finish(
        &mut self,
        password: &str,
        response: &str,
        username: &str,
        server_id: &str,
    ) -> Result<String, String> {
        let state = self.login.take().ok_or(ERROR)?;
        let response = CredentialResponse::deserialize(&wire(response)?).map_err(|_| ERROR)?;
        let mut result = state
            .finish(
                &mut OsRng,
                password.as_bytes(),
                response,
                ClientLoginFinishParameters::new(
                    Some(CONTEXT),
                    identifiers(username, server_id),
                    Some(&ksf()),
                ),
            )
            .map_err(|_| ERROR)?;
        self.export_key = Some(zeroize::Zeroizing::new(result.export_key.to_vec()));
        result.export_key.zeroize();
        result.session_key.zeroize();
        Ok(hex::encode(result.message.serialize()))
    }
    #[cfg(feature = "local-vault")]
    pub(crate) fn export_key(&self) -> Result<&[u8], String> {
        self.export_key
            .as_deref()
            .map(|key| key.as_slice())
            .ok_or_else(|| ERROR.into())
    }
    pub fn lock_export_key(&mut self) {
        self.export_key = None;
    }
    #[cfg(feature = "local-vault")]
    pub fn prepare_identity(
        &self,
        envelope: Option<&str>,
        account: &str,
        server: &str,
    ) -> Result<(crate::vault::LocalIdentity, String), String> {
        let key = self.export_key()?;
        let identity = match envelope {
            Some(envelope) => crate::vault::LocalIdentity::open(envelope, key, account, server)?,
            None => crate::vault::LocalIdentity::new(),
        };
        let sealed = match envelope {
            Some(envelope) => envelope.to_owned(),
            None => identity.seal(key, account, server)?,
        };
        Ok((identity, sealed))
    }
    #[cfg(feature = "local-vault")]
    pub fn wrap_identity(
        &self,
        identity: &crate::vault::LocalIdentity,
        account: &str,
        server: &str,
    ) -> Result<String, String> {
        identity.seal(self.export_key()?, account, server)
    }
}

pub struct Server {
    setup: ServerSetup<Suite>,
}
impl Default for Server {
    fn default() -> Self {
        Self {
            setup: ServerSetup::new(&mut OsRng),
        }
    }
}
impl Server {
    pub fn serialize(&self) -> Vec<u8> {
        self.setup.serialize().to_vec()
    }
    pub fn deserialize(bytes: &[u8]) -> Result<Self, String> {
        Ok(Self {
            setup: ServerSetup::deserialize(bytes).map_err(|_| ERROR)?,
        })
    }
    pub fn registration_start(&self, username: &str, message: &str) -> Result<String, String> {
        let request = RegistrationRequest::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let result = ServerRegistration::<Suite>::start(&self.setup, request, username.as_bytes())
            .map_err(|_| ERROR)?;
        Ok(hex::encode(result.message.serialize()))
    }
    pub fn registration_finish(message: &str) -> Result<Vec<u8>, String> {
        let upload = RegistrationUpload::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        Ok(ServerRegistration::<Suite>::finish(upload)
            .serialize()
            .to_vec())
    }
    pub fn login_start(
        &self,
        username: &str,
        server_id: &str,
        record: Option<&[u8]>,
        message: &str,
    ) -> Result<(String, Vec<u8>), String> {
        let request = CredentialRequest::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let record = record
            .map(ServerRegistration::<Suite>::deserialize)
            .transpose()
            .map_err(|_| ERROR)?;
        let result = ServerLogin::<Suite>::start(
            &mut OsRng,
            &self.setup,
            record,
            request,
            username.as_bytes(),
            ServerLoginParameters {
                context: Some(CONTEXT),
                identifiers: identifiers(username, server_id),
            },
        )
        .map_err(|_| ERROR)?;
        Ok((
            hex::encode(result.message.serialize()),
            result.state.serialize().to_vec(),
        ))
    }
    pub fn login_finish(
        state: &[u8],
        username: &str,
        server_id: &str,
        message: &str,
    ) -> Result<(), String> {
        let state = ServerLogin::<Suite>::deserialize(state).map_err(|_| ERROR)?;
        let finalization =
            CredentialFinalization::deserialize(&wire(message)?).map_err(|_| ERROR)?;
        let mut result = state
            .finish(
                finalization,
                ServerLoginParameters {
                    context: Some(CONTEXT),
                    identifiers: identifiers(username, server_id),
                },
            )
            .map_err(|_| ERROR)?;
        result.session_key.zeroize();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_binding_persistence_and_one_use_client_state() {
        let mut client = Client::default();
        let server = Server::default();
        let password = "PHASE1_PASSWORD_CANARY_very_private";
        let request = client.registration_start(password).unwrap();
        let response = server.registration_start("owner", &request).unwrap();
        let upload = client
            .registration_finish(password, &response, "owner", "server-one")
            .unwrap();
        let record = Server::registration_finish(&upload).unwrap();
        assert!(
            !record
                .windows(password.len())
                .any(|bytes| bytes == password.as_bytes())
        );
        let server = Server::deserialize(&server.serialize()).unwrap();
        let request = client.login_start(password).unwrap();
        let (response, state) = server
            .login_start("owner", "server-one", Some(&record), &request)
            .unwrap();
        let proof = client
            .login_finish(password, &response, "owner", "server-one")
            .unwrap();
        assert!(
            client
                .login_finish(password, &response, "owner", "server-one")
                .is_err()
        );
        Server::login_finish(&state, "owner", "server-one", &proof).unwrap();
        for (password, id, username) in [
            ("wrong", "server-one", "owner"),
            (password, "other-server", "owner"),
            (password, "server-one", "other_user"),
        ] {
            let request = client.login_start(password).unwrap();
            let (response, _) = server
                .login_start("owner", "server-one", Some(&record), &request)
                .unwrap();
            assert!(
                client
                    .login_finish(password, &response, username, id)
                    .is_err()
            );
        }
    }
}
