use crate::{
    contracts::{Command, Query, Runtime, WorkspaceStorage},
    model::*,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};
use std::{path::Path, sync::Arc, time::Duration};

pub struct SqliteWorkspace {
    pub(crate) connection: Connection,
    pub(crate) runtime: Arc<dyn Runtime>,
}
impl SqliteWorkspace {
    pub fn open(path: &Path, runtime: Arc<dyn Runtime>) -> Result<Self> {
        if !path.is_absolute() {
            return Err(StorageError::invalid("Workspace path must be absolute"));
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.create_collation("JS_TEXT", |a, b| a.encode_utf16().cmp(b.encode_utf16()))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let identity: i64 = connection.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        if version == 0 && identity == 0 {
            let tables: i64 = connection.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                [],
                |r| r.get(0),
            )?;
            if tables != 0 {
                return Err(StorageError::invalid(
                    "Unrecognized database; original file retained",
                ));
            }
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute_batch(include_str!("schema.sql"))?;
            for table in ["boards", "columns", "items", "events", "tags"] {
                tx.execute_batch(&format!(
                    "CREATE TRIGGER {table}_identity BEFORE INSERT ON {table} BEGIN
                     SELECT CASE WHEN EXISTS(SELECT 1 FROM identities WHERE id=NEW.id AND entity<>'{table}') THEN RAISE(ABORT,'Duplicate global identity') END;
                     INSERT OR IGNORE INTO identities VALUES(NEW.id,'{table}'); END;
                     CREATE TRIGGER {table}_identity_delete AFTER DELETE ON {table} BEGIN
                     DELETE FROM identities WHERE id=OLD.id AND entity='{table}'; END;"
                ))?;
            }
            tx.execute("INSERT INTO workspace_meta VALUES(1,0,?1)", [runtime.id()])?;
            tx.commit()?;
        } else if version != 2 || identity != 1262636593 {
            return Err(StorageError::invalid(
                "Unsupported workspace schema; original file retained",
            ));
        }
        crate::recovery::migration::verify_ledger(&connection)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        let integrity: String = connection.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(StorageError::invalid("Workspace integrity check failed"));
        }
        if connection.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(StorageError::invalid("Workspace relationships are damaged"));
        }
        Ok(Self {
            connection,
            runtime,
        })
    }
}
impl WorkspaceStorage for SqliteWorkspace {
    fn execute(&mut self, command: Command, expected_revision: Option<u64>) -> Result<Reply> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let context = Context {
            db: &tx,
            runtime: self.runtime.as_ref(),
        };
        let before = context.version()?;
        if expected_revision.is_some_and(|expected| before.revision != expected) {
            return Err(StorageError::conflict());
        }
        let value = context.command(command)?;
        tx.execute(
            "UPDATE workspace_meta SET revision=revision+1 WHERE id=1",
            [],
        )?;
        let version = context.version()?;
        tx.commit()?;
        Ok(Reply { version, value })
    }
    fn query(&mut self, query: Query) -> Result<Reply> {
        let tx = self.connection.transaction()?;
        let context = Context {
            db: &tx,
            runtime: self.runtime.as_ref(),
        };
        let version = context.version()?;
        let value = context.query(query)?;
        tx.commit()?;
        Ok(Reply { version, value })
    }
}

pub(crate) struct Context<'a> {
    pub db: &'a Connection,
    pub runtime: &'a dyn Runtime,
}
pub(crate) fn decode<T: Record>(data: &str) -> Result<T> {
    let record: T = serde_json::from_str(data)?;
    record.validate()?;
    Ok(record)
}
pub(crate) trait Record: Serialize + DeserializeOwned {
    const TABLE: &'static str;
    fn id(&self) -> &str;
    fn normalized_name(&self) -> Option<String> {
        None
    }
    fn validate(&self) -> Result<()>;
}
macro_rules! record {
    ($t:ty,$table:literal) => {
        impl Record for $t {
            const TABLE: &'static str = $table;
            fn id(&self) -> &str {
                &self.meta.id
            }
            fn validate(&self) -> Result<()> {
                crate::validation::validate_record(self)
            }
        }
    };
}
record!(Board, "boards");
record!(Item, "items");
record!(Scratchpad, "scratchpads");
impl Record for Column {
    const TABLE: &'static str = "columns";
    fn id(&self) -> &str {
        &self.meta.id
    }
    fn normalized_name(&self) -> Option<String> {
        Some(self.input.name.to_lowercase())
    }
    fn validate(&self) -> Result<()> {
        crate::validation::validate_record(self)
    }
}
impl Record for Tag {
    const TABLE: &'static str = "tags";
    fn id(&self) -> &str {
        &self.meta.id
    }
    fn normalized_name(&self) -> Option<String> {
        Some(self.name.to_lowercase())
    }
    fn validate(&self) -> Result<()> {
        crate::validation::validate_record(self)
    }
}
impl Record for ItemEvent {
    const TABLE: &'static str = "events";
    fn id(&self) -> &str {
        &self.id
    }
    fn validate(&self) -> Result<()> {
        crate::validation::validate_record(self)
    }
}
impl Record for Settings {
    const TABLE: &'static str = "settings";
    fn id(&self) -> &str {
        &self.id
    }
    fn validate(&self) -> Result<()> {
        crate::validation::validate_record(self)
    }
}
impl Context<'_> {
    pub fn version(&self) -> Result<WorkspaceVersion> {
        Ok(self.db.query_row(
            "SELECT revision,generation FROM workspace_meta WHERE id=1",
            [],
            |r| {
                Ok(WorkspaceVersion {
                    revision: r.get::<_, i64>(0)? as u64,
                    generation: r.get(1)?,
                })
            },
        )?)
    }
    pub fn now(&self) -> String {
        self.runtime
            .now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }
    pub fn meta(&self) -> Meta {
        let now = self.now();
        Meta {
            id: self.runtime.id(),
            created_at: now.clone(),
            updated_at: now,
            revision: 1,
        }
    }
    pub fn touch(&self, meta: &mut Meta) {
        meta.updated_at = self.now();
        meta.revision += 1;
    }
    pub fn get<T: Record>(&self, id: &str) -> Result<Option<T>> {
        let data: Option<String> = self
            .db
            .query_row(
                &format!("SELECT data FROM {} WHERE id=?1", T::TABLE),
                [id],
                |r| r.get(0),
            )
            .optional()?;
        data.map(|s| decode(&s)).transpose()
    }
    pub fn require<T: Record>(&self, id: &str) -> Result<T> {
        self.get(id)?
            .ok_or_else(|| StorageError::invalid(format!("{} record not found", T::TABLE)))
    }
    pub fn list<T: Record>(&self, clause: &str, params: impl rusqlite::Params) -> Result<Vec<T>> {
        let mut statement =
            self.db
                .prepare(&format!("SELECT data FROM {} {}", T::TABLE, clause))?;
        let rows = statement.query_map(params, |r| r.get::<_, String>(0))?;
        rows.map(|r| decode(&r?)).collect()
    }
    pub fn put<T: Record>(&self, record: &T) -> Result<()> {
        record.validate()?;
        let data = serde_json::to_string(record)?;
        if let Some(name) = record.normalized_name() {
            self.db.execute(&format!("INSERT INTO {}(id,data,normalized_name) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,normalized_name=excluded.normalized_name",T::TABLE),rusqlite::params![record.id(),data,name])?;
        } else {
            self.db.execute(&format!("INSERT INTO {}(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",T::TABLE),rusqlite::params![record.id(),data])?;
        }
        Ok(())
    }
    pub fn remove<T: Record>(&self, id: &str) -> Result<()> {
        self.db
            .execute(&format!("DELETE FROM {} WHERE id=?1", T::TABLE), [id])?;
        Ok(())
    }
    pub fn columns(&self, id: &str) -> Result<Vec<Column>> {
        self.list("WHERE board_id=?1 ORDER BY order_key", [id])
    }
    pub fn children(&self, id: &str) -> Result<Vec<Item>> {
        self.list("WHERE parent_id=?1 ORDER BY id", [id])
    }
    pub fn generation(&self, expected: Option<&str>) -> Result<()> {
        let version = self.version()?;
        if expected.is_some_and(|e| version.generation != e) {
            Err(StorageError::conflict())
        } else {
            Ok(())
        }
    }
    pub fn event(&self, item: &Item, kind: EventKind, from: Option<String>) -> Result<()> {
        let event = ItemEvent {
            id: self.runtime.id(),
            item_id: item.meta.id.clone(),
            r#type: kind,
            from_column_id: from,
            to_column_id: Some(item.column_id.clone()),
            occurred_at: self.now(),
        };
        event.validate()?;
        self.db.execute(
            "INSERT INTO events(id,data) VALUES(?1,?2)",
            rusqlite::params![event.id, serde_json::to_string(&event)?],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::SystemRuntime;
    #[test]
    fn writer_enforces_foreign_keys_and_full_synchronous_mode() {
        let directory = tempfile::tempdir().unwrap();
        let store = SqliteWorkspace::open(
            &directory.path().join("settings.sqlite"),
            Arc::new(SystemRuntime),
        )
        .unwrap();
        for (pragma, expected) in [("PRAGMA foreign_keys", 1), ("PRAGMA synchronous", 2)] {
            assert_eq!(
                store
                    .connection
                    .query_row(pragma, [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                expected
            );
        }
        assert!(store
            .connection
            .execute("INSERT INTO relations VALUES('missing','also-missing')", [])
            .is_err());
    }
}
