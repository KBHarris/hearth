use std::path::Path;

use anyhow::{Context, bail};
use hearth_crypto::IdentityKey;

/// Load the server signing key, generating and persisting one on first start.
pub fn load_or_create(path: &Path) -> anyhow::Result<IdentityKey> {
    if path.exists() {
        let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        let Ok(secret) = <[u8; 32]>::try_from(bytes.as_slice()) else {
            bail!("{} is not a 32-byte Ed25519 secret key", path.display());
        };
        return Ok(IdentityKey::from_bytes(&secret));
    }

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let key = IdentityKey::generate();
    std::fs::write(path, key.to_bytes()).with_context(|| format!("writing {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    tracing::info!(path = %path.display(), "generated new server signing key");
    Ok(key)
}
