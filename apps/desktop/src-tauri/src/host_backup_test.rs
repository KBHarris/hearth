use super::*;
#[test]
fn backup_volume_rejects_links_before_restoring_any_data() {
    let directory =
        std::env::temp_dir().join(format!("hearth-backup-safety-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join("volume.tar");
    let mut builder = tar::Builder::new(fs::File::create(&file).unwrap());
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o600);
    header.set_link_name("/backup/.env").unwrap();
    header.set_cksum();
    builder
        .append_data(&mut header, "./escape", std::io::empty())
        .unwrap();
    builder.finish().unwrap();
    drop(builder);
    assert!(
        validate_volume_archive(&file)
            .unwrap_err()
            .contains("Unsafe")
    );
    fs::remove_dir_all(directory).unwrap();
}
#[test]
#[ignore = "Requires a locally signed disposable package from verify-host-controls.mjs --integrity-only"]
fn managed_host_package_integrity() {
    let root = PathBuf::from(std::env::var("HEARTH_HOST_TEST_DIR").unwrap())
        .canonicalize()
        .unwrap();
    assert!(hosting::validate(&root).is_ok());
    let package_archive = root.join("prepared-host.tar");
    let mut builder = tar::Builder::new(fs::File::create(&package_archive).unwrap());
    let bundle = hosting::validate(&root).unwrap();
    for name in [
        "manifest.json",
        "manifest.json.sig",
        "deploy/compose.yaml",
        "deploy/compose.https.yaml",
        "deploy/setup.mjs",
        "deploy/.env.example",
        "deploy/Caddyfile",
        "deploy/storage-entrypoint.sh",
    ] {
        builder
            .append_path_with_name(root.join(name), name)
            .unwrap();
    }
    for name in bundle
        .files
        .keys()
        .filter(|name| crate::host_media::PUBLIC_FILES.contains(&name.as_str()))
    {
        builder
            .append_path_with_name(root.join(name), name)
            .unwrap();
    }
    for name in bundle
        .files
        .keys()
        .filter(|name| name.starts_with("Hearth_Server_Test_") && name.ends_with(".tar"))
    {
        builder
            .append_path_with_name(root.join(name), name)
            .unwrap();
    }
    builder.finish().unwrap();
    drop(builder);
    let extracted = root.join("prepared-host");
    crate::host_package::extract(&package_archive, &extracted).unwrap();
    assert!(hosting::validate(&extracted).is_ok());
    assert!(!extracted.join("deploy/.env").exists());
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
    let mut report = serde_json::json!({"outcome":"pass","checks":{"signed_host_package_validates":true,"signed_host_tar_extracts_without_operator_configuration":true,"modified_manifest_and_script_are_rejected":true,"unsigned_host_package_is_rejected":true}});
    if bundle
        .files
        .contains_key(crate::host_media::PUBLIC_FILES[0])
    {
        for file in crate::host_media::PUBLIC_FILES {
            assert_eq!(
                fs::read(extracted.join(file)).unwrap(),
                fs::read(root.join(file)).unwrap()
            );
            let path = root.join(file);
            let original = fs::read(&path).unwrap();
            fs::write(&path, b"tampered media deployment").unwrap();
            assert!(hosting::validate(&root).is_err());
            fs::write(path, original).unwrap();
        }
        let selection = Selection {
            root: root.clone(),
            https: false,
            project: bundle.server.compose_project.clone(),
            public_address: None,
        };
        crate::host_media::configure(&selection).unwrap();
        let private = root.join("deploy/media/data");
        let before = fs::read(private.join(".env")).unwrap();
        crate::host_media::configure(&selection).unwrap();
        assert_eq!(before, fs::read(private.join(".env")).unwrap());
        let environment = String::from_utf8(before).unwrap();
        assert!(!environment.contains("/opt/data") && !environment.contains("\\\\?\\"));
        assert!(!crate::host_media::enabled(&root).unwrap());
        report["checks"]["signed_media_files_extract_and_tampering_is_rejected"] = true.into();
        report["checks"]["native_media_preparation_preserves_credentials_and_rebases_mounts"] =
            true.into();
    }
    fs::write(root.join("native-report.json"), report.to_string()).unwrap();
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
    let environment_path = root.join("deploy/.env");
    let storage_path = root.join("deploy/s3.json");
    let environment = fs::read(&environment_path).unwrap();
    let storage = fs::read(&storage_path).unwrap();
    fs::remove_file(&environment_path).unwrap();
    let error = hosting::control(&selection, "start").err().unwrap();
    assert!(error.contains("missing its original .env or s3.json"));
    assert!(
        !environment_path.exists(),
        "Never generate credentials over existing data"
    );
    assert_eq!(fs::read(&storage_path).unwrap(), storage);
    fs::write(&environment_path, &environment).unwrap();
    fs::remove_file(&storage_path).unwrap();
    assert!(hosting::control(&selection, "start").is_err());
    assert!(!storage_path.exists());
    assert_eq!(fs::read(&environment_path).unwrap(), environment);
    fs::write(&storage_path, &storage).unwrap();
    let changed = String::from_utf8(environment.clone())
        .unwrap()
        .lines()
        .map(|line| {
            if line.starts_with("POSTGRES_PASSWORD=") {
                format!("POSTGRES_PASSWORD={}", "0".repeat(64))
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(&environment_path, &changed).unwrap();
    let error = hosting::control(&selection, "start").err().unwrap();
    assert!(
        error.contains("could not verify this host folder's credentials"),
        "{error}"
    );
    assert!(!error.contains(&"0".repeat(64)));
    assert_eq!(fs::read_to_string(&environment_path).unwrap(), changed);
    assert_eq!(fs::read(&storage_path).unwrap(), storage);
    fs::write(&environment_path, &environment).unwrap();
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
    let media_dir = root.join("deploy/media/data");
    fs::create_dir_all(&media_dir).unwrap();
    let media_canary = "backup-private-media-credential-fixture";
    fs::write(media_dir.join(".env"),format!("HEARTH_SFU_CONFIG_PATH=/old/livekit.yaml\nHEARTH_TURN_CONFIG_PATH=/old/turnserver.conf\nHEARTH_SFU_API_SECRET={media_canary}\n")).unwrap();
    for (file, content) in [
        ("livekit.yaml", "keys: {}\n"),
        ("turnserver.conf", "no-tls\n"),
        ("settings.json", "{\"turnTls\":false}"),
        ("enabled.json", "false"),
    ] {
        fs::write(media_dir.join(file), content).unwrap();
    }
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
        host_archive_sha256: None,
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
    assert!(
        fs::read_to_string(media_dir.join(".env"))
            .unwrap()
            .contains(media_canary)
    );
    assert!(
        !fs::read_to_string(media_dir.join(".env"))
            .unwrap()
            .contains("/old/")
    );
    assert!(!crate::host_media::enabled(&root).unwrap());
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
    let fresh_data = root.join("fresh-machine-app-data");
    assert!(
        fresh_restore(&fresh_data, &directory)
            .unwrap_err()
            .contains("already has data")
    );
    let server_identity = hosting::compose(
        &selection,
        &[
            "exec",
            "-T",
            "server",
            "sha256sum",
            "/var/lib/hearth/server.key",
            "/var/lib/hearth/opaque.setup",
        ],
        20,
    )
    .unwrap();
    // Remove only this test's randomly named project, simulating a new machine's empty volumes.
    assert!(selection.project.starts_with("hearth-host-"));
    hosting::compose(&selection, &["down", "--volumes", "--timeout", "10"], 90).unwrap();
    let fresh = fresh_restore(&fresh_data, &directory).unwrap();
    assert_ne!(fresh.root, selection.root);
    assert_eq!(
        hosting::compose(
            &fresh,
            &[
                "exec",
                "-T",
                "server",
                "sha256sum",
                "/var/lib/hearth/server.key",
                "/var/lib/hearth/opaque.setup"
            ],
            20
        )
        .unwrap(),
        server_identity
    );
    assert_eq!(
        fs::read(fresh.root.join("deploy/.env")).unwrap(),
        fs::read(directory.join(".env")).unwrap()
    );
    let restored = hosting::compose(
        &fresh,
        &[
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "hearth",
            "-d",
            "hearth",
            "-tAc",
            "SELECT ciphertext FROM host_restore_probe",
        ],
        20,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&restored).trim(),
        "0123456789abcdef"
    );
    // Retry the same recovery journal without generating new credentials or identity.
    let retried = fresh_restore(&fresh_data, &directory).unwrap();
    assert_eq!(retried.root, fresh.root);
    let report = serde_json::json!({"outcome":"pass","checks":{"native_start_stop_status_and_setup_code":true,"missing_configuration_never_regenerates_credentials_over_existing_volumes":true,"wrong_database_credentials_are_rejected_without_changing_data_or_configuration":true,"original_configuration_retries_successfully":true,"modified_bundle_rejected":true,"backup_database_restore_rehearsal_and_identity_check":true,"failed_new_server_restores_database_and_original_identity":true,"interrupted_override_can_be_recovered":true,"fresh_restore_rejects_existing_host_data":true,"fresh_restore_preserves_identity_credentials_and_database":true,"fresh_restore_retry_reuses_recovery_journal":true,"private_media_credentials_restore_and_mount_paths_are_rebased":true,"only_disposable_project_resources_used":true}});
    fs::write(root.join("native-report.json"), report.to_string()).unwrap();
}
