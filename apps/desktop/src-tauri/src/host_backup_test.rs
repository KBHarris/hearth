use super::*;
#[test]
#[ignore = "Requires a locally signed disposable package from verify-host-controls.mjs --integrity-only"]
fn managed_host_package_integrity() {
    let root = PathBuf::from(std::env::var("HEARTH_HOST_TEST_DIR").unwrap())
        .canonicalize()
        .unwrap();
    assert!(hosting::validate(&root).is_ok());
    let path = root.join("manifest.json");
    let original = fs::read(&path).unwrap();
    let mut changed = original.clone();
    changed.push(b' ');
    fs::write(&path, changed).unwrap();
    assert!(hosting::validate(&root).is_err());
    fs::write(&path, original).unwrap();
    let script = root.join("deploy/setup.mjs");
    let original = fs::read(&script).unwrap();
    fs::write(&script, b"modified").unwrap();
    assert!(hosting::validate(&root).is_err());
    fs::write(&script, original).unwrap();
    let signature = root.join("manifest.json.sig");
    let original = fs::read(&signature).unwrap();
    fs::remove_file(&signature).unwrap();
    assert!(hosting::validate(&root).is_err());
    fs::write(signature, original).unwrap();
    fs::write(root.join("native-report.json"),serde_json::json!({"outcome":"pass","checks":{"signed_host_package_validates":true,"modified_manifest_and_script_are_rejected":true,"unsigned_host_package_is_rejected":true}}).to_string()).unwrap();
}
struct Cleanup<'a> {
    selection: &'a Selection,
    image: Option<String>,
}
impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        let _ = hosting::compose_recovery(
            self.selection,
            &["down", "--volumes", "--remove-orphans", "--timeout", "10"],
            90,
        );
        if let Some(image) = &self.image {
            let _ = docker(self.selection, &["image", "rm", image], 30);
        }
    }
}
#[test]
#[ignore = "Requires the disposable Docker fixture prepared by verify-host-controls.mjs"]
fn managed_host_lifecycle_and_failed_update_restore() {
    let root = PathBuf::from(
        std::env::var("HEARTH_HOST_TEST_DIR").expect("Use the local host acceptance runner"),
    )
    .canonicalize()
    .unwrap();
    let data = root.join("private-app-data");
    let bundle = hosting::validate(&root).unwrap();
    assert!(bundle.server.compose_project.starts_with("hearth-host-"));
    let selection = Selection {
        root: root.clone(),
        https: false,
        project: bundle.server.compose_project.clone(),
        public_address: None,
    };
    let existing = docker(
        &selection,
        &[
            "volume",
            "ls",
            "-q",
            "--filter",
            &format!("label=com.docker.compose.project={}", selection.project),
        ],
        20,
    )
    .unwrap();
    assert!(
        String::from_utf8_lossy(&existing).trim().is_empty(),
        "Refuse to reuse existing host data"
    );
    let mut cleanup = Cleanup {
        selection: &selection,
        image: None,
    };
    assert_eq!(
        serde_json::to_value(hosting::control(&selection, "start").unwrap()).unwrap()["state"],
        "running"
    );
    hosting::compose(&selection, &["exec", "-T", "postgres", "psql", "-U", "hearth", "-d", "hearth", "-v", "ON_ERROR_STOP=1", "-c", "CREATE TABLE host_restore_probe (ciphertext TEXT); INSERT INTO host_restore_probe VALUES ('0123456789abcdef');"], 20).unwrap();
    let identity = hosting::compose(
        &selection,
        &["exec", "-T", "server", "hearth-server", "--setup-code"],
        20,
    )
    .unwrap();
    assert_eq!(String::from_utf8_lossy(&identity).trim().len(), 64);
    let original = fs::read(root.join("deploy/compose.yaml")).unwrap();
    fs::write(root.join("deploy/compose.yaml"), b"tampered").unwrap();
    assert!(hosting::control(&selection, "start").is_err());
    fs::write(root.join("deploy/compose.yaml"), original).unwrap();
    let original_manifest = fs::read(root.join("manifest.json")).unwrap();
    let mut altered_manifest = original_manifest.clone();
    altered_manifest.push(b' ');
    fs::write(root.join("manifest.json"), altered_manifest).unwrap();
    assert!(hosting::control(&selection, "start").is_err());
    fs::write(root.join("manifest.json"), original_manifest).unwrap();
    let tag = format!(
        "hearth-backup-failure:{}",
        selection.project.trim_start_matches("hearth-host-")
    );
    let context = root.join("failure-image");
    fs::create_dir(&context).unwrap();
    let script = r#"printf invalid > /var/lib/hearth/server.key; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE host_restore_probe SET ciphertext='changed'"; exit 1"#;
    let entrypoint = serde_json::to_string(&["/bin/sh", "-c", script]).unwrap();
    fs::write(context.join("Dockerfile"), format!("FROM postgres:17-alpine\nUSER 0\nHEALTHCHECK --interval=1s --timeout=1s --retries=1 CMD exit 1\nENTRYPOINT {entrypoint}\n")).unwrap();
    let bad_image = docker(
        &selection,
        &["build", "--quiet", "--tag", &tag, context.to_str().unwrap()],
        90,
    )
    .unwrap();
    let bad_image = String::from_utf8(bad_image).unwrap().trim().to_string();
    cleanup.image = Some(tag);
    // Internal coordinator fault injection: production callers verify signatures first.
    let signed = SignedRelease {
        manifest: "{}".into(),
        signature: "invalid-test-only-signature".into(),
    };
    let release = ServerRelease {
        schema: 1,
        version: "0.0.0".into(),
        min_client_version: "0.0.0".into(),
        source_commit: "0".repeat(40),
        image_id: bad_image,
        archive_url: String::new(),
        archive_sha256: "0".repeat(64),
    };
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let reader_seen = seen.clone();
    let reader_selection = Selection {
        root: selection.root.clone(),
        https: false,
        project: selection.project.clone(),
        public_address: None,
    };
    let observer = std::thread::spawn(move || {
        while !reader_stop.load(Ordering::SeqCst) {
            if let Ok(value) = hosting::compose(
                &reader_selection,
                &[
                    "exec",
                    "-T",
                    "postgres",
                    "psql",
                    "-U",
                    "hearth",
                    "-d",
                    "hearth",
                    "-t",
                    "-A",
                    "-c",
                    "SELECT ciphertext FROM host_restore_probe",
                ],
                20,
            ) && String::from_utf8_lossy(&value).trim() == "changed"
            {
                reader_seen.store(true, Ordering::SeqCst);
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
    let result = apply_with_data(&data, &selection, &signed, &release);
    stop.store(true, Ordering::SeqCst);
    observer.join().unwrap();
    let error = result.unwrap_err();
    assert!(
        error.contains("previous server and its verified data backup were restored"),
        "{error}"
    );
    assert!(
        seen.load(Ordering::SeqCst),
        "The failing update must change its database before rollback"
    );
    let restored = hosting::compose(
        &selection,
        &[
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "hearth",
            "-d",
            "hearth",
            "-t",
            "-A",
            "-c",
            "SELECT ciphertext FROM host_restore_probe",
        ],
        20,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&restored).trim(),
        "0123456789abcdef"
    );
    assert_eq!(
        hosting::compose(
            &selection,
            &["exec", "-T", "server", "hearth-server", "--setup-code"],
            20
        )
        .unwrap(),
        identity
    );
    assert!(!root.join("deploy/host-update.json").exists());
    let directory: PathBuf =
        serde_json::from_slice(&fs::read(data.join("last-host-backup.json")).unwrap()).unwrap();
    let backup: Backup =
        serde_json::from_slice(&fs::read(directory.join("backup.json")).unwrap()).unwrap();
    fs::write(
        root.join("deploy/compose.runtime.json"),
        b"invalid interrupted update",
    )
    .unwrap();
    restore(&selection, &directory, &backup).unwrap();
    assert!(hosting::validate(&root).is_ok());
    assert_eq!(
        serde_json::to_value(hosting::control(&selection, "stop").unwrap()).unwrap()["state"],
        "stopped"
    );
    assert_eq!(
        serde_json::to_value(hosting::control(&selection, "start").unwrap()).unwrap()["state"],
        "running"
    );
    let report = serde_json::json!({"outcome":"pass","checks":{"native_start_stop_status_and_setup_code":true,"modified_bundle_rejected":true,"backup_database_restore_rehearsal_and_identity_check":true,"failed_new_server_restores_database_and_original_identity":true,"interrupted_override_can_be_recovered":true,"only_disposable_project_resources_used":true}});
    fs::write(root.join("native-report.json"), report.to_string()).unwrap();
}
