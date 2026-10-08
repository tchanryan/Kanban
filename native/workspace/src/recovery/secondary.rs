use super::{snapshots::write_new, BackupCatalog, BackupEntry, RecoveryHooks};
use crate::{
    contracts::Runtime,
    model::{Result, StorageError},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Location {
    directory: PathBuf,
    owner: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryStatus {
    pub directory: Option<String>,
    pub error: Option<String>,
    pub backups: Vec<BackupEntry>,
}

pub struct SecondaryBackups {
    workspace: PathBuf,
    runtime: Arc<dyn Runtime>,
    hooks: Arc<dyn RecoveryHooks>,
}
impl SecondaryBackups {
    pub fn new(
        workspace: PathBuf,
        runtime: Arc<dyn Runtime>,
        hooks: Arc<dyn RecoveryHooks>,
    ) -> Self {
        Self {
            workspace,
            runtime,
            hooks,
        }
    }
    fn read(&self) -> Result<Option<Location>> {
        let path = self.workspace.join("SECONDARY.json");
        if !path.exists() {
            return Ok(None);
        }
        let location: Option<Location> = serde_json::from_slice(&fs::read(path)?)?;
        if let Some(location) = &location {
            if !location.directory.is_absolute() {
                return Err(StorageError::invalid("Invalid secondary backup path"));
            }
            uuid::Uuid::parse_str(&location.owner)
                .map_err(|_| StorageError::invalid("Invalid secondary backup identity"))?;
        }
        Ok(location)
    }
    fn catalog_at(&self, location: &Location) -> Result<BackupCatalog> {
        // Never recreate an absent drive or accept a replacement drive at the same letter.
        if !location.directory.is_dir()
            || fs::canonicalize(&location.directory).ok().as_ref() != Some(&location.directory)
            || fs::read_to_string(location.directory.join("kanban.owner"))
                .ok()
                .as_deref()
                != Some(location.owner.as_str())
        {
            return Err(StorageError::invalid("The selected backup folder is unavailable or its identity changed. Reconnect its drive or select a folder again."));
        }
        BackupCatalog::open_existing(
            location.directory.clone(),
            Arc::clone(&self.runtime),
            Arc::clone(&self.hooks),
        )
    }
    pub fn status(&self) -> SecondaryStatus {
        let mut status = SecondaryStatus {
            directory: None,
            error: None,
            backups: Vec::new(),
        };
        let result = (|| -> Result<()> {
            if let Some(location) = self.read()? {
                status.directory = Some(location.directory.display().to_string());
                let (entries, errors) = self.catalog_at(&location)?.recoverable()?;
                status.backups = entries;
                if !errors.is_empty() {
                    return Err(StorageError::invalid(errors.join("; ")));
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            status.error = Some(error.to_string());
        }
        status
    }
    fn publish(&self, location: Option<Location>) -> Result<()> {
        let pending = self
            .workspace
            .join(format!("{}.secondary-pending", self.runtime.id()));
        write_new(&pending, &serde_json::to_vec(&location)?)?;
        self.hooks.checkpoint("before-secondary-settings")?;
        fs::rename(pending, self.workspace.join("SECONDARY.json"))?;
        Ok(())
    }
    /// The caller supplies only a path returned by the operating system's folder picker.
    pub fn select(
        &self,
        selected: &Path,
        primary: &BackupCatalog,
        latest: Option<&str>,
    ) -> Result<()> {
        if !selected.is_absolute() {
            return Err(StorageError::invalid("Choose an absolute backup folder"));
        }
        let selected = fs::canonicalize(selected)?;
        let workspace = fs::canonicalize(&self.workspace)?;
        if selected.starts_with(&workspace) {
            return Err(StorageError::invalid(
                "Choose a folder outside application storage",
            ));
        }
        let location = if selected.join("kanban.owner").exists() {
            let owner = fs::read_to_string(selected.join("kanban.owner"))?;
            uuid::Uuid::parse_str(&owner)
                .map_err(|_| StorageError::invalid("Invalid backup folder identity"))?;
            Location {
                directory: selected,
                owner,
            }
        } else {
            if latest.is_none() {
                return Err(StorageError::invalid(
                    "Recovery requires an existing verified backup folder",
                ));
            }
            let owner = self.runtime.id();
            uuid::Uuid::parse_str(&owner)
                .map_err(|_| StorageError::invalid("Invalid backup folder identity"))?;
            let directory = selected.join(format!("Kanban-backups-{owner}"));
            fs::create_dir(&directory)?;
            write_new(&directory.join("kanban.owner"), owner.as_bytes())?;
            Location {
                directory: fs::canonicalize(directory)?,
                owner,
            }
        };
        let catalog = self.catalog_at(&location)?;
        let (entries, errors) = catalog.recoverable()?;
        if !errors.is_empty() {
            return Err(StorageError::invalid(errors.join("; ")));
        }
        if let Some(id) = latest {
            catalog.copy_verified(primary, id)?;
            for entry in primary.list()? {
                catalog.copy_verified(primary, &entry.id)?;
            }
            catalog.prune()?;
        } else if entries.is_empty() {
            return Err(StorageError::invalid(
                "This folder contains no verified recovery backups",
            ));
        }
        self.publish(Some(location))
    }
    pub fn disable(&self) -> Result<()> {
        self.publish(None)
    }
    pub fn synchronize(&self, primary: &BackupCatalog) -> Result<()> {
        if let Some(location) = self.read()? {
            let target = self.catalog_at(&location)?;
            let entries = primary.list()?;
            for entry in &entries {
                target.copy_verified(primary, &entry.id)?;
            }
            // Safety snapshots can temporarily exceed ordinary local retention during an upgrade/restore.
            target.prune_retaining(&entries.into_iter().map(|entry| entry.id).collect())?;
        }
        Ok(())
    }
    pub fn recover_to_primary(&self, primary: &BackupCatalog, id: &str) -> Result<()> {
        let location = self
            .read()?
            .ok_or_else(|| StorageError::invalid("Choose a secondary backup folder first"))?;
        primary.copy_verified(&self.catalog_at(&location)?, id)?;
        Ok(())
    }
}
