use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageError {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, StorageError>;
impl StorageError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "validation",
            message: message.into(),
        }
    }
    pub fn conflict() -> Self {
        Self {
            code: "conflict",
            message: "The saved version changed. Reload before retrying.".into(),
        }
    }
}
impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for StorageError {}
impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        Self {
            code: "filesystem",
            message: error.to_string(),
        }
    }
}
impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self {
            code: "storage",
            message: error.to_string(),
        }
    }
}
impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self {
            code: "validation",
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BoardKind {
    Root,
    Project,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Task,
    Project,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Medium,
    High,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Color {
    Violet,
    Blue,
    Teal,
    Amber,
    Rose,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    #[serde(flatten)]
    pub meta: Meta,
    pub kind: BoardKind,
    pub project_id: Option<String>,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    #[serde(flatten)]
    pub meta: Meta,
    pub board_id: String,
    #[serde(flatten)]
    pub input: ColumnInput,
    pub order_key: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInput {
    pub name: String,
    pub is_default_new_item_column: bool,
    pub starts_work_on_first_entry: bool,
    pub completes_item_on_entry: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(flatten)]
    pub meta: Meta,
    pub kind: ItemKind,
    pub board_id: String,
    pub column_id: String,
    pub parent_project_id: Option<String>,
    pub title: String,
    pub description: String,
    pub priority: Priority,
    pub planned_start_date: Option<String>,
    pub due_date: Option<String>,
    pub first_started_at: Option<String>,
    pub completed_at: Option<String>,
    pub archive_after: Option<String>,
    pub archived_at: Option<String>,
    pub order_key: String,
    pub project_color_token: Option<Color>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Created,
    Moved,
    Completed,
    Reopened,
    Archived,
    Restored,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemEvent {
    pub id: String,
    pub item_id: String,
    pub r#type: EventKind,
    pub from_column_id: Option<String>,
    pub to_column_id: Option<String>,
    pub occurred_at: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    #[serde(flatten)]
    pub meta: Meta,
    pub name: String,
    pub color_token: Color,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub item_id: String,
    pub tag_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scratchpad {
    #[serde(flatten)]
    pub meta: Meta,
    pub content: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CalendarMode {
    Actual,
    Planned,
    Compare,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub id: String,
    pub calendar_show_projects: bool,
    pub calendar_show_top_level_tasks: bool,
    pub calendar_show_project_tasks: bool,
    pub calendar_mode: CalendarMode,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            id: "app".into(),
            calendar_show_projects: true,
            calendar_show_top_level_tasks: false,
            calendar_show_project_tasks: false,
            calendar_mode: CalendarMode::Actual,
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize)]
pub enum Patch<T> {
    #[default]
    Missing,
    Value(Option<T>),
}
// Missing JSON keys and explicit null are distinct for nullable date/color edits.
pub fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Patch<T>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Patch::Value)
}
pub fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemPatch {
    #[serde(default, deserialize_with = "present")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub priority: Option<Priority>,
    #[serde(default, deserialize_with = "nullable")]
    pub planned_start_date: Patch<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub due_date: Patch<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub project_color_token: Patch<Color>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedText {
    #[serde(default, deserialize_with = "present")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub description: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    #[serde(default, deserialize_with = "present")]
    pub calendar_show_projects: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    pub calendar_show_top_level_tasks: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    pub calendar_show_project_tasks: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    pub calendar_mode: Option<CalendarMode>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchiveCursor {
    pub date: String,
    pub id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePage {
    pub items: Vec<Item>,
    pub next_cursor: Option<ArchiveCursor>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceVersion {
    pub revision: u64,
    pub generation: String,
}
#[derive(Debug, Serialize)]
pub struct Reply {
    pub version: WorkspaceVersion,
    pub value: serde_json::Value,
}
