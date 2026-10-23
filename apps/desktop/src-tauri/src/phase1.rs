//! Opt-in packaged-client acceptance. Fixture origins and storage are isolated.
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub struct Fixture {
    config: serde_json::Value,
    directory: PathBuf,
    scopes: Mutex<HashSet<(String, String)>>,
    finished: AtomicBool,
    operations: Arc<(Mutex<usize>, Condvar)>,
}
// A dropped page promise does not cancel a native blocking storage call. Keep
// fixture credentials/files alive until every such call has actually returned.
pub struct StorageLease(Arc<(Mutex<usize>, Condvar)>);
impl Drop for StorageLease {
    fn drop(&mut self) {
        let (count, changed) = &*self.0;
        if let Ok(mut count) = count.lock() {
            *count -= 1;
            changed.notify_all();
        }
    }
}
pub fn storage_context(
    window: &tauri::WebviewWindow,
    scope: &str,
    kind: &str,
) -> Result<Option<(PathBuf, &'static str, StorageLease)>, String> {
    let Some(fixture) = window.app_handle().try_state::<Fixture>() else {
        return Ok(None);
    };
    let mut count = fixture
        .operations
        .0
        .lock()
        .map_err(|_| "Fixture lock failed")?;
    if fixture.finished.load(Ordering::SeqCst) {
        return Err("Fixture has finished".into());
    }
    *count += 1;
    let lease = StorageLease(Arc::clone(&fixture.operations));
    drop(count);
    let server = fixture.config["serverKey"]
        .as_str()
        .ok_or("Invalid fixture")?;
    if !scope.starts_with(&format!("{server}:")) {
        return Err("Storage is outside the disposable fixture.".into());
    }
    let service = if kind == "identity" {
        "chat.hearth.phase1-webview-identity"
    } else {
        "chat.hearth.phase1-webview-messages"
    };
    let mut scopes = fixture.scopes.lock().map_err(|_| "Fixture lock failed")?;
    let key = (service.to_owned(), scope.to_owned());
    if !scopes.contains(&key) {
        let entry =
            keyring::Entry::new(service, scope).map_err(|_| "Fixture key store unavailable")?;
        if !matches!(entry.get_secret(), Err(keyring::Error::NoEntry)) {
            return Err("Unexpected existing fixture credential was preserved.".into());
        }
        scopes.insert(key);
    }
    Ok(Some((fixture.directory.join(kind), service, lease)))
}
fn cleanup(fixture: &Fixture) -> (bool, bool, bool) {
    let (count, changed) = &*fixture.operations;
    let Ok(count) = count.lock() else {
        return (false, false, false);
    };
    let Ok((count, timeout)) =
        changed.wait_timeout_while(count, std::time::Duration::from_secs(20), |count| {
            *count != 0
        })
    else {
        return (false, false, false);
    };
    if timeout.timed_out() && *count != 0 {
        return (false, false, false);
    }
    drop(count);
    let mut clean = true;
    if let Ok(scopes) = fixture.scopes.lock() {
        for (service, scope) in scopes.iter() {
            if let Ok(entry) = keyring::Entry::new(service, scope) {
                clean &= matches!(
                    entry.delete_credential(),
                    Ok(()) | Err(keyring::Error::NoEntry)
                );
            } else {
                clean = false;
            }
        }
    } else {
        clean = false;
    }
    // This fresh directory is generated and created here, never supplied by a page.
    (
        true,
        clean,
        std::fs::remove_dir_all(&fixture.directory).is_ok(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_preserves_files_until_native_storage_returns() {
        let directory = std::env::temp_dir().join(format!(
            "hearth-fixture-drain-{}",
            hearth_crypto::IdentityKey::generate().public().to_hex()
        ));
        std::fs::create_dir(&directory).unwrap();
        let operations = Arc::new((Mutex::new(1), Condvar::new()));
        let fixture = Fixture {
            config: serde_json::Value::Null,
            directory: directory.clone(),
            scopes: Mutex::new(HashSet::new()),
            finished: AtomicBool::new(true),
            operations: Arc::clone(&operations),
        };
        let worker = std::thread::spawn(move || {
            let lease = StorageLease(operations);
            std::thread::sleep(std::time::Duration::from_millis(50));
            let preserved = directory.is_dir();
            drop(lease);
            preserved
        });
        assert_eq!(cleanup(&fixture), (true, true, true));
        assert!(worker.join().unwrap());
        assert!(!fixture.directory.exists());
    }
}
#[tauri::command]
fn phase1_config(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    crate::vault_store::allowed(&window)?;
    Ok(window.app_handle().state::<Fixture>().config.clone())
}
#[tauri::command]
fn phase1_finish(window: tauri::WebviewWindow, report: serde_json::Value) -> Result<(), String> {
    crate::vault_store::allowed(&window)?;
    let fixture = window.app_handle().state::<Fixture>();
    let checks = report["checks"].as_object().ok_or("Invalid report")?;
    if checks.is_empty()
        || checks.len() > 32
        || checks.iter().any(|(name, value)| {
            name.len() > 80
                || !name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
                || !value.is_boolean()
        })
    {
        return Err("Invalid report".into());
    }
    if fixture.finished.swap(true, Ordering::SeqCst) {
        return Err("Fixture already finished".into());
    }
    let (drained, credentials_removed, files_removed) = cleanup(&fixture);
    let cleaned = drained && credentials_removed && files_removed;
    let pass = report["outcome"] == "pass" && checks.values().all(|value| value == true) && cleaned;
    // Only enumerated outcomes, never page error strings or credential data.
    println!(
        "HEARTH_PHASE1_REPORT={}",
        serde_json::json!({"outcome":if pass {"pass"}else{"fail"},"checks":checks,"fixture_storage_cleaned":cleaned,"fixture_cleanup":{"native_calls_drained":drained,"credentials_removed":credentials_removed,"files_removed":files_removed}})
    );
    window.app_handle().exit(if pass { 0 } else { 1 });
    Ok(())
}
pub fn run() {
    let path = std::env::var_os("HEARTH_PHASE1_FIXTURE_PATH")
        .expect("Disposable fixture configuration required");
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).expect("Fixture configuration missing"))
            .expect("Invalid fixture JSON");
    let origin = tauri::Url::parse(config["origin"].as_str().expect("Fixture origin missing"))
        .expect("Invalid fixture URL");
    assert!(
        origin.scheme() == "http"
            && origin.host_str() == Some("127.0.0.1")
            && origin.port().is_some()
            && origin.username().is_empty()
            && origin.password().is_none()
    );
    let server = config["serverKey"]
        .as_str()
        .expect("Fixture identity missing");
    assert!(
        server.len() == 64
            && server
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    );
    let directory = std::env::temp_dir().join(format!(
        "hearth-webview-{}",
        &hearth_crypto::IdentityKey::generate().public().to_hex()[..24]
    ));
    std::fs::create_dir(&directory).expect("Fresh fixture storage required");
    tauri::Builder::default()
        .manage(Fixture {
            config,
            directory,
            scopes: Mutex::new(HashSet::new()),
            finished: AtomicBool::new(false),
            operations: Arc::new((Mutex::new(0), Condvar::new())),
        })
        .invoke_handler(tauri::generate_handler![
            phase1_config,
            phase1_finish,
            crate::vault_store::identity_vault_read,
            crate::vault_store::identity_vault_create,
            crate::message_store::message_store_read,
            crate::message_store::message_store_write
        ])
        .setup(|app| {
            let direct_calls = app.state::<Fixture>().config["directCalls"].as_bool() == Some(true);
            let builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App(
                    if direct_calls {
                        "media-test.html"
                    } else {
                        "phase1.html"
                    }
                    .into(),
                ),
            )
            .title(if direct_calls {
                "Hearth direct call acceptance"
            } else {
                "Hearth Phase 1 acceptance"
            })
            .visible(false)
            .on_navigation(move |url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (direct_calls && url.scheme() == "data")
                    || (matches!(url.scheme(), "http" | "https")
                        && url.host_str() == Some("tauri.localhost"))
            });
            #[cfg(target_os = "macos")]
            let builder = builder
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
            builder.build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let duration = if handle.state::<Fixture>().config["phase3"].as_bool() == Some(true)
                {
                    410
                } else if handle.state::<Fixture>().config["voiceRooms"].as_bool() == Some(true) {
                    360
                } else {
                    180
                };
                std::thread::sleep(std::time::Duration::from_secs(duration));
                let fixture = handle.state::<Fixture>();
                if !fixture.finished.swap(true, Ordering::SeqCst) {
                    cleanup(&fixture);
                    handle.exit(124);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!("phase1/tauri.conf.json"))
        .expect("Phase 1 webview could not start");
}
