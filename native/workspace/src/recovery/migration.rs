use crate::model::*;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::path::Path;

const SCHEMA_2: &str = "CREATE TABLE drafts (id TEXT PRIMARY KEY, token TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER delete_item_drafts AFTER DELETE ON items BEGIN DELETE FROM drafts WHERE id=OLD.id||'-title' OR id=OLD.id||'-description'; END;
CREATE TABLE migration_ledger(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);
PRAGMA user_version=2;";

pub(crate) fn verify_ledger(connection: &Connection) -> Result<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='migration_ledger')",
        [],
        |row| row.get(0),
    )?;
    // Fresh schema-2 databases predate the migration ledger; migrated databases must match exactly.
    if !exists {
        return Ok(());
    }
    let entries: i64 =
        connection.query_row("SELECT count(*) FROM migration_ledger", [], |row| {
            row.get(0)
        })?;
    let checksum: String = connection.query_row(
        "SELECT checksum FROM migration_ledger WHERE version=2",
        [],
        |row| row.get(0),
    )?;
    if entries != 1 || checksum != format!("{:x}", Sha256::digest(SCHEMA_2.as_bytes())) {
        return Err(StorageError::invalid(
            "Migration checksum is incompatible; original files retained",
        ));
    }
    Ok(())
}

pub(crate) fn schema(path: &Path) -> Result<i64> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}
/// Only called on a new recovery copy after the source has a verified snapshot.
pub(crate) fn upgrade_copy(path: &Path) -> Result<()> {
    if schema(path)? != 1 {
        return Ok(());
    }
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    let transaction = connection.transaction()?;
    transaction.execute_batch(SCHEMA_2)?;
    transaction.execute(
        "INSERT INTO migration_ledger VALUES(2,?1)",
        [format!("{:x}", Sha256::digest(SCHEMA_2.as_bytes()))],
    )?;
    transaction.commit()?;
    Ok(())
}
