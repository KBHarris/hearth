//! Desktop shell. The UI is the shared React client (`apps/client`); this crate adds the
//! native pieces: OS keystore, SQLCipher store, notifications, and auto-update (Phase 1+).

#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_backup;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_configuration;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_enrollment;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_package;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_runtime;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod host_startup;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod hosting;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod invite_links;
pub mod message_store;
#[cfg(feature = "phase0-spike")]
pub mod phase0;
#[cfg(feature = "phase1-acceptance")]
pub mod phase1;
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
mod updates;
pub mod vault_store;

/// Protocol version compiled into the native core, so the UI can detect a mismatched build.
#[tauri::command]
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
fn protocol_version() -> u32 {
    hearth_proto::PROTOCOL_VERSION
}

#[tauri::command]
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
fn build_revision() -> &'static str {
    option_env!("HEARTH_BUILD_COMMIT").unwrap_or("development")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
pub fn run() {
    use tauri::Manager;
    use tauri_plugin_deep_link::DeepLinkExt;

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--host-autostart") {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(hosting::HostState::default())
        .manage(invite_links::PendingInvite::default())
        .setup(|app| {
            host_startup::resume(app.handle().clone());
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    app.state::<invite_links::PendingInvite>()
                        .receive(url.as_str());
                }
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle
                        .state::<invite_links::PendingInvite>()
                        .receive(url.as_str());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            build_revision,
            invite_links::take_invite_link,
            hosting::host_select,
            hosting::host_saved,
            host_package::host_prepare,
            host_runtime::host_runtime,
            host_startup::host_startup,
            hosting::host_control,
            hosting::host_setup_code,
            host_enrollment::host_owner_code,
            hosting::host_configure,
            updates::desktop_update,
            updates::server_update,
            host_backup::host_rollback,
            host_backup::host_backup_export,
            host_backup::host_backup_import,
            vault_store::identity_vault_read,
            vault_store::identity_vault_create,
            message_store::message_store_read,
            message_store::message_store_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Hearth desktop app");
}
