//! Desktop shell. The UI is the shared React client (`apps/client`); this crate adds the
//! native pieces: OS keystore, SQLCipher store, notifications, and auto-update (Phase 1+).

/// Protocol version compiled into the native core, so the UI can detect a mismatched build.
#[tauri::command]
fn protocol_version() -> u32 {
    hearth_proto::PROTOCOL_VERSION
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![protocol_version])
        .run(tauri::generate_context!())
        .expect("error while running the Hearth desktop app");
}
