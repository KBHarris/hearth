//! Explicit local host controls. No remote account can control the host runtime.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_controls_accept_only_local_docker_endpoints() {
        for endpoint in [
            "tcp://example.org:2376",
            "ssh://host",
            "npipe:////server/pipe/docker",
            "unix://host/path",
        ] {
            assert!(!local_docker_endpoint(endpoint));
        }
        for endpoint in [
            "unix:///var/run/docker.sock",
            "npipe:////./pipe/dockerDesktopLinuxEngine",
        ] {
            assert!(local_docker_endpoint(endpoint));
        }
    }
    #[test]
    fn public_address_rejects_credentials_paths_private_and_shared_addresses() {
        for value in [
            "localhost",
            "10.0.0.1",
            "127.0.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "169.254.2.3",
            "https://example.org",
            "example.org/path",
            "user:pass@example.org",
            "example.local",
            "example.org\nINJECT=value",
            "-bad.example.org",
        ] {
            assert!(public_address(value).is_err());
        }
        assert_eq!(
            public_address(" CHAT.EXAMPLE.ORG ").unwrap(),
            "chat.example.org"
        );
        assert_eq!(public_address("203.0.113.8").unwrap(), "203.0.113.8");
    }
    #[test]
    fn other_projects_are_rejected_before_starting_a_process() {
        let selection = Selection {
            root: PathBuf::from("missing"),
            https: false,
            project: "tcgbindr".into(),
            public_address: None,
        };
        assert!(
            compose(&selection, &["down", "--volumes"], 1)
                .unwrap_err()
                .contains("Unknown host project")
        );
    }
    #[test]
    fn configured_port_preserves_custom_hosts_and_rejects_ambiguous_values() {
        assert_eq!(
            parse_local_port("HEARTH_PORT=8080\r\n", 8183).unwrap(),
            8080
        );
        assert_eq!(parse_local_port("", 8183).unwrap(), 8183);
        for text in [
            "HEARTH_PORT=0",
            "HEARTH_PORT=65536",
            "HEARTH_PORT=oops",
            "HEARTH_PORT=8080\nHEARTH_PORT=8183",
        ] {
            assert!(parse_local_port(text, 8080).is_err());
        }
    }
}

#[derive(Default)]
pub struct HostState(pub Arc<Mutex<()>>);
pub(crate) const SHUTDOWN_TIMEOUT: u64 = 150;
#[derive(Debug, Serialize, Deserialize)]
pub struct Selection {
    pub root: PathBuf,
    pub https: bool,
    pub project: String,
    pub public_address: Option<String>,
}
fn public_address(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if let Ok(ip) = value.parse::<std::net::Ipv4Addr>() {
        let [a, b, _, _] = ip.octets();
        if ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()
            || a == 0
            || a >= 224
            || a == 100 && (64..=127).contains(&b)
        {
            return Err("That address only works inside your own network. Enter your public internet address (IPv4) or a domain name instead.".into());
        }
        return Ok(value);
    }
    let labels = value.split('.').collect::<Vec<_>>();
    if value.len() > 253
        || labels.len() < 2
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        || !labels
            .last()
            .is_some_and(|label| label.len() >= 2 && label.bytes().all(|b| b.is_ascii_alphabetic()))
        || ["localhost", "local", "internal"].contains(labels.last().unwrap_or(&""))
    {
        return Err(
            "Enter just your public internet address (IPv4) or domain name, like chat.example.org, without http://, a port number or a path.".into(),
        );
    }
    Ok(value)
}
fn configure_environment(selection: &Selection) -> Result<(), String> {
    if !selection.https {
        return Ok(());
    }
    let path = selection.root.join("deploy/.env");
    regular(&path)?;
    let text = fs::read_to_string(&path)
        .map_err(|_| "Hearth couldn’t read your server’s settings. Nothing was changed.")?;
    let existing = text
        .lines()
        .filter_map(|line| line.strip_prefix("HEARTH_PUBLIC_ADDRESS="))
        .collect::<Vec<_>>();
    if existing.len() > 1 {
        return Err("Your server’s .env settings file lists HEARTH_PUBLIC_ADDRESS more than once. Keep only one HEARTH_PUBLIC_ADDRESS line. Nothing was changed.".into());
    }
    let address = public_address(
        selection
            .public_address
            .as_deref()
            .or(existing.first().copied())
            .unwrap_or(""),
    )?;
    let mut updated = text
        .lines()
        .filter(|line| !line.starts_with("HEARTH_PUBLIC_ADDRESS="))
        .collect::<Vec<_>>()
        .join("\n");
    updated.push_str(&format!("\nHEARTH_PUBLIC_ADDRESS={address}\n"));
    fs::write(path, updated)
        .map_err(|_| "Hearth couldn’t save your server’s public address. Try again.".into())
}
fn allowed_project(value: &str) -> bool {
    value == "hearth-guided-test"
        || value.strip_prefix("hearth-host-").is_some_and(|id| {
            id.len() == 24
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleServer {
    pub image_id: String,
    pub compose_project: String,
    pub backend_port: u16,
}
#[derive(Deserialize)]
pub struct Bundle {
    pub client: BundleClient,
    pub server: BundleServer,
    pub files: BTreeMap<String, String>,
}
#[derive(Deserialize)]
pub struct BundleClient {
    pub version: String,
}
#[derive(Serialize)]
pub struct HostStatus {
    folder: Option<String>,
    https: bool,
    state: String,
    message: String,
    local_url: Option<String>,
    public_address: Option<String>,
}
pub(crate) fn prepared_status(selection: &Selection, message: String) -> HostStatus {
    HostStatus {
        folder: Some(selection.root.to_string_lossy().into()),
        https: selection.https,
        state: "selected".into(),
        message,
        local_url: None,
        public_address: selection.public_address.clone(),
    }
}
#[tauri::command]
pub async fn host_saved(app: tauri::AppHandle) -> Result<Option<HostStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = selection_path(&app)?;
        if !path.exists() { return Ok(None); }
        regular(&path)?;
        let bytes = fs::read(path).map_err(|_| "Hearth couldn’t read your saved server. Open Hosting & updates to fix it.")?;
        if bytes.len() > 16384 { return Err("Your saved server details look damaged. Use Choose server files to pick its original server files again.".into()); }
        let selection: Selection = serde_json::from_slice(&bytes).map_err(|_| "Your saved server needs attention. Use Choose server files to pick its original server files again. Your server data is safe.")?;
        let mut status = prepared_status(&selection, "Saved server found. Choose Refresh status to check the hosting tools.".into());
        match selected_for_recovery(&app) {
            Ok(selection) => {
                let bundle = validate_base(&selection.root)?;
                status.local_url = Some(format!("http://localhost:{}", local_port(&selection, bundle.server.backend_port)?));
            }
            Err(error) => { status.state = "error".into(); status.message = format!("{error} Your saved server was kept. Use Choose server files to pick its original server files and fix it."); }
        }
        Ok(Some(status))
    }).await.map_err(|_| "Hearth couldn’t look up your saved server. Close and reopen Hearth, then try again.".to_string())?
}
pub(crate) fn regular(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|_| "A file Hearth needs for your server is missing.")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("One of your server’s files is a link or an online-only file (for example from OneDrive), which Hearth can’t use. Move the server folder to a normal folder on this computer.".into());
        }
    }
    if !meta.is_file() || meta.is_symlink() {
        return Err("One of your server’s files is a link or folder instead of a normal file, so Hearth won’t use it. Use the original server files.".into());
    }
    Ok(())
}
pub(crate) fn sha256(path: &Path) -> Result<String, String> {
    regular(path)?;
    let mut file =
        fs::File::open(path).map_err(|_| "Hearth couldn’t read one of your server’s files.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Hearth couldn’t read one of your server’s files.")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}
fn validate_base(root: &Path) -> Result<Bundle, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Hearth can’t find your server folder. It may have been moved or deleted. Use Choose server files to pick it again.")?;
    regular(&root.join("manifest.json"))?;
    let raw =
        fs::read(root.join("manifest.json")).map_err(|_| "These server files couldn’t be read. Download them again, or choose the original server folder.")?;
    let signature_path = root.join("manifest.json.sig");
    regular(&signature_path)?;
    let signature =
        fs::read_to_string(signature_path).map_err(|_| "These aren’t verified Hearth server files. Choose the folder from a Hearth server download.")?;
    crate::updates::verify_bytes(&raw, &signature)?;
    if raw.len() > 65536 {
        return Err("These server files look damaged. Download them again.".into());
    }
    let bundle: Bundle = serde_json::from_slice(&raw)
        .map_err(|_| "These server files can’t be used. Choose the unpacked Hearth server files folder that contains manifest.json.")?;
    if !bundle.server.image_id.starts_with("sha256:")
        || bundle.server.image_id.len() != 71
        || !bundle.server.image_id[7..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || !allowed_project(&bundle.server.compose_project)
        || bundle.server.backend_port == 0
    {
        return Err("These server files don’t work with this version of Hearth. Update Hearth or download the matching server files.".into());
    }
    for file in [
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
        let expected = bundle
            .files
            .get(file)
            .ok_or("These server files are incomplete. Download them again.")?;
        let path = root.join(file);
        if path
            .canonicalize()
            .map_err(|_| "These server files are incomplete. Download them again.")?
            != canonical_root.join(file)
            || &sha256(&path)? != expected
        {
            return Err("Some server files were changed or damaged. Download fresh server files, but don’t delete your settings files (.env and s3.json) or your server data.".into());
        }
    }
    Ok(bundle)
}
pub(crate) fn validate(root: &Path) -> Result<Bundle, String> {
    let bundle = validate_base(root)?;
    crate::updates::validate_runtime(root)?;
    Ok(bundle)
}
pub(crate) fn command(
    program: &str,
    args: &[String],
    cwd: &Path,
    seconds: u64,
) -> Result<Vec<u8>, String> {
    command_env(program, args, cwd, seconds, &[])
}
pub(crate) fn command_env(
    program: &str,
    args: &[String],
    cwd: &Path,
    seconds: u64,
    environment: &[(&str, &str)],
) -> Result<Vec<u8>, String> {
    if program == "docker" {
        if let Ok(endpoint) = std::env::var("DOCKER_HOST")
            && std::env::var_os("DOCKER_CONTEXT").is_none()
        {
            if !local_docker_endpoint(&endpoint) {
                return Err("Hearth can only manage a server on this computer, but Docker is set to use a different computer (DOCKER_HOST). Switch Docker back to this computer. Nothing on the other computer was changed.".into());
            }
        } else {
            let endpoint = command_raw(
                "docker",
                &[
                    "context".into(),
                    "inspect".into(),
                    "--format".into(),
                    "{{.Endpoints.docker.Host}}".into(),
                ],
                cwd,
                10,
                &[],
            )?;
            if !local_docker_endpoint(String::from_utf8_lossy(&endpoint).trim()) {
                return Err("Docker is set up to control a different computer. Switch Docker back to its default context on this computer, then try again.".into());
            }
        }
    }
    command_raw(program, args, cwd, seconds, environment)
}
fn local_docker_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with("unix:///") || endpoint.starts_with("npipe:////./pipe/")
}
fn command_raw(
    program: &str,
    args: &[String],
    cwd: &Path,
    seconds: u64,
    environment: &[(&str, &str)],
) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    if std::env::var_os("HEARTH_HOST_TEST_DIR").is_some() {
        eprintln!("Host fixture command: {program} {args:?}");
    }
    let mut command = Command::new(if program == "docker" {
        docker_program()
    } else {
        PathBuf::from(program)
    });
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Credentials are inherited by the subprocess, never interpolated into arguments/logs.
    for &(name, value) in environment {
        command.env(name, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| format!("Hearth couldn’t find {program}. Choose Install hosting tools to install Docker Desktop, then choose Open hosting tools."))?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Hearth couldn’t read your server’s status. Choose Refresh status to try again.")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        // Drain even after the capture limit so a verbose process cannot deadlock.
        let mut buffer = [0u8; 8192];
        while let Ok(count) = output.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if bytes.len() + count <= 4 * 1024 * 1024 {
                bytes.extend_from_slice(&buffer[..count]);
            }
        }
        bytes
    });
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let bytes = reader.join().map_err(|_| "Hearth couldn’t read your server’s status. Choose Refresh status to try again.")?;
                if status.success() {
                    return Ok(bytes);
                }
                return Err("Something went wrong running your server. Make sure Docker Desktop is open, your server is set up, and its ports aren’t used by another app. Your server data is safe.".into());
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Your server took too long to respond. Choose Refresh status before trying again. Your server data is safe.".into());
            }
        }
    }
}
fn docker_program() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(directory) = std::env::var_os("ProgramFiles") {
        let path = PathBuf::from(directory).join("Docker/Docker/resources/bin/docker.exe");
        if path.is_file() {
            return path;
        }
    }
    #[cfg(target_os = "macos")]
    for path in [
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/usr/local/bin/docker",
    ] {
        if Path::new(path).is_file() {
            return PathBuf::from(path);
        }
    }
    #[cfg(target_os = "linux")]
    if Path::new("/usr/bin/docker").is_file() {
        return PathBuf::from("/usr/bin/docker");
    }
    PathBuf::from("docker")
}
pub(crate) fn compose(
    selection: &Selection,
    tail: &[&str],
    seconds: u64,
) -> Result<Vec<u8>, String> {
    compose_files(selection, tail, seconds, true)
}
pub(crate) fn compose_recovery(
    selection: &Selection,
    tail: &[&str],
    seconds: u64,
) -> Result<Vec<u8>, String> {
    compose_files(selection, tail, seconds, false)
}
fn compose_files(
    selection: &Selection,
    tail: &[&str],
    seconds: u64,
    runtime: bool,
) -> Result<Vec<u8>, String> {
    compose_environment(selection, tail, seconds, runtime, &[])
}
fn compose_environment(
    selection: &Selection,
    tail: &[&str],
    seconds: u64,
    runtime: bool,
    environment: &[(&str, &str)],
) -> Result<Vec<u8>, String> {
    if !allowed_project(&selection.project) {
        return Err("Unknown host project.".into());
    }
    let mut args = vec![
        "compose".into(),
        "--project-name".into(),
        selection.project.clone(),
        "-f".into(),
        "compose.yaml".into(),
    ];
    if selection.https {
        args.extend(["-f".into(), "compose.https.yaml".into()]);
    }
    args.extend(crate::host_media::options(&selection.root)?);
    if runtime && selection.root.join("deploy/compose.runtime.json").exists() {
        args.extend(["-f".into(), "compose.runtime.json".into()]);
    }
    args.extend(tail.iter().map(|s| s.to_string()));
    command_env(
        "docker",
        &args,
        &selection.root.join("deploy"),
        seconds,
        environment,
    )
}
const MISSING_HOST_CONFIG: &str = "Hearth found existing server data, but this server folder is missing its original .env or s3.json. Choose the original server folder, or put both files back from your backup. No new passwords were created, and your server data is safe.";
const WRONG_DATABASE_CONFIG: &str = "The database could not verify this host folder's credentials. This can happen when new server files are used with an older server’s data. Choose the original server folder, or put back its matching .env and s3.json, then try again. Your server data and passwords were not changed.";

fn guard_existing_configuration(selection: &Selection) -> Result<(), String> {
    if !allowed_project(&selection.project) {
        return Err("Unknown host project.".into());
    }
    let volumes = command(
        "docker",
        &[
            "volume".into(),
            "ls".into(),
            "-q".into(),
            "--filter".into(),
            format!("label=com.docker.compose.project={}", selection.project),
        ],
        &selection.root,
        20,
    )?;
    if !String::from_utf8_lossy(&volumes).trim().is_empty()
        && [".env", "s3.json"]
            .iter()
            .any(|file| !selection.root.join("deploy").join(file).exists())
    {
        return Err(MISSING_HOST_CONFIG.into());
    }
    Ok(())
}

fn verify_database_configuration(selection: &Selection) -> Result<(), String> {
    let path = selection.root.join("deploy/.env");
    regular(&path)?;
    let text = fs::read_to_string(path)
        .map_err(|_| "Hearth couldn’t read your server’s settings. Nothing was changed.")?;
    let passwords = text
        .lines()
        .filter_map(|line| line.strip_prefix("POSTGRES_PASSWORD="))
        .collect::<Vec<_>>();
    if passwords.len() != 1 {
        return Err(WRONG_DATABASE_CONFIG.into());
    }
    let password = passwords[0].trim();
    // Connect via the service hostname: container-local loopback may use trust auth.
    compose_environment(
        selection,
        &[
            "exec",
            "-T",
            "-e",
            "PGPASSWORD",
            "postgres",
            "psql",
            "-w",
            "-h",
            "postgres",
            "-U",
            "hearth",
            "-d",
            "hearth",
            "-v",
            "ON_ERROR_STOP=1",
            "-tAc",
            "SELECT 1",
        ],
        20,
        true,
        &[("PGPASSWORD", password)],
    )
    .map(|_| ())
    .map_err(|_| WRONG_DATABASE_CONFIG.into())
}
pub(crate) fn selection_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Hearth couldn’t open its storage folder on this computer. Close and reopen Hearth, then try again.")?;
    fs::create_dir_all(&directory).map_err(|_| "Hearth couldn’t open its storage folder on this computer. Close and reopen Hearth, then try again.")?;
    Ok(directory.join("host-selection.json"))
}
pub(crate) fn save_selection(app: &tauri::AppHandle, selection: &Selection) -> Result<(), String> {
    use rand_core::{OsRng, RngCore};
    use std::io::Write;
    let target = selection_path(app)?;
    if target.exists() {
        regular(&target)?;
    }
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let temporary = target.with_extension(format!("{}.partial", hex::encode(nonce)));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "Hearth couldn’t save your server choice. Try again.")?;
    file.write_all(
        &serde_json::to_vec(selection)
            .map_err(|_| "Hearth couldn’t save your server choice. Try again.")?,
    )
    .and_then(|_| file.sync_all())
    .map_err(
        |_| "Hearth couldn’t finish saving your server choice. Your previous choice was kept.",
    )?;
    drop(file);
    fs::rename(temporary, target).map_err(|_| {
        "Hearth couldn’t update your saved server choice. Your previous choice was kept.".into()
    })
}
pub(crate) fn selected_for_recovery(app: &tauri::AppHandle) -> Result<Selection, String> {
    let path = selection_path(app)?;
    regular(&path)?;
    let mut selection: Selection =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Hearth couldn’t read your saved server choice. Use Choose server files to pick your server again.")?)
            .map_err(|_| "Use Choose server files to pick your server files again.")?;
    selection.root = selection
        .root
        .canonicalize()
        .map_err(|_| "Hearth can’t find your server files. They may have been moved or deleted. Use Choose server files to pick them again.")?;
    if validate_base(&selection.root)?.server.compose_project != selection.project {
        return Err("These server files belong to a different server than the one you saved. Use Choose server files to pick the right folder.".into());
    }
    Ok(selection)
}
pub(crate) fn selected(app: &tauri::AppHandle) -> Result<Selection, String> {
    let selection = selected_for_recovery(app)?;
    crate::updates::validate_runtime(&selection.root)?;
    Ok(selection)
}
fn parse_local_port(text: &str, fallback: u16) -> Result<u16, String> {
    let values = text
        .lines()
        .filter_map(|line| line.strip_prefix("HEARTH_PORT="))
        .collect::<Vec<_>>();
    match values.as_slice() {
        [] => Ok(fallback),
        [value] => value
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(|| "HEARTH_PORT in your server’s .env settings file must be a port number from 1 to 65535.".into()),
        _ => Err("Your server’s .env settings file lists HEARTH_PORT more than once. Keep only one HEARTH_PORT line.".into()),
    }
}
pub(crate) fn local_port(selection: &Selection, fallback: u16) -> Result<u16, String> {
    let path = selection.root.join("deploy/.env");
    if !path.exists() {
        return Ok(fallback);
    }
    regular(&path)?;
    parse_local_port(
        &fs::read_to_string(path)
            .map_err(|_| "Hearth couldn’t read your server’s settings. Nothing was changed.")?,
        fallback,
    )
}
pub(crate) fn status(selection: &Selection) -> Result<HostStatus, String> {
    let bundle = validate(&selection.root)?;
    let running = compose(selection, &["ps", "--services", "--status", "running"], 20)?;
    let running = String::from_utf8_lossy(&running);
    let healthy = ["server", "postgres", "storage"]
        .iter()
        .all(|name| running.lines().any(|line| line == *name))
        && (!selection.https || running.lines().any(|line| line == "proxy"));
    Ok(HostStatus {
        folder: Some(selection.root.to_string_lossy().into()),
        https: selection.https,
        state: if healthy {
            "running"
        } else if running.trim().is_empty() {
            "stopped"
        } else {
            "partial"
        }
        .into(),
        message: if healthy {
            "Your server is running. Choose Check server to make sure it’s ready."
        } else {
            "Your server is stopped or only partly running. Choose Start server to start it."
        }
        .into(),
        local_url: Some(format!(
            "http://localhost:{}",
            local_port(selection, bundle.server.backend_port)?
        )),
        public_address: selection.public_address.clone(),
    })
}
#[tauri::command]
pub async fn host_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    https: bool,
    public_address_input: Option<String>,
) -> Result<Option<HostStatus>, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Choose your unpacked Hearth server files folder")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let root = folder
            .into_path()
            .map_err(|_| "Choose a server folder on this computer.")?
            .canonicalize()
            .map_err(|_| "Hearth couldn’t open this folder. Choose another folder.")?;
        let bundle = validate(&root)?;
        let public_address = public_address_input
            .filter(|v| !v.trim().is_empty())
            .map(|v| public_address(&v))
            .transpose()?;
        let selection = Selection {
            root,
            https,
            project: bundle.server.compose_project,
            public_address,
        };
        save_selection(&app, &selection)?;
        Ok(Some(HostStatus {
            folder: Some(selection.root.to_string_lossy().into()),
            https,
            state: "selected".into(),
            message: "Server files selected. Choose Start server when you’re ready.".into(),
            local_url: None,
            public_address: selection.public_address.clone(),
        }))
    })
    .await
    .map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.".to_string())?
}
#[tauri::command]
pub async fn host_control(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    action: String,
) -> Result<HostStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let selection = selected_for_recovery(&app)?;
        if action == "status"
            && let Err(message) = crate::updates::validate_runtime(&selection.root)
        {
            return Ok(HostStatus {
                folder: Some(selection.root.to_string_lossy().into()),
                https: selection.https,
                state: "error".into(),
                message,
                local_url: None,
                public_address: selection.public_address.clone(),
            });
        }
        match control(&selection, &action) {
            Err(message) if action == "status" => Ok(HostStatus {
                folder: Some(selection.root.to_string_lossy().into()),
                https: selection.https,
                state: "error".into(),
                message,
                local_url: None,
                public_address: selection.public_address.clone(),
            }),
            result => result,
        }
    })
    .await
    .map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.".to_string())?
}
pub(crate) fn control(selection: &Selection, action: &str) -> Result<HostStatus, String> {
    let bundle = validate(&selection.root)?;
    match action {
        "start" => {
            guard_existing_configuration(selection)?;
            for file in [".env", "s3.json"] {
                let path = selection.root.join("deploy").join(file);
                if path.exists() {
                    regular(&path)?;
                }
            }
            crate::host_configuration::initialize(&selection.root.join("deploy"))?;
            for file in [".env", "s3.json"] {
                regular(&selection.root.join("deploy").join(file))?;
            }
            configure_environment(selection)?;
            compose(
                selection,
                &[
                    "up",
                    "-d",
                    "--no-recreate",
                    "--wait",
                    "--wait-timeout",
                    "60",
                    "postgres",
                ],
                90,
            )?;
            verify_database_configuration(selection)?;
            if command(
                "docker",
                &[
                    "image".into(),
                    "inspect".into(),
                    bundle.server.image_id.clone(),
                ],
                &selection.root,
                20,
            )
            .is_err()
            {
                let archives = bundle
                    .files
                    .iter()
                    .filter(|(path, _)| {
                        path.starts_with("Hearth_Server_Test_")
                            && path.ends_with(".tar")
                            && !path.contains(['/', '\\'])
                    })
                    .collect::<Vec<_>>();
                if archives.len() != 1 {
                    return Err("These server files are incomplete. Download them again.".into());
                }
                let (name, expected) = archives[0];
                if &sha256(&selection.root.join(name))? != expected {
                    return Err("Part of these server files is damaged or was changed, so Hearth didn’t use it. Download the server files again.".into());
                }
                command(
                    "docker",
                    &[
                        "load".into(),
                        "--input".into(),
                        selection.root.join(name).to_string_lossy().into(),
                    ],
                    &selection.root,
                    180,
                )?;
            }
            compose(
                selection,
                &["up", "-d", "--no-build", "--wait", "--wait-timeout", "120"],
                180,
            ).map_err(|_| format!("Hearth couldn’t finish starting your server. Check that port {} isn’t used by another app and that Docker Desktop is running, then try again. Your existing data and settings were kept.", local_port(selection, bundle.server.backend_port).unwrap_or(bundle.server.backend_port)))?;
        }
        "stop" => {
            // Compose stops in dependency order. Proxy, backend and storage may
            // each use their 30-second grace period before the command returns.
            compose(selection, &["stop", "--timeout", "30"], SHUTDOWN_TIMEOUT)?;
        }
        "status" => {}
        _ => return Err(
            "Hearth didn’t recognize that server request. Close and reopen Hearth, then try again."
                .into(),
        ),
    }
    status(selection)
}

#[tauri::command]
pub async fn host_setup_code(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
) -> Result<String, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let selection = selected(&app)?;
        setup_code(&selection)
    })
    .await
    .map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.".to_string())?
}

pub(crate) fn setup_code(selection: &Selection) -> Result<String, String> {
    let output = compose(
        selection,
        &["exec", "-T", "server", "hearth-server", "--setup-code"],
        20,
    )?;
    let code = String::from_utf8(output)
        .map_err(|_| "Hearth couldn’t get the owner setup code from your server. Make sure it’s running, then try again.")?
        .trim()
        .to_string();
    if code.len() != 64 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(
            "Hearth couldn’t get the owner setup code. Choose Start server first, then try again."
                .into(),
        );
    }
    Ok(code)
}

#[tauri::command]
pub async fn host_configure(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    https: bool,
    public_address_input: Option<String>,
) -> Result<HostStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let mut selection = selected(&app)?;
        let running = command(
            "docker",
            &[
                "ps".into(),
                "--filter".into(),
                format!("label=com.docker.compose.project={}", selection.project),
                "--format".into(),
                "{{.ID}}".into(),
            ],
            &selection.root,
            20,
        )?;
        if !String::from_utf8_lossy(&running).trim().is_empty() {
            return Err(
                "Choose Stop server before changing the public address or secure connection (HTTPS) settings.".into(),
            );
        }
        selection.https = https;
        selection.public_address = public_address_input
            .filter(|v| !v.trim().is_empty())
            .map(|v| public_address(&v))
            .transpose()?;
        save_selection(&app, &selection)?;
        Ok(HostStatus {
            folder: Some(selection.root.to_string_lossy().into()),
            https,
            state: "selected".into(),
            message: "Server settings saved. Choose Start server to use them.".into(),
            local_url: None,
            public_address: selection.public_address.clone(),
        })
    })
    .await
    .map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.".to_string())?
}
