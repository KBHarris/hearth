use std::path::Path;

use anyhow::bail;
use hearth_crypto::IdentityKey;
use zeroize::Zeroizing;

/// Load the server signing key, generating and persisting one on first start.
pub fn load_or_create(path: &Path) -> anyhow::Result<IdentityKey> {
    let bytes = Zeroizing::new(crate::auth::secret_file(path, || {
        IdentityKey::generate().to_bytes().to_vec()
    })?);
    let Ok(secret) = <[u8; 32]>::try_from(bytes.as_slice()) else {
        bail!("{} is not a 32-byte Ed25519 secret key", path.display());
    };
    let secret = Zeroizing::new(secret);
    Ok(IdentityKey::from_bytes(&secret))
}
