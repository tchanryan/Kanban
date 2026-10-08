use crate::{
    contracts::Command,
    model::{ExpectedText, ItemPatch, Reply, Result, StorageError},
    sqlite::{Context, SqliteWorkspace},
    validation,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextField {
    Title,
    Description,
    Scratch,
}

/// Serializable recovery text. The token identifies one exact editor revision.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftRecord {
    pub id: String,
    pub token: String,
    pub entity_id: String,
    pub field: TextField,
    pub text: String,
    pub expected: String,
    pub generation: String,
    pub label: String,
}
impl DraftRecord {
    pub(crate) fn validate(&self) -> Result<()> {
        for value in [&self.token, &self.generation] {
            uuid::Uuid::parse_str(value)
                .map_err(|_| StorageError::invalid("Invalid draft identity"))?;
        }
        let expected_id = match self.field {
            TextField::Scratch => {
                if self.entity_id != "global" {
                    return Err(StorageError::invalid("Invalid scratchpad identity"));
                }
                "scratchpad-global".to_owned()
            }
            TextField::Title | TextField::Description => {
                uuid::Uuid::parse_str(&self.entity_id)
                    .map_err(|_| StorageError::invalid("Invalid draft item identity"))?;
                format!(
                    "{}-{}",
                    self.entity_id,
                    if matches!(self.field, TextField::Title) {
                        "title"
                    } else {
                        "description"
                    }
                )
            }
        };
        if self.id != expected_id || self.label.encode_utf16().count() > 200 {
            return Err(StorageError::invalid("Invalid draft field or label"));
        }
        // Invalid canonical titles (including empty text) must still be recoverable.
        validation::text(&self.text)?;
        validation::text(&self.expected)
    }
    fn command(self) -> Command {
        match self.field {
            TextField::Scratch => Command::SaveScratch {
                content: self.text,
                expected: Some(self.expected),
                generation: Some(self.generation),
            },
            TextField::Title | TextField::Description => {
                let mut patch = ItemPatch::default();
                let mut expected = ExpectedText::default();
                if matches!(self.field, TextField::Title) {
                    patch.title = Some(self.text);
                    expected.title = Some(self.expected);
                } else {
                    patch.description = Some(self.text);
                    expected.description = Some(self.expected);
                }
                Command::Update {
                    id: self.entity_id,
                    patch,
                    expected: Some(expected),
                    generation: Some(self.generation),
                }
            }
        }
    }
}

pub trait DraftStorage {
    fn stage_draft(&mut self, record: DraftRecord) -> Result<String>;
    fn recovery_drafts(&self) -> Result<Vec<DraftRecord>>;
    fn commit_draft(&mut self, id: &str, token: &str) -> Result<Reply>;
    fn discard_draft(&mut self, id: &str, token: &str) -> Result<()>;
}

impl DraftStorage for SqliteWorkspace {
    fn stage_draft(&mut self, record: DraftRecord) -> Result<String> {
        record.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO drafts VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET token=excluded.token,data=excluded.data",
            params![record.id, record.token, serde_json::to_string(&record)?],
        )?;
        tx.commit()?;
        Ok(record.token)
    }
    fn recovery_drafts(&self) -> Result<Vec<DraftRecord>> {
        let mut statement = self
            .connection
            .prepare("SELECT data FROM drafts ORDER BY id")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| {
            let record: DraftRecord = serde_json::from_str(&row?)?;
            record.validate()?;
            Ok(record)
        })
        .collect()
    }
    fn commit_draft(&mut self, id: &str, token: &str) -> Result<Reply> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let data: Option<String> = tx
            .query_row(
                "SELECT data FROM drafts WHERE id=?1 AND token=?2",
                params![id, token],
                |r| r.get(0),
            )
            .optional()?;
        let record: DraftRecord = serde_json::from_str(&data.ok_or_else(StorageError::conflict)?)?;
        record.validate()?;
        let context = Context {
            db: &tx,
            runtime: self.runtime.as_ref(),
        };
        let value = context.command(record.command())?;
        tx.execute(
            "UPDATE workspace_meta SET revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.execute(
            "DELETE FROM drafts WHERE id=?1 AND token=?2",
            params![id, token],
        )?;
        let version = context.version()?;
        tx.commit()?;
        Ok(Reply { value, version })
    }
    fn discard_draft(&mut self, id: &str, token: &str) -> Result<()> {
        self.connection.execute(
            "DELETE FROM drafts WHERE id=?1 AND token=?2",
            params![id, token],
        )?;
        Ok(())
    }
}
