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
        return Err("Hearth didn’t recognize part of your server’s data, so it stopped to protect your data.".into());
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
        return Err("Hearth stopped because some Docker data doesn’t belong to your selected server. Hearth didn’t change it.".into());
    }
    Ok(name)
}
fn bind(path: &Path) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or("Hearth couldn’t use the backup folder’s location. Try again.")?;
    #[cfg(windows)]
    let text = text.strip_prefix("\\\\?\\").unwrap_or(text);
    if text.contains([',', '\n', '\r']) {
        return Err("The backup folder’s location contains a comma or line break, which Hearth can’t use. Move it to a folder without commas in its name, then try again.".into());
    }
    Ok(format!("type=bind,src={text},dst=/backup"))
}
fn optional_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    hosting::regular(path)?;
    Ok(Some(fs::read(path).map_err(
        |_| "Hearth couldn’t read your server’s update files for the backup. Try again.",
    )?))
}
fn restore_file(path: &Path, bytes: &Option<Vec<u8>>) -> Result<(), String> {
    if path.exists() {
        hosting::regular(path)?;
    }
    match bytes {
        Some(bytes) => fs::write(path, bytes).map_err(|_| {
            "Hearth couldn’t put back your server’s previous update files.".to_string()
        }),
        None if path.exists() => fs::remove_file(path).map_err(|_| {
            "Hearth couldn’t remove a newer update file from your server folder.".to_string()
        }),
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
    fs::create_dir_all(&directory)
        .map_err(|_| "Hearth couldn’t create a private backup of your server.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Hearth couldn’t make the server backup private on this computer.")?;
    }
    let mount = bind(&directory)?;
    let image_ref = String::from_utf8(hosting::compose(
        selection,
        &["images", "-q", "postgres"],
        20,
    )?)
    .map_err(|_| "Hearth couldn’t find your server’s database to back it up. Choose Start server, then try again.")?
    .trim()
    .to_string();
    let image_digest = image_ref.strip_prefix("sha256:").unwrap_or(&image_ref);
    if !(12..=64).contains(&image_digest.len())
        || !image_digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Hearth couldn’t find your server’s database to back it up. Choose Start server, then try again.".into());
    }
    let image = String::from_utf8(docker(
        selection,
        &["image", "inspect", "--format", "{{.Id}}", &image_ref],
        20,
    )?)
    .map_err(|_| "Hearth couldn’t find your server’s database to back it up. Choose Start server, then try again.")?
    .trim()
    .to_string();
    if image.len() != 71
        || !image.starts_with("sha256:")
        || !image[7..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(
            "Hearth couldn’t find your server’s database to back it up. Choose Start server, then try again.".into(),
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
                    "Hearth tested the backup, but your server’s keys didn’t restore correctly, so it stopped. Nothing was updated.".into(),
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
                "Hearth tested the backup, but the database didn’t restore correctly, so it stopped. Nothing was updated."
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
        fs::copy(&source, directory.join(file)).map_err(
            |_| "Hearth couldn’t back up your server’s settings files (.env and s3.json).",
        )?;
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
                .ok_or("Hearth couldn’t use the backup folder’s location. Try again.")?,
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
                .ok_or("Hearth couldn’t use the backup folder’s location. Try again.")?,
            &image,
        ],
        180,
    )?;
    hashes.insert("helper-image.tar".into(), hosting::sha256(&helper_archive)?);
    if selection.root.join("deploy/media/data/.env").exists() {
        crate::host_media::directory(&selection.root)?;
        fs::create_dir_all(directory.join("media"))
            .map_err(|_| "Hearth couldn’t back up your private voice and video settings.")?;
        for file in crate::host_media::PRIVATE_FILES {
            let source = selection.root.join("deploy/media/data").join(file);
            if source.exists() {
                hosting::regular(&source)?;
                let name = format!("media/{file}");
                fs::copy(&source, directory.join(&name))
                    .map_err(|_| "Hearth couldn’t back up your voice and video keys.")?;
                hashes.insert(name.clone(), hosting::sha256(&directory.join(name))?);
            }
        }
    }
    let package = directory.join("package");
    fs::create_dir_all(package.join("deploy"))
        .map_err(|_| "Hearth couldn’t prepare a backup you can move to another computer.")?;
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
        fs::create_dir_all(
            package
                .join(file)
                .parent()
                .ok_or("Hearth couldn’t copy your server files into the backup.")?,
        )
        .map_err(|_| "Hearth couldn’t prepare the voice and video part of the backup.")?;
        fs::copy(selection.root.join(file), package.join(file))
            .map_err(|_| "Hearth couldn’t back up your verified server files.")?;
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
            return Err(
                "Part of your verified server files is damaged, so the backup was cancelled."
                    .into(),
            );
        }
        fs::copy(selection.root.join(name), package.join(name))
            .map_err(|_| "Hearth couldn’t back up your server’s software.")?;
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
        serde_json::to_vec(&backup)
            .map_err(|_| "Hearth couldn’t finish saving the server backup.")?,
    )
    .map_err(|_| "Hearth couldn’t finish saving the server backup.")?;
    fs::write(
        data.join("last-host-backup.json"),
        serde_json::to_vec(&directory)
            .map_err(|_| "Hearth couldn’t finish saving the server backup.")?,
    )
    .map_err(|_| "Hearth couldn’t finish saving the server backup.")?;
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
            return Err(
                "This backup contains a file Hearth doesn’t recognize, so it wasn’t used.".into(),
            );
        }
        if &hosting::sha256(&directory.join(file))? != expected {
            return Err("This backup is damaged or was changed, so it wasn’t used. Your server data is safe.".into());
        }
    }
    if DATA
        .iter()
        .any(|suffix| !backup.hashes.contains_key(&format!("{suffix}.tar")))
    {
        return Err("This backup is incomplete, so it can’t be used.".into());
    }
    if !backup.hashes.contains_key("server-image.tar") {
        return Err(
            "This backup is missing its copy of the server software, so it can’t be used.".into(),
        );
    }
    for file in [".env", "s3.json"] {
        if !backup.hashes.contains_key(file) {
            return Err("This backup is missing your server’s settings files (.env and s3.json), so it can’t be used.".into());
        }
    }
    if !backup.image.starts_with("sha256:")
        || backup.image.len() != 71
        || !backup.image[7..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("This backup looks damaged, so it can’t be used.".into());
    }
    // Inspect volume archives before starting Docker or stopping an existing host.
    for suffix in DATA.into_iter().chain(if backup.https {
        vec!["caddy-data", "caddy-config"]
    } else {
        vec![]
    }) {
        let name = format!("{suffix}.tar");
        if !backup.hashes.contains_key(&name) {
            return Err("This backup is incomplete, so it can’t be used.".into());
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
    let mut archive = tar::Archive::new(
        fs::File::open(path).map_err(|_| "Hearth couldn’t read part of the backup.")?,
    );
    let mut total = 0u64;
    let mut count = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| "This backup looks damaged, so it can’t be used.")?
    {
        let entry = entry.map_err(|_| "This backup looks damaged, so it can’t be used.")?;
        let path = entry
            .path()
            .map_err(|_| "This backup looks damaged, so it can’t be used.")?;
        let kind = entry.header().entry_type();
        count += 1;
        total = total
            .checked_add(entry.size())
            .ok_or("Part of this backup is larger than expected, so it can’t be used.")?;
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
                "Unsafe or oversized files were found in this backup, so it wasn’t used. Your server data is safe.".into(),
            );
        }
    }
    Ok(())
}
fn restore(selection: &Selection, directory: &Path, backup: &Backup) -> Result<(), String> {
    if backup.root != selection.root || backup.https != selection.https {
        return Err(
            "This backup is from a different server setup, so it can’t be restored here.".into(),
        );
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
                .ok_or("Hearth couldn’t use the backup folder’s location. Try again.")?,
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
        fs::copy(directory.join(file), target).map_err(
            |_| "Hearth couldn’t restore your server’s settings files (.env and s3.json).",
        )?;
    }
    for file in backup
        .hashes
        .keys()
        .filter_map(|file| file.strip_prefix("package/"))
    {
        let target = selection.root.join(file);
        fs::create_dir_all(
            target
                .parent()
                .ok_or("Hearth couldn’t restore your server files from the backup.")?,
        )
        .map_err(|_| "Hearth couldn’t restore your server files.")?;
        if target.exists() {
            hosting::regular(&target)?;
        }
        fs::copy(directory.join("package").join(file), target)
            .map_err(|_| "Hearth couldn’t restore your verified server files.")?;
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
        .map_err(|_| "Hearth couldn’t open its backup folder on this computer. Close and reopen Hearth, then try again.")?;
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
                    "Your server was restarted on its previous version."
                } else {
                    "Your server couldn’t restart on its previous version. Choose Start server to try again."
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
        .map_err(|_| "Hearth couldn’t switch your server to the verified update.")?;
        fs::write(
            selection.root.join("deploy/host-update.json"),
            serde_json::to_vec(signed)
                .map_err(|_| "Hearth couldn’t save a record of the server update.")?,
        )
        .map_err(|_| "Hearth couldn’t save a record of the server update.")?;
        hosting::compose(
            selection,
            &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
            180,
        )?;
        Ok::<(), String>(())
    })();
    if result.is_err() {
        return match restore(selection, &directory, &backup) {
            Ok(()) => Err("The updated server didn’t start, so Hearth went back: the previous server and its verified data backup were restored.".into()),
            Err(_) => Err(format!("The update failed, and Hearth couldn’t automatically go back to the previous version. Your server is stopped to protect its data. Keep the verified backup at {} and choose Restore last backup.", directory.display())),
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
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let selection = hosting::selected_for_recovery(&app)?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|_| "Hearth couldn’t open its backup folder on this computer. Close and reopen Hearth, then try again.")?;
        let path = data.join("last-host-backup.json");
        hosting::regular(&path)?;
        let directory: PathBuf =
            serde_json::from_slice(&fs::read(path).map_err(|_| "There’s no server backup to restore yet.")?)
                .map_err(|_| "Hearth’s record of your last backup is damaged, so it can’t be restored.")?;
        let canonical = directory
            .canonicalize()
            .map_err(|_| "Your last server backup is missing from this computer.")?;
        if !canonical.starts_with(
            data.join("host-backups")
                .canonicalize()
                .map_err(|_| "Your last server backup is missing from this computer.")?,
        ) {
            return Err("Your last server backup isn’t in Hearth’s own storage folder, so Hearth won’t restore it.".into());
        }
        let record = canonical.join("backup.json");
        hosting::regular(&record)?;
        let backup: Backup =
            serde_json::from_slice(&fs::read(record).map_err(|_| "Hearth couldn’t read the server backup.")?)
                .map_err(|_| "This server backup looks damaged, so it can’t be used.")?;
        restore(&selection, &canonical, &backup)?;
        Ok("Your previous server version and its verified data were restored.".into())
    })
    .await
    .map_err(|_| "Something went wrong restoring your server. Close and reopen Hearth, then try again.".to_string())?
}

fn record(directory: &Path) -> Result<Backup, String> {
    let path = directory.join("backup.json");
    hosting::regular(&path)?;
    let bytes = fs::read(path).map_err(|_| "Hearth couldn’t read the server backup.")?;
    if bytes.len() > 131072 {
        return Err("This server backup looks damaged, so it can’t be used.".into());
    }
    let backup: Backup = serde_json::from_slice(&bytes)
        .map_err(|_| "This server backup looks damaged, so it can’t be used.")?;
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
        (Err(error), Ok(_)) => Err(format!("{error} Your server was started again.")),
        (result, Err(_)) => Err(format!(
            "{} Your server couldn’t start again. Choose Start server to try. Your server data is safe.",
            result
                .err()
                .unwrap_or_else(|| "The backup finished.".into())
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
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let Some(folder) = app.dialog().file().set_title("Choose where to save the private server backup").blocking_pick_folder() else { return Ok(None); };
        let destination = folder.into_path().map_err(|_| "Choose a backup folder on this computer.")?.canonicalize().map_err(|_| "Hearth couldn’t open that folder. Choose another one.")?;
        let selection = hosting::selected(&app)?;
        let data = app.path().app_data_dir().map_err(|_| "Hearth couldn’t open its backup folder on this computer. Close and reopen Hearth, then try again.")?;
        let directory = make_backup(&data, &selection)?;
        let backup = record(&directory)?;
        let destination = destination.join(format!("Hearth_Backup_{}", directory.file_name().ok_or("Hearth couldn’t save the backup to that folder. Choose another folder.")?.to_string_lossy()));
        fs::create_dir(&destination).map_err(|_| "A backup folder with this name already exists there, or the folder couldn’t be created. Nothing was overwritten. Choose another location.")?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&destination, fs::Permissions::from_mode(0o700)).map_err(|_| "Hearth couldn’t make the backup folder private.")?; }
        for file in backup.hashes.keys().chain(std::iter::once(&"backup.json".to_string())) {
            let target = destination.join(file);
            fs::create_dir_all(target.parent().ok_or("Hearth couldn’t save the backup to that folder. Choose another folder.")?).map_err(|_| "Hearth couldn’t create the backup folder.")?;
            fs::copy(directory.join(file), &target).map_err(|_| "Hearth couldn’t finish saving the backup to that folder. A private copy is still kept inside Hearth.")?;
        }
        record(&destination)?;
        Ok(Some(format!("Verified server backup saved to {}. Keep it private: it contains your server’s secret keys, passwords and encrypted messages. Stop the old server before using this backup on another computer.", destination.display())))
    }).await.map_err(|_| "Something went wrong saving the backup. Close and reopen Hearth, then try again.".to_string())?
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
        return Err("This backup is from an older version and can only undo an update on the same computer. On the original computer, use Export server backup to make a new one.".into());
    }
    let bundle = hosting::validate(&directory.join("package"))?;
    let pending_path = data.join("pending-host-restore.json");
    let record_hash = hosting::sha256(&directory.join("backup.json"))?;
    let pending = if pending_path.exists() {
        hosting::regular(&pending_path)?;
        let pending: PendingRestore =
            serde_json::from_slice(&fs::read(&pending_path).map_err(
                |_| "Hearth couldn’t read the progress of an earlier restore. Try again.",
            )?)
            .map_err(
                |_| "The record of an earlier unfinished restore is damaged, so Hearth stopped.",
            )?;
        if pending.backup != directory
            || pending.record_hash != record_hash
            || pending.project != bundle.server.compose_project
            || pending.root.parent() != Some(data.join("hosts").as_path())
        {
            return Err("Another restore hasn’t finished. Restore that same backup again before restoring a different server. Your existing data is safe.".into());
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
                return Err("This computer already has data for that Hearth server. Restore onto a computer that hasn’t hosted it before. Your existing server data on this computer was not changed.".into());
            }
        }
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let root = data
            .join("hosts")
            .join(format!("restored-{}", hex::encode(nonce)));
        fs::create_dir_all(root.join("deploy"))
            .map_err(|_| "Hearth couldn’t prepare a new server folder for the restore.")?;
        let pending = PendingRestore {
            root,
            backup: directory.to_path_buf(),
            record_hash,
            project: bundle.server.compose_project,
        };
        fs::write(
            &pending_path,
            serde_json::to_vec(&pending)
                .map_err(|_| "Hearth couldn’t save the restore’s progress, so it stopped.")?,
        )
        .map_err(|_| "Hearth couldn’t save the restore’s progress, so it stopped.")?;
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
                .ok_or("Hearth couldn’t restore your server files from the backup.")?,
        )
        .map_err(|_| "Hearth couldn’t prepare to restore voice and video settings.")?;
        fs::copy(
            directory.join("package").join(file),
            pending.root.join(file),
        )
        .map_err(|_| "Hearth couldn’t prepare the verified server files from the backup.")?;
    }
    for file in [".env", "s3.json"] {
        fs::copy(directory.join(file), pending.root.join("deploy").join(file)).map_err(
            |_| "Hearth couldn’t restore your server’s original settings files (.env and s3.json).",
        )?;
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
                    .ok_or("Hearth couldn’t use the backup folder’s location. Try again.")?,
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
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let Some(folder) = app.dialog().file().set_title("Choose the private Hearth backup folder").blocking_pick_folder() else { return Ok(None); };
        let directory = folder.into_path().map_err(|_| "Choose a backup folder on this computer.")?.canonicalize().map_err(|_| "Hearth couldn’t open that backup folder. Choose another one.")?;
        let data = app.path().app_data_dir().map_err(|_| "Hearth couldn’t open its storage folder on this computer. Close and reopen Hearth, then try again.")?;
        let selection = fresh_restore(&data, &directory)?;
        hosting::save_selection(&app, &selection).map_err(|_| "Your restored server is running, but Hearth couldn’t remember it. Restore this backup again to fix that.")?;
        fs::remove_file(data.join("pending-host-restore.json")).map_err(|_| "Server restored, but Hearth couldn’t clear its restore progress record. Restore this backup again before restoring a different one.")?;
        Ok(Some("Server restored with its original keys, passwords and message history. Update your router’s port forwarding to point to this computer, then run the outside-network check again. Keep the old server stopped.".into()))
    }).await.map_err(|_| "Something went wrong restoring the backup. Close and reopen Hearth, then try again.".to_string())?
}
