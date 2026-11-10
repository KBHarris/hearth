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
    let version = semver::Version::parse(&package.version).map_err(
        |_| "The server download information looks damaged. Update Hearth, then try again.",
    )?;
    let required = semver::Version::parse(&package.min_client_version).map_err(
        |_| "The server download information looks damaged. Update Hearth, then try again.",
    )?;
    let client = semver::Version::parse(client_version).map_err(
        |_| "Hearth couldn’t read its own version number. Reinstall Hearth, then try again.",
    )?;
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
        return Err("These server files don’t work with this version of Hearth, or they don’t come from Hearth’s official releases. Update Hearth, then try again.".into());
    }
    Ok(())
}
fn small(client: &reqwest::blocking::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().and_then(|r| r.error_for_status()).map_err(|_| "Hearth couldn’t download verified server files. Check your internet connection, or use Choose server files to pick server files you already have.")?;
    let mut bytes = Vec::new();
    response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The server files download was interrupted. Try again.")?;
    if bytes.len() as u64 > max {
        return Err("The server download information is larger than expected, so Hearth didn’t use it. Try again later.".into());
    }
    Ok(bytes)
}
pub(crate) fn extract(archive: &Path, destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(
        fs::File::open(archive)
            .map_err(|_| "Hearth couldn’t open the downloaded server files. Try again.")?,
    );
    let mut seen = BTreeSet::new();
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|_| "These server files look damaged. Download them again.")?
    {
        let mut entry =
            entry.map_err(|_| "These server files look damaged. Download them again.")?;
        let path = entry
            .path()
            .map_err(|_| "These server files look damaged. Download them again.")?
            .into_owned();
        let name = path
            .to_str()
            .ok_or("These server files look damaged. Download them again.")?;
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
        ) || crate::host_media::PUBLIC_FILES.contains(&name)
            || (name.starts_with("Hearth_Server_Test_")
                && name.ends_with(".tar")
                && !name.contains(['/', '\\']));
        total = total
            .checked_add(entry.size())
            .ok_or("These server files are larger than expected, so Hearth didn’t use them. Download them again.")?;
        if !allowed
            || name.contains(['\\', ':'])
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || !entry.header().entry_type().is_file()
            || !seen.insert(name.to_owned())
            || total > LIMIT
            || seen.len() > 32
        {
            return Err(
                "These server files contain something unsafe or unexpected, so Hearth didn’t use them.".into(),
            );
        }
        let target = destination.join(path);
        fs::create_dir_all(
            target
                .parent()
                .ok_or("Hearth couldn’t unpack the server files. Try again.")?,
        )
        .map_err(|_| "Hearth couldn’t create a folder for the server files. Try again.")?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options
            .open(&target)
            .map_err(|_| "Hearth couldn’t unpack the server files. Try again.")?;
        std::io::copy(&mut entry, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|_| "Hearth couldn’t finish unpacking the server files. Try again.")?;
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
        return Err(
            "Part of the verified server files is missing or damaged. Download them again.".into(),
        );
    }
    Ok(())
}
/// Fetch the exact deployment archive named by the already verified server
/// release before stopping hosting. Legacy releases retain image-only updates.
pub(crate) fn update_candidate(
    data: &Path,
    release: &crate::updates::ServerRelease,
) -> Result<Option<std::path::PathBuf>, String> {
    let Some(expected) = release.host_archive_sha256.as_deref() else {
        return Ok(None);
    };
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let directory = data
        .join("host-updates")
        .join(format!("package-{}", hex::encode(nonce)));
    fs::create_dir_all(&directory).map_err(
        |_| "Hearth couldn’t prepare the server update. Your server wasn’t changed. Try again.",
    )?;
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| "Hearth couldn’t start downloading the server update. Your server wasn’t changed. Try again.")?;
    let url = format!(
        "https://github.com/KBHarris/hearth/releases/download/v{}/Hearth_Host_{}.tar",
        release.version, release.version
    );
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(
            |_| "Hearth couldn’t download the server update. Your server wasn’t changed. Check your internet connection, then try again.",
        )?;
    if response
        .content_length()
        .is_some_and(|length| length > LIMIT)
    {
        return Err("The server update download is larger than expected, so Hearth didn’t use it. Your server wasn’t changed.".into());
    }
    let archive = directory.join("download.tar");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&archive)
        .map_err(|_| "Hearth couldn’t save the server update download. Your server wasn’t changed. Try again.")?;
    let mut reader = response.take(LIMIT + 1);
    let mut hash = Sha256::new();
    let mut count = 0u64;
    let mut bytes = [0u8; 65536];
    loop {
        let length = reader
            .read(&mut bytes)
            .map_err(|_| "The server update download was interrupted. Your server wasn’t changed. Try again.")?;
        if length == 0 {
            break;
        }
        count += length as u64;
        if count > LIMIT {
            return Err("The server update download is larger than expected, so Hearth didn’t use it. Your server wasn’t changed.".into());
        }
        hash.update(&bytes[..length]);
        file.write_all(&bytes[..length])
            .map_err(|_| "Hearth couldn’t save the server update download. Your server wasn’t changed. Try again.")?;
    }
    file.sync_all()
        .map_err(|_| "Hearth couldn’t finish downloading the server update. Your server wasn’t changed. Try again.")?;
    drop(file);
    if hex::encode(hash.finalize()) != expected {
        return Err("The server update download was damaged or changed, so Hearth didn’t install it. Your server wasn’t changed.".into());
    }
    extract(&archive, &directory)?;
    let bundle = hosting::validate(&directory)?;
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(directory.join("manifest.json"))
            .map_err(|_| "The server update files couldn’t be read, so Hearth didn’t install them. Your server wasn’t changed.")?,
    )
    .map_err(|_| "The server update files look damaged, so Hearth didn’t install them. Your server wasn’t changed.")?;
    if manifest["sourceCommit"] != release.source_commit {
        return Err("The parts of this server update don’t match each other, so Hearth didn’t install it. Your server wasn’t changed. Try again later.".into());
    }
    if bundle.client.version != release.version || bundle.server.image_id != release.image_id {
        return Err("The parts of this server update don’t match each other, so Hearth didn’t install it. Your server wasn’t changed. Try again later.".into());
    }
    Ok(Some(directory))
}
pub(crate) fn install_candidate(candidate: &Path, selection: &Selection) -> Result<(), String> {
    let bundle = hosting::validate(candidate)?;
    if bundle.server.compose_project != selection.project {
        return Err("This server update is for a different server setup, so Hearth didn’t install it. Your server files weren’t changed.".into());
    }
    let files = std::iter::once("manifest.json")
        .chain(std::iter::once("manifest.json.sig"))
        .chain(
            bundle
                .files
                .keys()
                .filter(|file| {
                    matches!(
                        file.as_str(),
                        "deploy/compose.yaml"
                            | "deploy/compose.https.yaml"
                            | "deploy/setup.mjs"
                            | "deploy/.env.example"
                            | "deploy/Caddyfile"
                            | "deploy/storage-entrypoint.sh"
                    ) || crate::host_media::PUBLIC_FILES.contains(&file.as_str())
                        || file.starts_with("Hearth_Server_Test_")
                            && file.ends_with(".tar")
                            && !file.contains(['/', '\\'])
                })
                .map(String::as_str),
        );
    for file in files {
        let target = selection.root.join(file);
        if target.exists() {
            hosting::regular(&target)?;
        }
        fs::create_dir_all(
            target
                .parent()
                .ok_or("Hearth couldn’t install the server update files.")?,
        )
        .map_err(|_| "Hearth couldn’t install the server update files.")?;
        fs::copy(candidate.join(file), target).map_err(
            |_| "Hearth couldn’t copy the verified server update files into your server folder.",
        )?;
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
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
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
            .map_err(|_| "Hearth couldn’t start downloading the server files. Try again.")?;
        let feed = if app.config().identifier == "chat.hearth.desktop" {
            STABLE_FEED
        } else {
            FEED
        };
        let raw = small(&client, feed, 65536)?;
        let signature = String::from_utf8(small(&client, &format!("{feed}.sig"), 16384)?)
            .map_err(|_| "Hearth could not confirm this download is genuine, so nothing was installed.")?;
        crate::updates::verify_bytes(&raw, &signature)?;
        let package: Package =
            serde_json::from_slice(&raw).map_err(|_| "The server download information looks damaged, so nothing was installed. Update Hearth, then try again.")?;
        check_package(&package, &app.package_info().version.to_string())?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|_| "Hearth couldn’t open its storage folder on this computer. Close and reopen Hearth, then try again.")?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let directory = data.join("hosts").join(hex::encode(nonce));
        fs::create_dir_all(&directory).map_err(|_| "Hearth couldn’t create a private folder for your server files. Try again.")?;
        let archive = directory.join("download.tar");
        let response = client
            .get(&package.archive_url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Hearth couldn’t download the verified server files. Try again, or use Choose server files to pick server files you already have.")?;
        if response.content_length().is_some_and(|n| n > LIMIT) {
            return Err("The server files download is larger than expected, so Hearth didn’t use it. Try again later.".into());
        }
        let mut reader = response.take(LIMIT + 1);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&archive)
            .map_err(|_| "Hearth couldn’t save the server files download. Make sure your computer has free disk space, then try again.")?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = reader
                .read(&mut buffer)
                .map_err(|_| "The server files download was interrupted. Try again.")?;
            if n == 0 {
                break;
            }
            size += n as u64;
            if size > LIMIT {
                return Err("The server files download is larger than expected, so Hearth didn’t use it. Try again later.".into());
            }
            hash.update(&buffer[..n]);
            file.write_all(&buffer[..n])
                .map_err(|_| "Hearth couldn’t save the server files download. Make sure your computer has free disk space, then try again.")?;
        }
        file.sync_all()
            .map_err(|_| "Hearth couldn’t finish downloading the server files. Try again.")?;
        drop(file);
        if hex::encode(hash.finalize()) != package.archive_sha256 {
            return Err("The server files download was damaged or changed, so nothing was installed. Try again.".into());
        }
        extract(&archive, &directory)?;
        let bundle = hosting::validate(&directory)?;
        if bundle.client.version != package.version {
            return Err("The downloaded server files aren’t the expected version, so Hearth didn’t use them. Try again later.".into());
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
            "Verified server files are ready. Set up the hosting tools, then choose Start server.".into(),
        ))
    })
    .await
    .map_err(|_| "Hearth couldn’t prepare your server. Close and reopen Hearth, then try again.".to_string())?
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
