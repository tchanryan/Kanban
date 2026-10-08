use kanban_workspace::{
    model::{Result, StorageError},
    portable::{ImportPreview, ImportReceipt, PortableBackup},
    recovery::{BackupEntry, ManagedWorkspace, RecoveryStatus},
    sqlite::SqliteWorkspace,
};
use std::sync::{Arc, Mutex};

pub struct WorkspaceService(Arc<Mutex<ManagedWorkspace>>);
impl WorkspaceService {
    pub fn new(store: ManagedWorkspace) -> Self {
        let shared = Arc::new(Mutex::new(store));
        let weak = Arc::downgrade(&shared);
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            let Some(shared) = weak.upgrade() else { break };
            if let Ok(mut store) = shared.lock() {
                store.backup_if_due();
            };
        });
        Self(shared)
    }
    pub async fn access<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut SqliteWorkspace) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.managed(move |managed| operation(managed.storage()?))
            .await
    }
    pub async fn mutate<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut SqliteWorkspace) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.managed(move |managed| {
            let result = operation(managed.storage()?)?;
            managed.backup_if_due();
            Ok(result)
        })
        .await
    }
    pub async fn status(&self) -> Result<RecoveryStatus> {
        let inspection = self
            .managed(|managed| Ok(managed.recovery_inspection()))
            .await?;
        tauri::async_runtime::spawn_blocking(move || inspection.inspect())
            .await
            .map_err(|_| StorageError::invalid("Recovery inspection worker stopped"))
    }
    pub async fn is_available(&self) -> Result<bool> {
        self.managed(|managed| Ok(managed.is_available())).await
    }
    pub async fn export_portable(&self) -> Result<PortableBackup> {
        self.managed(|managed| managed.export_portable()).await
    }
    pub async fn preview_import(&self, backup: PortableBackup) -> Result<ImportPreview> {
        self.managed(move |managed| managed.preview_import(backup))
            .await
    }
    pub async fn import_portable(&self, ticket: String, confirmed: bool) -> Result<ImportReceipt> {
        self.managed(move |managed| managed.import_portable(&ticket, confirmed))
            .await
    }
    pub async fn import_history(&self) -> Result<Vec<ImportReceipt>> {
        self.managed(|managed| managed.import_history()).await
    }
    pub async fn backup(&self) -> Result<BackupEntry> {
        self.managed(|managed| managed.backup_now()).await
    }
    pub async fn select_secondary(&self, path: std::path::PathBuf) -> Result<()> {
        self.managed(move |managed| managed.select_secondary(&path))
            .await
    }
    pub async fn disable_secondary(&self) -> Result<()> {
        self.managed(|managed| managed.disable_secondary()).await
    }
    pub async fn restore_secondary(
        &self,
        id: String,
        confirmed: bool,
    ) -> Result<kanban_workspace::model::WorkspaceVersion> {
        self.managed(move |managed| managed.restore_secondary(&id, confirmed))
            .await
    }
    pub async fn restore(
        &self,
        id: String,
        confirmed: bool,
    ) -> Result<kanban_workspace::model::WorkspaceVersion> {
        self.managed(move |managed| managed.restore(&id, confirmed))
            .await
    }
    async fn managed<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut ManagedWorkspace) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let shared = Arc::clone(&self.0);
        tauri::async_runtime::spawn_blocking(move || {
            let mut store = shared.lock().map_err(|_| {
                StorageError::invalid("Storage service unavailable; restart the preview")
            })?;
            operation(&mut store)
        })
        .await
        .map_err(|_| StorageError::invalid("Storage worker stopped; restart the preview"))?
    }
}
