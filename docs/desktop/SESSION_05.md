# Desktop session 5: native UI and durable drafts

Date: 29 September 2026. Status: complete; session-5 exit gate passed for the disposable preview.

Starting tracked revision: `e7c54a0`. Branch: `codex-desktop-session-5`, preserving the local changes from sessions 1–4. All work remains local and uncommitted.

## Implemented

- Added a standalone Tauri preview host with a single serialized SQLite owner, blocking worker execution, typed IPC, post-commit events and the single-instance plugin. A second launch focuses the existing window instead of opening another workspace owner.
- Connected all shared workspace operations to the existing UI through a desktop repository with runtime DTO validation. Desktop compilation rejects Dexie/web storage imports and omits service-worker registration; the normal web build retains its original adapter.
- Added native query subscriptions that coalesce commits, reject overtaken reads, refresh after revision gaps/generation changes and reconcile missed events through periodic/focus version checks.
- Added serializable recovery records with field/item identity, original value, generation and edit token. Canonical save, workspace revision and deletion of the exact recovery token commit atomically. Invalid/conflicting saves retain the recovery record. Confirmed item deletion clears its recovery records in the same native transaction.
- Preserved the 550 ms editor debounce. Desktop shows a separate recovery-copy acknowledgement; Saved still waits for the canonical commit. New typing during a save is retained and its baseline is rebased after the committed result. Recovery after restart requires explicit action.
- Added normal-close draft flushing and explicit Cancel/retain choices after failure. Editing pauses during close; failure to retain prevents close. Backups/import remain explicitly unavailable in this disposable preview.
- Added a Windows desktop build job alongside native storage CI. Hosted CI has not run.

## Verification

- Native library: 14 tests pass, covering existing domain parity and three journal tests for reopen, conflict/token rejection, and injected failure while deleting the journal. Failed transactions leave both canonical state and workspace revision unchanged.
- Frontend: 59 tests pass across 16 files, including new draft race/recovery and query notification tests.
- Web: production builds and all 28 Chrome journeys pass at both `/` and `/Kanban/` (56 journeys). Existing main-chunk size advisory remains, approximately 559 KB.
- Real Windows WebView2/EdgeDriver 154.0.4258.37: offline UI save, live board refresh, second-launch single ownership, forced termination/reopen of acknowledged saves, journal recovery, explicit retry, normal close flushing, failed-title close cancellation/retention, explicit discard and absence of IndexedDB all pass. The final run observed the exact UI journal text after 84 ms; this is a sample, not a worst-case durability guarantee. The native screenshot was inspected.
- Final TypeScript, ESLint, formatting, whitespace checks, desktop frontend/native builds and Rust Clippy with `-D warnings` pass. The final native lifecycle rerun also passes after navigation and close refinements. Hosted CI has not run.

## Boundaries and next session

The preview uses its own app-local directory and synthetic data only. No user data was imported. SQLite schema 2 is for this preview; old schema-1 feasibility files are rejected intact. The native lockfile retains the compatible session-1 supporting Tauri versions after a fresh resolution produced incompatible APIs.

Session 6 owns consistent verified backups, retention, protected schema migration, missing/damaged-file recovery and interruption-safe restore. Startup currently fails on unreadable/unsupported files; the full recovery UI and missing-file safeguards are not implemented. Session 7 owns explicit previewed user migration. Do not switch this preview to user data before those gates. Installer lifecycle, external-browser links, broad crash/scale/disk-failure testing and signing remain later sessions. No physical power-loss guarantee is established here.

Run/build instructions and the executable usage example are in [native desktop README](../../native/desktop/README.md).

## Usage

Starting shared account readings: five-hour 3% used, weekly 0% used. Closing checkpoint: five-hour 82% used (18% remaining), weekly 13% used (87% remaining). Exact task token usage is unavailable; account percentages must not be converted to task tokens. No reset credit was redeemed.

Keep sessions 6–10 and the two previously reserved contingency sessions. Session 6's provisional allowance remains 18–28k tokens. This session does not start backup or migration implementation.

No commit, PR, push, deployment, installer publication, user-data migration or scheduled continuation occurred.
