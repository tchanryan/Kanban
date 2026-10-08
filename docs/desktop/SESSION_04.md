# Desktop session 4: native SQLite domain storage

Date: 22 September 2026. Status: complete; session-4 exit gate passed.

Starting tracked revision: `e7c54a0`. Branch: `codex-desktop-session-4`, preserving all prior local changes. The web adapter remains the default; no native library is connected to user storage.

## Implemented

- Added the standalone `native/workspace` Rust library with typed commands/queries, domain DTOs, clock/UUID injection, schema versioning and a transaction-owning SQLite adapter.
- Mapped canonical records into separate entity tables with generated indexed projections. Added foreign keys, global ID protection, ownership constraints, per-board default/completion constraints, scoped unique order keys and Unicode-aware name uniqueness.
- Preserved fractional order keys, timestamps, record revisions, field conflicts and dataset generation. Workspace revision and canonical writes commit atomically; reads return a consistent version/data pair. Failures produce no success acknowledgement.
- Implemented all 16 repository commands and 19 queries. History retains deleted column references; archived items may reference a missing column; active records may not. Board/child/history/archive paths use indexes.
- Added a shared Dexie/native fixture covering 76 steps and 240 ordering cases, including Unicode casing, whitespace and UTF-16 sort semantics.
- Corrected two archive invariants in both backends: fallback restoration appends to avoid colliding order keys, and independent child restoration is rejected. Added regressions for both.
- Added a Windows native CI workflow and a runnable disposable-database [example](../../native/workspace/examples/basic.rs). See [native storage notes](../../native/workspace/README.md) for commands and architecture.

## Verification

- Native: 11 tests passed (2 unit, 9 integration), including parity, rollback after a history failure, unchanged revision on failure, reopen persistence, stale revision/generation checks, bounded lock failure, archive fallback and 230-record tied-date pagination, schema rejection, FK/FULL/WAL settings and archive index selection.
- Native Clippy with `-D warnings` and Rust formatting checks passed. The runnable example passed, reporting committed revision 3 with one item.
- Web: all 53 tests passed across 14 files. TypeScript, ESLint, formatting and whitespace checks passed. Production builds and all 28 Chrome journeys passed at both `/` and `/Kanban/` (56 browser checks total). The existing >500 KB bundle advisory remains.
- Hosted Windows CI has been added but has not run. No native UI/installer, crash/power-loss or migration claim is established by these library checks.

## Decisions and remaining risks

Stored JSON is the canonical native record, with generated columns for indexed relationships/lifecycle/order. It is not an unindexed workspace blob or frontend persistence path. Transaction ownership, SQL and connection handles remain inside the Rust library.

Web comparison deliberately excludes Dexie's private `activeBoardId` and `archiveSortAt` indexes. Native query responses retain the declared domain fields. The tests compare current host Unicode behavior; other locale-specific casing rules and different Unicode versions need an explicit compatibility policy before broader locale support.

Session 5 owns the Tauri service lifecycle, typed IPC binding and notification source. Session 6 owns safety snapshots, backup retention, integrity/recovery and interruption-safe replacement. Session 7 owns previewed migration. Do not connect this library to real user data before those gates.

## Usage and revised plan

Starting account readings: five-hour 0% used, weekly 31% used. Closing checkpoint: five-hour 84% used (16% remaining), weekly 44% used (56% remaining). Exact task token usage is unavailable. All quota readings are shared account readings, not session token counts. No reset credit was redeemed.

Re-estimate after session 4: retain six planned sessions (5–10), with provisional allowances totaling 86–134k tokens, plus two 15–25k contingency sessions (116–184k including both). Session 5 remains 14–22k. The library parity gate reduces domain uncertainty, but IPC, durable draft recovery, backup failure handling and installer lifecycle remain substantial unverified work. Retain both contingency sessions.

All changes remain local and uncommitted. No PR, push, deployment, user-data migration or scheduled continuation occurred.
