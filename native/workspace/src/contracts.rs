use crate::model::*;
use chrono::{DateTime, Utc};
use serde::Deserialize;

pub trait Runtime: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
    fn id(&self) -> String;
}
pub struct SystemRuntime;
impl Runtime for SystemRuntime {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
    fn id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "name",
    content = "args",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Initialize,
    SaveColumn {
        #[serde(rename = "boardId")]
        board_id: String,
        input: ColumnInput,
        id: Option<String>,
    },
    ReorderColumn {
        id: String,
        #[serde(rename = "beforeId")]
        before_id: Option<String>,
    },
    DeleteColumn {
        id: String,
        #[serde(rename = "destinationId")]
        destination_id: Option<String>,
        confirmed: bool,
    },
    Create {
        #[serde(rename = "boardId")]
        board_id: String,
        title: String,
        kind: ItemKind,
        #[serde(rename = "columnId")]
        column_id: Option<String>,
    },
    Update {
        id: String,
        patch: ItemPatch,
        expected: Option<ExpectedText>,
        generation: Option<String>,
    },
    Move {
        id: String,
        #[serde(rename = "columnId")]
        column_id: String,
        #[serde(rename = "beforeId")]
        before_id: Option<String>,
        confirmed: bool,
    },
    Archive {
        id: String,
        confirmed: bool,
    },
    Maintain,
    Restore {
        id: String,
    },
    DeleteItem {
        id: String,
        confirmed: bool,
    },
    SaveTag {
        name: String,
        #[serde(rename = "colorToken")]
        color_token: Color,
        id: Option<String>,
    },
    DeleteTag {
        id: String,
    },
    SetTag {
        #[serde(rename = "itemId")]
        item_id: String,
        #[serde(rename = "tagId")]
        tag_id: String,
        selected: bool,
    },
    SaveScratch {
        content: String,
        expected: Option<String>,
        generation: Option<String>,
    },
    SaveSettings {
        patch: SettingsPatch,
    },
}
#[derive(Debug, Deserialize)]
#[serde(
    tag = "name",
    content = "args",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Query {
    Root,
    Board {
        id: String,
    },
    ProjectBoard {
        id: String,
    },
    Item {
        id: String,
    },
    EditorItem {
        id: String,
    },
    EditorScratch,
    Columns {
        #[serde(rename = "boardId")]
        board_id: String,
    },
    Items {
        #[serde(rename = "boardId")]
        board_id: String,
    },
    Children {
        id: String,
    },
    Tags,
    ItemTags {
        id: String,
    },
    BoardTagRelations {
        #[serde(rename = "boardId")]
        board_id: String,
    },
    History {
        id: String,
    },
    Scratch,
    Settings,
    CalendarItems {
        #[serde(rename = "includeStandaloneTasks")]
        include_standalone_tasks: bool,
    },
    Search {
        query: String,
        archived: bool,
    },
    ArchivePage {
        query: String,
        cursor: Option<ArchiveCursor>,
        limit: u32,
    },
    Counts,
}
/// One command owns its entire transaction; replies follow commit, never partial writes.
pub trait WorkspaceStorage {
    fn execute(&mut self, command: Command, expected_revision: Option<u64>) -> Result<Reply>;
    fn query(&mut self, query: Query) -> Result<Reply>;
}
