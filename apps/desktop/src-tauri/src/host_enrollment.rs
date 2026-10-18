//! Owner enrollment is bound to the selected local host, never an arbitrary server URL.
use crate::hosting::{self, HostState, Selection};
use serde_json::Value;
use std::{io::Read, time::Duration};

fn enrollment_origin(input: &str, port: u16) -> Result<String, String> {
    let url = reqwest::Url::parse(input).map_err(|_| "Use the selected local server address.")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        || url.port_or_known_default() != Some(port)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Owner setup from this computer is available only for the selected local server. Connect to its local address first.".into());
    }
    Ok(format!("http://127.0.0.1:{port}"))
}
fn json(client: &reqwest::blocking::Client, url: String) -> Result<Value, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|_| "The local server did not respond. Start it and retry.")?;
    if !response.status().is_success() {
        return Err("The local server is not ready for owner setup.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read local server readiness.")?;
    if bytes.len() > 65536 {
        return Err("Invalid local server readiness response.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid local server readiness response.".into())
}
pub(crate) fn owner_code(
    selection: &Selection,
    server: &str,
    server_key: &str,
) -> Result<String, String> {
    let bundle = hosting::validate(&selection.root)?;
    let origin = enrollment_origin(
        server,
        hosting::local_port(selection, bundle.server.backend_port)?,
    )?;
    if server_key.len() != 64 || !server_key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Check the local server's identity before owner setup.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "Local readiness is unavailable.")?;
    let discovery = json(&client, format!("{origin}/.well-known/hearth"))?;
    if !discovery["server_key"]
        .as_str()
        .is_some_and(|key| key.eq_ignore_ascii_case(server_key))
    {
        return Err("The selected local host has a different identity. Check the server again; no setup code was retrieved.".into());
    }
    if json(&client, format!("{origin}/api/v1/setup"))?["setup_complete"] != false {
        return Err("This local server already has an owner, or its setup state is unavailable. Sign in instead.".into());
    }
    hosting::setup_code(selection)
}
#[tauri::command]
pub async fn host_owner_code(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HostState>,
    server: String,
    server_key: String,
) -> Result<String, String> {
    crate::vault_store::allowed(&window)?;
    let app = window.app_handle().clone();
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        owner_code(&hosting::selected(&app)?, &server, &server_key)
    })
    .await
    .map_err(|_| "Local owner setup is unavailable.".to_string())?
}

use tauri::Manager;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owner_setup_cannot_target_remote_or_wrong_local_endpoints() {
        for input in [
            "https://example.org",
            "http://192.168.1.2:8080",
            "http://localhost:8183",
            "http://user@localhost:8080",
            "http://localhost:8080/other",
            "http://localhost:8080/?code=secret",
            "http://localhost:8080/#secret",
            "https://localhost:8080",
        ] {
            assert!(enrollment_origin(input, 8080).is_err());
        }
        for input in [
            "http://localhost:8080",
            "http://127.0.0.1:8080/",
            "http://[::1]:8080",
        ] {
            assert_eq!(
                enrollment_origin(input, 8080).unwrap(),
                "http://127.0.0.1:8080"
            );
        }
    }

    #[test]
    #[ignore = "Requires the signed disposable Docker fixture from verify-host-controls.mjs --owner-only"]
    fn managed_owner_enrollment() {
        let root = std::path::PathBuf::from(std::env::var("HEARTH_HOST_TEST_DIR").unwrap())
            .canonicalize()
            .unwrap();
        let bundle = hosting::validate(&root).unwrap();
        assert!(bundle.server.compose_project.starts_with("hearth-host-"));
        let selection = Selection {
            root: root.clone(),
            https: false,
            project: bundle.server.compose_project,
            public_address: None,
        };
        struct Cleanup<'a>(&'a Selection);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = hosting::compose_recovery(
                    self.0,
                    &["down", "--volumes", "--remove-orphans"],
                    90,
                );
            }
        }
        let existing = hosting::command(
            "docker",
            &[
                "volume".into(),
                "ls".into(),
                "-q".into(),
                "--filter".into(),
                format!("label=com.docker.compose.project={}", selection.project),
            ],
            &root,
            20,
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&existing).trim().is_empty());
        let _cleanup = Cleanup(&selection);
        hosting::control(&selection, "start").unwrap();
        let origin = format!("http://localhost:{}", bundle.server.backend_port);
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap();
        let discovery = json(&client, format!("{origin}/.well-known/hearth")).unwrap();
        let key = discovery["server_key"].as_str().unwrap();
        assert!(owner_code(&selection, "https://example.org", key).is_err());
        assert!(
            owner_code(&selection, &origin, &"0".repeat(64))
                .unwrap_err()
                .contains("different identity")
        );
        let code = owner_code(&selection, &origin, key).unwrap();
        assert_eq!(code, hosting::setup_code(&selection).unwrap());
        hosting::compose(
            &selection,
            &[
                "exec",
                "-T",
                "postgres",
                "psql",
                "-U",
                "hearth",
                "-d",
                "hearth",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "INSERT INTO instance_settings (key,value) VALUES ('setup_complete','true'::jsonb)",
            ],
            20,
        )
        .unwrap();
        assert!(
            owner_code(&selection, &origin, key)
                .unwrap_err()
                .contains("already has an owner")
        );
        hosting::control(&selection, "stop").unwrap();
        assert!(owner_code(&selection, &origin, key).is_err());
        std::fs::write(root.join("native-report.json"), serde_json::json!({"outcome":"pass","checks":{"remote_destination_cannot_retrieve_local_owner_code":true,"changed_server_identity_is_rejected":true,"matching_fresh_local_host_retrieves_exact_owner_code":true,"completed_owner_setup_is_rejected":true,"stopped_host_has_bounded_retryable_failure":true}}).to_string()).unwrap();
    }
}
