// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "phase1-storage-test")]
    if std::env::args().nth(1).as_deref() == Some("--verify-local-vault-read") {
        match hearth_desktop_lib::vault_store::verify_child_read(
            &std::env::args().nth(2).unwrap_or_default(),
        ) {
            Ok(()) => {}
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    #[cfg(feature = "phase1-storage-test")]
    if std::env::args().any(|arg| arg == "--verify-local-vault") {
        match hearth_desktop_lib::vault_store::verify_real_store() {
            Ok(()) => println!("OS_KEYSTORE: pass; create/read/preserve-existing/cleanup"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    #[cfg(feature = "phase0-spike")]
    if std::env::args().any(|arg| arg == "--phase0-spike") {
        hearth_desktop_lib::phase0::run();
        return;
    }
    #[cfg(feature = "mls-spike")]
    if std::env::args().any(|arg| arg == "--mls-spike") {
        match hearth_crypto::mls_spike::run() {
            Ok(report) => println!(
                "{}",
                serde_json::to_string(&report).expect("report serializes")
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    #[cfg(not(feature = "phase0-spike"))]
    hearth_desktop_lib::run();
    #[cfg(feature = "phase0-spike")]
    {
        eprintln!("This diagnostic build requires --phase0-spike or --mls-spike.");
        std::process::exit(2);
    }
}
