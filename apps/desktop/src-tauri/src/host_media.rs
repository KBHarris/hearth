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
    let text = path.to_str().ok_or("Media path is unavailable.")?;
    #[cfg(windows)]
    let text = text.strip_prefix("\\\\?\\").unwrap_or(text);
    if text.contains([',', '\n', '\r']) || text.starts_with("UNC\\") {
        return Err("Choose a local host folder without commas or line breaks.".into());
    }
    Ok(text.replace('\\', "/"))
}

pub(crate) fn directory(root: &Path) -> Result<std::path::PathBuf, String> {
    let path = root.join("deploy/media/data");
    let canonical = root
        .canonicalize()
        .map_err(|_| "Cannot inspect host storage.")?;
    if root
        .join("deploy")
        .canonicalize()
        .map_err(|_| "Cannot inspect deployment storage.")?
        != canonical.join("deploy")
    {
        return Err("Deployment files must remain inside the host folder without links.".into());
    }
    let media = root.join("deploy/media");
    if !media.exists() {
        fs::create_dir(&media).map_err(|_| "Cannot prepare media storage.")?;
    }
    if media
        .canonicalize()
        .map_err(|_| "Cannot inspect media storage.")?
        != canonical.join("deploy/media")
    {
        return Err("Media files must remain inside the host folder without links.".into());
    }
    fs::create_dir_all(&path).map_err(|_| "Cannot prepare private media settings.")?;
    if path
        .canonicalize()
        .map_err(|_| "Cannot inspect media storage.")?
        != root
            .canonicalize()
            .map_err(|_| "Cannot inspect host storage.")?
            .join("deploy/media/data")
    {
        return Err(
            "Media storage must remain inside the selected host folder without links.".into(),
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
        &fs::read(path).map_err(|_| "Cannot read the media preference.")?,
    )
    .map_err(|_| "Invalid media preference.".into())
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
        &fs::read(dir.join("settings.json")).map_err(|_| "Cannot read media settings.")?,
    )
    .map_err(|_| "Invalid media settings.")?;
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
    let text = fs::read_to_string(&path).map_err(|_| "Cannot read private media settings.")?;
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
        .map_err(|_| "Cannot relocate private media settings.".into())
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
                fs::copy(backup.join(name), dir.join(file))
                    .map_err(|_| "Cannot restore media settings.")?;
            }
        }
        rebase(root)?;
    } else if root.join("deploy/media/data/enabled.json").exists() {
        hosting::regular(&root.join("deploy/media/data/enabled.json"))?;
        fs::write(root.join("deploy/media/data/enabled.json"), b"false\n")
            .map_err(|_| "Cannot restore disabled media state.")?;
    }
    Ok(())
}
fn ipv4(address: &str) -> Result<Ipv4Addr, String> {
    if let Ok(ip) = address.parse() {
        return Ok(ip);
    }
    (address, 443)
        .to_socket_addrs()
        .map_err(|_| "Cannot resolve the configured public media address.")?
        .find_map(|a| {
            if let std::net::IpAddr::V4(ip) = a.ip() {
                Some(ip)
            } else {
                None
            }
        })
        .ok_or_else(|| "Media hosting currently requires a public IPv4 address.".into())
}
fn mount(path: &Path, target: &str, readonly: bool) -> Result<String, String> {
    let source = docker_path(path)?;
    if source.contains([',', '\n', '\r']) {
        return Err("Choose a host folder without commas or line breaks.".into());
    }
    Ok(format!(
        "type=bind,src={source},dst={target}{}",
        if readonly { ",readonly" } else { "" }
    ))
}
fn configure(selection: &Selection) -> Result<(), String> {
    let bundle = hosting::validate(&selection.root)?;
    if PUBLIC_FILES
        .iter()
        .any(|file| !bundle.files.contains_key(*file))
    {
        return Err("Update this host package before enabling voice and video hosting.".into());
    }
    let dir = directory(&selection.root)?;
    let preferences = dir.join("settings.json");
    let signal_port = if preferences.exists() {
        hosting::regular(&preferences)?;
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(&preferences).map_err(|_| "Cannot read media preferences.")?,
        )
        .map_err(|_| "Invalid media preferences; existing settings were preserved.")?;
        settings["signalPort"]
            .as_u64()
            .filter(|port| (1024..=65535).contains(port))
            .ok_or("Invalid media signaling port; existing settings were preserved.")?
    } else {
        7880
    };
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|_| "Cannot inspect this computer's network.")?;
    // UDP connect selects a route without transmitting a packet.
    socket
        .connect((Ipv4Addr::new(192, 0, 2, 1), 9))
        .map_err(|_| "Connect this computer to a network before enabling media.")?;
    let std::net::IpAddr::V4(lan) = socket
        .local_addr()
        .map_err(|_| "Cannot find a local media address.")?
        .ip()
    else {
        return Err("A local IPv4 network is required.".into());
    };
    if lan.is_loopback() || lan.is_unspecified() || lan.is_multicast() {
        return Err("A usable local IPv4 network is required.".into());
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
            .ok_or("Save your public host address first.")?;
        let public = ipv4(host)?;
        if public.is_private()
            || public.is_loopback()
            || public.is_unspecified()
            || public.is_multicast()
            || public.is_link_local()
        {
            return Err(
                "The configured media address must resolve to a public IPv4 address.".into(),
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
    hosting::command("docker",&args,&selection.root,300).map_err(|_|"Media setup failed. Existing keys and server data were preserved; check Docker and retry.")?;
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
        let _guard=mutex.lock().map_err(|_|"Host controls are unavailable.")?;
        let selection=hosting::selected(&app)?;
        match action.as_str(){
            "status"=>{},
            "enable"=>{
                configure(&selection)?;
                fs::write(directory(&selection.root)?.join("enabled.json"),b"true\n").map_err(|_|"Cannot save media preference.")?;
                hosting::compose(&selection,&["up","-d","--no-build","--wait","--wait-timeout","120"],300).map_err(|_|"Media is configured but did not finish starting. Check Docker and refresh host status.")?;
            },
            "disable"=>{
                if enabled(&selection.root)?{hosting::compose(&selection,&["stop","media","relay"],150)?;}
                fs::write(directory(&selection.root)?.join("enabled.json"),b"false\n").map_err(|_|"Cannot save media preference.")?;
                hosting::compose(&selection,&["up","-d","--no-build","--wait","--wait-timeout","120"],180)?;
            },
            _=>return Err("Unknown media action.".into())
        }
        let enabled=enabled(&selection.root)?;
        let message=if enabled{
            let file=directory(&selection.root)?.join("settings.json");hosting::regular(&file)?;
            let settings:serde_json::Value=serde_json::from_slice(&fs::read(file).map_err(|_|"Cannot read media settings.")?).map_err(|_|"Invalid media settings.")?;
            let port=|name:&str|settings[name].as_u64().filter(|n|(1024..=65535).contains(n)).ok_or("Invalid media port settings.");
            let tls=if settings["turnTls"]==true{format!(", {} TCP for TLS",port("turnTlsPort")?)}else{String::new()};
            format!("Voice/video hosting is enabled. Internet calling needs router ports {} TCP, {} UDP, {} TCP/UDP{} and {}–{} UDP; test from another network.{}",port("tcpPort")?,port("udpPort")?,port("turnPort")?,tls,port("relayMin")?,port("relayMax")?,if settings["turnTls"]==true{" TLS waits for this host's HTTPS certificate."}else{""})
        }else{"Voice/video hosting is off. Direct calls can still use a separately configured relay.".into()};
        Ok(MediaStatus{enabled,message})
    }).await.map_err(|_|"Media controls failed.".to_string())?
}
