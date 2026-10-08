# Disposable desktop preview

Sessions 5–7 connect the existing React UI to a single native SQLite owner with verified local snapshots, explicit recovery and portable JSON/encrypted migration. This is an unsigned development executable for synthetic data. Installer lifecycle and release acceptance remain later gates.

## Run

From the repository root in PowerShell:

```powershell
npm run build:desktop
. ./native/Use-WorkspaceToolchain.ps1
cargo run --locked --offline --manifest-path native/desktop/Cargo.toml
```

The application uses `%LOCALAPPDATA%\io.github.tchanryan.kanban.session5\disposable-preview`. `CURRENT.json` selects `workspace.sqlite` or a restored UUID-named database; Settings displays the active path. Its WebView profile is a separate `webview` subdirectory. It never reads the website's IndexedDB or selects a production workspace. Create a workflow column before adding a task. Use the normal window close button; failed drafts offer Cancel or retention for recovery.

For a runnable recovery example, launch with the commands above, save `Before backup` in Notes, open Settings and select **Back up now**. Change Notes to `After backup`, then restore the manual snapshot from Settings and confirm. The restored copy contains `Before backup`; the former workspace remains on disk. Restart to verify the selected copy persists. Use synthetic text until release acceptance.

For portable migration, export JSON or encrypted JSON from a disposable browser workspace. In desktop Settings, select that file, enter its passphrase if encrypted and review the entity counts. Confirm replacement; existing desktop data receives a verified safety snapshot. A changed workspace or unresolved drafts blocks confirmation and requires another review. The source browser/file remains untouched. Desktop exports use the Windows save dialog and remain importable by the website. Internal journals, snapshots and import receipts are not included in portable v1.

The native dependency lock is seeded from the tested session-1 Tauri set, with single-instance plugin 2.4.5. Keep the lockfile: resolving all supporting Tauri crates to their newest versions produced incompatible APIs during this session. Rust is pinned to 1.98.1.

## Boundaries

- `src/platform/desktop/desktopWorkspaceRepository.ts` implements the shared contracts and validates every returned domain DTO. No SQL or native handles cross IPC. Recovery status exposes the active path for display; restore accepts a validated backup ID, never a renderer-supplied path.
- `src/service.rs` serializes access to the native store on blocking workers; database lock waits do not run on the window thread.
- `src/main.rs` owns the isolated profile, typed IPC, post-commit events, single-instance focus handoff and close acknowledgement.
- `DurableDrafts` serializes journal/save/discard work, retains original field values and dataset generation, and distinguishes a recovery acknowledgement from a canonical save. The Rust draft transaction saves text and removes that exact journal token atomically. Recovered drafts require a deliberate retry/rebase/discard.
- `NativeQuerySource` refetches active subscriptions after commits, drops overtaken reads, and reconciles revision gaps/generation changes. The composition root polls the native version every two seconds and on focus to catch a missed event. Invalidation is currently conservative across all active queries; scale tuning remains session 9.
- `vite.desktop.config.ts` selects desktop composition and rejects browser storage imports. It does not register a service worker. Native capability permissions allow only event subscription; application commands are typed. External navigation and additional WebView windows are blocked in this preview; external-browser link handling remains a packaging task.

`ManagedWorkspace` owns startup selection, backup scheduling and restore. `BackupCatalog` owns online snapshots, checksums and verification; `RetentionPolicy` selects the union of 12 recent, 7 daily and 4 weekly snapshots. Runtime and fault hooks are injected. Snapshot metadata is published last, after validation and file flushing. Restore copies and verifies first, creates a new generation, then switches the active pointer. Unavailable storage renders the recovery UI without creating an empty replacement.

Native schema 2 adds recovery records. Schema-1 files receive a verified safety snapshot and migrate only in a separate copy, recording the migration SQL checksum. Portable import records its semantic hash, counts, versions and safety-backup ID in a separate ledger in the replacement transaction. Backups are local and unencrypted; a failed backup produces a visible warning without undoing successful ordinary saves. A failed pre-restore/pre-import/pre-migration backup blocks that operation. Old workspace copies and incomplete snapshot files remain intact for diagnosis and are not included in automatic retention.

## Real Windows check

```powershell
. ./native/Use-WorkspaceToolchain.ps1
cargo build --locked --offline --manifest-path native/desktop/Cargo.toml
./native/desktop/Test-Native.ps1 `
  -TauriDriver 'D:/KanbanBuildTools/cargo/bin/tauri-driver.exe' `
  -EdgeDriver 'D:/KanbanBuildTools/drivers/154.0.4258.37/msedgedriver.exe' `
  -Application 'D:/KanbanBuildTools/targets/kanban-workspace/debug/kanban-desktop-preview.exe'
```

Match EdgeDriver to the installed WebView2 version. The test refuses to run while a preview is already open. It uses synthetic records in the disposable preview, forces that test process to exit, reopens it, exercises native offline mode, normal/failed close choices, manual backup/restore and deliberate database corruption/recovery. It checks the corruption target stays inside the disposable preview and confirms no IndexedDB database was created. It leaves synthetic records and retained damaged files in the preview and closes its test processes. Do not point it at a release application.

Run `Test-Migration.ps1` with the same parameters for preview/cancel/conflict, forced restart, Windows Save dialogs and JSON/encrypted round trips. It uses UI Automation only against the launched test process's save dialog. The common driver helpers live in `Native-TestHarness.ps1`.

See [the session checkpoint](../../docs/desktop/SESSION_07.md) for results and the next gate. Injected disk-full and process-interruption checks do not establish physical power-loss or installer guarantees.
