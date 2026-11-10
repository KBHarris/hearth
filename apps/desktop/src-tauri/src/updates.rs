//! Signed releases from one pinned GitHub source; no update URL is supplied by a webview.
use crate::hosting::{self, HostState, Selection};
use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path, time::Duration};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const PREVIEW_FEED: &str =
    "https://github.com/KBHarris/hearth/releases/latest/download/server.json";
const STABLE_FEED: &str =
    "https://github.com/KBHarris/hearth/releases/latest/download/server-stable.json";
#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct ServerRelease {
    pub schema: u32,
    pub version: String,
    pub min_client_version: String,
    pub source_commit: String,
    pub image_id: String,
    pub archive_url: String,
    pub archive_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_archive_sha256: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRelease {
    pub manifest: String,
    pub signature: String,
}
#[derive(Serialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
    pub message: String,
}
fn public_key() -> Result<PublicKey, String> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(
            |_| "This copy of Hearth is damaged, so it can’t check downloads. Reinstall Hearth.",
        )?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("This copy of Hearth is damaged, so it can’t check downloads. Reinstall Hearth.")?;
    let text = STANDARD.decode(key).map_err(
        |_| "This copy of Hearth is damaged, so it can’t check downloads. Reinstall Hearth.",
    )?;
    PublicKey::decode(std::str::from_utf8(&text).map_err(
        |_| "This copy of Hearth is damaged, so it can’t check downloads. Reinstall Hearth.",
    )?)
    .map_err(|_| {
        "This copy of Hearth is damaged, so it can’t check downloads. Reinstall Hearth.".into()
    })
}
pub(crate) fn verify_bytes(bytes: &[u8], signature: &str) -> Result<(), String> {
    if bytes.len() > 65536 || signature.len() > 16384 {
        return Err("Hearth could not confirm these files are genuine because they are larger than expected. Nothing was installed.".into());
    }
    let signature = STANDARD.decode(signature.trim()).map_err(
        |_| "Hearth could not confirm this download is genuine, so nothing was installed.",
    )?;
    let signature = Signature::decode(std::str::from_utf8(&signature).map_err(
        |_| "Hearth could not confirm this download is genuine, so nothing was installed.",
    )?)
    .map_err(|_| "Hearth could not confirm this download is genuine, so nothing was installed.")?;
    public_key()?.verify(bytes, &signature, true).map_err(
        |_| "Hearth could not confirm this download is genuine, so nothing was installed.",
    )?;
    Ok(())
}
fn verify(signed: &SignedRelease) -> Result<ServerRelease, String> {
    verify_bytes(signed.manifest.as_bytes(), &signed.signature)?;
    let release: ServerRelease = serde_json::from_str(&signed.manifest)
        .map_err(|_| "The server update details look damaged. Nothing was installed.")?;
    semver::Version::parse(&release.version)
        .map_err(|_| "The server update details look damaged. Nothing was installed.")?;
    semver::Version::parse(&release.min_client_version)
        .map_err(|_| "The server update details look damaged. Nothing was installed.")?;
    if release.schema != 1
        || !image_id(&release.image_id)
        || !hex(&release.source_commit, 40)
        || !hex(&release.archive_sha256, 64)
        || release
            .host_archive_sha256
            .as_deref()
            .is_some_and(|value| !hex(value, 64))
        || !release.archive_url.starts_with(&format!(
            "https://github.com/KBHarris/hearth/releases/download/v{}/",
            release.version
        ))
        || release.archive_url.contains(['?', '#'])
        || !release.archive_url.ends_with(".tar")
    {
        return Err("This server update can’t be used by this version of Hearth. Choose Update app, then try again.".into());
    }
    Ok(release)
}
fn hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn image_id(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|v| hex(v, 64))
}
fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Hearth desktop updater")
        .build()
        .map_err(|_| {
            "Hearth couldn’t start a secure connection to download updates. Try again.".into()
        })
}
fn download(client: &reqwest::blocking::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|_| "Hearth couldn’t reach the update server. Check your internet connection, then try again.")?;
    if !response.status().is_success() {
        return Err("There’s no update available to download yet. Try again later.".into());
    }
    if response.content_length().is_some_and(|size| size > max) {
        return Err("The update download is larger than expected, so Hearth didn’t use it. Nothing was installed.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The update download was interrupted. Try again.")?;
    if bytes.len() as u64 > max {
        return Err("The update download is larger than expected, so Hearth didn’t use it. Nothing was installed.".into());
    }
    Ok(bytes)
}
fn fetch_release(preview: bool) -> Result<(SignedRelease, ServerRelease), String> {
    let client = http()?;
    let feed = if preview { PREVIEW_FEED } else { STABLE_FEED };
    let manifest = String::from_utf8(download(&client, feed, 65536)?)
        .map_err(|_| "The server update details look damaged. Nothing was installed.")?;
    let signature = String::from_utf8(download(&client, &format!("{feed}.sig"), 16384)?).map_err(
        |_| "Hearth could not confirm this download is genuine, so nothing was installed.",
    )?;
    let signed = SignedRelease {
        manifest,
        signature,
    };
    let release = verify(&signed)?;
    Ok((signed, release))
}
pub(crate) fn runtime(root: &Path) -> Result<Option<ServerRelease>, String> {
    let path = root.join("deploy/host-update.json");
    if !path.exists() {
        return Ok(None);
    }
    hosting::regular(&path)?;
    let bytes = fs::read(path).map_err(|_| "Hearth couldn’t read which server update is installed (host-update.json in your server folder). Try again.")?;
    if bytes.len() > 100000 {
        return Err("The record of your installed server update (host-update.json in your server folder) looks damaged.".into());
    }
    let signed: SignedRelease =
        serde_json::from_slice(&bytes).map_err(|_| "The record of your installed server update (host-update.json in your server folder) looks damaged.")?;
    Ok(Some(verify(&signed)?))
}
pub(crate) fn validate_runtime(root: &Path) -> Result<(), String> {
    let path = root.join("deploy/compose.runtime.json");
    let release = runtime(root)?;
    if !path.exists() && release.is_none() {
        return Ok(());
    }
    let release = release.ok_or("Your server’s update files are incomplete (compose.runtime.json has no verified update record), so Hearth won’t use them.")?;
    hosting::regular(&path)?;
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(path).map_err(|_| "Hearth couldn’t read your server’s update file (compose.runtime.json). Try again.")?,
    )
    .map_err(|_| "Your server’s update file (compose.runtime.json) looks damaged, so Hearth won’t use it.")?;
    if value != serde_json::json!({"services":{"server":{"image":release.image_id}}}) {
        return Err("Your server’s update file (compose.runtime.json) doesn’t match its verified update, so Hearth won’t use it.".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn desktop_update(
    app: tauri::AppHandle,
    install: bool,
    expected_version: Option<String>,
) -> Result<UpdateStatus, String> {
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| "Hearth can’t check for app updates right now. Try again later.")?;
    let update = updater.check().await.map_err(|_| "Hearth couldn’t check for app updates. Check your internet connection, or try again later.")?;
    let Some(update) = update else {
        return Ok(UpdateStatus {
            available: false,
            version: None,
            message: "This app is up to date.".into(),
        });
    };
    if install {
        if expected_version.as_deref() != Some(update.version.as_str()) {
            return Err("The available app update changed. Choose Check for updates again.".into());
        }
        update.download_and_install(|_, _| {}, || {}).await.map_err(|_| "The app update couldn’t be confirmed as genuine or couldn’t be installed. Your current app and data were not changed.")?;
    }
    Ok(UpdateStatus {
        available: true,
        version: Some(update.version.clone()),
        message: if install {
            "Update installed. Restart Hearth to finish.".into()
        } else {
            format!(
                "Hearth {} is available. Choose Update app to install it.",
                update.version
            )
        },
    })
}
#[tauri::command]
pub async fn server_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    install: bool,
    expected_version: Option<String>,
) -> Result<UpdateStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let selection = hosting::selected(&app)?;
        let bundle = hosting::validate(&selection.root)?;
        let (signed, release) = fetch_release(app.config().identifier == "chat.hearth.preview")?;
        let current = runtime(&selection.root)?
            .map(|v| v.version)
            .unwrap_or(bundle.client.version);
        let newer = semver::Version::parse(&release.version)
            .map_err(|_| "The server update details look damaged. Nothing was installed.")?
            > semver::Version::parse(&current).map_err(|_| "Hearth couldn’t read your server’s current version. Nothing was installed.")?;
        if !newer {
            return Ok(UpdateStatus {
                available: false,
                version: None,
                message: "This hosted server is up to date.".into(),
            });
        }
        if semver::Version::parse(&release.min_client_version)
            .map_err(|_| "The server update details look damaged. Nothing was installed.")?
            > app.package_info().version
        {
            return Err("Choose Update app first, then update this hosted server.".into());
        }
        if install {
            if expected_version.as_deref() != Some(release.version.as_str()) {
                return Err(
                    "The available server update changed. Choose Check for updates again.".into(),
                );
            }
            install_server(&app, &selection, &signed, &release)?;
        }
        Ok(UpdateStatus {
            available: true,
            version: Some(release.version.clone()),
            message: if install {
                "Server updated. Hearth kept a verified backup, so you can go back with Restore last backup.".into()
            } else {
                format!(
                    "Server {} is available. Your server will be offline for a short time while it updates.",
                    release.version
                )
            },
        })
    })
    .await
    .map_err(|_| "Something went wrong checking for server updates. Close and reopen Hearth, then try again.".to_string())?
}
fn install_server(
    app: &tauri::AppHandle,
    selection: &Selection,
    signed: &SignedRelease,
    release: &ServerRelease,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Hearth couldn’t open its storage folder on this computer. Close and reopen Hearth, then try again.")?
        .join("host-updates");
    fs::create_dir_all(&directory).map_err(
        |_| "Hearth couldn’t prepare a place to download the server update. Nothing was installed.",
    )?;
    let archive = directory.join(format!("{}.tar", release.archive_sha256));
    let bytes = download(&http()?, &release.archive_url, 512 * 1024 * 1024)?;
    use sha2::Digest;
    if hex::encode(sha2::Sha256::digest(&bytes)) != release.archive_sha256 {
        return Err(
            "The server update download was damaged or changed, so nothing was installed.".into(),
        );
    }
    fs::write(&archive, bytes).map_err(|_| "Hearth couldn’t save the server update download. Nothing was installed. Make sure your computer has free disk space, then try again.")?;
    hosting::command(
        "docker",
        &[
            "load".into(),
            "--input".into(),
            archive.to_string_lossy().into(),
        ],
        &selection.root,
        180,
    )?;
    let image = hosting::command(
        "docker",
        &[
            "image".into(),
            "inspect".into(),
            "--format".into(),
            "{{.Id}} {{index .Config.Labels \"org.opencontainers.image.revision\"}}".into(),
            release.image_id.clone(),
        ],
        &selection.root,
        20,
    )?;
    if String::from_utf8_lossy(&image).trim()
        != format!("{} {}", release.image_id, release.source_commit)
    {
        return Err(
            "The server update didn’t match its verified version, so Hearth didn’t use it. Nothing was changed.".into(),
        );
    }
    crate::host_backup::apply(app, selection, signed, release)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> SignedRelease {
        SignedRelease {
            manifest: include_str!("../tests/fixtures/server-release.json").into(),
            signature: include_str!("../tests/fixtures/server-release.json.sig").into(),
        }
    }
    #[test]
    fn release_signature_binds_version_image_origin_and_source() {
        let signed = fixture();
        assert_eq!(verify(&signed).unwrap().version, "0.0.0");
        for (from, to) in [
            ("0.0.0", "9.9.9"),
            ("sha256:0", "sha256:1"),
            ("KBHarris", "attacker"),
            ("source_commit", "other_field"),
        ] {
            let mut altered = fixture();
            altered.manifest = altered.manifest.replace(from, to);
            assert!(verify(&altered).is_err());
        }
        let mut altered = fixture();
        let decoded =
            String::from_utf8(STANDARD.decode(altered.signature.trim()).unwrap()).unwrap();
        let mut lines = decoded.lines().map(str::to_string).collect::<Vec<_>>();
        let mut bytes = STANDARD.decode(&lines[1]).unwrap();
        bytes[30] ^= 1;
        lines[1] = STANDARD.encode(bytes);
        altered.signature = STANDARD.encode(lines.join("\n") + "\n");
        assert!(verify(&altered).is_err());
    }
    #[test]
    fn unsigned_or_injected_compose_override_is_rejected() {
        let root = std::env::temp_dir().join(format!("hearth-update-test-{}", std::process::id()));
        fs::create_dir_all(root.join("deploy")).unwrap();
        fs::write(
            root.join("deploy/compose.runtime.json"),
            r#"{"services":{"server":{"image":"untrusted:latest"}}}"#,
        )
        .unwrap();
        assert!(validate_runtime(&root).is_err());
        let signed = fixture();
        fs::write(
            root.join("deploy/host-update.json"),
            serde_json::to_vec(&signed).unwrap(),
        )
        .unwrap();
        let image = verify(&signed).unwrap().image_id;
        fs::write(
            root.join("deploy/compose.runtime.json"),
            serde_json::json!({"services":{"server":{"image":image}}}).to_string(),
        )
        .unwrap();
        assert!(validate_runtime(&root).is_ok());
        fs::write(
            root.join("deploy/compose.runtime.json"),
            serde_json::json!({"services":{"server":{"image":image,"privileged":true}}})
                .to_string(),
        )
        .unwrap();
        assert!(validate_runtime(&root).is_err());
        fs::remove_file(root.join("deploy/compose.runtime.json")).unwrap();
        fs::remove_file(root.join("deploy/host-update.json")).unwrap();
        fs::remove_dir(root.join("deploy")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
