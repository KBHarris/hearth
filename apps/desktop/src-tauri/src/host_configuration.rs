//! Desktop bootstrap requires Docker, but no separately installed JavaScript runtime.
use crate::hosting;
use rand_core::{OsRng, RngCore};
use serde::Serialize;
use std::{fs, io::Write, path::Path};

fn read(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    hosting::regular(path)?;
    if fs::metadata(path)
        .map_err(|_| "Cannot inspect host configuration.")?
        .len()
        > 65536
    {
        return Err("Host configuration is too large. Existing files were preserved.".into());
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|_| "Cannot read host configuration.".into())
}
fn value(text: &str, name: &str) -> Result<Option<String>, String> {
    let mut result = None;
    for raw in text.lines() {
        let line = raw.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != name {
            continue;
        }
        if result.is_some() {
            return Err(format!(
                "Use exactly one {name}; existing configuration was preserved."
            ));
        }
        if !raw.starts_with(&format!("{name}=")) {
            return Err(format!(
                "Use plain {name}=value in host configuration; existing files were preserved."
            ));
        }
        result = Some(value.trim().to_owned());
    }
    Ok(result)
}
fn random(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}
#[derive(Serialize)]
struct Storage {
    identities: Vec<Identity>,
}
#[derive(Serialize)]
struct Identity {
    name: &'static str,
    credentials: Vec<Credential>,
    actions: [&'static str; 3],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Credential {
    access_key: String,
    secret_key: String,
}
fn prepare(mut text: String, storage: Option<&str>) -> Result<(String, String), String> {
    let password = value(&text, "POSTGRES_PASSWORD")?
        .ok_or("A database password is missing; restore the original configuration.")?;
    if password.len() < 32
        || !password
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("The existing database password is invalid. Restore its original configuration; no password was changed.".into());
    }
    if let Some(port) = value(&text, "HEARTH_PORT")? {
        port.parse::<u16>()
            .ok()
            .filter(|v| *v != 0)
            .ok_or("HEARTH_PORT must be a valid TCP port.")?;
    }
    let mut keys = Vec::new();
    for (name, size) in [("HEARTH_S3_ACCESS_KEY", 16), ("HEARTH_S3_SECRET_KEY", 32)] {
        let existing = value(&text, name)?;
        let key = existing
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| random(size));
        if key.len() < size * 2
            || !key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(format!(
                "{name} must be random hex; existing configuration was preserved."
            ));
        }
        if existing.as_deref().is_none_or(str::is_empty) {
            text = text
                .lines()
                .filter(|line| {
                    let line = line.trim();
                    let line = line.strip_prefix("export ").unwrap_or(line);
                    !line
                        .split_once('=')
                        .is_some_and(|(key, _)| key.trim() == name)
                })
                .collect::<Vec<_>>()
                .join("\n");
            text.push_str(&format!("\n{name}={key}\n"));
        }
        keys.push(key);
    }
    let desired = serde_json::to_string_pretty(&Storage {
        identities: vec![Identity {
            name: "hearth-server",
            credentials: vec![Credential {
                access_key: keys.remove(0),
                secret_key: keys.remove(0),
            }],
            actions: ["Admin", "Read", "Write"],
        }],
    })
    .map_err(|_| "Cannot prepare private storage.")?
        + "\n";
    if let Some(existing) = storage {
        let actual: serde_json::Value = serde_json::from_str(existing)
            .map_err(|_| "Existing S3 configuration is invalid; files were preserved.")?;
        let expected: serde_json::Value =
            serde_json::from_str(&desired).map_err(|_| "Cannot prepare private storage.")?;
        if actual != expected {
            return Err("Existing S3 configuration differs. Restore matching credentials; files were preserved.".into());
        }
    }
    Ok((text, desired))
}
fn create(path: &Path, text: &str) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(
        |_| "Cannot create host configuration. Refresh and retry; existing files were preserved.",
    )?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot finish host configuration. Preserve these files for recovery.".into())
}
pub(crate) fn initialize(directory: &Path) -> Result<(), String> {
    let environment_path = directory.join(".env");
    let storage_path = directory.join("s3.json");
    let original = read(&environment_path)?;
    let storage = read(&storage_path)?;
    let text = match &original {
        Some(text) => text.clone(),
        None => read(&directory.join(".env.example"))?
            .ok_or("The signed host configuration template is missing.")?
            .replace(
                "POSTGRES_PASSWORD=change-me",
                &format!("POSTGRES_PASSWORD={}", random(32)),
            ),
    };
    let (text, desired) = prepare(text, storage.as_deref())?;
    match original {
        None => create(&environment_path, &text)?,
        Some(original) if original != text => {
            fs::write(&environment_path, text).map_err(|_| "Cannot save host configuration.")?
        }
        _ => {}
    }
    if storage.is_none() {
        create(&storage_path, &desired)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!("hearth-bootstrap-{}", random(12)));
        fs::create_dir(&directory).unwrap();
        fs::write(
            directory.join(".env.example"),
            "POSTGRES_PASSWORD=change-me\nHEARTH_PORT=8080\n",
        )
        .unwrap();
        directory
    }
    fn cleanup(directory: &Path) {
        let directory = directory.canonicalize().unwrap();
        assert_eq!(
            directory.parent().unwrap(),
            std::env::temp_dir().canonicalize().unwrap()
        );
        assert!(
            directory
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("hearth-bootstrap-")
        );
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn fresh_native_bootstrap_is_private_and_retry_preserves_exact_credentials() {
        let directory = directory();
        initialize(&directory).unwrap();
        let env = fs::read(directory.join(".env")).unwrap();
        let storage = fs::read(directory.join("s3.json")).unwrap();
        initialize(&directory).unwrap();
        assert_eq!(fs::read(directory.join(".env")).unwrap(), env);
        assert_eq!(fs::read(directory.join("s3.json")).unwrap(), storage);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(directory.join(".env"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        cleanup(&directory);
    }
    #[test]
    fn invalid_or_conflicting_existing_configuration_is_never_written() {
        let valid = format!("POSTGRES_PASSWORD={}\nHEARTH_PORT=8080\n", "a".repeat(64));
        for env in [
            "POSTGRES_PASSWORD=change-me".to_owned(),
            format!("{valid} POSTGRES_PASSWORD={}\n", "b".repeat(64)),
            valid.replace("8080", "0"),
            format!("{valid}export HEARTH_PORT=8183\n"),
            format!("{valid}HEARTH_S3_ACCESS_KEY=not-hex\n"),
        ] {
            let directory = directory();
            fs::write(directory.join(".env"), &env).unwrap();
            assert!(initialize(&directory).is_err());
            assert_eq!(fs::read_to_string(directory.join(".env")).unwrap(), env);
            assert!(!directory.join("s3.json").exists());
            cleanup(&directory);
        }
        let directory = directory();
        fs::write(directory.join(".env"), &valid).unwrap();
        fs::write(directory.join("s3.json"), "{}").unwrap();
        assert!(initialize(&directory).is_err());
        assert_eq!(fs::read_to_string(directory.join(".env")).unwrap(), valid);
        assert_eq!(fs::read_to_string(directory.join("s3.json")).unwrap(), "{}");
        cleanup(&directory);
    }
}
