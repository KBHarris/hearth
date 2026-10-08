//! SQLCipher with a random database key in the OS credential store. No file-key fallback.
use keyring::{Entry, Error};
use rand_core::{OsRng, RngCore};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, path::Path};
use tauri::Manager;
use zeroize::Zeroizing;
const SERVICE: &str = "chat.hearth.message-store.v1";
const ERROR: &str = "The encrypted message store is locked, damaged or changed in another window. Preserve it, unlock the system key store and sign in again.";
const MAX_ENVELOPE: usize = (8 * 1024 * 1024 + 41) * 2;
#[derive(Clone, Serialize)]
pub struct StoredState {
    pub revision: u64,
    pub envelope: String,
}
fn valid_scope(scope: &str) -> bool {
    scope.len() == 194
        && scope.split(':').count() == 3
        && scope.split(':').all(|part| {
            part.len() == 64
                && part
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}
fn valid_envelope(value: &str) -> bool {
    value.len() >= 82
        && value.len() <= MAX_ENVELOPE
        && value.len().is_multiple_of(2)
        && value.starts_with("01")
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn open_database(path: &Path, key: &[u8], new: bool) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|_| ERROR)?;
    let raw = Zeroizing::new(format!("x'{}'", hex::encode(key)));
    db.pragma_update(None, "key", raw.as_str())
        .map_err(|_| ERROR)?;
    let version: String = db
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| ERROR)?;
    if version.is_empty() {
        return Err(ERROR.into());
    }
    // Force an authenticated page read before any mutation of an existing database.
    db.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(|_| ERROR)?;
    db.execute_batch(
        "PRAGMA cipher_memory_security=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
    )
    .map_err(|_| ERROR)?;
    if new {
        db.execute_batch("CREATE TABLE message_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0), envelope TEXT NOT NULL);").map_err(|_|ERROR)?;
    }
    Ok(db)
}
fn store(
    directory: &Path,
    service: &str,
    scope: &str,
    write: Option<(u64, &str)>,
) -> Result<Option<StoredState>, String> {
    if !valid_scope(scope)
        || write.is_some_and(|(revision, value)| {
            revision >= 9_007_199_254_740_991 || !valid_envelope(value)
        })
    {
        return Err("Invalid encrypted message storage request.".into());
    }
    std::fs::create_dir_all(directory).map_err(|_| ERROR)?;
    let name = hex::encode(Sha256::digest(scope.as_bytes()));
    let path = directory.join(format!("{name}.db"));
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(format!("{name}.lock")))
        .map_err(|_| ERROR)?;
    lock.lock().map_err(|_| ERROR)?;
    let existed = path.exists();
    let entry = Entry::new(service, scope).map_err(|_| ERROR)?;
    let key = match entry.get_secret() {
        Ok(bytes) => {
            if bytes.len() != 32 || !existed {
                return Err(ERROR.into());
            }
            Zeroizing::new(bytes)
        }
        Err(Error::NoEntry) => {
            if existed {
                return Err(ERROR.into());
            }
            if write.is_none() {
                return Ok(None);
            }
            if write.is_some_and(|(revision, _)| revision != 0) {
                return Err(ERROR.into());
            }
            let mut bytes = Zeroizing::new(vec![0; 32]);
            OsRng.fill_bytes(&mut bytes);
            entry.set_secret(&bytes).map_err(|_| ERROR)?;
            let saved = Zeroizing::new(entry.get_secret().map_err(|_| ERROR)?);
            if saved.as_slice() != bytes.as_slice() {
                return Err(ERROR.into());
            }
            saved
        }
        Err(_) => return Err(ERROR.into()),
    };
    if !existed {
        if write.is_none() {
            return Ok(None);
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&path)
            .map_err(|_| ERROR)?
            .sync_all()
            .map_err(|_| ERROR)?;
    }
    let mut db = open_database(&path, &key, !existed)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| ERROR)?;
    let saved = tx
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
        .optional()
        .map_err(|_| ERROR)?;
    if saved
        .as_ref()
        .is_some_and(|s| s.revision > 9_007_199_254_740_991 || !valid_envelope(&s.envelope))
    {
        return Err(ERROR.into());
    }
    let result = if let Some((expected, envelope)) = write {
        if saved.as_ref().map_or(0, |s| s.revision) != expected {
            return Err(ERROR.into());
        }
        let revision = expected + 1;
        tx.execute("INSERT INTO message_state(id,revision,envelope) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,envelope=excluded.envelope",rusqlite::params![revision as i64,envelope]).map_err(|_|ERROR)?;
        Some(StoredState {
            revision,
            envelope: envelope.into(),
        })
    } else {
        saved
    };
    tx.commit().map_err(|_| ERROR)?;
    Ok(result)
}
#[tauri::command]
pub async fn message_store_read(
    window: tauri::WebviewWindow,
    scope: String,
) -> Result<Option<StoredState>, String> {
    crate::vault_store::allowed(&window)?;
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| ERROR)?
        .join("messages-v1");
    let (directory, service) = (directory, SERVICE);
    #[cfg(feature = "phase1-acceptance")]
    let (directory, service, lease) =
        match crate::phase1::storage_context(&window, &scope, "messages")? {
            Some((directory, service, lease)) => (directory, service, Some(lease)),
            None => (directory, service, None),
        };
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "phase1-acceptance")]
        let _lease = lease;
        store(&directory, service, &scope, None)
    })
    .await
    .map_err(|_| ERROR)?
}
#[tauri::command]
pub async fn message_store_write(
    window: tauri::WebviewWindow,
    scope: String,
    revision: u64,
    envelope: String,
) -> Result<StoredState, String> {
    crate::vault_store::allowed(&window)?;
    let directory = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| ERROR)?
        .join("messages-v1");
    let (directory, service) = (directory, SERVICE);
    #[cfg(feature = "phase1-acceptance")]
    let (directory, service, lease) =
        match crate::phase1::storage_context(&window, &scope, "messages")? {
            Some((directory, service, lease)) => (directory, service, Some(lease)),
            None => (directory, service, None),
        };
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "phase1-acceptance")]
        let _lease = lease;
        store(&directory, service, &scope, Some((revision, &envelope)))
    })
    .await
    .map_err(|_| ERROR)??
    .ok_or_else(|| ERROR.into())
}
#[cfg(feature = "phase1-storage-test")]
pub fn verify_real_store() -> Result<(), String> {
    let service = "chat.hearth.phase1-message-store-test";
    let scope = (0..3)
        .map(|_| hearth_crypto::IdentityKey::generate().public().to_hex())
        .collect::<Vec<_>>()
        .join(":");
    let name = hex::encode(Sha256::digest(scope.as_bytes()));
    let directory = std::env::temp_dir().join(format!("hearth-sqlcipher-test-{}", &scope[..32]));
    let entry = Entry::new(service, &scope).map_err(|_| ERROR)?;
    let value = format!(
        "01{}{}",
        "ab".repeat(40),
        hex::encode(b"HEARTH_SQLCIPHER_LOCAL_PRIVATE_CANARY")
    );
    let alternate = format!("01{}", "cd".repeat(80));
    if directory.exists() || !matches!(entry.get_secret(), Err(Error::NoEntry)) {
        return Err("Test storage unexpectedly exists; preserved.".into());
    }
    let result = (|| {
        assert!(store(&directory, service, &scope, None)?.is_none());
        let first = store(&directory, service, &scope, Some((0, &value)))?.ok_or(ERROR)?;
        assert_eq!(first.revision, 1);
        assert!(store(&directory, service, &scope, Some((0, &alternate))).is_err());
        assert_eq!(
            store(&directory, service, &scope, None)?
                .ok_or(ERROR)?
                .envelope,
            value
        );
        let second = store(&directory, service, &scope, Some((1, &value)))?.ok_or(ERROR)?;
        assert_eq!(second.revision, 2);
        let mut child = std::process::Command::new(std::env::current_exe().map_err(|_| ERROR)?);
        child
            .arg("--verify-message-store-read")
            .arg(&scope)
            .arg(&directory);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            child.creation_flags(0x08000000);
        }
        if !child.output().map_err(|_| ERROR)?.status.success() {
            return Err("Encrypted state failed across a new process.".into());
        }
        std::thread::scope(|threads| {
            let one = threads.spawn(|| store(&directory, service, &scope, Some((2, &value))));
            let two = threads.spawn(|| store(&directory, service, &scope, Some((2, &value))));
            let outcomes = [one.join().unwrap(), two.join().unwrap()];
            assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
        });
        let bytes = std::fs::read(directory.join(format!("{name}.db"))).map_err(|_| ERROR)?;
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(!bytes.windows(32).any(|w| w == &value.as_bytes()[82..114]));
        assert!(open_database(&directory.join(format!("{name}.db")), &[1; 32], false).is_err());
        entry.delete_credential().map_err(|_| ERROR)?;
        assert!(store(&directory, service, &scope, Some((3, &alternate))).is_err());
        assert!(matches!(entry.get_secret(), Err(Error::NoEntry)));
        assert_eq!(
            std::fs::read(directory.join(format!("{name}.db"))).map_err(|_| ERROR)?,
            bytes
        );
        Ok(())
    })();
    match entry.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => {}
        Err(_) => return Err(ERROR.into()),
    }
    for suffix in [".db", ".db-journal", ".lock"] {
        let _ = std::fs::remove_file(directory.join(format!("{name}{suffix}")));
    }
    let _ = std::fs::remove_dir(&directory);
    result
}
#[cfg(feature = "phase1-storage-test")]
pub fn verify_child_read(scope: &str, directory: &Path) -> Result<(), String> {
    if !valid_scope(scope)
        || directory != std::env::temp_dir().join(format!("hearth-sqlcipher-test-{}", &scope[..32]))
    {
        return Err("Invalid test directory.".into());
    }
    let saved = store(
        directory,
        "chat.hearth.phase1-message-store-test",
        scope,
        None,
    )?
    .ok_or(ERROR)?;
    if saved.revision != 2
        || saved.envelope
            != format!(
                "01{}{}",
                "ab".repeat(40),
                hex::encode(b"HEARTH_SQLCIPHER_LOCAL_PRIVATE_CANARY")
            )
    {
        return Err(ERROR.into());
    }
    Ok(())
}
