use super::*;
use crate::{
    recovery::RecoveryHooks,
    sqlite::{Context, SqliteWorkspace},
};
use rusqlite::TransactionBehavior;

fn export(context: &Context<'_>) -> Result<PortableBackup> {
    let mut query = context
        .db
        .prepare("SELECT item_id,tag_id FROM relations ORDER BY item_id,tag_id")?;
    let relations = query
        .query_map([], |row| {
            Ok(Relation {
                item_id: row.get(0)?,
                tag_id: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(PortableBackup {
        format: "kanban-calendar".into(),
        version: 1,
        exported_at: context.now(),
        boards: context.list("ORDER BY id", [])?,
        columns: context.list("ORDER BY id", [])?,
        items: context.list("ORDER BY id", [])?,
        events: context.list("ORDER BY id", [])?,
        tags: context.list("ORDER BY id", [])?,
        relations,
        scratchpads: context.list("ORDER BY id", [])?,
        settings: context.list("ORDER BY id", [])?,
    })
}

impl PortableStorage for SqliteWorkspace {
    fn export_portable(&mut self) -> Result<PortableBackup> {
        let tx = self.connection.transaction()?;
        let result = export(&Context {
            db: &tx,
            runtime: self.runtime.as_ref(),
        })?;
        tx.commit()?;
        result.validate()?;
        Ok(result)
    }
    fn import_history(&self) -> Result<Vec<ImportReceipt>> {
        if !self
            .connection
            .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='import_ledger'")?
            .exists([])?
        {
            return Ok(Vec::new());
        }
        let mut query = self
            .connection
            .prepare("SELECT data FROM import_ledger ORDER BY rowid DESC")?;
        let entries = query
            .query_map([], |row| row.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect();
        entries
    }
}

impl SqliteWorkspace {
    pub(crate) fn replace_portable(
        &mut self,
        prepared: &PreparedImport,
        safety_backup_id: String,
        hooks: &dyn RecoveryHooks,
    ) -> Result<ImportReceipt> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let context = Context {
            db: &tx,
            runtime: self.runtime.as_ref(),
        };
        if context.version()? != prepared.preview.expected
            || tx.prepare("SELECT 1 FROM drafts LIMIT 1")?.exists([])?
        {
            return Err(StorageError::conflict());
        }
        for table in [
            "relations",
            "events",
            "items",
            "columns",
            "boards",
            "tags",
            "scratchpads",
            "settings",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        hooks.checkpoint("after-import-clear")?;
        let backup = &prepared.backup;
        macro_rules! insert {
            ($records:expr) => {
                for record in $records {
                    context.put(record)?;
                }
            };
        }
        insert!(&backup.boards);
        insert!(&backup.columns);
        insert!(&backup.items);
        insert!(&backup.events);
        insert!(&backup.tags);
        insert!(&backup.scratchpads);
        insert!(&backup.settings);
        for relation in &backup.relations {
            tx.execute(
                "INSERT INTO relations VALUES(?1,?2)",
                [&relation.item_id, &relation.tag_id],
            )?;
        }
        if export(&context)?.semantic_hash()? != prepared.preview.semantic_sha256 {
            return Err(StorageError::invalid(
                "Imported data differs from reviewed backup",
            ));
        }
        if tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(StorageError::invalid(
                "Imported relationships failed validation",
            ));
        }
        tx.execute(
            "UPDATE workspace_meta SET generation=?1,revision=revision+1 WHERE id=1",
            [self.runtime.id()],
        )?;
        let receipt = ImportReceipt {
            id: self.runtime.id(),
            imported_at: context.now(),
            source_exported_at: backup.exported_at.clone(),
            semantic_sha256: prepared.preview.semantic_sha256.clone(),
            counts: backup.counts(),
            previous: prepared.preview.expected.clone(),
            current: context.version()?,
            safety_backup_id,
        };
        tx.execute_batch("CREATE TABLE IF NOT EXISTS import_ledger(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));")?;
        tx.execute(
            "INSERT INTO import_ledger VALUES(?1,?2)",
            rusqlite::params![receipt.id, serde_json::to_string(&receipt)?],
        )?;
        hooks.checkpoint("before-import-commit")?;
        tx.commit()?;
        Ok(receipt)
    }
}
