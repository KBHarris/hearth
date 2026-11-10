//! Optional local SFU/relay configuration. Transport credentials stay on the host.
use crate::hosting::{self, HostState, Selection};
use serde::Serialize;
use std::{
    fs,
    net::{Ipv4Addr, ToSocketAddrs, UdpSocket},
    path::Path,
};

pub(crate) const PUBLIC_FILES: &[&str] = &[
    "deploy/compose.media.yaml",
    "deploy/compose.turn.yaml",
    "deploy/compose.turn-tls.yaml",
    "deploy/media/setup.mjs",
    "deploy/media/turn-entrypoint.sh",
];
pub(crate) const PRIVATE_FILES: &[&str] = &[
    ".env",
    "livekit.yaml",
    "turnserver.conf",
    "settings.json",
    "enabled.json",
];
const NODE: &str =
    "node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8";
#[derive(Serialize)]
pub struct MediaStatus {
    enabled: bool,
    message: String,
}
fn docker_path(path: &Path) -> Result<String, String> {
    let text = path.to_str().ok_or("Hearth couldn’t read your server folder’s location for voice and video. Move the server folder somewhere else on this computer, then try again.")?;
    #[cfg(windows)]
    let text = text.strip_prefix("\\\\?\\").unwrap_or(text);
    if text.contains([',', '\n', '\r']) || text.starts_with("UNC\\") {
        return Err("Your server folder’s location contains a comma or line break, which voice and video can’t use. Move the server folder somewhere whose folder names have no commas, then try again.".into());
    }
    Ok(text.replace('\\', "/"))
}

pub(crate) fn directory(root: &Path) -> Result<std::path::PathBuf, String> {
    let path = root.join("deploy/media/data");
    let canonical = root
        .canonicalize()
        .map_err(|_| "Hearth couldn’t check your server folder. Try again.")?;
    if root
        .join("deploy")
        .canonicalize()
        .map_err(|_| "Hearth couldn’t check your server folder. Try again.")?
        != canonical.join("deploy")
    {
        return Err("Your server folder contains a link or shortcut to another place, which Hearth doesn’t allow for safety. Use the original server files.".into());
    }
    let media = root.join("deploy/media");
    if !media.exists() {
        fs::create_dir(&media)
            .map_err(|_| "Hearth couldn’t prepare voice and video settings. Try again.")?;
    }
    if media
        .canonicalize()
        .map_err(|_| "Hearth couldn’t check voice and video settings. Try again.")?
        != canonical.join("deploy/media")
    {
        return Err("Voice and video files must stay inside your server folder, with no links or shortcuts to other places.".into());
    }
    fs::create_dir_all(&path)
        .map_err(|_| "Hearth couldn’t prepare private voice and video settings. Try again.")?;
    if path
        .canonicalize()
        .map_err(|_| "Hearth couldn’t check voice and video settings. Try again.")?
        != root
            .canonicalize()
            .map_err(|_| "Hearth couldn’t check your server folder. Try again.")?
            .join("deploy/media/data")
    {
        return Err(
            "Voice and video files must stay inside your server folder, with no links or shortcuts to other places.".into(),
        );
    }
    Ok(path)
}
pub(crate) fn enabled(root: &Path) -> Result<bool, String> {
    let path = root.join("deploy/media/data/enabled.json");
    if !path.exists() {
        return Ok(false);
    }
    hosting::regular(&path)?;
    serde_json::from_slice::<bool>(
        &fs::read(path).map_err(
            |_| "Hearth couldn’t read whether voice and video are turned on. Try again.",
        )?,
    )
    .map_err(|_| {
        "The voice and video on/off setting (enabled.json in your server folder) looks damaged."
            .into()
    })
}
pub(crate) fn options(root: &Path) -> Result<Vec<String>, String> {
    if !enabled(root)? {
        return Ok(vec![]);
    }
    let dir = directory(root)?;
    for file in PRIVATE_FILES {
        hosting::regular(&dir.join(file))?;
    }
    let settings: serde_json::Value = serde_json::from_slice(
        &fs::read(dir.join("settings.json"))
            .map_err(|_| "Hearth couldn’t read your voice and video settings. Try again.")?,
    )
    .map_err(|_| "Your saved voice and video settings look damaged.")?;
    let mut result = vec![
        "--env-file".into(),
        ".env".into(),
        "--env-file".into(),
        "media/data/.env".into(),
        "-f".into(),
        "compose.media.yaml".into(),
        "-f".into(),
        "compose.turn.yaml".into(),
    ];
    if settings["turnTls"] == true {
        result.extend(["-f".into(), "compose.turn-tls.yaml".into()]);
    }
    Ok(result)
}
pub(crate) fn rebase(root: &Path) -> Result<(), String> {
    let dir = directory(root)?;
    let path = dir.join(".env");
    hosting::regular(&path)?;
    let text = fs::read_to_string(&path)
        .map_err(|_| "Hearth couldn’t read your private voice and video settings. Try again.")?;
    let mut lines = vec![];
    for line in text.lines() {
        let rewritten = if line.starts_with("HEARTH_SFU_CONFIG_PATH=") {
            Some(("HEARTH_SFU_CONFIG_PATH", "livekit.yaml"))
        } else if line.starts_with("HEARTH_TURN_CONFIG_PATH=") {
            Some(("HEARTH_TURN_CONFIG_PATH", "turnserver.conf"))
        } else {
            None
        };
        if let Some((key, file)) = rewritten {
            lines.push(format!("{key}={}", docker_path(&dir.join(file))?))
        } else {
            lines.push(line.to_string())
        }
    }
    fs::write(path, lines.join("\n") + "\n")
        .map_err(|_| "Hearth couldn’t update your private voice and video settings for this server folder. Try again.".into())
}
pub(crate) fn restore(
    root: &Path,
    backup: &Path,
    hashes: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    if hashes.keys().any(|file| file.starts_with("media/")) {
        let dir = directory(root)?;
        for file in PRIVATE_FILES {
            let name = format!("media/{file}");
            if hashes.contains_key(&name) {
                if dir.join(file).exists() {
                    hosting::regular(&dir.join(file))?;
                }
                fs::copy(backup.join(name), dir.join(file)).map_err(
                    |_| "Hearth couldn’t restore your voice and video settings from the backup.",
                )?;
            }
        }
        rebase(root)?;
    } else if root.join("deploy/media/data/enabled.json").exists() {
        hosting::regular(&root.join("deploy/media/data/enabled.json"))?;
        fs::write(root.join("deploy/media/data/enabled.json"), b"false\n")
            .map_err(|_| "Hearth couldn’t turn voice and video off while restoring the backup.")?;
    }
    Ok(())
}
fn ipv4(address: &str) -> Result<Ipv4Addr, String> {
    if let Ok(ip) = address.parse() {
        return Ok(ip);
    }
    (address, 443)
        .to_socket_addrs()
        .map_err(|_| "Hearth couldn’t look up your server’s public address. Check the address and your internet connection, then try again.")?
        .find_map(|a| {
            if let std::net::IpAddr::V4(ip) = a.ip() {
                Some(ip)
            } else {
                None
            }
        })
        .ok_or_else(|| "Voice and video hosting needs a public IPv4 internet address, and your server’s public address doesn’t have one.".into())
}
fn mount(path: &Path, target: &str, readonly: bool) -> Result<String, String> {
    let source = docker_path(path)?;
    if source.contains([',', '\n', '\r']) {
        return Err("Your server folder’s location contains a comma or line break, which voice and video can’t use. Move the server folder somewhere whose folder names have no commas, then try again.".into());
    }
    Ok(format!(
        "type=bind,src={source},dst={target}{}",
        if readonly { ",readonly" } else { "" }
    ))
}
pub(crate) fn configure(selection: &Selection) -> Result<(), String> {
    let bundle = hosting::validate(&selection.root)?;
    if PUBLIC_FILES
        .iter()
        .any(|file| !bundle.files.contains_key(*file))
    {
        return Err("These server files are too old for voice and video. Choose Update hosted server first, then turn on voice and video.".into());
    }
    let dir = directory(&selection.root)?;
    let preferences = dir.join("settings.json");
    let signal_port = if preferences.exists() {
        hosting::regular(&preferences)?;
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(&preferences)
                .map_err(|_| "Hearth couldn’t read your voice and video settings. Try again.")?,
        )
        .map_err(|_| "Your saved voice and video settings look damaged. Nothing was changed.")?;
        settings["signalPort"]
            .as_u64()
            .filter(|port| (1024..=65535).contains(port))
            .ok_or("The voice and video connection port in your saved settings looks damaged. Nothing was changed.")?
    } else {
        7880
    };
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| "Hearth couldn’t check this computer’s network connection. Try again.")?;
    // UDP connect selects a route without transmitting a packet.
    socket
        .connect((Ipv4Addr::new(192, 0, 2, 1), 9))
        .map_err(|_| "Connect this computer to a network before turning on voice and video.")?;
    let std::net::IpAddr::V4(lan) = socket
        .local_addr()
        .map_err(|_| "Hearth couldn’t find this computer’s address on your local network. Check your network connection, then try again.")?
        .ip()
    else {
        return Err("Voice and video need this computer to be on a local network with an IPv4 address. Check your network connection.".into());
    };
    if lan.is_loopback() || lan.is_unspecified() || lan.is_multicast() {
        return Err("Voice and video need a working local network connection with an IPv4 address. Check your network connection.".into());
    }
    let mut settings = vec![
        "--turn".to_string(),
        "--profile=sfu25".into(),
        "--bind=0.0.0.0".into(),
        format!("--node-ip={lan}"),
    ];
    if selection.https {
        let host = selection
            .public_address
            .as_deref()
            .ok_or("Save your server’s public address first.")?;
        let public = ipv4(host)?;
        if public.is_private()
            || public.is_loopback()
            || public.is_unspecified()
            || public.is_multicast()
            || public.is_link_local()
        {
            return Err(
                "For voice and video, your server’s public address must point to a public IPv4 internet address.".into(),
            );
        }
        settings.extend([
            format!("--url=wss://{host}/hearth-media"),
            format!("--advertise-ip={public}"),
            "--turn-tls".into(),
            format!("--turn-host={host}"),
        ]);
    } else {
        settings.extend([
            format!("--url=ws://127.0.0.1:{signal_port}"),
            format!("--advertise-ip={lan}"),
            "--no-turn-tls".into(),
        ]);
    }
    let mut args = vec![
        "run".into(),
        "--rm".into(),
        "--network".into(),
        "none".into(),
        "--read-only".into(),
        "--cap-drop".into(),
        "ALL".into(),
        "--tmpfs".into(),
        "/tmp".into(),
        "--mount".into(),
        mount(
            &selection.root.join("deploy/media/setup.mjs"),
            "/opt/setup.mjs",
            true,
        )?,
        "--mount".into(),
        mount(&dir, "/opt/data", false)?,
        NODE.into(),
        "node".into(),
        "/opt/setup.mjs".into(),
    ];
    args.extend(settings);
    hosting::command("docker",&args,&selection.root,300).map_err(|_|"Voice and video setup didn’t finish. Your existing keys and server data are safe. Make sure Docker Desktop is running, then try again.")?;
    rebase(&selection.root)
}
#[tauri::command]
pub async fn host_media(
    app: tauri::AppHandle,
    state: tauri::State<'_, HostState>,
    action: String,
) -> Result<MediaStatus, String> {
    let mutex = state.0.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let _guard=mutex.lock().map_err(|_|"Hearth’s server controls stopped responding. Close and reopen Hearth, then try again.")?;
        let selection=hosting::selected(&app)?;
        match action.as_str(){
            "status"=>{},
            "enable"=>{
                configure(&selection)?;
                fs::write(directory(&selection.root)?.join("enabled.json"),b"true\n").map_err(|_|"Hearth couldn’t save the voice and video setting. Try again.")?;
                hosting::compose(&selection,&["up","-d","--no-build","--wait","--wait-timeout","120"],300).map_err(|_|"Voice and video are set up but didn’t finish starting. Make sure Docker Desktop is running, then choose Refresh status.")?;
            },
            "disable"=>{
                if enabled(&selection.root)?{hosting::compose(&selection,&["stop","media","relay"],150)?;}
                fs::write(directory(&selection.root)?.join("enabled.json"),b"false\n").map_err(|_|"Hearth couldn’t save the voice and video setting. Try again.")?;
                hosting::compose(&selection,&["up","-d","--no-build","--wait","--wait-timeout","120"],180)?;
            },
            _=>return Err("Hearth didn’t recognize that voice and video request. Close and reopen Hearth, then try again.".into())
        }
        let enabled=enabled(&selection.root)?;
        let message=if enabled{
            let file=directory(&selection.root)?.join("settings.json");hosting::regular(&file)?;
            let settings:serde_json::Value=serde_json::from_slice(&fs::read(file).map_err(|_|"Hearth couldn’t read your voice and video settings. Try again.")?).map_err(|_|"Your saved voice and video settings look damaged.")?;
            let port=|name:&str|settings[name].as_u64().filter(|n|(1024..=65535).contains(n)).ok_or("The port numbers in your saved voice and video settings look damaged.");
            let tls=if settings["turnTls"]==true{format!(", {} TCP for secure connections",port("turnTlsPort")?)}else{String::new()};
            format!("Voice and video hosting is on. For calls over the internet, forward these ports on your router: {} TCP, {} UDP, {} TCP/UDP{} and {}–{} UDP. Then test from a different network.{}",port("tcpPort")?,port("udpPort")?,port("turnPort")?,tls,port("relayMin")?,port("relayMax")?,if settings["turnTls"]==true{" Secure connections start working once your server has its HTTPS certificate."}else{""})
        }else{"Voice and video hosting is off. Direct calls can still work through a relay server that was set up separately.".into()};
        Ok(MediaStatus{enabled,message})
    }).await.map_err(|_|"Something went wrong with voice and video settings. Close and reopen Hearth, then try again.".to_string())?
}
