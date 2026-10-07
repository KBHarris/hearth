//! Opt-in bundled webview acceptance harness. No product commands or device capture.
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn phase0_mls() -> Result<hearth_crypto::mls_spike::MlsSpikeReport, String> {
    println!("Phase 0: native MLS invoked from webview");
    hearth_crypto::mls_spike::run()
}

#[tauri::command]
fn phase0_finish(app: tauri::AppHandle, report: serde_json::Value) {
    // The bundled harness prints outcomes only, never keys, tokens, or transcripts.
    let pass = report["outcome"] == "pass";
    println!("HEARTH_PHASE0_REPORT={report}");
    app.state::<AtomicBool>().store(true, Ordering::SeqCst);
    app.exit(if pass { 0 } else { 1 });
}

pub fn run() {
    tauri::Builder::default()
        .manage(AtomicBool::new(false))
        .invoke_handler(tauri::generate_handler![phase0_mls, phase0_finish])
        .setup(|app| {
            let builder =
                WebviewWindowBuilder::new(app, "phase0", WebviewUrl::App("index.html".into()))
                    .title("Hearth Phase 0 acceptance")
                    .visible(false)
                    .initialization_script("window.__HEARTH_DESKTOP_SPIKE__ = true;")
                    .on_page_load(|_, _| println!("Phase 0: bundled page load event"))
                    .on_navigation(|url| {
                        (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                    });
            // Generated audio has no human click in the CLI harness. This test-only
            // policy does not validate normal autoplay or device permissions.
            #[cfg(target_os = "windows")]
            let builder =
                builder.additional_browser_args("--autoplay-policy=no-user-gesture-required");
            builder.build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(90));
                if !handle.state::<AtomicBool>().load(Ordering::SeqCst) {
                    eprintln!("Phase 0 webview timed out before reporting.");
                    handle.exit(124);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!("phase0/tauri.conf.json"))
        .expect("Phase 0 webview could not start");
}
