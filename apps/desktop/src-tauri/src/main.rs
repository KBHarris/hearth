// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "phase1-acceptance")]
    if std::env::args().any(|arg| arg == "--phase1-acceptance") {
        hearth_desktop_lib::phase1::run();
        return;
    }
    #[cfg(feature = "phase1-storage-test")]
    if std::env::args().nth(1).as_deref() == Some("--verify-message-store-read") {
        let result = hearth_desktop_lib::message_store::verify_child_read(
            &std::env::args().nth(2).unwrap_or_default(),
            std::path::Path::new(&std::env::args().nth(3).unwrap_or_default()),
        );
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    #[cfg(feature = "phase1-storage-test")]
    if std::env::args().any(|arg| arg == "--verify-message-store") {
        match hearth_desktop_lib::message_store::verify_real_store() {
            Ok(()) => println!(
                "SQLCIPHER_STORE: pass; create/read/new-process/CAS/wrong-key/canary/missing-key/cleanup"
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
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
    #[cfg(not(any(feature = "phase0-spike", feature = "phase1-acceptance")))]
    hearth_desktop_lib::run();
    #[cfg(any(feature = "phase0-spike", feature = "phase1-acceptance"))]
    {
        eprintln!("This diagnostic build requires its explicit acceptance argument.");
        std::process::exit(2);
    }
}
