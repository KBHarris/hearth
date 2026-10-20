//! User-level startup enrollment. No system-wide startup or silently granted privileges.
use crate::hosting::{self, HostState};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;
#[derive(Serialize)]
pub struct StartupStatus {
    enabled: bool,
    message: String,
}
#[cfg(any(test, not(target_os = "windows")))]
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
#[cfg(any(test, not(target_os = "windows")))]
fn entry(platform: &str, executable: &str) -> Result<String, String> {
    if executable.contains(['\n', '\r', '\0', '%']) {
        return Err("The app path cannot be enrolled for startup.".into());
    }
    match platform {
        "windows" => Ok(format!(
            "Set shell = CreateObject(\"WScript.Shell\")\r\nshell.Run \"\"\"{}\"\" --host-autostart\", 0, False\r\n",
            executable.replace('"', "\"\"")
        )),
        "macos" => Ok(format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>chat.hearth.host</string><key>ProgramArguments</key><array><string>{}</string><string>--host-autostart</string></array><key>RunAtLoad</key><true/></dict></plist>",
            xml(executable)
        )),
        "linux" => Ok(format!(
            "[Desktop Entry]\nType=Application\nName=Hearth host\nExec=\"{}\" --host-autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            executable
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('`', "\\`")
                .replace('$', "\\$")
        )),
        _ => Err("Startup is unavailable on this operating system.".into()),
    }
}
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let identifier = app.config().identifier.replace('.', "-");
    #[cfg(target_os = "windows")]
    let directory = app
        .path()
        .config_dir()
        .map_err(|_| "Startup folder is unavailable.")?
        .join("Microsoft/Windows/Start Menu/Programs/Startup");
    #[cfg(target_os = "macos")]
    let directory = app
        .path()
        .home_dir()
        .map_err(|_| "Startup folder is unavailable.")?
        .join("Library/LaunchAgents");
    #[cfg(target_os = "linux")]
    let directory = app
        .path()
        .config_dir()
        .map_err(|_| "Startup folder is unavailable.")?
        .join("autostart");
    #[cfg(target_os = "windows")]
    let name = format!("{identifier}-host.lnk");
    #[cfg(target_os = "macos")]
    let name = format!("{identifier}-host.plist");
    #[cfg(target_os = "linux")]
    let name = format!("{identifier}-host.desktop");
    Ok(directory.join(name))
}
#[cfg(not(target_os = "windows"))]
fn write_entry(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        hosting::regular(path)?;
    }
    fs::create_dir_all(path.parent().ok_or("Startup folder is unavailable.")?)
        .map_err(|_| "Cannot prepare startup folder.")?;
    fs::write(path, content).map_err(|_| "Cannot save startup enrollment.".into())
}
#[tauri::command]
pub async fn host_startup(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    enabled: Option<bool>,
) -> Result<StartupStatus, String> {
    let lock = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|_| "Host controls are busy.")?;
        let path = path(&app)?;
        match enabled {
            Some(true) => {
                hosting::selected(&app)?;
                let executable = std::env::current_exe().map_err(|_| "App path is unavailable.")?;
                #[cfg(target_os = "windows")]
                {
                    if path.exists() { hosting::regular(&path)?; }
                    fs::create_dir_all(path.parent().ok_or("Startup folder unavailable.")?).map_err(|_| "Cannot prepare startup folder.")?;
                    hosting::command_env("powershell.exe", &["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:HEARTH_STARTUP_LINK); $s.TargetPath = $env:HEARTH_STARTUP_EXE; $s.Arguments = '--host-autostart'; $s.WindowStyle = 7; $s.Save()".into()], Path::new("."), 30, &[("HEARTH_STARTUP_LINK", path.to_str().ok_or("Startup path unavailable.")?), ("HEARTH_STARTUP_EXE", executable.to_str().ok_or("App path unavailable.")?)])?;
                }
                #[cfg(not(target_os = "windows"))]
                write_entry(&path, &entry(std::env::consts::OS, executable.to_str().ok_or("App path is unavailable.")?)?)?;
            }
            Some(false) if path.exists() => { hosting::regular(&path)?; fs::remove_file(&path).map_err(|_| "Cannot disable startup enrollment.")?; }
            _ => {}
        }
        let mut message = if path.exists() { "Hearth will start this host when you sign in. Keep Docker available. Closing Hearth leaves hosting running." } else { "Hearth startup is disabled. Running containers may still restart with Docker until you choose Stop server." }.to_string();
        if enabled.is_none() && let Ok(data) = app.path().app_data_dir() {
            let status = data.join("host-startup-status.txt");
            if status.exists() && hosting::regular(&status).is_ok() && let Ok(previous) = fs::read_to_string(status) {
                message.push_str(" Last startup attempt: "); message.extend(previous.chars().take(1024));
            }
        }
        Ok(StartupStatus { enabled: path.exists(), message })
    }).await.map_err(|_| "Startup controls are unavailable.".to_string())?
}
pub(crate) fn resume(app: tauri::AppHandle) {
    if !std::env::args().any(|arg| arg == "--host-autostart") {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !path(&app).is_ok_and(|p| p.is_file()) {
            return;
        }
        let state = app.state::<HostState>();
        let Ok(_guard) = state.0.lock() else {
            return;
        };
        let result = (|| {
            crate::host_runtime::start_runtime()?;
            let deadline = Instant::now() + Duration::from_secs(120);
            while !crate::host_runtime::ready() {
                if Instant::now() >= deadline {
                    return Err(
                        "Docker did not become ready. Open Hosting & updates and retry.".into(),
                    );
                }
                std::thread::sleep(Duration::from_secs(2));
            }
            hosting::control(&hosting::selected(&app)?, "start").map(|_| ())
        })();
        if let Ok(data) = app.path().app_data_dir() {
            let message = result
                .err()
                .unwrap_or_else(|| "Host resumed at sign-in.".to_string());
            let _ = fs::write(data.join("host-startup-status.txt"), message);
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_arguments_survive_spaces_and_special_characters() {
        assert!(
            entry("windows", "C:\\A B\\hearth.exe")
                .unwrap()
                .contains("\"\"C:\\A B\\hearth.exe\"\" --host-autostart")
        );
        assert!(
            entry("macos", "/Applications/A&B.app/hearth")
                .unwrap()
                .contains("A&amp;B")
        );
        assert!(entry("linux", "/tmp/A $B/hearth").unwrap().contains("\\$B"));
        for os in ["windows", "macos", "linux"] {
            assert!(entry(os, "/tmp/bad\npath").is_err());
            assert!(entry(os, "%APPDATA%/evil").is_err());
        }
    }
}
