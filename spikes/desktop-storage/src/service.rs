use crate::{
    contracts::NoteStore,
    model::{StorageResult, StoredNote},
};

pub struct ProbeService<S: NoteStore> {
    store: S,
}

impl<S: NoteStore> ProbeService<S> {
    pub fn new(store: S) -> Self {
        Self { store }
    }

    /// The second statement fails after changing the note; rollback must undo both.
    pub fn prove_rollback(&mut self) -> StorageResult<StoredNote> {
        self.store.save("Acknowledged native save", 1)?;
        let committed = self.store.read()?;
        if self.store.save("Must never survive", 1).is_ok() {
            return Err("Expected duplicate history failure".into());
        }
        if self.store.read()? != committed {
            return Err("Failed transaction changed persisted state".into());
        }
        Ok(committed)
    }
}
