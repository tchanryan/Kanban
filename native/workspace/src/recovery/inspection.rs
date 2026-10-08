use super::{BackupCatalog, RecoveryStatus, SecondaryBackups};
use crate::model::Result;

/// Owned catalogue inspection; carries no live SQLite connection or workspace lock.
pub struct RecoveryInspection {
    status: RecoveryStatus,
    primary: Result<BackupCatalog>,
    secondary: SecondaryBackups,
}

impl RecoveryInspection {
    pub(crate) fn new(
        status: RecoveryStatus,
        primary: Result<BackupCatalog>,
        secondary: SecondaryBackups,
    ) -> Self {
        Self {
            status,
            primary,
            secondary,
        }
    }

    pub fn inspect(mut self) -> RecoveryStatus {
        match self.primary.and_then(|catalog| catalog.recoverable()) {
            Ok((entries, errors)) => {
                self.status.backups = entries;
                if !errors.is_empty() {
                    self.status.backup_error = Some(errors.join("; "));
                }
            }
            Err(error) => self.status.backup_error = Some(error.to_string()),
        }
        let mut secondary = self.secondary.status();
        if secondary.directory.is_some()
            && secondary.error.is_none()
            && self
                .status
                .backups
                .iter()
                .any(|entry| !secondary.backups.iter().any(|copy| copy.id == entry.id))
        {
            secondary.error = Some("Some local backups have not been copied to the selected folder. Reconnect its drive and choose Back up now to retry.".into());
        }
        self.status.secondary = secondary;
        self.status
    }
}
