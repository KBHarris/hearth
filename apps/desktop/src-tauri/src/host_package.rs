//! Pinned-source, signed host preparation. Never overwrite or replace an existing host.
use crate::hosting::{self, HostState, HostStatus, Selection};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::{Component, Path},
    time::Duration,
};
use tauri::Manager;
const FEED: &str = "https://github.com/KBHarris/hearth/releases/latest/download/host-package.json";
const STABLE_FEED: &str =
    "https://github.com/KBHarris/hearth/releases/latest/download/host-package-stable.json";
const LIMIT: u64 = 2 * 1024 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Package {
    schema: u32,
    version: String,
    min_client_version: String,
    architecture: String,
    archive_url: String,
    archive_sha256: String,
}
fn check_package(package: &Package, client_version: &str) -> Result<(), String> {
    let version =
        semver::Version::parse(&package.version).map_err(|_| "Invalid host package version.")?;
    let required = semver::Version::parse(&package.min_client_version)
        .map_err(|_| "Invalid host package compatibility.")?;
    let client = semver::Version::parse(client_version).map_err(|_| "Invalid client version.")?;
    if package.schema != 1
        || package.architecture != "amd64"
        || client < required
        || package.archive_url
            != format!(
                "https://github.com/KBHarris/hearth/releases/download/v{version}/Hearth_Host_{version}.tar"
            )
        || package.archive_sha256.len() != 64
        || !package
            .archive_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err("This host package is incompatible or has an untrusted source. Update Hearth and retry.".into());
    }
    Ok(())
}
fn small(client: &reqwest::blocking::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().and_then(|r| r.error_for_status()).map_err(|_| "No signed host package is available. Check your connection or choose an existing signed package.")?;
    let mut bytes = Vec::new();
    response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Host package download interrupted.")?;
    if bytes.len() as u64 > max {
        return Err("Host package metadata exceeds its size limit.".into());
    }
    Ok(bytes)
}
pub(crate) fn extract(archive: &Path, destination: &Path) -> Result<(), String> {
    let mut archive =
        tar::Archive::new(fs::File::open(archive).map_err(|_| "Cannot open the host package.")?);
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| "Invalid host package archive.")?
    {
        let mut entry = entry.map_err(|_| "Invalid host package entry.")?;
        let path = entry
            .path()
            .map_err(|_| "Invalid host package path.")?
            .into_owned();
        let name = path.to_str().ok_or("Invalid host package filename.")?;
        let allowed = matches!(
            name,
            "manifest.json"
                | "manifest.json.sig"
                | "deploy/compose.yaml"
                | "deploy/compose.https.yaml"
                | "deploy/setup.mjs"
                | "deploy/.env.example"
                | "deploy/Caddyfile"
                | "deploy/storage-entrypoint.sh"
        ) || (name.starts_with("Hearth_Server_Test_")
            && name.ends_with(".tar")
            && !name.contains(['/', '\\']));
        total = total
            .checked_add(entry.size())
            .ok_or("Host package is too large.")?;
        if !allowed
            || name.contains(['\\', ':'])
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || !entry.header().entry_type().is_file()
            || !seen.insert(name.to_owned())
            || total > LIMIT
            || seen.len() > 16
        {
            return Err(
                "Unsafe, duplicate or oversized host package entry. Nothing was selected.".into(),
            );
        }
        let target = destination.join(path);
        fs::create_dir_all(target.parent().ok_or("Invalid host destination.")?)
            .map_err(|_| "Cannot create host storage.")?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options
            .open(&target)
            .map_err(|_| "Host destination already exists or is unavailable.")?;
        std::io::copy(&mut entry, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|_| "Cannot finish host extraction.")?;
    }
    let bundle = hosting::validate(destination)?;
    let images = bundle
        .files
        .iter()
        .filter(|(name, _)| {
            name.starts_with("Hearth_Server_Test_")
                && name.ends_with(".tar")
                && !name.contains(['/', '\\'])
        })
        .collect::<Vec<_>>();
    if images.len() != 1 || hosting::sha256(&destination.join(images[0].0))? != *images[0].1 {
        return Err("The signed server archive is missing or damaged.".into());
    }
    Ok(())
}
impl HostStatus {
    pub(crate) fn prepared(selection: &Selection, message: String) -> Self {
        // Serialized through the same status type; constructor lives in hosting.
        hosting::prepared_status(selection, message)
    }
}
#[tauri::command]
pub async fn host_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
) -> Result<HostStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let selection_path = hosting::selection_path(&app)?;
        if selection_path.exists() {
            let selection = hosting::selected_for_recovery(&app)?;
            return hosting::status(&selection)
                .or_else(|message| Ok(HostStatus::prepared(&selection, message)));
        }
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Cannot initialize host downloads.")?;
        let feed = if app.config().identifier == "chat.hearth.desktop" {
            STABLE_FEED
        } else {
            FEED
        };
        let raw = small(&client, feed, 65536)?;
        let signature = String::from_utf8(small(&client, &format!("{feed}.sig"), 16384)?)
            .map_err(|_| "Invalid package signature.")?;
        crate::updates::verify_bytes(&raw, &signature)?;
        let package: Package =
            serde_json::from_slice(&raw).map_err(|_| "Invalid signed host package.")?;
        check_package(&package, &app.package_info().version.to_string())?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|_| "Host storage is unavailable.")?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let directory = data.join("hosts").join(hex::encode(nonce));
        fs::create_dir_all(&directory).map_err(|_| "Cannot create private host storage.")?;
        let archive = directory.join("download.tar");
        let response = client
            .get(&package.archive_url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Cannot download the signed host package. Retry or choose a package.")?;
        if response.content_length().is_some_and(|n| n > LIMIT) {
            return Err("Host download is too large.".into());
        }
        let mut reader = response.take(LIMIT + 1);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&archive)
            .map_err(|_| "Cannot save the host download.")?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = reader
                .read(&mut buffer)
                .map_err(|_| "Host download interrupted. Retry setup.")?;
            if n == 0 {
                break;
            }
            size += n as u64;
            if size > LIMIT {
                return Err("Host download is too large.".into());
            }
            hash.update(&buffer[..n]);
            file.write_all(&buffer[..n])
                .map_err(|_| "Cannot save the host download.")?;
        }
        file.sync_all()
            .map_err(|_| "Cannot finish the host download.")?;
        drop(file);
        if hex::encode(hash.finalize()) != package.archive_sha256 {
            return Err("Host archive checksum failed. Nothing was selected.".into());
        }
        extract(&archive, &directory)?;
        let bundle = hosting::validate(&directory)?;
        if bundle.client.version != package.version {
            return Err("Host package versions do not match.".into());
        }
        let selection = Selection {
            root: directory,
            https: false,
            project: bundle.server.compose_project,
            public_address: None,
        };
        hosting::save_selection(&app, &selection)?;
        Ok(HostStatus::prepared(
            &selection,
            "Signed host package ready. Prepare the runtime, then start the server.".into(),
        ))
    })
    .await
    .map_err(|_| "Host preparation is unavailable.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_package_requires_pinned_source_and_compatible_client() {
        let mut package = Package {
            schema: 1,
            version: "0.3.5".into(),
            min_client_version: "0.3.5".into(),
            architecture: "amd64".into(),
            archive_url:
                "https://github.com/KBHarris/hearth/releases/download/v0.3.5/Hearth_Host_0.3.5.tar"
                    .into(),
            archive_sha256: "a".repeat(64),
        };
        assert!(check_package(&package, "0.3.5").is_ok());
        assert!(check_package(&package, "0.3.4").is_err());
        for url in [
            "https://evil.test/archive.tar",
            "https://github.com/KBHarris/hearth/releases/download/v0.3.5/Hearth_Host_0.3.5.tar?x=1",
        ] {
            package.archive_url = url.into();
            assert!(check_package(&package, "0.3.5").is_err());
        }
    }
    #[test]
    fn extraction_rejects_links_and_operator_configuration_before_writing() {
        let directory =
            std::env::temp_dir().join(format!("hearth-unsafe-package-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        for (index, kind, path) in [
            (0, tar::EntryType::Regular, "deploy/.env"),
            (1, tar::EntryType::Symlink, "manifest.json"),
        ] {
            let archive = directory.join(format!("bad-{index}.tar"));
            let mut builder = tar::Builder::new(fs::File::create(&archive).unwrap());
            let mut header = tar::Header::new_gnu();
            header.set_size(0);
            header.set_entry_type(kind);
            header.set_mode(0o600);
            header.set_cksum();
            builder
                .append_data(&mut header, path, std::io::empty())
                .unwrap();
            builder.finish().unwrap();
            assert!(extract(&archive, &directory.join(format!("out-{index}"))).is_err());
            assert!(!directory.join(format!("out-{index}")).exists());
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
