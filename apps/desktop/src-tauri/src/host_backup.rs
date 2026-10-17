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
    let backup = Backup {
        root: selection.root.clone(),
        https: selection.https,
        image,
        hashes,
        runtime: optional_file(&selection.root.join("deploy/compose.runtime.json"))?,
        release: optional_file(&selection.root.join("deploy/host-update.json"))?,
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
fn restore(selection: &Selection, directory: &Path, backup: &Backup) -> Result<(), String> {
    if backup.root != selection.root || backup.https != selection.https {
        return Err("This backup belongs to another host configuration.".into());
    }
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
        ]
        .contains(&file.as_str())
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
    for file in backup
        .hashes
        .keys()
        .filter(|file| file.ends_with(".tar") && file.as_str() != "server-image.tar")
    {
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
