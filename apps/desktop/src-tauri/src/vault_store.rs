//! OS credential store for password-wrapped identity envelopes. No plaintext fallback.
use keyring::{Entry, Error};
use std::{fs::OpenOptions, path::Path};
use tauri::Manager;

const SERVICE: &str = "chat.hearth.identity.v1";
const UNAVAILABLE: &str =
    "Your system key store is unavailable or locked. Unlock it and try again.";
fn valid_scope(scope: &str) -> bool {
    scope.len() == 129
        && scope.as_bytes()[64] == b':'
        && scope
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 64 || b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_envelope(value: &str) -> bool {
    value.len() == 274
        && value.starts_with("01")
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn read(entry: &Entry) -> Result<Option<String>, String> {
    match entry.get_secret() {
        Ok(bytes) => {
            let value = String::from_utf8(bytes).map_err(|_| {
                "The saved identity is damaged. Preserve it for recovery.".to_owned()
            })?;
            if !valid_envelope(&value) {
                return Err("The saved identity is damaged. Preserve it for recovery.".into());
            }
            Ok(Some(value))
        }
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(UNAVAILABLE.into()),
    }
}
fn store(
    directory: &Path,
    service: &str,
    scope: &str,
    envelope: Option<&str>,
) -> Result<Option<String>, String> {
    if !valid_scope(scope) || envelope.is_some_and(|value| !valid_envelope(value)) {
        return Err("Invalid identity storage request.".into());
    }
    std::fs::create_dir_all(directory).map_err(|_| UNAVAILABLE)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(scope.replace(':', "-")))
        .map_err(|_| UNAVAILABLE)?;
    lock.lock().map_err(|_| UNAVAILABLE)?;
    // Filesystem lock covers multiple app processes. Only the OS store holds the envelope.
    let entry = Entry::new(service, scope).map_err(|_| UNAVAILABLE)?;
    if let Some(saved) = read(&entry)? {
        return Ok(Some(saved));
    }
    if let Some(envelope) = envelope {
        entry
            .set_secret(envelope.as_bytes())
            .map_err(|_| UNAVAILABLE)?;
        return read(&entry);
    }
    Ok(None)
}
pub(crate) fn allowed(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| UNAVAILABLE)?;
    let bundled = matches!(url.scheme(), "tauri" | "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "tauri.localhost"))
        && (url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"));
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(5173);
    if window.label() != "main" || !(bundled || dev) {
        return Err("Identity storage is available only to the Hearth client.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn identity_vault_read(
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Option<String>, String> {
    allowed(&window)?;
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| UNAVAILABLE)?
        .join("identity-locks");
    let (directory, service) = (directory, SERVICE);
    #[cfg(feature = "phase1-acceptance")]
    let (directory, service, lease) =
        match crate::phase1::storage_context(&window, &scope, "identity")? {
            Some((directory, service, lease)) => (directory, service, Some(lease)),
            None => (directory, service, None),
        };
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "phase1-acceptance")]
        let _lease = lease;
        store(&directory, service, &scope, None)
    })
    .await
    .map_err(|_| UNAVAILABLE)?
}
#[tauri::command]
pub async fn identity_vault_create(
    window: tauri::WebviewWindow,
    scope: String,
    envelope: String,
) -> Result<String, String> {
    allowed(&window)?;
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| UNAVAILABLE)?
        .join("identity-locks");
    let (directory, service) = (directory, SERVICE);
    #[cfg(feature = "phase1-acceptance")]
    let (directory, service, lease) =
        match crate::phase1::storage_context(&window, &scope, "identity")? {
            Some((directory, service, lease)) => (directory, service, Some(lease)),
            None => (directory, service, None),
        };
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "phase1-acceptance")]
        let _lease = lease;
        store(&directory, service, &scope, Some(&envelope))
    })
    .await
    .map_err(|_| UNAVAILABLE)?
    .and_then(|value| value.ok_or_else(|| UNAVAILABLE.into()))
}

#[cfg(feature = "phase1-storage-test")]
pub fn verify_real_store() -> Result<(), String> {
    // Dedicated disposable service; never address production credentials.
    let service = "chat.hearth.phase1-storage-test";
    let scope = format!(
        "{}:{}",
        hearth_crypto::IdentityKey::generate().public().to_hex(),
        hearth_crypto::IdentityKey::generate().public().to_hex()
    );
    let directory =
        std::env::temp_dir().join(format!("hearth-keyring-test-{}", std::process::id()));
    let entry = Entry::new(service, &scope).map_err(|_| UNAVAILABLE)?;
    let value = format!("01{}", "ab".repeat(136));
    let alternate = format!("01{}", "cd".repeat(136));
    if read(&entry)?.is_some() {
        return Err("Test credential unexpectedly exists; preserved.".into());
    }
    let result = (|| {
        assert_eq!(
            store(&directory, service, &scope, Some(&value))?,
            Some(value.clone())
        );
        assert_eq!(
            store(&directory, service, &scope, Some(&alternate))?,
            Some(value.clone())
        );
        assert_eq!(store(&directory, service, &scope, None)?, Some(value));
        let mut child =
            std::process::Command::new(std::env::current_exe().map_err(|_| UNAVAILABLE)?);
        child.arg("--verify-local-vault-read").arg(&scope);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            child.creation_flags(0x08000000);
        }
        if !child.output().map_err(|_| UNAVAILABLE)?.status.success() {
            return Err("Identity did not persist across a new process.".into());
        }
        entry
            .set_secret(b"damaged-test-envelope")
            .map_err(|_| UNAVAILABLE)?;
        assert!(store(&directory, service, &scope, Some(&alternate)).is_err());
        assert_eq!(
            entry.get_secret().map_err(|_| UNAVAILABLE)?,
            b"damaged-test-envelope"
        );
        Ok(())
    })();
    // This entry is owned by this test invocation; no product deletion API is exposed.
    let cleanup = entry
        .delete_credential()
        .map_err(|_| UNAVAILABLE.to_owned());
    let _ = std::fs::remove_file(directory.join(scope.replace(':', "-")));
    let _ = std::fs::remove_dir(directory);
    result.and(cleanup)
}

#[cfg(feature = "phase1-storage-test")]
pub fn verify_child_read(scope: &str) -> Result<(), String> {
    if !valid_scope(scope) {
        return Err("Invalid test scope.".into());
    }
    let entry = Entry::new("chat.hearth.phase1-storage-test", scope).map_err(|_| UNAVAILABLE)?;
    if read(&entry)? != Some(format!("01{}", "ab".repeat(136))) {
        return Err("Test identity is unavailable.".into());
    }
    Ok(())
}
