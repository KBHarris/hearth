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
#[derive(Serialize, Deserialize)]
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
            return Err("Use your public IPv4 address or a public DNS name.".into());
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
            "Enter a public IPv4 address or DNS name, without a scheme, port or path.".into(),
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
    let text = fs::read_to_string(&path).map_err(|_| "Cannot read host configuration.")?;
    let existing = text
        .lines()
        .filter_map(|line| line.strip_prefix("HEARTH_PUBLIC_ADDRESS="))
        .collect::<Vec<_>>();
    if existing.len() > 1 {
        return Err("Use one HEARTH_PUBLIC_ADDRESS in the host configuration; the existing file was preserved.".into());
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
    fs::write(path, updated).map_err(|_| "Cannot save the public host address.".into())
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
pub(crate) fn regular(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "A required host file is missing.")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Host files must not use reparse points.".into());
        }
    }
    if !meta.is_file() || meta.is_symlink() {
        return Err("Host files must be regular files.".into());
    }
    Ok(())
}
pub(crate) fn sha256(path: &Path) -> Result<String, String> {
    regular(path)?;
    let mut file = fs::File::open(path).map_err(|_| "Cannot read the host package.")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Cannot read the host package.")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}
fn validate_base(root: &Path) -> Result<Bundle, String> {
    regular(&root.join("manifest.json"))?;
    let raw =
        fs::read(root.join("manifest.json")).map_err(|_| "Cannot read the package manifest.")?;
    let signature_path = root.join("manifest.json.sig");
    regular(&signature_path)?;
    let signature =
        fs::read_to_string(signature_path).map_err(|_| "Choose a signed Hearth host package.")?;
    crate::updates::verify_bytes(&raw, &signature)?;
    if raw.len() > 65536 {
        return Err("Invalid package manifest.".into());
    }
    let bundle: Bundle = serde_json::from_slice(&raw)
        .map_err(|_| "Choose the extracted Hearth host package containing manifest.json.")?;
    if !bundle.server.image_id.starts_with("sha256:")
        || bundle.server.image_id.len() != 71
        || !bundle.server.image_id[7..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
        || !allowed_project(&bundle.server.compose_project)
        || bundle.server.backend_port == 0
    {
        return Err("This host package is not supported by this client.".into());
    }
    for file in [
        "deploy/compose.yaml",
        "deploy/compose.https.yaml",
        "deploy/setup.mjs",
        "deploy/.env.example",
        "deploy/Caddyfile",
        "deploy/storage-entrypoint.sh",
    ] {
        let expected = bundle
            .files
            .get(file)
            .ok_or("Incomplete host package manifest.")?;
        let path = root.join(file);
        if path
            .canonicalize()
            .map_err(|_| "Host package is incomplete.")?
            .parent()
            != Some(root.join("deploy").as_path())
            || &sha256(&path)? != expected
        {
            return Err("Host package files changed. Extract a fresh package; keep your existing operator configuration and volumes.".into());
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
fn command_env(
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
    let mut command = Command::new(program);
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
    let mut child = command.spawn().map_err(|_| format!("{program} is unavailable. Install Docker Desktop with Compose, then start Docker Desktop."))?;
    let mut output = child
        .stdout
        .take()
        .ok_or("Could not capture host status.")?;
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
                let bytes = reader.join().map_err(|_| "Could not read host status.")?;
                if status.success() {
                    return Ok(bytes);
                }
                return Err("The host operation failed. Check that Docker Desktop is running, the selected package is configured, and its ports are available. Your host data was preserved.".into());
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The host operation timed out. Refresh its status before retrying. Your host data was preserved.".into());
            }
        }
    }
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
const MISSING_HOST_CONFIG: &str = "Existing Hearth server data was found, but this folder is missing its original .env or s3.json. Choose the original host folder, or restore both configuration files from its backup. No new passwords were generated and existing data was preserved.";
const WRONG_DATABASE_CONFIG: &str = "The database could not verify this host folder's credentials. This can happen when a new host package is used with an older server's data. Choose the original host folder or restore its matching .env and s3.json, then retry. Existing data and passwords were preserved.";

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
    let text = fs::read_to_string(path).map_err(|_| "Cannot read host configuration.")?;
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
fn selection_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "Local app storage is unavailable.")?;
    fs::create_dir_all(&directory).map_err(|_| "Local app storage is unavailable.")?;
    Ok(directory.join("host-selection.json"))
}
pub(crate) fn selected_for_recovery(app: &tauri::AppHandle) -> Result<Selection, String> {
    let path = selection_path(app)?;
    regular(&path)?;
    let mut selection: Selection =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read host selection.")?)
            .map_err(|_| "Choose your host package again.")?;
    selection.root = selection
        .root
        .canonicalize()
        .map_err(|_| "The selected host package is missing.")?;
    if validate_base(&selection.root)?.server.compose_project != selection.project {
        return Err("Host selection does not match this package.".into());
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
            .ok_or_else(|| "HEARTH_PORT must be a valid TCP port in the host's .env.".into()),
        _ => Err("Use exactly one HEARTH_PORT entry in the host's .env.".into()),
    }
}
pub(crate) fn local_port(selection: &Selection, fallback: u16) -> Result<u16, String> {
    let path = selection.root.join("deploy/.env");
    if !path.exists() {
        return Ok(fallback);
    }
    regular(&path)?;
    parse_local_port(
        &fs::read_to_string(path).map_err(|_| "Cannot read host configuration.")?,
        fallback,
    )
}
fn status(selection: &Selection) -> Result<HostStatus, String> {
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
            "Hosting services are running. Use Check server to confirm Hearth is ready."
        } else {
            "Hosting services are stopped or incomplete."
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
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Choose the extracted Hearth host package")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let root = folder
            .into_path()
            .map_err(|_| "Choose a local host folder.")?
            .canonicalize()
            .map_err(|_| "Cannot open this folder.")?;
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
        let bytes = serde_json::to_vec(&selection).map_err(|_| "Cannot save host selection.")?;
        fs::write(selection_path(&app)?, bytes).map_err(|_| "Cannot save host selection.")?;
        Ok(Some(HostStatus {
            folder: Some(selection.root.to_string_lossy().into()),
            https,
            state: "selected".into(),
            message: "Host package selected. Start it when ready.".into(),
            local_url: None,
            public_address: selection.public_address.clone(),
        }))
    })
    .await
    .map_err(|_| "Host controls are unavailable.".to_string())?
}
#[tauri::command]
pub async fn host_control(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    action: String,
) -> Result<HostStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
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
    .map_err(|_| "Host controls are unavailable.".to_string())?
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
                    return Err("The server image archive is missing from this package.".into());
                }
                let (name, expected) = archives[0];
                if &sha256(&selection.root.join(name))? != expected {
                    return Err("The server archive checksum failed.".into());
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
            ).map_err(|_| format!("Hearth could not finish starting. Check whether local port {} is already in use and whether Docker services are healthy, then retry. Existing data and configuration were preserved.", local_port(selection, bundle.server.backend_port).unwrap_or(bundle.server.backend_port)))?;
        }
        "stop" => {
            // Compose stops in dependency order. Proxy, backend and storage may
            // each use their 30-second grace period before the command returns.
            compose(selection, &["stop", "--timeout", "30"], SHUTDOWN_TIMEOUT)?;
        }
        "status" => {}
        _ => return Err("Unknown host action.".into()),
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
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let selection = selected(&app)?;
        setup_code(&selection)
    })
    .await
    .map_err(|_| "Host controls are unavailable.".to_string())?
}

pub(crate) fn setup_code(selection: &Selection) -> Result<String, String> {
    let output = compose(
        selection,
        &["exec", "-T", "server", "hearth-server", "--setup-code"],
        20,
    )?;
    let code = String::from_utf8(output)
        .map_err(|_| "The local setup code is unavailable.")?
        .trim()
        .to_string();
    if code.len() != 64 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("The local setup code is unavailable. Start this host first.".into());
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
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
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
                "Stop this host before changing its public address or HTTPS settings.".into(),
            );
        }
        selection.https = https;
        selection.public_address = public_address_input
            .filter(|v| !v.trim().is_empty())
            .map(|v| public_address(&v))
            .transpose()?;
        fs::write(
            selection_path(&app)?,
            serde_json::to_vec(&selection).map_err(|_| "Cannot save host settings.")?,
        )
        .map_err(|_| "Cannot save host settings.")?;
        Ok(HostStatus {
            folder: Some(selection.root.to_string_lossy().into()),
            https,
            state: "selected".into(),
            message: "Host settings saved. Start the server to apply them.".into(),
            local_url: None,
            public_address: selection.public_address.clone(),
        })
    })
    .await
    .map_err(|_| "Host controls are unavailable.".to_string())?
}
