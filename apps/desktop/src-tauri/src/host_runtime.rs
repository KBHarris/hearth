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
        let program = std::env::var_os("ProgramFiles").ok_or(
            "Hearth couldn’t find Docker Desktop. Choose Install hosting tools, then try again.",
        )?;
        let executable = Path::new(&program).join("Docker/Docker/Docker Desktop.exe");
        use std::os::windows::process::CommandExt;
        std::process::Command::new(executable)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "Docker Desktop couldn’t be opened. Choose Install hosting tools, then try again.")?;
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
        .map_err(|_| "Hearth couldn’t find a place on this computer to download the hosting tools. Nothing was installed.")?
        .join("runtime-4.96.0");
    fs::create_dir_all(&directory)
        .map_err(|_| "Hearth couldn’t prepare the hosting tools download. Try again.")?;
    let path = directory.join(name);
    if path.exists() && hosting::sha256(&path)? == hash {
        return Ok(path);
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(1200))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Hearth couldn’t start the Docker Desktop download. Try again.")?;
    let response = client.get(url).send().and_then(|r| r.error_for_status()).map_err(|_| "Hearth couldn’t download Docker Desktop. Check your internet connection and try again. If it still fails, update Hearth or install Docker Desktop from Docker’s official website.")?;
    let mut source = response.take(2 * 1024 * 1024 * 1024 + 1);
    let temporary = directory.join("installer.partial");
    let mut output =
        fs::File::create(&temporary).map_err(|_| "Hearth couldn’t save the Docker Desktop download. Make sure your computer has free disk space, then try again.")?;
    let count = std::io::copy(&mut source, &mut output)
        .map_err(|_| "The Docker Desktop download was interrupted. Choose Install hosting tools to try again.")?;
    drop(output);
    if count > 2 * 1024 * 1024 * 1024 || hosting::sha256(&temporary)? != hash {
        return Err(
            "The Docker Desktop download was damaged or changed, so nothing was installed. Choose Install hosting tools to try again.".into(),
        );
    }
    if path.exists() {
        hosting::regular(&path)?;
        fs::remove_file(&path).map_err(
            |_| "Hearth couldn’t replace an unfinished Docker Desktop download. Try again.",
        )?;
    }
    fs::rename(&temporary, &path)
        .map_err(|_| "Hearth couldn’t finish downloading Docker Desktop. Try again.")?;
    Ok(path)
}
fn install(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let path = installer(app)?;
        let path = path
            .to_str()
            .ok_or("Hearth couldn’t open the Docker Desktop installer. Try again.")?;
        // A verified fixed script, with the path passed as data, never shell interpolation.
        hosting::command_env("powershell.exe", &["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), "$s = Get-AuthenticodeSignature -LiteralPath $env:HEARTH_RUNTIME_INSTALLER; if ($s.Status -ne 'Valid') { exit 1 }; $p = Start-Process -FilePath $env:HEARTH_RUNTIME_INSTALLER -Verb RunAs -Wait -PassThru; exit $p.ExitCode".into()], Path::new("."), 1200, &[("HEARTH_RUNTIME_INSTALLER", path)])
            .map_err(|_| "Docker Desktop didn’t finish installing. Your Hearth data is safe. Choose Install hosting tools to try again and follow Docker’s setup steps; Docker Desktop may need virtualization and WSL turned on in Windows.")?;
        Ok("Docker Desktop is installed. Finish Docker’s own setup and license steps and restart Windows if it asks, then choose Check hosting tools.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let path = installer(app)?;
        let mount = path
            .parent()
            .ok_or("Hearth couldn’t open the Docker Desktop installer. Try again.")?
            .join("mounted");
        std::fs::create_dir_all(&mount)
            .map_err(|_| "Hearth couldn’t open the Docker Desktop installer. Try again.")?;
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
            let text = executable
                .to_str()
                .ok_or("Hearth couldn’t open the Docker Desktop installer. Try again.")?;
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
            Ok("Docker Desktop is installed. Choose Open hosting tools and finish Docker’s own setup and license steps.".into())
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
            .map_err(|_| "Hearth couldn’t tell which version of Linux this is, so it can’t install the hosting tools for you. Install Docker and Docker Compose yourself, then choose Check hosting tools.")?;
        if !release
            .lines()
            .any(|line| matches!(line, "ID=ubuntu" | "ID=\"ubuntu\""))
        {
            return Err("Hearth can install the hosting tools for you only on Ubuntu. Install Docker and Docker Compose from your Linux system’s own packages, then choose Check hosting tools.".into());
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
        let user = String::from_utf8(user).map_err(|_| "Docker was installed, but Hearth couldn’t find your user name to give you access to it. Choose Install hosting tools to try again.")?;
        let user = user.trim();
        if user.is_empty()
            || !user
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        {
            return Err("Docker was installed, but Hearth can’t give your user account access to it because the user name has unusual characters. Add your account to the docker group yourself.".into());
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
        Ok("Docker and Docker Compose are installed. Sign out of your computer and back in, then choose Check hosting tools. Note: being in the docker group gives your user account administrator-level control of this computer.".into())
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
        let _guard = lock.lock().map_err(|_| "Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let message = match action.as_str() {
            "status" => if ready() { "The hosting tools are ready." } else { "The hosting tools aren’t ready. Install or open Docker Desktop, finish its setup, then choose Check hosting tools." }.into(),
            "install" => if ready() { "The hosting tools are already ready, so nothing was installed.".into() } else { install(&app)? },
            "start" => { start_runtime()?; "Docker Desktop is starting. Finish any setup it asks for, then choose Check hosting tools.".into() }
            _ => return Err("Hearth didn’t recognize that request. Close and reopen Hearth, then try again.".into()),
        };
        Ok(RuntimeStatus { ready: ready(), message })
    }).await.map_err(|_| "Something went wrong checking the hosting tools. Close and reopen Hearth, then try again.".to_string())?
}
