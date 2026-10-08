use kanban_workspace::{
    contracts::{Command, SystemRuntime, WorkspaceStorage},
    portable::PortableBackup,
    recovery::{ManagedWorkspace, NoFaults},
};
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    let mut workspace = ManagedWorkspace::open(
        temporary.path().join("example"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    );
    workspace.storage()?.execute(Command::Initialize, None)?;
    let backup: PortableBackup =
        serde_json::from_str(include_str!("../tests/fixtures/portable-v1.json"))?;
    let preview = workspace.preview_import(backup)?;
    println!(
        "Review: {} items, {} boards",
        preview.counts.items, preview.counts.boards
    );
    // This example confirms only the bundled synthetic fixture in its temporary workspace.
    let receipt = workspace.import_portable(&preview.ticket, true)?;
    assert_eq!(
        workspace.export_portable()?.semantic_hash()?,
        receipt.semantic_sha256
    );
    println!(
        "Round trip verified; safety backup {}",
        receipt.safety_backup_id
    );
    Ok(())
}
