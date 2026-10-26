//! Explicit recovery of one missing store. Never creates/replaces its OS key.
use super::{ERROR, MAX_ENVELOPE, SERVICE, StoredState, valid_envelope, valid_scope};
use keyring::Entry;
use rand_core::{OsRng, RngCore};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

const NOT_FOUND: &str = "No matching encrypted history could be recovered from the earlier Windows app cache. Original files and keys were preserved.";
const AMBIGUOUS: &str = "Different matching history copies were found. Nothing was restored; preserve those files before choosing a recovery source.";
const EXISTS: &str =
    "Encrypted history already exists in this profile. Nothing was overwritten; retry messaging.";
const LIMIT: usize = MAX_ENVELOPE + 2 * 1024 * 1024;
const BUSY: &str = "A matching history file is still in use. Close other Hearth windows and try recovery again. Original files and keys were preserved.";

fn plain(path: &Path) -> bool {
    path.ancestors().all(|part| {
        let Ok(metadata) = fs::symlink_metadata(part) else {
            return false;
        };
        if metadata.file_type().is_symlink() {
            return false;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return false;
            }
        }
        true
    })
}

fn verify(path: &Path, key: &[u8]) -> Result<StoredState, String> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ERROR)?;
    let raw = Zeroizing::new(format!("x'{}'", hex::encode(key)));
    db.pragma_update(None, "key", raw.as_str())
        .map_err(|_| ERROR)?;
    let integrity: String = db
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| ERROR)?;
    if integrity != "ok" {
        return Err(ERROR.into());
    }
    let rows: i64 = db
        .query_row("SELECT count(*) FROM message_state", [], |row| row.get(0))
        .map_err(|_| ERROR)?;
    let saved = db
        .query_row(
            "SELECT revision,envelope FROM message_state WHERE id=1",
            [],
            |row| {
                Ok(StoredState {
                    revision: row.get::<_, i64>(0)? as u64,
                    envelope: row.get(1)?,
                })
            },
        )
        .map_err(|_| ERROR)?;
    if rows != 1
        || saved.revision == 0
        || saved.revision > 9_007_199_254_740_991
        || !valid_envelope(&saved.envelope)
    {
        return Err(ERROR.into());
    }
    Ok(saved)
}

struct Snapshot(PathBuf);
impl Drop for Snapshot {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn stage(
    directory: &Path,
    source: &Path,
    name: &str,
    key: &[u8],
) -> Result<(Snapshot, [u8; 32]), String> {
    if !plain(source)
        || !fs::metadata(source)
            .is_ok_and(|m| m.is_file() && m.len() > 0 && m.len() <= LIMIT as u64)
    {
        return Err(NOT_FOUND.into());
    }
    for suffix in ["-wal", "-journal"] {
        let sidecar = source.with_file_name(format!("{name}.db{suffix}"));
        if sidecar.symlink_metadata().is_ok()
            && (!plain(&sidecar)
                || !fs::metadata(&sidecar).is_ok_and(|m| m.is_file() && m.len() == 0))
        {
            return Err(BUSY.into());
        }
    }
    let source_lock = source.with_file_name(format!("{name}.lock"));
    if !plain(&source_lock) {
        return Err(NOT_FOUND.into());
    }
    let lease = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&source_lock)
        .map_err(|_| NOT_FOUND)?;
    lease.try_lock().map_err(|_| BUSY)?;
    let mut bytes = Vec::new();
    File::open(source)
        .map_err(|_| NOT_FOUND)?
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| NOT_FOUND)?;
    if bytes.is_empty() || bytes.len() > LIMIT {
        return Err(NOT_FOUND.into());
    }
    let mut nonce = [0u8; 16];
    OsRng.fill_bytes(&mut nonce);
    let path = directory.join(format!(".history-recovery-{}.tmp", hex::encode(nonce)));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|_| ERROR)?;
    let snapshot = Snapshot(path);
    file.write_all(&bytes).map_err(|_| ERROR)?;
    file.sync_all().map_err(|_| ERROR)?;
    drop(file);
    verify(&snapshot.0, key)?;
    Ok((snapshot, Sha256::digest(&bytes).into()))
}

fn restore(
    directory: &Path,
    scope: &str,
    key: &[u8],
    candidates: &[PathBuf],
) -> Result<(), String> {
    if !valid_scope(scope) || key.len() != 32 || !plain(directory) {
        return Err(ERROR.into());
    }
    let name = hex::encode(Sha256::digest(scope.as_bytes()));
    let target = directory.join(format!("{name}.db"));
    let target_lock = directory.join(format!("{name}.lock"));
    if target_lock.symlink_metadata().is_ok() && !plain(&target_lock) {
        return Err(ERROR.into());
    }
    let lease = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(target_lock)
        .map_err(|_| ERROR)?;
    lease.try_lock().map_err(|_| ERROR)?;
    if target.symlink_metadata().is_ok() {
        return Err(EXISTS.into());
    }
    let mut selected: Option<(Snapshot, [u8; 32])> = None;
    for source in candidates {
        if source.file_name() != target.file_name() {
            continue;
        }
        let candidate = match stage(directory, source, &name, key) {
            Ok(candidate) => candidate,
            Err(error) if error == BUSY => return Err(error),
            Err(_) => continue,
        };
        if let Some((_, digest)) = &selected {
            if digest != &candidate.1 {
                return Err(AMBIGUOUS.into());
            }
        } else {
            selected = Some(candidate)
        }
    }
    let (snapshot, _) = selected.ok_or(NOT_FOUND)?;
    // Same-directory hard-link publication is atomic and cannot replace a file
    // created by another process. Dropping Snapshot removes only our temp link.
    fs::hard_link(&snapshot.0, &target).map_err(|_| ERROR)?;
    Ok(())
}

pub(super) fn recover(directory: &Path, local_data: &Path, scope: &str) -> Result<(), String> {
    if !valid_scope(scope) {
        return Err("Invalid encrypted message storage request.".into());
    }
    let key = Zeroizing::new(
        Entry::new(SERVICE, scope)
            .map_err(|_| ERROR)?
            .get_secret()
            .map_err(|_| ERROR)?,
    );
    if key.len() != 32 {
        return Err(ERROR.into());
    }
    discover_and_restore(directory, local_data, scope, &key)
}
fn discover_and_restore(
    directory: &Path,
    local_data: &Path,
    scope: &str,
    key: &[u8],
) -> Result<(), String> {
    let name = format!("{}.db", hex::encode(Sha256::digest(scope.as_bytes())));
    let packages = local_data.join("Packages");
    let mut candidates = Vec::new();
    if plain(&packages) {
        for entry in fs::read_dir(packages)
            .map_err(|_| NOT_FOUND)?
            .take(512)
            .flatten()
        {
            let path = entry.path();
            if !plain(&path) || !path.is_dir() {
                continue;
            }
            let candidate = path
                .join("LocalCache/Local/chat.hearth.preview/messages-v1")
                .join(&name);
            if candidate.exists() {
                candidates.push(candidate)
            }
        }
    }
    restore(directory, scope, key, &candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let (Ok(root), Ok(temp)) = (self.0.canonicalize(), std::env::temp_dir().canonicalize())
            else {
                return;
            };
            let name = root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            let suffix = name.strip_prefix("hearth-history-recovery-").unwrap_or("");
            if root.parent() == Some(temp.as_path())
                && suffix.len() == 32
                && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                let _ = fs::remove_dir_all(root);
            }
        }
    }
    fn fixture() -> Fixture {
        let mut nonce = [0; 16];
        OsRng.fill_bytes(&mut nonce);
        let root =
            std::env::temp_dir().join(format!("hearth-history-recovery-{}", hex::encode(nonce)));
        fs::create_dir(&root).unwrap();
        Fixture(root.canonicalize().unwrap())
    }
    fn source(root: &Path, scope: &str, key: &[u8], revision: i64) -> PathBuf {
        fs::create_dir_all(root).unwrap();
        let name = hex::encode(Sha256::digest(scope.as_bytes()));
        File::create(root.join(format!("{name}.lock"))).unwrap();
        let path = root.join(format!("{name}.db"));
        let db = super::super::open_database(&path, key, true).unwrap();
        db.execute(
            "INSERT INTO message_state VALUES(1,?1,?2)",
            rusqlite::params![revision, format!("01{}", "ab".repeat(40))],
        )
        .unwrap();
        drop(db);
        path
    }
    fn scope() -> String {
        ["a".repeat(64), "b".repeat(64), "c".repeat(64)].join(":")
    }
    #[test]
    fn restores_only_missing_verified_history_and_preserves_source() {
        let f = fixture();
        let scope = scope();
        let key = [7; 32];
        let path = source(
            &f.0.join("Packages/test-package/LocalCache/Local/chat.hearth.preview/messages-v1"),
            &scope,
            &key,
            42,
        );
        source(
            &f.0.join("Packages/other-package/LocalCache/Local/other.app/messages-v1"),
            &scope,
            &key,
            7,
        );
        let before = fs::read(&path).unwrap();
        let target = f.0.join("target");
        fs::create_dir(&target).unwrap();
        discover_and_restore(&target, &f.0, &scope, &key).unwrap();
        let restored = target.join(path.file_name().unwrap());
        assert_eq!(verify(&restored, &key).unwrap().revision, 42);
        assert_eq!(fs::read(&restored).unwrap(), before);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(restore(&target, &scope, &key, &[path]), Err(EXISTS.into()));
        assert_eq!(fs::read(restored).unwrap(), before);
    }
    #[test]
    fn refuses_wrong_keys_ambiguous_copies_and_hot_journals() {
        let f = fixture();
        let scope = scope();
        let key = [7; 32];
        let one = source(&f.0.join("one"), &scope, &key, 2);
        let two = source(&f.0.join("two"), &scope, &key, 3);
        let target = f.0.join("target");
        fs::create_dir(&target).unwrap();
        assert!(restore(&target, &scope, &[8; 32], std::slice::from_ref(&one)).is_err());
        assert_eq!(
            restore(&target, &scope, &key, &[one.clone(), two.clone()]),
            Err(AMBIGUOUS.into())
        );
        assert!(!target.join(one.file_name().unwrap()).exists());
        fs::write(one.with_extension("db-journal"), [1]).unwrap();
        assert!(restore(&target, &scope, &key, &[one]).is_err());
        assert_eq!(fs::read_dir(target).unwrap().count(), 1); // target lock only
    }
    #[test]
    fn deduplicates_identical_snapshots_but_rejects_an_active_source() {
        let f = fixture();
        let scope = scope();
        let key = [7; 32];
        let one = source(&f.0.join("one"), &scope, &key, 2);
        let two = f.0.join("two");
        fs::create_dir(&two).unwrap();
        let copy = two.join(one.file_name().unwrap());
        fs::copy(&one, &copy).unwrap();
        fs::copy(one.with_extension("lock"), copy.with_extension("lock")).unwrap();
        let target = f.0.join("target");
        fs::create_dir(&target).unwrap();
        let lease = OpenOptions::new()
            .read(true)
            .write(true)
            .open(one.with_extension("lock"))
            .unwrap();
        lease.lock().unwrap();
        assert!(restore(&target, &scope, &key, std::slice::from_ref(&one)).is_err());
        assert_eq!(
            restore(&target, &scope, &key, &[copy.clone(), one.clone()]),
            Err(BUSY.into())
        );
        drop(lease);
        restore(&target, &scope, &key, &[one, copy]).unwrap();
    }
}
