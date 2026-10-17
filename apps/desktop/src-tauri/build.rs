fn main() {
    println!("cargo:rerun-if-env-changed=HEARTH_BUILD_COMMIT");
    if std::env::var_os("CARGO_FEATURE_PHASE1_ACCEPTANCE").is_some() {
        assert!(
            std::path::Path::new("../../client/dist/phase1.html").is_file(),
            "Build the acceptance page with HEARTH_PHASE1_HARNESS=1 before building phase1-acceptance."
        );
    }
    tauri_build::build()
}
