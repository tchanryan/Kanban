#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod external_links;
mod files;
mod folders;
mod navigation;
mod service;
mod windows_dialogs;
use folders::FolderDestination;
use service::WorkspaceService;

use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    drafts::{DraftRecord, DraftStorage},
    model::{Reply, Result, StorageError, WorkspaceVersion},
    portable::{ImportPreview, ImportReceipt, PortableBackup},
    recovery::{BackupEntry, ManagedWorkspace, NoFaults, RecoveryStatus},
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

struct ClosePermission(AtomicBool);

#[tauri::command]
async fn open_external_link(address: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        external_links::ExternalLinks::new(external_links::SystemBrowser).open(&address)
    })
    .await
    .map_err(|_| StorageError::invalid("Browser worker stopped"))?
}

#[tauri::command]
async fn workspace_query(service: State<'_, WorkspaceService>, query: Query) -> Result<Reply> {
    service.access(move |store| store.query(query)).await
}
#[tauri::command]
async fn workspace_command(
    app: tauri::AppHandle,
    service: State<'_, WorkspaceService>,
    command: Command,
) -> Result<Reply> {
    service
        .mutate(move |store| {
            let reply = store.execute(command, None)?;
            // Event delivery is advisory: a committed command must never become a failed write.
            let _ = app.emit("workspace-committed", &reply.version);
            Ok(reply)
        })
        .await
}
#[tauri::command]
async fn workspace_version(service: State<'_, WorkspaceService>) -> Result<WorkspaceVersion> {
    service
        .access(|store| Ok(store.query(Query::Counts)?.version))
        .await
}
#[tauri::command]
async fn draft_stage(service: State<'_, WorkspaceService>, record: DraftRecord) -> Result<String> {
    service.access(move |store| store.stage_draft(record)).await
}
#[tauri::command]
async fn draft_list(service: State<'_, WorkspaceService>) -> Result<Vec<DraftRecord>> {
    service.access(|store| store.recovery_drafts()).await
}
#[tauri::command]
async fn draft_commit(
    app: tauri::AppHandle,
    service: State<'_, WorkspaceService>,
    id: String,
    token: String,
) -> Result<Reply> {
    service
        .mutate(move |store| {
            let reply = store.commit_draft(&id, &token)?;
            let _ = app.emit("workspace-committed", &reply.version);
            Ok(reply)
        })
        .await
}
#[tauri::command]
async fn draft_discard(
    service: State<'_, WorkspaceService>,
    id: String,
    token: String,
) -> Result<()> {
    service
        .access(move |store| store.discard_draft(&id, &token))
        .await
}
#[tauri::command]
fn finish_close(window: tauri::WebviewWindow, permission: State<ClosePermission>) -> Result<()> {
    permission.0.store(true, Ordering::SeqCst);
    window
        .close()
        .map_err(|_| StorageError::invalid("Could not close the window"))
}

#[tauri::command]
async fn recovery_status(service: State<'_, WorkspaceService>) -> Result<RecoveryStatus> {
    service.status().await
}
#[tauri::command]
async fn workspace_available(service: State<'_, WorkspaceService>) -> Result<bool> {
    service.is_available().await
}
#[tauri::command]
async fn backup_now(service: State<'_, WorkspaceService>) -> Result<BackupEntry> {
    service.backup().await
}
#[tauri::command]
async fn restore_backup(
    app: tauri::AppHandle,
    service: State<'_, WorkspaceService>,
    id: String,
    confirmed: bool,
) -> Result<WorkspaceVersion> {
    let version = service.restore(id, confirmed).await?;
    let _ = app.emit("workspace-committed", &version);
    Ok(version)
}

#[tauri::command]
async fn portable_export(service: State<'_, WorkspaceService>) -> Result<PortableBackup> {
    service.export_portable().await
}
#[tauri::command]
async fn portable_preview(
    service: State<'_, WorkspaceService>,
    backup: PortableBackup,
) -> Result<ImportPreview> {
    service.preview_import(backup).await
}
#[tauri::command]
async fn portable_import(
    app: tauri::AppHandle,
    service: State<'_, WorkspaceService>,
    ticket: String,
    confirmed: bool,
) -> Result<ImportReceipt> {
    let receipt = service.import_portable(ticket, confirmed).await?;
    let _ = app.emit("workspace-committed", &receipt.current);
    Ok(receipt)
}
#[tauri::command]
async fn import_history(service: State<'_, WorkspaceService>) -> Result<Vec<ImportReceipt>> {
    service.import_history().await
}

#[tauri::command]
async fn save_portable_file(
    window: tauri::WebviewWindow,
    payload: String,
    encrypted: bool,
) -> Result<bool> {
    #[cfg(windows)]
    let owner = window
        .hwnd()
        .map_err(|_| StorageError::invalid("The application window is unavailable"))?
        .0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    tauri::async_runtime::spawn_blocking(move || {
        files::PortableFileDelivery::new(files::WindowsSaveDestination { owner })
            .save(&payload, encrypted)
    })
    .await
    .map_err(|_| StorageError::invalid("Backup delivery worker stopped"))?
}

#[tauri::command]
async fn choose_secondary_folder(
    window: tauri::WebviewWindow,
    service: State<'_, WorkspaceService>,
) -> Result<bool> {
    #[cfg(windows)]
    let owner = window
        .hwnd()
        .map_err(|_| StorageError::invalid("The application window is unavailable"))?
        .0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    let selected = tauri::async_runtime::spawn_blocking(move || {
        folders::WindowsFolderDestination { owner }.choose()
    })
    .await
    .map_err(|_| StorageError::invalid("Folder selection worker stopped"))??;
    if let Some(path) = selected {
        service.select_secondary(path).await?;
        return Ok(true);
    }
    Ok(false)
}
#[tauri::command]
async fn disable_secondary_folder(service: State<'_, WorkspaceService>) -> Result<()> {
    service.disable_secondary().await
}
#[tauri::command]
async fn restore_secondary_backup(
    app: tauri::AppHandle,
    service: State<'_, WorkspaceService>,
    id: String,
    confirmed: bool,
) -> Result<WorkspaceVersion> {
    let version = service.restore_secondary(id, confirmed).await?;
    let _ = app.emit("workspace-committed", &version);
    Ok(version)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let personal_preview = app.config().identifier == "io.github.tchanryan.kanban.preview";
            let directory = app.path().app_local_data_dir()?.join(if personal_preview {
                "data"
            } else {
                "disposable-preview"
            });
            let store = ManagedWorkspace::open_versioned(
                directory.clone(),
                Arc::new(SystemRuntime),
                Arc::new(NoFaults),
                app.package_info().version.to_string(),
            );
            app.manage(WorkspaceService::new(store));
            app.manage(ClosePermission(AtomicBool::new(false)));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(format!(
                    "{} {} — unsigned preview",
                    app.config()
                        .product_name
                        .as_deref()
                        .unwrap_or("Kanban Desktop Preview"),
                    app.package_info().version
                ))
                .inner_size(1280.0, 860.0)
                .data_directory(directory.join("webview"))
                .on_navigation(navigation::allows_bundled_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<ClosePermission>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("desktop-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            portable_export,
            portable_preview,
            portable_import,
            import_history,
            save_portable_file,
            workspace_query,
            workspace_command,
            workspace_version,
            draft_stage,
            draft_list,
            draft_commit,
            draft_discard,
            recovery_status,
            workspace_available,
            backup_now,
            restore_backup,
            choose_secondary_folder,
            disable_secondary_folder,
            restore_secondary_backup,
            finish_close,
            open_external_link
        ])
        .run(tauri::generate_context!())
        .expect("Preview startup failed; existing workspace has been retained");
}
