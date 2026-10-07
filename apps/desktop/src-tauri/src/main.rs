// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
