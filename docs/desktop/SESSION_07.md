# Desktop session 7: portable migration

Dates: 4–5 October 2026. Status: complete; session-7 exit gate passed for the disposable preview. Session 8 has not started.

Branch: `codex-desktop-session-7`, starting from tracked revision `e7c54a0` and retaining all local work from sessions 1–6. The working tree is uncommitted. Do not reset it.

## Implementation

The shared `BackupService` now supports an explicit review step. Web storage preserves its existing transactional replacement and recovery snapshots. `DesktopBackupStore` validates the portable DTO, obtains a native one-use preview ticket and requires the same reviewed contents on confirmation. Editing pauses during the final flush/commit. A changed workspace or unresolved journal invalidates the import; the user must review again.

Native portable models, validation and storage live in separate modules under `native/workspace/src/portable`. `ManagedWorkspace` owns preview lifetime and verified pre-import snapshots. The SQLite transaction replaces all canonical entities, compares a normalized semantic SHA-256 against the preview, checks relationships, changes generation and records the import receipt together. A failure rolls back the replacement and receipt. The receipt contains canonical counts, source export time, semantic hash, old/new workspace versions and safety-backup ID; it contains no passphrase or source path.

Validation covers version, size, IDs, ordering, defaults, project ownership, tag links, dates and record constraints. Archived references to removed columns and historical column references remain valid. Portable output excludes internal indexes, drafts, snapshot files and import receipts. JSON/encrypted v1 uses the shared codec; encryption remains PBKDF2-SHA256/AES-GCM with the existing envelope. Decryption happens before native preview and sends no passphrase over IPC.

Settings offers a browser migration guide, complete entity-count review, confirmed replacement and compatible JSON/encrypted export. The empty desktop dashboard links to that guide. Import uses the WebView's native file chooser through the file input. Export uses a Windows save dialog with overwrite confirmation, writes/flushed temporary bytes in the selected directory and publishes by rename. Cancel/failure is not reported as successful delivery. Renderer commands cannot supply filesystem paths.

## Verification checkpoint

- All 64 frontend tests across 18 files pass, including exact-preview matching, conflict recovery, failed/cancelled file delivery, encrypted codec checks and the shared Dexie/native fixture.
- All 35 native library test entries pass, including seven portable entries (one subprocess helper). New cases verify full round-trip equality, reopen, safety restore, receipt/generation atomicity, confirmation/replay/conflict guards, pending drafts, invalid input, locked writers, injected disk-full/transaction failure and a real process kill before import commit. Two subprocess helpers across the full suite are counted in the total.
- Both native file-delivery tests pass, including cancellation, invalid payloads, unavailable destinations, byte preservation and replacement of an existing export. Desktop frontend/native builds, TypeScript, ESLint, Prettier, Rust formatting, library/host Clippy with `-D warnings`, Git whitespace checks and the executable portable example pass.
- The complete Windows UI journey passes: file selection, preview/cancel, stale-preview rejection, confirmed JSON replacement, forced restart, import receipt persistence, native JSON/encrypted Save dialogs, cancelled delivery, wrong-passphrase rejection without canonical/generation/ledger changes, encrypted re-import and unchanged source-file checksum. The final report is retained at `artifacts/native/session7-migration.json`; the Settings screenshot was inspected. These are ignored local test artifacts.
- Production builds and all 29 Chrome journeys pass at both `/` and `/Kanban/` (58 journeys, approximately 1.4 minutes per suite). The Pages migration journey imported the JSON actually exported by the desktop Save dialog and re-exported it with full canonical equality. The existing approximately 562 KB main-bundle advisory remains.
- The synthetic fixture includes root/project boards, child tasks, an archived item with a removed column, historical events, Unicode/multiline notes, tags/relations and calendar settings. It is produced by Dexie, imported/exported by SQLite, and imported back into Dexie with canonical equality. Browser source data and source-file preservation have separate assertions.

## Executable example

From the repository root:

```powershell
. ./native/Use-WorkspaceToolchain.ps1
cargo run --locked --offline --manifest-path native/workspace/Cargo.toml --example portable
```

The example composes the runtime, recovery policy and managed workspace, previews/confirms only the bundled synthetic backup and verifies its semantic round trip in a temporary directory. For the real preview:

```powershell
npm run build:desktop
. ./native/Use-WorkspaceToolchain.ps1
cargo run --locked --offline --manifest-path native/desktop/Cargo.toml
```

Export synthetic data from the browser's Settings, select it in desktop Settings, review and confirm. Restart, inspect tasks/notes, export JSON or encrypted JSON from desktop and import it into a disposable browser profile. Preserve the original browser and export. Subsequent edits are independent; imports replace rather than merge.

## Boundaries and next session

This remains an unsigned disposable preview. No real user data was imported. Previewed portable migration does not establish installer durability, upgrade/uninstall behavior, physical power-loss guarantees or release readiness. Session 8 owns packaging, storage/secondary-backup settings and manual upgrades; signing is required before public distribution. Large import/status performance and broad destructive/installer acceptance remain later gates.

Schema migration and portable-import receipts are separate ledgers. The import ledger is part of the native database transaction and snapshots, not the portable v1 format. Restoring an older native snapshot also restores its older ledger. Pre-import safety snapshots follow the existing retention policy; an import receipt does not pin its snapshot indefinitely.

Preview tickets are deliberately conservative: background archive maintenance can advance the workspace revision even when no canonical fields change, requiring another review. Wrong-passphrase acceptance checks compare all canonical fields, generation and receipt history rather than treating every background revision as an import write. This is safe but leaves an opportunity to avoid unnecessary reviews when maintenance is a no-op.

Native Save automation restores only its test window and targets its dialog. UI Automation's filename value update required a native edit notification before Save; otherwise the dialog used its original default filename. The synthetic default-name export was retained under test artifacts. Dialog workers explicitly initialize/uninitialize their COM apartment. No timeout, retry count or data-integrity assertion was relaxed to obtain the passing result. Hosted CI and installer acceptance were not run.

## Usage

Starting account readings: five-hour 3% used, weekly 0% used. The work crossed account windows; the last continuation began at five-hour 3%, weekly 19%. Closing checkpoint: five-hour 23% used (77% remaining), weekly 22% used (78% remaining). These are shared account readings, not task token counts or a cumulative session cost. This task has not redeemed reset credits, committed, pushed, deployed, created a PR or scheduled continuation.
