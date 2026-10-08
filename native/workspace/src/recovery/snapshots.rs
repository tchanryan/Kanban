use super::RetentionPolicy;
use crate::{
    contracts::Runtime,
    model::*,
    sqlite::{decode, Context, SqliteWorkspace},
};
use rusqlite::{Connection, OpenFlags, MAIN_DB};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};

pub trait RecoveryHooks: Send + Sync {
    fn checkpoint(&self, phase: &'static str) -> Result<()>;
}
pub struct NoFaults;
impl RecoveryHooks for NoFaults {
    fn checkpoint(&self, _: &'static str) -> Result<()> {
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    pub id: String,
    pub created_at: String,
    pub version: WorkspaceVersion,
    pub sha256: String,
    pub bytes: u64,
    pub reason: String,
}

pub struct BackupCatalog {
    directory: PathBuf,
    runtime: Arc<dyn Runtime>,
    hooks: Arc<dyn RecoveryHooks>,
}
impl BackupCatalog {
    pub fn open_existing(
        directory: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
    ) -> Result<Self> {
        if !directory.is_absolute() || !directory.is_dir() {
            return Err(StorageError::invalid(
                "The existing backup directory is unavailable",
            ));
        }
        Ok(Self {
            directory,
            runtime,
            hooks,
        })
    }
    pub fn new(
        directory: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
    ) -> Result<Self> {
        if !directory.is_absolute() {
            return Err(StorageError::invalid("Backup directory must be absolute"));
        }
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory,
            runtime,
            hooks,
        })
    }
    fn path(&self, id: &str, extension: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id).map_err(|_| StorageError::invalid("Invalid backup identity"))?;
        Ok(self.directory.join(format!("{id}.{extension}")))
    }
    pub fn list(&self) -> Result<Vec<BackupEntry>> {
        let mut entries = Vec::new();
        for file in fs::read_dir(&self.directory)? {
            let file = file?;
            if file.path().extension().is_some_and(|v| v == "json") {
                let entry: BackupEntry = serde_json::from_slice(&fs::read(file.path())?)?;
                if file.path() != self.path(&entry.id, "json")? {
                    return Err(StorageError::invalid("Backup catalog identity mismatch"));
                }
                entry
                    .created_at
                    .parse::<chrono::DateTime<chrono::Utc>>()
                    .map_err(|_| StorageError::invalid("Invalid backup date"))?;
                entries.push(entry);
            }
        }
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok(entries)
    }
    pub fn verify(&self, id: &str) -> Result<(BackupEntry, PathBuf)> {
        let (entry, path) = self.verify_bytes(id)?;
        if validate_snapshot(&path, self.runtime.as_ref())? != entry.version {
            return Err(StorageError::invalid("Backup version mismatch"));
        }
        Ok((entry, path))
    }
    fn verify_bytes(&self, id: &str) -> Result<(BackupEntry, PathBuf)> {
        let entry: BackupEntry = serde_json::from_slice(&fs::read(self.path(id, "json")?)?)?;
        if let Some(version) = &entry.app_version {
            super::release::version(version)?;
        }
        entry
            .created_at
            .parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|_| StorageError::invalid("Invalid backup date"))?;
        let path = self.path(id, "sqlite")?;
        require_closed_snapshot(&path)?;
        if entry.id != id
            || entry.sha256 != checksum(&path)?
            || entry.bytes != fs::metadata(&path)?.len()
        {
            return Err(StorageError::invalid(
                "Backup checksum mismatch; original files retained",
            ));
        }
        Ok((entry, path))
    }
    pub fn recoverable(&self) -> Result<(Vec<BackupEntry>, Vec<String>)> {
        let mut entries = Vec::new();
        let mut errors = Vec::new();
        for file in fs::read_dir(&self.directory)? {
            let path = file?.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let id = path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                match self.verify(id) {
                    Ok((entry, _)) => entries.push(entry),
                    Err(error) => errors.push(format!("Backup {id}: {}", error.message)),
                }
            }
        }
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        Ok((entries, errors))
    }
    pub fn copy_verified(&self, source: &BackupCatalog, id: &str) -> Result<BackupEntry> {
        let (entry, path) = source.verify(id)?;
        let metadata = self.path(id, "json")?;
        if metadata.exists() {
            // Identical bytes and metadata inherit the source's full validation above.
            let (existing, _) = self.verify_bytes(id)?;
            if serde_json::to_vec(&existing)? != serde_json::to_vec(&entry)? {
                return Err(StorageError::invalid(
                    "Backup copy identity collision; existing files retained",
                ));
            }
            return Ok(existing);
        }
        let destination = self.path(id, "sqlite")?;
        require_closed_snapshot(&destination)?;
        if !destination.exists() {
            let pending = self
                .directory
                .join(format!("{}.copy-pending", self.runtime.id()));
            self.hooks.checkpoint("before-secondary-copy")?;
            let mut output = File::options()
                .write(true)
                .create_new(true)
                .open(&pending)?;
            std::io::copy(&mut File::open(path)?, &mut output)?;
            output.sync_all()?;
            drop(output);
            // Matching bytes inherit the source's completed integrity/domain validation.
            if checksum(&pending)? != entry.sha256 {
                return Err(StorageError::invalid("Copied backup validation failed"));
            }
            self.hooks.checkpoint("before-secondary-publish")?;
            fs::rename(pending, &destination)?;
        }
        // An interrupted copy may have published SQLite without metadata; admit it only after verification.
        if checksum(&destination)? != entry.sha256
            || fs::metadata(&destination)?.len() != entry.bytes
        {
            return Err(StorageError::invalid(
                "Existing backup copy is damaged; files retained",
            ));
        }
        let pending = self
            .directory
            .join(format!("{}.copy-metadata-pending", self.runtime.id()));
        write_new(&pending, &serde_json::to_vec(&entry)?)?;
        fs::rename(pending, metadata)?;
        Ok(entry)
    }
    pub fn create(&self, store: &SqliteWorkspace, reason: &str) -> Result<BackupEntry> {
        self.create_connection(&store.connection, reason)
    }
    pub(crate) fn create_file(&self, path: &Path, reason: &str) -> Result<BackupEntry> {
        validate_snapshot(path, self.runtime.as_ref())?;
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(std::time::Duration::from_secs(2))?;
        self.create_connection(&connection, reason)
    }
    fn create_connection(&self, connection: &Connection, reason: &str) -> Result<BackupEntry> {
        let id = self.runtime.id();
        let pending = self.path(&id, "pending")?;
        if pending.exists()
            || self.path(&id, "sqlite")?.exists()
            || self.path(&id, "json")?.exists()
        {
            return Err(StorageError::invalid("Backup identity already exists"));
        }
        self.hooks.checkpoint("before-snapshot")?;
        connection.backup(MAIN_DB, &pending, None)?;
        File::options().write(true).open(&pending)?.sync_all()?;
        self.hooks.checkpoint("after-snapshot")?;
        let version = validate_snapshot(&pending, self.runtime.as_ref())?;
        let entry = BackupEntry {
            app_version: super::release::recorded_version(
                self.directory
                    .parent()
                    .ok_or_else(|| StorageError::invalid("Backup directory has no parent"))?,
            )?,
            id: id.clone(),
            created_at: self
                .runtime
                .now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            version,
            sha256: checksum(&pending)?,
            bytes: fs::metadata(&pending)?.len(),
            reason: reason.into(),
        };
        self.hooks.checkpoint("before-publish")?;
        fs::rename(&pending, self.path(&id, "sqlite")?)?;
        let metadata = self.path(&id, "metadata-pending")?;
        write_new(&metadata, &serde_json::to_vec(&entry)?)?;
        fs::rename(&metadata, self.path(&id, "json")?)?;
        self.verify(&id)?;
        Ok(entry)
    }
    pub fn prune(&self) -> Result<()> {
        self.prune_retaining(&std::collections::HashSet::new())
    }
    pub fn prune_retaining(&self, pinned: &std::collections::HashSet<String>) -> Result<()> {
        let entries = self.list()?;
        // No deletion is authorized by unverified catalog claims.
        for entry in &entries {
            self.verify(&entry.id)?;
        }
        let mut keep = RetentionPolicy::default().keep(&entries);
        keep.extend(pinned.iter().cloned());
        self.hooks.checkpoint("before-prune")?;
        for entry in entries {
            if !keep.contains(&entry.id) {
                // Retire metadata first: an interruption can only leave an unlisted file.
                fs::remove_file(self.path(&entry.id, "json")?)?;
                fs::remove_file(self.path(&entry.id, "sqlite")?)?;
            }
        }
        Ok(())
    }
}

fn require_closed_snapshot(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-journal"] {
        let mut sibling = path.as_os_str().to_os_string();
        sibling.push(suffix);
        match fs::metadata(PathBuf::from(sibling)) {
            Ok(metadata) if metadata.len() > 0 => {
                return Err(StorageError::invalid(
                    "Backup is not a closed SQLite snapshot",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = File::options().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
pub(crate) fn checksum(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let length = file.read(&mut buffer)?;
        if length == 0 {
            break;
        }
        digest.update(&buffer[..length]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub(crate) fn validate_snapshot(path: &Path, runtime: &dyn Runtime) -> Result<WorkspaceVersion> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.create_collation("JS_TEXT", |a, b| a.encode_utf16().cmp(b.encode_utf16()))?;
    let schema: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let identity: i64 = connection.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    if ![1, 2].contains(&schema) || identity != 1262636593 {
        return Err(StorageError::invalid("Unsupported backup schema"));
    }
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" || connection.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(StorageError::invalid("Backup integrity validation failed"));
    }
    macro_rules! records {
        ($table:literal, $kind:ty) => {{
            let mut statement = connection.prepare(concat!("SELECT data FROM ", $table))?;
            for data in statement.query_map([], |r| r.get::<_, String>(0))? {
                decode::<$kind>(&data?)?;
            }
        }};
    }
    records!("boards", Board);
    records!("columns", Column);
    records!("items", Item);
    records!("tags", Tag);
    records!("events", ItemEvent);
    records!("scratchpads", Scratchpad);
    records!("settings", Settings);
    if schema == 2 {
        super::migration::verify_ledger(&connection)?;
        let mut statement = connection.prepare("SELECT data FROM drafts")?;
        for data in statement.query_map([], |row| row.get::<_, String>(0))? {
            let draft: crate::drafts::DraftRecord = serde_json::from_str(&data?)?;
            draft.validate()?;
        }
    }
    let context = Context {
        db: &connection,
        runtime,
    };
    context.version()
}
