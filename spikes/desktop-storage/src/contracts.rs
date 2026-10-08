use crate::model::{StorageResult, StoredNote};
use std::path::Path;

/// One operation owns the note and its history transaction, including failure.
pub trait NoteStore {
    fn save(&mut self, text: &str, event_id: i64) -> StorageResult<()>;
    fn read(&self) -> StorageResult<StoredNote>;
    fn backup(&self, destination: &Path) -> StorageResult<()>;
}
