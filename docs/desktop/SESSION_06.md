# Desktop session 6: verified snapshots and recovery

Date: 1 October 2026. Status: complete; session-6 exit gate passed for the disposable preview.

Starting tracked revision: `e7c54a0`. Branch: `codex-desktop-session-6`, preserving sessions 1–5. All migration work remains local and uncommitted. Do not discard the working tree.

## Implemented

- Added injected native recovery contracts, snapshot metadata, a separate retention policy, a backup catalog and a managed workspace service. Frontend recovery uses typed IPC and runtime validation; SQL, file handles and path-based write operations remain native.
- Consistent snapshots use SQLite's online backup API. Each snapshot receives integrity, foreign-key, domain-record, draft-record, revision, size and SHA-256 checks. Files are flushed before publication; metadata is published last. Restore verifies the source and copied bytes again before opening the copy.
- Automatic snapshots run after the first canonical change and when changed data is due, with a 270-second threshold and 30-second host polling. Scheduling reconciles persisted metadata after restart. Failure is visible and does not undo an acknowledged ordinary save.
- Retention keeps a deduplicated union of 12 newest snapshots, newest representatives of 7 UTC dates and 4 ISO weeks. All catalog entries are verified before any pruning. A bad entry prevents deletion while valid siblings remain visible for recovery.
- Explicit restore first requires a verified safety backup of a healthy current workspace. It restores into a new file, changes generation, retains pending text for explicit conflict resolution, then switches `CURRENT.json`. Original databases, including damaged files, are retained. The initialized marker prevents a missing pointer from silently selecting an old workspace.
- Missing, corrupt or unsupported selected databases open the recovery screen without initializing an empty replacement. Settings shows the active path, verified backup dates/space, errors and manual backup/restore controls. Restore requires confirmation.
- Legacy schema-1 preview databases receive a verified pre-migration snapshot and upgrade only in a new copy. The SQL checksum is recorded in a native schema ledger. Browser import/provenance is separate session-7 work.

## Verification

- Native library: all 28 test entries pass (2 unit, 9 contract, 3 draft and 14 recovery entries; one recovery entry is the subprocess helper). Recovery covers consistent concurrent snapshots, missing/damaged files and pointers, restore/reopen, generation changes, retention, truncated snapshots, malformed catalog entries, locked backup files, failed destinations, injected disk-full errors, protected schema upgrade and interruption checkpoints. A real child process is killed before the pointer switch and the original acknowledged data reopens.
- Frontend: all 59 tests across 16 files pass. TypeScript, ESLint, formatting and desktop frontend compilation passed. Native host rebuild passed after the missing-pointer regression fix. Final library Clippy with `-D warnings`, Rust formatting and Git whitespace checks passed; host Clippy passed earlier in this session.
- Web root production build and all 28 Chrome journeys passed. Pages production build passed; its full run passed 27 of 28 journeys, with the large-fixture import exceeding the existing five-second dialog assertion while native work was running. The isolated performance rerun then passed (7.2 seconds for the test, 9.4 seconds overall). The timeout and performance budgets were not relaxed. This was a focused rerun, not a second full Pages suite.
- The extended real Windows WebView2 script passed: offline UI save, live refresh, single owner, forced exit/reopen, journal recovery, normal close, failed-draft close/discard, manual backup/restore, restored-pointer persistence after forced exit, deliberate database corruption and recovery preserving the damaged file, and no IndexedDB. The observed journal acknowledgement was 93 ms, a sample rather than a guarantee. Earlier attempts received unexpected extra characters in the focused editor; minimizing the test window and making it inert during single-instance focus handoff/direct journal staging resolved that interference. The screenshot was generated but subsequently removed by the browser test runner before visual inspection; no visual-review claim is made.
- Hosted CI has not run. No physical power-loss or real volume-exhaustion test was performed; disk-full is injected at the pre-snapshot boundary. No installer or real user-data migration has been tested.

## Usage example and boundaries

The [desktop README](../../native/desktop/README.md) contains executable PowerShell build/run commands and a manual Notes → backup → edit → restore example. The preview remains under `%LOCALAPPDATA%\io.github.tchanryan.kanban.session5\disposable-preview` and uses synthetic data. D: holds the toolchain and build cache.

Local snapshots are unencrypted and do not protect against loss of the drive. Secondary backup destinations and storage settings belong to session 8. Retained original workspaces and orphan/pending files are intentionally not pruned automatically; listed snapshot space excludes those files. Status currently verifies all listed snapshots, so large-workspace cost needs measurement/tuning in session 9. The schema migration checksum is recorded; general ledger/version compatibility enforcement remains future migration work.

Session 7 owns previewed browser export/import, provenance ledger, portable export-back-to-web and semantic/conflict round trips. Keep browser source data intact and require recoverable desktop replacement. Do not switch this preview to user data before that gate. Packaging, upgrades, signing before public distribution and broad release acceptance remain sessions 8–10. Session 7 has not started.

## Usage

Starting shared account readings: five-hour 2% used, weekly 14% used. Closing checkpoint: five-hour 100% used (0% remaining), weekly 29% used (71% remaining). Account percentages are not task token measurements. No reset credit was redeemed. No commit, PR, push, deployment, installer publication, user-data migration or scheduled continuation occurred.
