use crate::{
    contracts::NoteStore,
    model::{StorageResult, StoredNote},
};
use rusqlite::{params, Connection, TransactionBehavior, MAIN_DB};
use std::{path::Path, time::Duration};

pub struct SqliteNoteStore {
    connection: Connection,
}

impl SqliteNoteStore {
    pub fn open(path: &Path) -> StorageResult<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY CHECK (id = 1), text TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, note_id INTEGER NOT NULL REFERENCES notes(id));",
        )?;
        Ok(Self { connection })
    }
}

impl NoteStore for SqliteNoteStore {
    fn save(&mut self, text: &str, event_id: i64) -> StorageResult<()> {
        if text.trim().is_empty() || text.chars().count() > 200 || event_id <= 0 {
            return Err("Invalid probe note or event ID".into());
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO notes (id, text) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET text = excluded.text",
            params![text],
        )?;
        transaction.execute(
            "INSERT INTO events (id, note_id) VALUES (?1, 1)",
            params![event_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn read(&self) -> StorageResult<StoredNote> {
        Ok(self.connection.query_row(
            "SELECT text, (SELECT COUNT(*) FROM events) FROM notes WHERE id = 1",
            [],
            |row| {
                Ok(StoredNote {
                    text: row.get(0)?,
                    events: row.get(1)?,
                })
            },
        )?)
    }

    fn backup(&self, destination: &Path) -> StorageResult<()> {
        if destination.exists() {
            return Err("Probe backup destination already exists".into());
        }
        self.connection.backup(MAIN_DB, destination, None)?;
        let backup = Connection::open(destination)?;
        let integrity: String = backup.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        if integrity != "ok" {
            return Err("Probe backup integrity check failed".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::SqliteNoteStore;

    #[test]
    fn writer_enforces_foreign_keys_and_full_synchronous_durability() {
        let directory = tempfile::tempdir().unwrap();
        let store = SqliteNoteStore::open(&directory.path().join("settings.sqlite")).unwrap();
        let synchronous: i64 = store
            .connection
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 2);
        assert!(store
            .connection
            .execute("INSERT INTO events (id, note_id) VALUES (1, 999)", [],)
            .is_err());
    }
}
