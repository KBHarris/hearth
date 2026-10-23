fn main() {
    println!("cargo:rerun-if-env-changed=HEARTH_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=HEARTH_DIRECT_CALL_HARNESS");
    if std::env::var_os("CARGO_FEATURE_PHASE1_ACCEPTANCE").is_some() {
        assert!(
            std::path::Path::new("../../client/dist/phase1.html").is_file(),
            "Build the acceptance page with HEARTH_PHASE1_HARNESS=1 before building phase1-acceptance."
        );
    }
    if std::env::var("HEARTH_DIRECT_CALL_HARNESS").as_deref() == Ok("1") {
        assert!(
            std::env::var_os("CARGO_FEATURE_PHASE1_ACCEPTANCE").is_some()
                && std::path::Path::new("../../client/dist/media-test.html").is_file(),
            "Native call acceptance requires phase1-acceptance and its explicit frontend build."
        );
    }
    tauri_build::build()
}
