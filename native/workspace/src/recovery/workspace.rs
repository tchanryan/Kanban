use super::{
    snapshots::{validate_snapshot, write_new},
    BackupCatalog, BackupEntry, RecoveryHooks,
};
use crate::{
    contracts::{Query, Runtime, WorkspaceStorage},
    drafts::DraftStorage,
    model::*,
    portable::{ImportPreview, ImportReceipt, PortableBackup, PortableStorage, PreparedImport},
    sqlite::SqliteWorkspace,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub app_version: Option<String>,
    pub available: bool,
    pub storage_path: String,
    pub recovery_error: Option<String>,
    pub backup_error: Option<String>,
    pub backups: Vec<BackupEntry>,
    pub secondary: super::SecondaryStatus,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ActiveFile {
    file: String,
}

pub struct ManagedWorkspace {
    release_version: Option<String>,
    directory: PathBuf,
    path: PathBuf,
    store: Option<SqliteWorkspace>,
    runtime: Arc<dyn Runtime>,
    hooks: Arc<dyn RecoveryHooks>,
    recovery_error: Option<String>,
    backup_error: Option<String>,
    last_attempt: Option<chrono::DateTime<chrono::Utc>>,
    prepared_import: Option<PreparedImport>,
}
impl ManagedWorkspace {
    pub fn open(
        directory: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
    ) -> Self {
        Self::open_internal(directory, runtime, hooks, None)
    }
    pub fn open_versioned(
        directory: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
        app_version: String,
    ) -> Self {
        Self::open_internal(directory, runtime, hooks, Some(app_version))
    }
    fn open_internal(
        directory: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
        release_version: Option<String>,
    ) -> Self {
        let mut managed = Self {
            release_version,
            path: directory.join("workspace.sqlite"),
            directory,
            store: None,
            runtime,
            hooks,
            recovery_error: None,
            backup_error: None,
            last_attempt: None,
            prepared_import: None,
        };
        if let Err(error) = managed.load_versioned() {
            managed.store = None;
            managed.recovery_error = Some(error.to_string());
        }
        managed
    }
    fn load_versioned(&mut self) -> Result<()> {
        if let Some(version) = &self.release_version {
            super::release::needs_backup(&self.directory, version)?;
        }
        self.load()?;
        self.publish_release()
    }
    fn publish_release(&self) -> Result<()> {
        if let Some(version) = &self.release_version {
            self.hooks.checkpoint("before-release-publish")?;
            super::release::publish(&self.directory, version, &self.runtime.id())?;
        }
        Ok(())
    }
    fn load(&mut self) -> Result<()> {
        if !self.directory.is_absolute() {
            return Err(StorageError::invalid(
                "Workspace directory must be absolute",
            ));
        }
        fs::create_dir_all(&self.directory)?;
        let pointer = self.directory.join("CURRENT.json");
        let marker = self.directory.join("initialized");
        if pointer.exists() {
            if !marker.exists() {
                write_new(&marker, b"kanban-preview-2")?;
            }
            let active: ActiveFile = serde_json::from_slice(&fs::read(pointer)?)?;
            if active.file != "workspace.sqlite" {
                let id = active
                    .file
                    .strip_suffix(".sqlite")
                    .ok_or_else(|| StorageError::invalid("Invalid active workspace identity"))?;
                uuid::Uuid::parse_str(id)
                    .map_err(|_| StorageError::invalid("Invalid active workspace identity"))?;
            }
            self.path = self.directory.join(active.file);
            // Never recreate a missing selected database.
            validate_snapshot(&self.path, self.runtime.as_ref())?;
        } else if marker.exists() {
            return Err(StorageError::invalid("The active workspace pointer is missing. Select a backup; original files are retained."));
        } else if self.path.exists() {
            validate_snapshot(&self.path, self.runtime.as_ref())?;
            write_new(&marker, b"kanban-preview-2")?;
            self.publish_pointer("workspace.sqlite")?;
        } else {
            if fs::read_dir(&self.directory)?.next().is_some() {
                return Err(StorageError::invalid("The existing workspace is missing. Select a verified backup; files have been retained."));
            }
            write_new(&self.directory.join("initialized"), b"kanban-preview-2")?;
            let store = SqliteWorkspace::open(&self.path, Arc::clone(&self.runtime))?;
            self.publish_pointer("workspace.sqlite")?;
            self.store = Some(store);
            return Ok(());
        }
        if let Some(version) = &self.release_version {
            if super::release::needs_backup(&self.directory, version)? {
                self.catalog()?.create_file(&self.path, "before-upgrade")?;
                let _ = self.secondary().synchronize(&self.catalog()?);
            }
        }
        if super::migration::schema(&self.path)? == 1 {
            let backup = self
                .catalog()?
                .create_file(&self.path, "before-migration")?;
            self.restore(&backup.id, true)?;
            return Ok(());
        }
        self.store = Some(SqliteWorkspace::open(
            &self.path,
            Arc::clone(&self.runtime),
        )?);
        Ok(())
    }
    pub fn storage(&mut self) -> Result<&mut SqliteWorkspace> {
        self.store.as_mut().ok_or_else(|| {
            StorageError::invalid(
                "Workspace requires recovery. Original files have not been replaced.",
            )
        })
    }
    pub fn is_available(&self) -> bool {
        self.store.is_some()
    }
    pub fn preview_import(&mut self, backup: PortableBackup) -> Result<ImportPreview> {
        self.prepared_import = None;
        backup.validate()?;
        let expected = self.storage()?.query(Query::Counts)?.version;
        if !self.storage()?.recovery_drafts()?.is_empty() {
            return Err(StorageError::invalid(
                "Resolve recovery drafts before importing",
            ));
        }
        let preview = ImportPreview {
            ticket: self.runtime.id(),
            counts: backup.counts(),
            expected,
            semantic_sha256: backup.semantic_hash()?,
        };
        self.prepared_import = Some(PreparedImport {
            preview: preview.clone(),
            backup,
        });
        Ok(preview)
    }
    pub fn import_portable(&mut self, ticket: &str, confirmed: bool) -> Result<ImportReceipt> {
        if !confirmed {
            return Err(StorageError::invalid(
                "Confirm replacement before importing",
            ));
        }
        if !self
            .prepared_import
            .as_ref()
            .is_some_and(|p| p.preview.ticket == ticket)
        {
            return Err(StorageError::invalid(
                "Review this backup again before importing",
            ));
        }
        let prepared = self
            .prepared_import
            .take()
            .expect("Validated import ticket");
        if self.storage()?.query(Query::Counts)?.version != prepared.preview.expected
            || !self.storage()?.recovery_drafts()?.is_empty()
        {
            return Err(StorageError::conflict());
        }
        let safety = self.backup("before-import")?;
        let hooks = Arc::clone(&self.hooks);
        self.storage()?
            .replace_portable(&prepared, safety.id, hooks.as_ref())
    }
    pub fn export_portable(&mut self) -> Result<PortableBackup> {
        self.storage()?.export_portable()
    }
    pub fn import_history(&mut self) -> Result<Vec<ImportReceipt>> {
        self.storage()?.import_history()
    }
    fn catalog(&self) -> Result<BackupCatalog> {
        BackupCatalog::new(
            self.directory.join("backups"),
            Arc::clone(&self.runtime),
            Arc::clone(&self.hooks),
        )
    }
    fn secondary(&self) -> super::SecondaryBackups {
        super::SecondaryBackups::new(
            self.directory.clone(),
            Arc::clone(&self.runtime),
            Arc::clone(&self.hooks),
        )
    }
    pub fn select_secondary(&mut self, selected: &Path) -> Result<()> {
        let latest = if self.store.is_some() {
            Some(self.backup_local("secondary-setup")?)
        } else {
            None
        };
        self.secondary().select(
            selected,
            &self.catalog()?,
            latest.as_ref().map(|entry| entry.id.as_str()),
        )
    }
    pub fn disable_secondary(&self) -> Result<()> {
        self.secondary().disable()
    }
    pub fn restore_secondary(&mut self, id: &str, confirmed: bool) -> Result<WorkspaceVersion> {
        if !confirmed {
            return Err(StorageError::invalid(
                "Confirm secondary backup restoration",
            ));
        }
        self.secondary().recover_to_primary(&self.catalog()?, id)?;
        self.restore(id, true)
    }
    pub fn status(&mut self) -> RecoveryStatus {
        let status = self.recovery_inspection().inspect();
        self.backup_error = status.backup_error.clone();
        status
    }
    pub fn recovery_inspection(&self) -> super::RecoveryInspection {
        let status = RecoveryStatus {
            secondary: super::SecondaryStatus {
                directory: None,
                error: None,
                backups: Vec::new(),
            },
            app_version: self.release_version.clone(),
            available: self.store.is_some(),
            storage_path: self.path.display().to_string(),
            recovery_error: self.recovery_error.clone(),
            backup_error: self.backup_error.clone(),
            backups: Vec::new(),
        };
        super::RecoveryInspection::new(status, self.catalog(), self.secondary())
    }
    pub fn backup_now(&mut self) -> Result<BackupEntry> {
        let result = self.backup("manual");
        if let Err(error) = &result {
            self.backup_error = Some(error.to_string());
        }
        result
    }
    fn backup(&mut self, reason: &str) -> Result<BackupEntry> {
        let entry = self.backup_local(reason)?;
        // A failed external copy must not turn an acknowledged local save into a failed save.
        let _ = self.secondary().synchronize(&self.catalog()?);
        Ok(entry)
    }
    fn backup_local(&mut self, reason: &str) -> Result<BackupEntry> {
        let catalog = self.catalog()?;
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| StorageError::invalid("Cannot back up an unavailable workspace"))?;
        let entry = catalog.create(store, reason)?;
        // Publication succeeded even if retention fails. Keep every file on validation failure.
        if reason != "before-restore" {
            self.backup_error = catalog.prune().err().map(|error| error.to_string());
        }
        Ok(entry)
    }
    pub fn backup_if_due(&mut self) {
        let result = self.check_due();
        if let Err(error) = result {
            self.backup_error = Some(error.to_string());
        }
    }
    fn check_due(&mut self) -> Result<()> {
        let now = self.runtime.now();
        if self
            .last_attempt
            .is_some_and(|last| now.signed_duration_since(last).num_seconds() < 30)
        {
            return Ok(());
        }
        if self.store.is_none() {
            return Ok(());
        }
        let version = self.storage()?.query(Query::Counts)?.version;
        if version.revision == 0 {
            return Ok(());
        }
        let entries = self.catalog()?.list()?;
        let latest = entries.first();
        if latest.is_some_and(|entry| entry.version == version) {
            return Ok(());
        }
        let due = latest.is_none_or(|entry| {
            entry
                .created_at
                .parse::<chrono::DateTime<chrono::Utc>>()
                .map(|time| self.runtime.now().signed_duration_since(time).num_seconds() >= 270)
                .unwrap_or(true)
        });
        if due {
            self.last_attempt = Some(now);
            self.backup("automatic")?;
        }
        Ok(())
    }
    pub fn restore(&mut self, id: &str, confirmed: bool) -> Result<WorkspaceVersion> {
        if !confirmed {
            return Err(StorageError::invalid("Confirm backup restoration"));
        }
        if let Some(version) = &self.release_version {
            super::release::needs_backup(&self.directory, version)?;
        }
        let (entry, source) = self.catalog()?.verify(id)?;
        if let (Some(current), Some(source_version)) = (&self.release_version, &entry.app_version) {
            if super::release::version(current)? < super::release::version(source_version)? {
                return Err(StorageError::invalid("This backup was created by a newer application. Use that version or a newer application to restore it."));
            }
        }
        let pending_drafts = match &self.store {
            Some(store) => store.recovery_drafts()?,
            None => Vec::new(),
        };
        if self.store.is_some() {
            self.backup("before-restore")?;
        }
        self.hooks.checkpoint("before-restore-copy")?;
        let name = format!("{}.sqlite", self.runtime.id());
        let path = self.directory.join(&name);
        // Create-new prevents a faulty ID provider from overwriting an older workspace.
        let mut destination = fs::File::options()
            .write(true)
            .create_new(true)
            .open(&path)?;
        std::io::copy(&mut fs::File::open(source)?, &mut destination)?;
        destination.sync_all()?;
        drop(destination);
        if super::snapshots::checksum(&path)? != entry.sha256 {
            return Err(StorageError::invalid("Restore copy checksum mismatch"));
        }
        validate_snapshot(&path, self.runtime.as_ref())?;
        super::migration::upgrade_copy(&path)?;
        let mut restored = SqliteWorkspace::open(&path, Arc::clone(&self.runtime))?;
        let tx = restored.connection.transaction()?;
        tx.execute(
            "UPDATE workspace_meta SET generation=?1,revision=revision+1 WHERE id=1",
            [self.runtime.id()],
        )?;
        tx.commit()?;
        for draft in pending_drafts {
            restored.stage_draft(draft)?;
        }
        let version = restored.query(Query::Counts)?.version;
        self.hooks.checkpoint("before-restore-switch")?;
        self.publish_release()?;
        self.publish_pointer(&name)?;
        // From here no fallible step precedes adoption of the committed pointer.
        self.path = path;
        self.store = Some(restored);
        self.recovery_error = None;
        Ok(version)
    }
    fn publish_pointer(&self, file: &str) -> Result<()> {
        let pending = self
            .directory
            .join(format!("{}.pointer-pending", self.runtime.id()));
        write_new(
            &pending,
            &serde_json::to_vec(&ActiveFile { file: file.into() })?,
        )?;
        fs::rename(pending, self.directory.join("CURRENT.json"))?;
        Ok(())
    }
    pub fn active_path(&self) -> &Path {
        &self.path
    }
}
