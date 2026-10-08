# Desktop session 1: architecture and feasibility

Started 20 September 2026 from main `e7c54a0`. Status: **complete; native feasibility verified**.

This is the first bounded session of [the desktop PRD](../PRD_DESKTOP_LOCAL_STORAGE.md), not the full desktop migration. Production web code and user storage remain outside the spike. The existing local `codex` branch prevents a `codex/desktop-*` ref, so this session uses `codex-desktop-session-1` without renaming historical branches.

## Decisions

- Windows x64, one local workspace, manual installer upgrades initially. Host reports Windows build 26200, X64; WebView2 and Edge are both 153.0.4234.48.
- User selected **unsigned personal preview first; signing before public distribution**. No signing credentials are needed for this spike.
- Reserve `io.github.tchanryan.kanban` for the production application and `io.github.tchanryan.kanban.spike` for feasibility work. Never migrate between identifiers implicitly. Installer identity must be checked again before distribution.
- Use Tauri 2, a Rust service owning a single SQLite writer, and narrowly typed IPC commands. Renderer code receives neither SQL nor arbitrary file paths. React remains composition based; stateful services use injected interfaces, and domain calculations stay pure.
- Evaluate rusqlite with bundled SQLite and its online backup API. Keep transactions in one Rust call, enable foreign keys, WAL and FULL synchronous durability, and use bounded lock waits. Commit acknowledgement follows successful commit only. Drop/rollback, reopen and backup consistency need real file-backed tests.
- Native automation uses the external `tauri-driver` and matching Edge driver. This avoids shipping embedded automation plugins. Native UI tests must invoke real commands and verify persisted results; browser IPC mocks do not satisfy this gate.
- The spike uses a newly allocated disposable directory, with its WebView data separate from the database. No production data directory or existing browser profile is opened. A successful spike is not evidence for crash safety, installer durability or complete backend parity.

Reference guidance checked this session: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), [native WebDriver](https://v2.tauri.app/develop/tests/webdriver/), [rusqlite transactions](https://docs.rs/rusqlite/latest/rusqlite/struct.Transaction.html), [online backup](https://docs.rs/rusqlite/latest/rusqlite/backup/index.html). Exact versions and a dependency lock are only accepted after a successful build.

## Contract scope for sessions 2–4

Split query and command interfaces; use existing domain DTOs with explicit Promise return types. No interface exposes `Database`, Dexie tables, transactions, SQL or native handles. Introduce ports before changing consumers. The web composition root injects the Dexie adapter by default; desktop composition is separate and fails visibly if native storage is unavailable.

| Port                 | Existing operations to preserve                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WorkspaceQueries     | root, board, projectBoard, item, editorItem, editorScratch, columns, items, children, tags, itemTags, boardTagRelations, history, scratch, settings, calendarItems, search, archivePage, counts |
| WorkspaceCommands    | initialize, saveColumn, reorderColumn, deleteColumn, create, update, move, archive, maintain, restore, deleteItem, saveTag, deleteTag, setTag, saveScratch, saveSettings                        |
| WorkspaceBackupStore | Consistent canonical export, validated atomic replacement, recovery snapshot listing; move current snapshots query here                                                                         |
| BackupCodec          | Portable v1 validation, JSON and encrypted envelope encoding/decoding; no database or download imports                                                                                          |
| DraftCoordinator     | Flush affected saves, retain failed/conflicting drafts, clear only after successful deletion; native journal comes in session 5                                                                 |
| WorkspaceQueryStore  | Scoped subscriptions, revision reconciliation, loading/error states and cancellation of stale responses; Dexie implementation in session 3                                                      |
| PlatformServices     | File delivery/picking, storage information, updates, clock and IDs wired once at startup                                                                                                        |

Return-value compatibility matters: create/update/move return items, saveColumn/saveTag return records, restore reports fallback-column use, and archivePage returns items plus an exclusive date/ID cursor. Preserve missing-record behaviour explicitly. Replace incidental database key returns (for example settings put) with documented command acknowledgements only after checking callers.

WorkItemActions and mutations currently depend on concrete WorkspaceRepository. Backups imports Dexie/Database and calls flushDrafts inside export/replace. Split these dependencies without breaking the nested export used to capture a pre-replacement snapshot. Feature components import a singleton repository; introduce a provider/composition boundary without scattering platform checks.

## Reactive consumer inventory

| Source under src/         | Reads and invalidation scope                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| app/App.tsx               | Root, selected project, project board, board columns and project children |
| features/Board.tsx        | Board columns/items, all tags and board tag relations                     |
| features/board/Card.tsx   | Project children/progress                                                 |
| features/Inspector.tsx    | Item plus generation, its board columns and item history                  |
| features/Scratchpad.tsx   | Scratch text plus generation                                              |
| features/TagPicker.tsx    | Tags and selected item's relations                                        |
| features/TagManager.tsx   | Tags                                                                      |
| features/Calendar.tsx     | Settings and calendar items, keyed by standalone-task setting             |
| features/SearchDialog.tsx | Debounced query and include-archived flag; item/tag/relation changes      |
| features/Archive.tsx      | Search and page cursor; lifecycle/order changes                           |
| features/Settings.tsx     | Counts and recovery snapshots; all canonical writes and replacement       |

Subscribe before initial reads, reconcile committed revision gaps, and invalidate all results on generation changes. Route changes must discard late responses. Failed writes must publish neither success nor change events. The existing browser cross-tab path remains supported.

## Invariants and required parity fixtures

- Empty initialization creates a Dashboard and settings, not sample work. Projects exist only on the root board; project creation atomically includes its board, three columns and creation history.
- Validate UUIDs, dates, date ordering, bounded titles/text and fractional order keys at boundaries. Preserve nullable lifecycle fields and canonical export v1. Derived IndexedDB keys are not portable fields.
- Column names are unique within a board and tag names globally using current JavaScript locale-lowercase semantics. SQLite NOCASE alone is insufficient. Resolve locale/Unicode normalization with shared fixtures before native implementation; do not silently change existing matching.
- Preserve the single default column and completion-column rules. Column deletion moves affected work, preserves history, and assigns a replacement default within one transaction.
- Move/reorder validates same-board destination and sibling ordering. First-start is retained; completion/reopen history and archive scheduling are atomic. Completing a project with incomplete children requires confirmation and leaves children unchanged.
- Only top-level items archive independently. Archived projects hide their children from ordinary search. Archive pagination orders by completion timestamp or archive timestamp, then ID, descending, with an exclusive cursor and a maximum page size of 200.
- Restore falls back to the default column if the historical column is missing. Imported archived records may reference removed columns; history may reference former columns. Avoid foreign keys that reject these supported cases.
- Project deletion removes its children, child board/columns, relations and history atomically. Failed deletion retains drafts. Tag deletion removes associations; setTag validates both ends and touches the item revision.
- Editor reads include generation with text; writes check generation and expected original fields within the same transaction. Replacement changes generation even when restored text is identical.
- Import rejects invalid ownership, global duplicate IDs, duplicate sibling keys, duplicate tag associations and invalid versions before mutation. Replacement and its safety snapshot are atomic in the web adapter. Native independent safety backups are introduced before any user migration.
- Keep portable JSON v1 and PBKDF2/AES-GCM envelope v1 compatible. Flush drafts before export/replacement; wrong passphrases and invalid imports leave storage intact.

Evidence sources: src/repositories/workspace.ts, src/domain/model.ts, src/services/backups.ts, src/services/drafts.ts, src/services/mutations.ts and current unit/browser fixtures. Known pre-existing boundary gaps (such as settings patch validation) must be recorded and deliberately reconciled rather than accidentally copied or changed during interface extraction.

## Session evidence and handoff

Initial tooling: Node 24.20.0, npm 11.19.0; cargo/rustc/rustup and Edge driver absent from PATH, default cargo installation absent, Visual Studio Installer absent at the standard location. Native build feasibility is not yet established.

Starting account readings: five-hour used 6%, weekly used 78%. These are account-wide readings, not task token counts. Exact task tokens are unavailable. No reset credit or scheduled continuation is authorized by this plan.

Exit gate: a built/locked isolated Tauri spike, real SQLite commit/rollback/reopen/backup tests, and a passing Windows native UI run. If prerequisites cannot be installed, retain this as an incomplete session-1 checkpoint; do not begin session 2 or describe native feasibility as proven.

### Earlier blocked checkpoint (superseded below)

- Added the isolated [spike and executable usage example](../../spikes/desktop-storage/README.md), with separate port/model/service/SQLite/composition modules, three real file-backed Rust integration tests, a local-only Tauri frontend and an external WebDriver runner. These native tests are authored, **not executed**.
- Direct native candidates are Tauri 2.11.6, tauri-build 2.6.3, rusqlite 0.40.2 with bundled SQLite/backup, and external tauri-driver 2.0.6. Cargo.lock successfully resolves 442 packages. Rust pin: 1.98.1 MSVC. No native library version is yet build-validated; native driver installation remains pending.
- Initial C++ installation failed with `2147942512` (`0x80070070`); the log required 6.71 GB free on C:. Initial Rustup installer also exited unsuccessfully (`3221225786`) and left an incomplete toolchain in the user profile. Do not assume either first installation succeeded.
- User explicitly approved D: (Seagate HDD, NTFS, approximately 1.8 TiB free) for tools. Windows identifies it as SATA, not USB. `D:\KanbanBuildTools` now holds the external Rust installation/cache/temp paths; build output is configured there by the shell helper. No global environment variables were changed by that helper.
- Retrying C++ Build Tools 17.14.41 with install/cache/shared paths on D: still failed. The log at `%TEMP%\dd_setup_20260920144516.log` requires **3.45 GB on C:** for shared components; C: had about 428 MiB free. The user has been asked to free at least 4–5 GB on C:. No personal files were deleted or moved.
- Web validation: **39 unit tests passed across 10 files**, plus TypeScript, ESLint and Prettier checks. Both PowerShell scripts passed parser checks. Production web source/configuration/dependencies were not changed. Browser/build reruns are deferred because this checkpoint changes only isolated spike files and documentation.
- Native compilation, Clippy, SQLite integration execution and native WebDriver launch are still pending; no desktop storage, migration, installer or crash-durability claim is established.
- Verified the exact external toolchain: rustc 1.98.1 and cargo 1.98.1 run successfully through the existing user-profile Rustup launcher. Rust formatting and locked offline package metadata checks pass. Rustup's installer ended with a launcher-location warning because CARGO_HOME points to D: while the launcher remains on C:; compiler/Cargo operation was separately verified rather than treating that installer exit as success.
- Closing account readings: five-hour used 50%, weekly used 84% (starting 6% and 78%). These readings include any concurrent account activity and are not exact session token measurements.

### Verified completion

The user freed C: space and authorized continuing with remaining usage. Visual Studio Build Tools 17.14.41 installed successfully on D:, Windows SDK 10.0.26100.0 is present, and the installer reports complete with no reboot required. Rust 1.98.1 MSVC, Tauri 2.11.6, tauri-build 2.6.3 and rusqlite 0.40.2 now build together using Cargo.lock. External tauri-driver 2.0.6 and EdgeDriver 153.0.4234.48 were installed on D:.

- `cargo test --locked --offline`: **5 tests passed** (one unit, four integration). Verified FULL synchronous durability, foreign-key enforcement, WAL/integrity, rollback after a failed history insert, close/reopen persistence, invalid-input rejection and independent online-backup contents after a later source write.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: passed.
- `cargo build --locked --offline`: passed. Executable: `D:\KanbanBuildTools\targets\kanban-storage-spike\debug\kanban-storage-spike.exe`.
- Real Windows WebDriver run: **passed**, reporting committed/rolledBack/reopened/backupVerified all true after a native button click and real IPC. Test processes were absent after cleanup.
- Fixed the required Windows ICO resource and two actual rusqlite compatibility errors. Initial native session startup exceeded the harness's 15-second request timeout; the harness now uses a bounded 45-second request timeout and captures route/driver diagnostics. The subsequent native run completed in about 8 seconds. No automatic test retries were added.
- Earlier web baseline remains 39 passing tests with lint/typecheck/format passing. Only isolated spike and documentation files changed. Full web/browser regressions remain mandatory during session 2.

Continuation account readings started at five-hour 56%, weekly 85%, and ended at five-hour 43% (reset timestamp changed), weekly **99% used**. These are account-wide readings, not task token measurements; do not subtract the five-hour readings across the reset. No reset credit was redeemed.

Next: session 2 query/command/platform interfaces, dependency injection and portable codec extraction, followed by all web checks. Retain the web adapter as default and do not wire the spike into production. Native crash safety, concurrent-write backup drills, full domain parity and installer lifecycle remain later gates. All changes remain local and uncommitted on `codex-desktop-session-1`; no PR, push, release or migration occurred.
