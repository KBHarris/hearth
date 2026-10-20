//! Explicit vendor/package-manager installation. Consent remains in the OS installer.
use crate::hosting::{self, HostState};
use serde::Serialize;
use std::path::Path;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use tauri::Manager;
#[derive(Serialize)]
pub struct RuntimeStatus {
    ready: bool,
    message: String,
}
pub(crate) fn ready() -> bool {
    hosting::command(
        "docker",
        &["info".into(), "--format".into(), "{{.OSType}}".into()],
        Path::new("."),
        15,
    )
    .is_ok_and(|v| String::from_utf8_lossy(&v).trim() == "linux")
        && hosting::command(
            "docker",
            &["compose".into(), "version".into()],
            Path::new("."),
            15,
        )
        .is_ok()
}
pub(crate) fn start_runtime() -> Result<(), String> {
    if ready() {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let program = std::env::var_os("ProgramFiles").ok_or("Docker Desktop is unavailable.")?;
        let executable = Path::new(&program).join("Docker/Docker/Docker Desktop.exe");
        use std::os::windows::process::CommandExt;
        std::process::Command::new(executable)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "Install Docker Desktop, then retry.")?;
    }
    #[cfg(target_os = "macos")]
    hosting::command(
        "/usr/bin/open",
        &["-a".into(), "Docker".into()],
        Path::new("/"),
        20,
    )?;
    #[cfg(target_os = "linux")]
    hosting::command(
        "systemctl",
        &["--user".into(), "start".into(), "docker-desktop".into()],
        Path::new("/"),
        30,
    )?;
    Ok(())
}
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn installer(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use std::{fs, io::Read, time::Duration};
    // Vendor checksums checked 2026-10-20; deliberately immutable, refreshed with app releases.
    #[cfg(target_os = "windows")]
    let (url, hash, name) = (
        "https://desktop.docker.com/win/main/amd64/243774/Docker%20Desktop%20Installer.exe",
        "3f75d46a07ff7c7adcc42e55b2bab862e25a459351723ac2633de9ad22a5b4b6",
        "Docker-Installer.exe",
    );
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let (url, hash, name) = (
        "https://desktop.docker.com/mac/main/arm64/243774/Docker.dmg",
        "d21bd8787e8761b22c2b1b78c34ffa99abb6c06219b43ba84b6b45087a35c9fe",
        "Docker.dmg",
    );
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    let (url, hash, name) = (
        "https://desktop.docker.com/mac/main/amd64/243774/Docker.dmg",
        "cdb0a193ba3fc4e1ecaa827061ab1f636df04db60c9bc109a33e2c3a62dad67a",
        "Docker.dmg",
    );
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Runtime download storage is unavailable.")?
        .join("runtime-4.96.0");
    fs::create_dir_all(&directory).map_err(|_| "Cannot prepare runtime download.")?;
    let path = directory.join(name);
    if path.exists() && hosting::sha256(&path)? == hash {
        return Ok(path);
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(1200))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize vendor download.")?;
    let response = client.get(url).send().and_then(|r| r.error_for_status()).map_err(|_| "The pinned Docker installer is unavailable. Update Hearth or install Docker using its official installer.")?;
    let mut source = response.take(2 * 1024 * 1024 * 1024 + 1);
    let temporary = directory.join("installer.partial");
    let mut output =
        fs::File::create(&temporary).map_err(|_| "Cannot save the runtime installer.")?;
    let count = std::io::copy(&mut source, &mut output)
        .map_err(|_| "Runtime download interrupted. Retry installation.")?;
    drop(output);
    if count > 2 * 1024 * 1024 * 1024 || hosting::sha256(&temporary)? != hash {
        return Err(
            "Runtime installer checksum verification failed. Nothing was installed.".into(),
        );
    }
    if path.exists() {
        hosting::regular(&path)?;
        fs::remove_file(&path).map_err(|_| "Cannot replace an incomplete runtime download.")?;
    }
    fs::rename(&temporary, &path).map_err(|_| "Cannot finish runtime download.")?;
    Ok(path)
}
fn install(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let path = installer(app)?;
        let path = path.to_str().ok_or("Installer path is unavailable.")?;
        // A verified fixed script, with the path passed as data, never shell interpolation.
        hosting::command_env("powershell.exe", &["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), "$s = Get-AuthenticodeSignature -LiteralPath $env:HEARTH_RUNTIME_INSTALLER; if ($s.Status -ne 'Valid') { exit 1 }; $p = Start-Process -FilePath $env:HEARTH_RUNTIME_INSTALLER -Verb RunAs -Wait -PassThru; exit $p.ExitCode".into()], Path::new("."), 1200, &[("HEARTH_RUNTIME_INSTALLER", path)])
            .map_err(|_| "Docker installation did not finish. Open the Windows App Installer and check Docker Desktop setup, virtualization and WSL requirements. Existing Hearth data was preserved.")?;
        Ok("Docker Desktop installation finished. Complete Docker’s license/setup prompts and restart Windows if requested, then check the runtime again.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let path = installer(app)?;
        let mount = path
            .parent()
            .ok_or("Installer path unavailable.")?
            .join("mounted");
        std::fs::create_dir_all(&mount).map_err(|_| "Cannot prepare installer mount.")?;
        let args = vec![
            "attach".into(),
            "-nobrowse".into(),
            "-readonly".into(),
            "-mountpoint".into(),
            mount.to_string_lossy().into_owned(),
            path.to_string_lossy().into_owned(),
        ];
        hosting::command("/usr/bin/hdiutil", &args, Path::new("/"), 120)?;
        let result = (|| {
            let docker = mount.join("Docker.app");
            hosting::command(
                "/usr/bin/codesign",
                &[
                    "--verify".into(),
                    "--deep".into(),
                    "--strict".into(),
                    docker.to_string_lossy().into_owned(),
                ],
                Path::new("/"),
                120,
            )?;
            let executable = docker.join("Contents/MacOS/install");
            let text = executable.to_str().ok_or("Installer path unavailable.")?;
            // AppleScript quotes the path as a shell argument itself.
            let literal = text.replace('\\', "\\\\").replace('"', "\\\"");
            hosting::command(
                "/usr/bin/osascript",
                &[
                    "-e".into(),
                    format!(
                        "do shell script (quoted form of \"{literal}\") with administrator privileges"
                    ),
                ],
                Path::new("/"),
                1200,
            )?;
            Ok("Docker Desktop installed. Open the runtime and complete Docker’s own license and setup prompts.".into())
        })();
        let _ = hosting::command(
            "/usr/bin/hdiutil",
            &["detach".into(), mount.to_string_lossy().into_owned()],
            Path::new("/"),
            60,
        );
        result
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        let release = std::fs::read_to_string("/etc/os-release")
            .map_err(|_| "Cannot identify this Linux distribution.")?;
        if !release
            .lines()
            .any(|line| matches!(line, "ID=ubuntu" | "ID=\"ubuntu\""))
        {
            return Err("Automatic Linux runtime setup currently supports Ubuntu. Use your distribution’s supported Docker and Compose packages, then check again.".into());
        }
        hosting::command(
            "pkexec",
            [
                "/usr/bin/apt-get",
                "install",
                "-y",
                "docker.io",
                "docker-compose-v2",
            ]
            .map(String::from)
            .as_slice(),
            Path::new("/"),
            1200,
        )?;
        let user = hosting::command("/usr/bin/id", &["-un".into()], Path::new("/"), 10)?;
        let user = String::from_utf8(user).map_err(|_| "Cannot identify the current user.")?;
        let user = user.trim();
        if user.is_empty()
            || !user
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        {
            return Err("Unsupported user name for runtime enrollment.".into());
        }
        hosting::command(
            "pkexec",
            ["/usr/sbin/usermod", "--append", "--groups", "docker", user]
                .map(String::from)
                .as_slice(),
            Path::new("/"),
            60,
        )?;
        hosting::command(
            "pkexec",
            ["/usr/bin/systemctl", "enable", "--now", "docker"]
                .map(String::from)
                .as_slice(),
            Path::new("/"),
            120,
        )?;
        Ok("Docker Engine and Compose installed from Ubuntu packages. Sign out and back in to activate Docker access, then check the runtime. Docker group membership grants host administration privileges.".into())
    }
}
#[tauri::command]
pub async fn host_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    action: String,
) -> Result<RuntimeStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let message = match action.as_str() {
            "status" => if ready() { "Docker and Compose are ready for Linux containers." } else { "Docker with Compose is not ready. Install or start Docker Desktop, complete its setup, then check again." }.into(),
            "install" => if ready() { "The runtime is already ready; nothing was installed.".into() } else { install(&app)? },
            "start" => { start_runtime()?; "Docker was asked to start. Complete its setup, then check again.".into() }
            _ => return Err("Unknown runtime action.".into()),
        };
        Ok(RuntimeStatus { ready: ready(), message })
    }).await.map_err(|_| "Runtime controls are unavailable.".to_string())?
}
