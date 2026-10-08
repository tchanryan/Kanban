use kanban_workspace::{
    contracts::{Command, SystemRuntime, WorkspaceStorage},
    recovery::{ManagedWorkspace, NoFaults},
};
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    let directory = temporary.path().join("workspace");
    let mut workspace = ManagedWorkspace::open_versioned(
        directory.clone(),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
        "0.1.0".into(),
    );
    workspace.storage()?.execute(Command::Initialize, None)?;
    workspace.select_secondary(temporary.path())?;
    workspace.backup_now()?;
    assert!(workspace.status().secondary.error.is_none());
    drop(workspace);
    let mut upgraded = ManagedWorkspace::open_versioned(
        directory,
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
        "0.1.1".into(),
    );
    assert!(upgraded
        .status()
        .backups
        .iter()
        .any(|entry| entry.reason == "before-upgrade"));
    assert!(upgraded.status().secondary.error.is_none());
    println!("Upgrade and second-folder copies verified in an isolated temporary workspace.");
    Ok(())
}
