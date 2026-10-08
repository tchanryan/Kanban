use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    model::{Board, ColumnInput, Item, ItemKind, Result},
    sqlite::SqliteWorkspace,
};
use std::sync::Arc;

fn main() -> Result<()> {
    let directory = tempfile::tempdir().expect("temporary example directory");
    let mut workspace = SqliteWorkspace::open(
        &directory.path().join("example.sqlite"),
        Arc::new(SystemRuntime),
    )?;
    let board: Board = serde_json::from_value(workspace.execute(Command::Initialize, None)?.value)?;
    workspace.execute(
        Command::SaveColumn {
            board_id: board.meta.id.clone(),
            input: ColumnInput {
                name: "Inbox".into(),
                is_default_new_item_column: true,
                starts_work_on_first_entry: false,
                completes_item_on_entry: false,
            },
            id: None,
        },
        None,
    )?;
    let committed = workspace.execute(
        Command::Create {
            board_id: board.meta.id.clone(),
            title: "Plan the next session".into(),
            kind: ItemKind::Task,
            column_id: None,
        },
        None,
    )?;
    let items: Vec<Item> = serde_json::from_value(
        workspace
            .query(Query::Items {
                board_id: board.meta.id,
            })?
            .value,
    )?;
    println!(
        "Committed revision {}: {} item(s)",
        committed.version.revision,
        items.len()
    );
    Ok(())
}
