//! Quiesced volume snapshots, a PostgreSQL restore rehearsal, and rollback.
use crate::{
    hosting::{self, HostState, Selection},
    updates::{ServerRelease, SignedRelease},
};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[cfg(test)]
#[path = "host_backup_test.rs"]
mod tests;

const DATA: [&str; 3] = ["postgres-data", "server-data", "storage-data"];
#[derive(Serialize, Deserialize)]
struct Backup {
    root: PathBuf,
    https: bool,
    image: String,
    hashes: BTreeMap<String, String>,
    runtime: Option<Vec<u8>>,
    release: Option<Vec<u8>>,
    #[serde(default)]
    public_address: Option<String>,
}
fn docker(selection: &Selection, args: &[&str], seconds: u64) -> Result<Vec<u8>, String> {
    hosting::command(
        "docker",
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        &selection.root,
        seconds,
    )
}
fn volume(selection: &Selection, suffix: &str) -> Result<String, String> {
    if !DATA.contains(&suffix)
        && !(selection.https && ["caddy-data", "caddy-config"].contains(&suffix))
    {
        return Err("Unknown host data volume.".into());
    }
    let name = format!("{}_{suffix}", selection.project);
    let project = docker(
        selection,
        &[
            "volume",
            "inspect",
            "--format",
            "{{index .Labels \"com.docker.compose.project\"}}",
            &name,
        ],
        20,
    )?;
    if String::from_utf8_lossy(&project).trim() != selection.project {
        return Err("Refusing to modify a volume outside the selected Hearth host.".into());
    }
    Ok(name)
}
fn bind(path: &Path) -> Result<String, String> {
    let text = path.to_str().ok_or("Backup path is unavailable.")?;
    #[cfg(windows)]
    let text = text.strip_prefix("\\\\?\\").unwrap_or(text);
    if text.contains([',', '\n', '\r']) {
        return Err("The backup path contains unsupported characters.".into());
    }
    Ok(format!("type=bind,src={text},dst=/backup"))
}
fn optional_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    hosting::regular(path)?;
    Ok(Some(
        fs::read(path).map_err(|_| "Cannot read the previous server release.")?,
    ))
}
fn restore_file(path: &Path, bytes: &Option<Vec<u8>>) -> Result<(), String> {
    if path.exists() {
        hosting::regular(path)?;
    }
    match bytes {
        Some(bytes) => fs::write(path, bytes)
            .map_err(|_| "Cannot restore the previous server release.".to_string()),
        None if path.exists() => fs::remove_file(path)
            .map_err(|_| "Cannot remove the server update override.".to_string()),
        None => Ok(()),
    }
}
struct Rehearsal<'a> {
    selection: &'a Selection,
    name: String,
    volumes: Vec<String>,
}
impl Drop for Rehearsal<'_> {
    fn drop(&mut self) {
        let _ = docker(self.selection, &["rm", "--force", &self.name], 30);
        for name in &self.volumes {
            let _ = docker(self.selection, &["volume", "rm", name], 20);
        }
    }
}
fn snapshot(data: &Path, selection: &Selection) -> Result<(PathBuf, Backup), String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let id = hex::encode(nonce);
    let directory = data.join("host-backups").join(&id);
    fs::create_dir_all(&directory).map_err(|_| "Cannot create the private host backup.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect the host backup.")?;
    }
    let mount = bind(&directory)?;
    let image_ref = String::from_utf8(hosting::compose(
        selection,
        &["images", "-q", "postgres"],
        20,
    )?)
    .map_err(|_| "Cannot identify the PostgreSQL runtime.")?
    .trim()
    .to_string();
    let image_digest = image_ref.strip_prefix("sha256:").unwrap_or(&image_ref);
    if !(12..=64).contains(&image_digest.len())
        || !image_digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Cannot identify the PostgreSQL runtime.".into());
    }
    let image = String::from_utf8(docker(
        selection,
        &["image", "inspect", "--format", "{{.Id}}", &image_ref],
        20,
    )?)
    .map_err(|_| "Cannot identify the PostgreSQL runtime.")?
    .trim()
    .to_string();
    if image.len() != 71
        || !image.starts_with("sha256:")
        || !image[7..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(
            "Cannot identify the PostgreSQL runtime. Start the host before updating it.".into(),
        );
    }
    let mut hashes = BTreeMap::new();
    let mut rehearsal = Rehearsal {
        selection,
        name: format!("hearth-backup-check-{id}"),
        volumes: Vec::new(),
    };
    let mut suffixes = DATA.to_vec();
    if selection.https {
        suffixes.extend(["caddy-data", "caddy-config"]);
    }
    for suffix in suffixes {
        let source = volume(selection, suffix)?;
        let source_mount = format!("type=volume,src={source},dst=/source,readonly");
        let script = format!("tar -cf /backup/{suffix}.tar -C /source .");
        docker(
            selection,
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--mount",
                &source_mount,
                "--mount",
                &mount,
                &image,
                "sh",
                "-c",
                &script,
            ],
            300,
        )?;
        let archive = format!("{suffix}.tar");
        hashes.insert(archive.clone(), hosting::sha256(&directory.join(&archive))?);
        let target = format!("hearth-backup-check-{id}-{suffix}");
        docker(
            selection,
            &[
                "volume",
                "create",
                "--label",
                "hearth.backup-rehearsal=true",
                &target,
            ],
            20,
        )?;
        rehearsal.volumes.push(target.clone());
        let target_mount = format!("type=volume,src={target},dst=/restore");
        let script = format!("tar -xf /backup/{suffix}.tar -C /restore");
        docker(
            selection,
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--mount",
                &target_mount,
                "--mount",
                &mount,
                &image,
                "sh",
                "-c",
                &script,
            ],
            300,
        )?;
        if suffix == "server-data" {
            let expected = docker(
                selection,
                &[
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--read-only",
                    "--mount",
                    &source_mount,
                    &image,
                    "sh",
                    "-c",
                    "cd /source && sha256sum server.key opaque.setup",
                ],
                20,
            )?;
            let restored_mount = format!("type=volume,src={target},dst=/source,readonly");
            let restored = docker(
                selection,
                &[
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--read-only",
                    "--mount",
                    &restored_mount,
                    &image,
                    "sh",
                    "-c",
                    "cd /source && sha256sum server.key opaque.setup",
                ],
                20,
            )?;
            if expected != restored {
                return Err(
                    "The restored server signing identity does not match. Update cancelled.".into(),
                );
            }
        }
    }
    let pg_mount = format!(
        "type=volume,src=hearth-backup-check-{id}-postgres-data,dst=/var/lib/postgresql/data"
    );
    docker(
        selection,
        &[
            "run",
            "-d",
            "--name",
            &rehearsal.name,
            "--network",
            "none",
            "--mount",
            &pg_mount,
            &image,
        ],
        30,
    )?;
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if docker(
            selection,
            &["exec", &rehearsal.name, "pg_isready", "-U", "hearth"],
            10,
        )
        .is_ok()
        {
            break;
        }
        if Instant::now() >= deadline {
            return Err(
                "The PostgreSQL backup did not pass its restore rehearsal. Update cancelled."
                    .into(),
            );
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    docker(
        selection,
        &[
            "exec",
            &rehearsal.name,
            "pg_dump",
            "-U",
            "hearth",
            "-d",
            "hearth",
            "--file=/tmp/hearth-restore-check.sql",
        ],
        300,
    )?;
    for file in [".env", "s3.json"] {
        let source = selection.root.join("deploy").join(file);
        hosting::regular(&source)?;
        fs::copy(&source, directory.join(file))
            .map_err(|_| "Cannot back up host configuration.")?;
        hashes.insert(file.to_string(), hosting::sha256(&directory.join(file))?);
    }
    let previous_image = crate::updates::runtime(&selection.root)?
        .map(|release| release.image_id)
        .unwrap_or(hosting::validate(&selection.root)?.server.image_id);
    let image_archive = directory.join("server-image.tar");
    docker(
        selection,
        &[
            "save",
            "--output",
            image_archive
                .to_str()
                .ok_or("Backup path is unavailable.")?,
            &previous_image,
        ],
        180,
    )?;
    hashes.insert("server-image.tar".into(), hosting::sha256(&image_archive)?);
    // Include the helper image and signed deployment package for a different machine.
    let helper_archive = directory.join("helper-image.tar");
    docker(
        selection,
        &[
            "save",
            "--output",
            helper_archive
                .to_str()
                .ok_or("Backup path is unavailable.")?,
            &image,
        ],
        180,
    )?;
    hashes.insert("helper-image.tar".into(), hosting::sha256(&helper_archive)?);
    if selection.root.join("deploy/media/data/.env").exists() {
        crate::host_media::directory(&selection.root)?;
        fs::create_dir_all(directory.join("media"))
            .map_err(|_| "Cannot back up private media settings.")?;
        for file in crate::host_media::PRIVATE_FILES {
            let source = selection.root.join("deploy/media/data").join(file);
            if source.exists() {
                hosting::regular(&source)?;
                let name = format!("media/{file}");
                fs::copy(&source, directory.join(&name))
                    .map_err(|_| "Cannot back up media credentials.")?;
                hashes.insert(name.clone(), hosting::sha256(&directory.join(name))?);
            }
        }
    }
    let package = directory.join("package");
    fs::create_dir_all(package.join("deploy")).map_err(|_| "Cannot prepare portable backup.")?;
    let bundle = hosting::validate(&selection.root)?;
    for file in [
        "manifest.json",
        "manifest.json.sig",
        "deploy/compose.yaml",
        "deploy/compose.https.yaml",
        "deploy/setup.mjs",
        "deploy/.env.example",
        "deploy/Caddyfile",
        "deploy/storage-entrypoint.sh",
    ]
    .into_iter()
    .chain(
        crate::host_media::PUBLIC_FILES
            .iter()
            .copied()
            .filter(|file| bundle.files.contains_key(*file)),
    ) {
        hosting::regular(&selection.root.join(file))?;
        fs::create_dir_all(package.join(file).parent().ok_or("Invalid package path.")?)
            .map_err(|_| "Cannot prepare portable media backup.")?;
        fs::copy(selection.root.join(file), package.join(file))
            .map_err(|_| "Cannot back up the signed deployment package.")?;
        hashes.insert(
            format!("package/{file}"),
            hosting::sha256(&package.join(file))?,
        );
    }
    // Keep the original signed base-image archive too, even after a server update.
    for (name, expected) in bundle.files.iter().filter(|(name, _)| {
        name.starts_with("Hearth_Server_Test_")
            && name.ends_with(".tar")
            && !name.contains(['/', '\\'])
    }) {
        if hosting::sha256(&selection.root.join(name))? != *expected {
            return Err("The base server image archive is damaged. Backup cancelled.".into());
        }
        fs::copy(selection.root.join(name), package.join(name))
            .map_err(|_| "Cannot back up the base server image.")?;
        hashes.insert(format!("package/{name}"), expected.clone());
    }
    let backup = Backup {
        root: selection.root.clone(),
        https: selection.https,
        image,
        hashes,
        runtime: optional_file(&selection.root.join("deploy/compose.runtime.json"))?,
        release: optional_file(&selection.root.join("deploy/host-update.json"))?,
        public_address: selection.public_address.clone(),
    };
    fs::write(
        directory.join("backup.json"),
        serde_json::to_vec(&backup).map_err(|_| "Cannot record the host backup.")?,
    )
    .map_err(|_| "Cannot record the host backup.")?;
    fs::write(
        data.join("last-host-backup.json"),
        serde_json::to_vec(&directory).map_err(|_| "Cannot record the host backup.")?,
    )
    .map_err(|_| "Cannot record the host backup.")?;
    Ok((directory, backup))
}
fn validate_backup(directory: &Path, backup: &Backup) -> Result<(), String> {
    for (file, expected) in &backup.hashes {
        if ![
            "postgres-data.tar",
            "server-data.tar",
            "storage-data.tar",
            "caddy-data.tar",
            "caddy-config.tar",
            "server-image.tar",
            ".env",
            "s3.json",
            "helper-image.tar",
        ]
        .contains(&file.as_str())
            && !portable_file(file)
        {
            return Err("Unknown backup file.".into());
        }
        if &hosting::sha256(&directory.join(file))? != expected {
            return Err("Backup checksum verification failed; host data was preserved.".into());
        }
    }
    if DATA
        .iter()
        .any(|suffix| !backup.hashes.contains_key(&format!("{suffix}.tar")))
    {
        return Err("Incomplete host backup.".into());
    }
    if !backup.hashes.contains_key("server-image.tar") {
        return Err("The rollback server image is missing.".into());
    }
    for file in [".env", "s3.json"] {
        if !backup.hashes.contains_key(file) {
            return Err("Host backup configuration is missing.".into());
        }
    }
    if !backup.image.starts_with("sha256:")
        || backup.image.len() != 71
        || !backup.image[7..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid backup helper image.".into());
    }
    // Inspect volume archives before starting Docker or stopping an existing host.
    for suffix in DATA.into_iter().chain(if backup.https {
        vec!["caddy-data", "caddy-config"]
    } else {
        vec![]
    }) {
        let name = format!("{suffix}.tar");
        if !backup.hashes.contains_key(&name) {
            return Err("Incomplete host backup.".into());
        }
        validate_volume_archive(&directory.join(name))?;
    }
    Ok(())
}
fn portable_file(file: &str) -> bool {
    if crate::host_media::PRIVATE_FILES
        .iter()
        .any(|name| file == format!("media/{name}"))
        || crate::host_media::PUBLIC_FILES
            .iter()
            .any(|name| file == format!("package/{name}"))
    {
        return true;
    }
    matches!(
        file,
        "package/manifest.json"
            | "package/manifest.json.sig"
            | "package/deploy/compose.yaml"
            | "package/deploy/compose.https.yaml"
            | "package/deploy/setup.mjs"
            | "package/deploy/.env.example"
            | "package/deploy/Caddyfile"
            | "package/deploy/storage-entrypoint.sh"
    ) || file
        .strip_prefix("package/Hearth_Server_Test_")
        .is_some_and(|s| s.ends_with(".tar") && !s.contains(['/', '\\', ':']) && !s.contains(".."))
}
fn validate_volume_archive(path: &Path) -> Result<(), String> {
    let mut archive =
        tar::Archive::new(fs::File::open(path).map_err(|_| "Cannot read backup volume.")?);
    let mut total = 0u64;
    let mut count = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| "Invalid backup volume archive.")?
    {
        let entry = entry.map_err(|_| "Invalid backup volume entry.")?;
        let path = entry.path().map_err(|_| "Invalid backup volume path.")?;
        let kind = entry.header().entry_type();
        count += 1;
        total = total
            .checked_add(entry.size())
            .ok_or("Oversized backup volume.")?;
        if count > 1_000_000
            || total > 64 * 1024 * 1024 * 1024
            || (!kind.is_file() && !kind.is_dir())
            || path.components().any(|c| {
                !matches!(
                    c,
                    std::path::Component::Normal(_) | std::path::Component::CurDir
                )
            })
            || path.to_string_lossy().contains(['\\', ':'])
        {
            return Err(
                "Unsafe or oversized backup volume archive. Host data was preserved.".into(),
            );
        }
    }
    Ok(())
}
fn restore(selection: &Selection, directory: &Path, backup: &Backup) -> Result<(), String> {
    if backup.root != selection.root || backup.https != selection.https {
        return Err("This backup belongs to another host configuration.".into());
    }
    validate_backup(directory, backup)?;
    docker(
        selection,
        &[
            "load",
            "--input",
            directory
                .join("server-image.tar")
                .to_str()
                .ok_or("Backup path is unavailable.")?,
        ],
        180,
    )?;
    let mount = bind(directory)?;
    // Remove containers first so no service can write during volume restoration.
    hosting::compose_recovery(
        selection,
        &["down", "--timeout", "30"],
        hosting::SHUTDOWN_TIMEOUT,
    )?;
    for file in backup.hashes.keys().filter(|file| {
        DATA.iter()
            .chain(["caddy-data", "caddy-config"].iter())
            .any(|suffix| **file == format!("{suffix}.tar"))
    }) {
        let suffix = file.trim_end_matches(".tar");
        let name = volume(selection, suffix)?;
        let target = format!("type=volume,src={name},dst=/restore");
        let script = format!(
            "find /restore -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} + && tar -xf /backup/{file} -C /restore"
        );
        docker(
            selection,
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--mount",
                &target,
                "--mount",
                &mount,
                &backup.image,
                "sh",
                "-c",
                &script,
            ],
            300,
        )?;
    }
    restore_file(
        &selection.root.join("deploy/compose.runtime.json"),
        &backup.runtime,
    )?;
    restore_file(
        &selection.root.join("deploy/host-update.json"),
        &backup.release,
    )?;
    for file in [".env", "s3.json"] {
        let target = selection.root.join("deploy").join(file);
        if target.exists() {
            hosting::regular(&target)?;
        }
        fs::copy(directory.join(file), target).map_err(|_| "Cannot restore host configuration.")?;
    }
    for file in backup
        .hashes
        .keys()
        .filter_map(|file| file.strip_prefix("package/"))
    {
        let target = selection.root.join(file);
        fs::create_dir_all(target.parent().ok_or("Invalid recovery path.")?)
            .map_err(|_| "Cannot restore deployment files.")?;
        if target.exists() {
            hosting::regular(&target)?;
        }
        fs::copy(directory.join("package").join(file), target)
            .map_err(|_| "Cannot restore the signed deployment package.")?;
    }
    crate::host_media::restore(&selection.root, directory, &backup.hashes)?;
    hosting::compose(
        selection,
        &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
        180,
    )?;
    Ok(())
}
pub fn apply(
    app: &tauri::AppHandle,
    selection: &Selection,
    signed: &SignedRelease,
    release: &ServerRelease,
) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|_| "Local backup storage is unavailable.")?;
    apply_with_data(&data, selection, signed, release)
}
pub(crate) fn apply_with_data(
    data: &Path,
    selection: &Selection,
    signed: &SignedRelease,
    release: &ServerRelease,
) -> Result<(), String> {
    let candidate = crate::host_package::update_candidate(data, release)?;
    hosting::compose(
        selection,
        &["stop", "--timeout", "30"],
        hosting::SHUTDOWN_TIMEOUT,
    )?;
    let (directory, backup) = match snapshot(data, selection) {
        Ok(backup) => backup,
        Err(error) => {
            let restarted = hosting::compose(
                selection,
                &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
                180,
            )
            .is_ok();
            return Err(format!(
                "{error} {}",
                if restarted {
                    "The previous server was restarted."
                } else {
                    "The previous server could not restart; use the host controls to retry."
                }
            ));
        }
    };
    let result = (|| {
        if let Some(candidate) = candidate.as_deref() {
            crate::host_package::install_candidate(candidate, selection)?;
        }
        let value = serde_json::json!({"services":{"server":{"image":release.image_id}}});
        fs::write(
            selection.root.join("deploy/compose.runtime.json"),
            value.to_string(),
        )
        .map_err(|_| "Cannot set the verified server image.")?;
        fs::write(
            selection.root.join("deploy/host-update.json"),
            serde_json::to_vec(signed).map_err(|_| "Cannot record the server release.")?,
        )
        .map_err(|_| "Cannot record the server release.")?;
        hosting::compose(
            selection,
            &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
            180,
        )?;
        Ok::<(), String>(())
    })();
    if result.is_err() {
        return match restore(selection, &directory, &backup) {
            Ok(()) => Err("The new server did not start. The previous server and its verified data backup were restored.".into()),
            Err(_) => Err(format!("The update and automatic rollback failed. Hosting is stopped to protect its data. Keep the verified backup at {} and use Restore last backup.", directory.display())),
        };
    }
    Ok(())
}
#[tauri::command]
pub async fn host_rollback(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
) -> Result<String, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let selection = hosting::selected_for_recovery(&app)?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|_| "Local backup storage is unavailable.")?;
        let path = data.join("last-host-backup.json");
        hosting::regular(&path)?;
        let directory: PathBuf =
            serde_json::from_slice(&fs::read(path).map_err(|_| "No host backup is available.")?)
                .map_err(|_| "Invalid host backup reference.")?;
        let canonical = directory
            .canonicalize()
            .map_err(|_| "The host backup is missing.")?;
        if !canonical.starts_with(
            data.join("host-backups")
                .canonicalize()
                .map_err(|_| "The host backup is missing.")?,
        ) {
            return Err("The host backup is outside app storage.".into());
        }
        let record = canonical.join("backup.json");
        hosting::regular(&record)?;
        let backup: Backup =
            serde_json::from_slice(&fs::read(record).map_err(|_| "Cannot read the host backup.")?)
                .map_err(|_| "Invalid host backup record.")?;
        restore(&selection, &canonical, &backup)?;
        Ok("Previous server and verified host data restored.".into())
    })
    .await
    .map_err(|_| "Host recovery is unavailable.".to_string())?
}

fn record(directory: &Path) -> Result<Backup, String> {
    let path = directory.join("backup.json");
    hosting::regular(&path)?;
    let bytes = fs::read(path).map_err(|_| "Cannot read the host backup.")?;
    if bytes.len() > 131072 {
        return Err("Host backup record is too large.".into());
    }
    let backup: Backup =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid host backup record.")?;
    validate_backup(directory, &backup)?;
    Ok(backup)
}
fn make_backup(data: &Path, selection: &Selection) -> Result<PathBuf, String> {
    hosting::compose(
        selection,
        &["stop", "--timeout", "30"],
        hosting::SHUTDOWN_TIMEOUT,
    )?;
    let result = snapshot(data, selection).map(|(directory, _)| directory);
    let restarted = hosting::compose(
        selection,
        &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
        180,
    );
    match (result, restarted) {
        (Ok(directory), Ok(_)) => Ok(directory),
        (Err(error), Ok(_)) => Err(format!("{error} The host was restarted.")),
        (result, Err(_)) => Err(format!(
            "{} The host could not restart; use Start server to retry. Data was preserved.",
            result.err().unwrap_or_else(|| "Backup completed.".into())
        )),
    }
}
#[tauri::command]
pub async fn host_backup_export(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
) -> Result<Option<String>, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let Some(folder) = app.dialog().file().set_title("Choose where to save the private server backup").blocking_pick_folder() else { return Ok(None); };
        let destination = folder.into_path().map_err(|_| "Choose a local backup folder.")?.canonicalize().map_err(|_| "Cannot open the backup folder.")?;
        let selection = hosting::selected(&app)?;
        let data = app.path().app_data_dir().map_err(|_| "Backup storage is unavailable.")?;
        let directory = make_backup(&data, &selection)?;
        let backup = record(&directory)?;
        let destination = destination.join(format!("Hearth_Backup_{}", directory.file_name().ok_or("Invalid backup path.")?.to_string_lossy()));
        fs::create_dir(&destination).map_err(|_| "The export folder already exists or cannot be created. Existing files were preserved.")?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&destination, fs::Permissions::from_mode(0o700)).map_err(|_| "Cannot protect the backup folder.")?; }
        for file in backup.hashes.keys().chain(std::iter::once(&"backup.json".to_string())) {
            let target = destination.join(file);
            fs::create_dir_all(target.parent().ok_or("Invalid backup path.")?).map_err(|_| "Cannot create export folder.")?;
            fs::copy(directory.join(file), &target).map_err(|_| "Cannot finish backup export. The private app backup is retained.")?;
        }
        record(&destination)?;
        Ok(Some(format!("Verified server backup saved to {}. Keep it private: it contains server keys, credentials and encrypted history. Stop the old host before using this backup on another computer.", destination.display())))
    }).await.map_err(|_| "Backup export is unavailable.".to_string())?
}

#[derive(Serialize, Deserialize)]
struct PendingRestore {
    root: PathBuf,
    backup: PathBuf,
    record_hash: String,
    project: String,
}
fn fresh_restore(data: &Path, directory: &Path) -> Result<Selection, String> {
    let mut backup = record(directory)?;
    if !backup.hashes.contains_key("helper-image.tar")
        || !backup.hashes.contains_key("package/manifest.json")
    {
        return Err("This older backup supports local rollback only. Export a new portable backup from the original host.".into());
    }
    let bundle = hosting::validate(&directory.join("package"))?;
    let pending_path = data.join("pending-host-restore.json");
    let record_hash = hosting::sha256(&directory.join("backup.json"))?;
    let pending = if pending_path.exists() {
        hosting::regular(&pending_path)?;
        let pending: PendingRestore = serde_json::from_slice(
            &fs::read(&pending_path).map_err(|_| "Cannot read restore recovery state.")?,
        )
        .map_err(|_| "Invalid restore recovery state.")?;
        if pending.backup != directory
            || pending.record_hash != record_hash
            || pending.project != bundle.server.compose_project
            || pending.root.parent() != Some(data.join("hosts").as_path())
        {
            return Err("Another restore is pending. Retry its original backup before importing a different server. Existing data was preserved.".into());
        }
        pending
    } else {
        // Both stopped containers and volumes count as an existing host. Never overwrite them.
        for kind in ["ps", "volume"] {
            let args = if kind == "ps" {
                vec![
                    "ps".into(),
                    "-a".into(),
                    "-q".into(),
                    "--filter".into(),
                    format!(
                        "label=com.docker.compose.project={}",
                        bundle.server.compose_project
                    ),
                ]
            } else {
                vec![
                    "volume".into(),
                    "ls".into(),
                    "-q".into(),
                    "--filter".into(),
                    format!(
                        "label=com.docker.compose.project={}",
                        bundle.server.compose_project
                    ),
                ]
            };
            let result = hosting::command("docker", &args, directory, 20)?;
            if !String::from_utf8_lossy(&result).trim().is_empty() {
                return Err("This computer already has data for that Hearth host. Restore onto a fresh computer; no existing containers or volumes were changed.".into());
            }
        }
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let root = data
            .join("hosts")
            .join(format!("restored-{}", hex::encode(nonce)));
        fs::create_dir_all(root.join("deploy"))
            .map_err(|_| "Cannot prepare fresh host storage.")?;
        let pending = PendingRestore {
            root,
            backup: directory.to_path_buf(),
            record_hash,
            project: bundle.server.compose_project,
        };
        fs::write(
            &pending_path,
            serde_json::to_vec(&pending).map_err(|_| "Cannot record restore recovery state.")?,
        )
        .map_err(|_| "Cannot record restore recovery state.")?;
        pending
    };
    // Validate the signed runtime override in the candidate directory before using Docker.
    for file in backup
        .hashes
        .keys()
        .filter_map(|file| file.strip_prefix("package/"))
    {
        fs::create_dir_all(
            pending
                .root
                .join(file)
                .parent()
                .ok_or("Invalid recovery path.")?,
        )
        .map_err(|_| "Cannot prepare media recovery.")?;
        fs::copy(
            directory.join("package").join(file),
            pending.root.join(file),
        )
        .map_err(|_| "Cannot prepare the signed recovery package.")?;
    }
    for file in [".env", "s3.json"] {
        fs::copy(directory.join(file), pending.root.join("deploy").join(file))
            .map_err(|_| "Cannot recover the original host credentials.")?;
    }
    restore_file(
        &pending.root.join("deploy/compose.runtime.json"),
        &backup.runtime,
    )?;
    restore_file(
        &pending.root.join("deploy/host-update.json"),
        &backup.release,
    )?;
    crate::host_media::restore(&pending.root, directory, &backup.hashes)?;
    hosting::validate(&pending.root)?;
    let selection = Selection {
        root: pending.root,
        https: backup.https,
        project: pending.project,
        public_address: backup.public_address.clone(),
    };
    for file in ["helper-image.tar", "server-image.tar"] {
        docker(
            &selection,
            &[
                "load",
                "--input",
                directory
                    .join(file)
                    .to_str()
                    .ok_or("Backup path is unavailable.")?,
            ],
            180,
        )?;
    }
    // Compose creates and labels empty volumes; it does not start the services yet.
    hosting::compose(&selection, &["create", "--no-build"], 180)?;
    backup.root = selection.root.clone();
    restore(&selection, directory, &backup)?;
    hosting::control(&selection, "status")?;
    Ok(selection)
}
#[tauri::command]
pub async fn host_backup_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
) -> Result<Option<String>, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let Some(folder) = app.dialog().file().set_title("Choose the private Hearth backup folder").blocking_pick_folder() else { return Ok(None); };
        let directory = folder.into_path().map_err(|_| "Choose a local backup folder.")?.canonicalize().map_err(|_| "Cannot open the backup.")?;
        let data = app.path().app_data_dir().map_err(|_| "Host storage is unavailable.")?;
        let selection = fresh_restore(&data, &directory)?;
        hosting::save_selection(&app, &selection).map_err(|_| "Restored host is running, but its selection could not be saved. Retry this backup to recover the selection.")?;
        fs::remove_file(data.join("pending-host-restore.json")).map_err(|_| "Host restored. Recovery journal could not be cleared; retry before another import.")?;
        Ok(Some("Server restored with its original keys, credentials and history. Update router forwarding for this computer and repeat the outside-network check. Keep the old host stopped.".into()))
    }).await.map_err(|_| "Fresh host restore is unavailable.".to_string())?
}
