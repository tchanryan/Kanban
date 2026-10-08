#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use kanban_storage_spike::{
    contracts::NoteStore,
    model::{ProbeReport, StorageResult},
    service::ProbeService,
    sqlite::SqliteNoteStore,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn run_probe() -> StorageResult<ProbeReport> {
    let directory = tempfile::Builder::new()
        .prefix("kanban-sqlite-probe-")
        .tempdir()?;
    let path = directory.path().join("probe.sqlite");
    let committed = {
        let mut service = ProbeService::new(SqliteNoteStore::open(&path)?);
        service.prove_rollback()?
    };
    let reopened = SqliteNoteStore::open(&path)?;
    if reopened.read()? != committed {
        return Err("Reopen lost committed data".into());
    }
    let backup_path = directory.path().join("backup.sqlite");
    reopened.backup(&backup_path)?;
    let backup = SqliteNoteStore::open(&backup_path)?;
    if backup.read()? != committed {
        return Err("Backup differs from committed data".into());
    }
    Ok(ProbeReport {
        committed: true,
        rolled_back: true,
        reopened: true,
        backup_verified: true,
    })
}

#[tauri::command]
fn probe_storage() -> Result<ProbeReport, String> {
    run_probe()
        .map_err(|_| "Native storage probe failed; run cargo test for diagnostics".to_owned())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let profile = tempfile::Builder::new()
                .prefix("kanban-webview-probe-")
                .tempdir()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Kanban Storage Spike")
                .data_directory(profile.path().to_path_buf())
                .build()?;
            app.manage(profile);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![probe_storage])
        .run(tauri::generate_context!())
        .expect("Could not launch isolated storage spike");
}
