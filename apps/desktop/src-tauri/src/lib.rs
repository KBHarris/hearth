//! Desktop shell. The UI is the shared React client (`apps/client`); this crate adds the
//! native pieces: OS keystore, SQLCipher store, notifications, and auto-update (Phase 1+).

pub mod message_store;
#[cfg(feature = "phase0-spike")]
pub mod phase0;
#[cfg(feature = "phase1-acceptance")]
pub mod phase1;
pub mod vault_store;

/// Protocol version compiled into the native core, so the UI can detect a mismatched build.
#[tauri::command]
#[cfg(not(feature = "phase0-spike"))]
fn protocol_version() -> u32 {
    hearth_proto::PROTOCOL_VERSION
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(feature = "phase0-spike"))]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            vault_store::identity_vault_read,
            vault_store::identity_vault_create,
            message_store::message_store_read,
            message_store::message_store_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Hearth desktop app");
}
