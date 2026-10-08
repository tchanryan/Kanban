mod storage;
mod validation;

use crate::model::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_BACKUP_BYTES: usize = 100_000_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableBackup {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub boards: Vec<Board>,
    pub columns: Vec<Column>,
    pub items: Vec<Item>,
    pub events: Vec<ItemEvent>,
    pub tags: Vec<Tag>,
    pub relations: Vec<Relation>,
    pub scratchpads: Vec<Scratchpad>,
    pub settings: Vec<Settings>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportCounts {
    pub boards: usize,
    pub columns: usize,
    pub items: usize,
    pub events: usize,
    pub tags: usize,
    pub relations: usize,
    pub scratchpads: usize,
    pub settings: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub ticket: String,
    pub counts: ImportCounts,
    pub expected: WorkspaceVersion,
    pub semantic_sha256: String,
}

pub(crate) struct PreparedImport {
    pub preview: ImportPreview,
    pub backup: PortableBackup,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportReceipt {
    pub id: String,
    pub imported_at: String,
    pub source_exported_at: String,
    pub semantic_sha256: String,
    pub counts: ImportCounts,
    pub previous: WorkspaceVersion,
    pub current: WorkspaceVersion,
    pub safety_backup_id: String,
}

/// Native policy boundary; no renderer can supply SQL or bypass a prepared import.
pub trait PortableStorage {
    fn export_portable(&mut self) -> Result<PortableBackup>;
    fn import_history(&self) -> Result<Vec<ImportReceipt>>;
}

impl PortableBackup {
    pub fn counts(&self) -> ImportCounts {
        ImportCounts {
            boards: self.boards.len(),
            columns: self.columns.len(),
            items: self.items.len(),
            events: self.events.len(),
            tags: self.tags.len(),
            relations: self.relations.len(),
            scratchpads: self.scratchpads.len(),
            settings: self.settings.len(),
        }
    }
    /// Ignores transport ordering and export time; includes every canonical field.
    pub fn semantic_hash(&self) -> Result<String> {
        let mut normalized = self.clone();
        normalized.exported_at.clear();
        normalized.boards.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        normalized.columns.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        normalized.items.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        normalized.events.sort_by(|a, b| a.id.cmp(&b.id));
        normalized.tags.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        normalized
            .relations
            .sort_by(|a, b| (&a.item_id, &a.tag_id).cmp(&(&b.item_id, &b.tag_id)));
        normalized
            .scratchpads
            .sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        normalized.settings.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&normalized)?)
        ))
    }
}
