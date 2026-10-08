# Desktop session 2: contracts and web dependency injection

Date: 21–22 September 2026. Status: complete; session-2 exit gate passed.

Starting tracked revision: `e7c54a0`. Branch: `codex-desktop-session-2`, created from the session-1 working checkout. The uncommitted PRD, session-1 checkpoint and isolated native spike are preserved. No desktop data migration or production storage change belongs to this session.

## Implemented

- Defined explicit query/command DTOs and contracts, plus backup-store, draft, file-delivery and storage-access ports. Public repository results are standard typed promises; the concrete database is private.
- Added a platform-independent application factory and a web factory supplying Dexie and browser services. All feature repository imports now resolve through the typed application runtime.
- Converted confirmation and deletion workflows to injected, narrowly scoped contracts. Existing draft coordination remains the implementation for the web adapter.
- Extracted portable validation into `domain/backup`, encryption/JSON parsing into `services/backupCodec`, DOM delivery into the web adapter, and transaction ownership into `DexieBackupStore`.
- Kept draft flushing outside storage transactions. Backup replacement still takes its safety snapshot and changes generation in the same transaction as canonical replacement. Invalid input/confirmation rejects before flushing or mutation.
- Added import-boundary lint rules and excluded generated native schema/build directories from formatting/lint.
- Preserved all 11 live-query consumers for session 3. The current web schema, field conflict rules, generation checks and backup formats remain unchanged. Settings command acknowledgement is now void after commit; its previous database record-key return was unused.

Executable composition example: [Architecture](../ARCHITECTURE.md#composition-example).

## Verification

The original 39 unit tests remain, with four additional application-composition tests for exporting pending drafts, preserving flushed draft text in the replacement safety snapshot, retaining failed drafts while blocking export/replacement, and preserving a stateful platform confirmation receiver. All 43 passed across 11 files. TypeScript, ESLint, formatting and whitespace checks passed. Both production builds passed, and all 28 Chrome browser journeys passed at both `/` and `/Kanban/` (56 browser checks total). Sandboxed Vite process startup returned EPERM; verification used the approved external process execution.

The existing bundle-size advisory remains (main JavaScript approximately 556 KB, 172 KB gzip). Browser checks cover the web adapter; they do not establish native production durability. No tests were skipped or retries increased.

Starting account readings: five-hour 42% used; weekly 7% used. Checkpoint readings on 22 September: five-hour 20% used; weekly 19% used. The five-hour window reset during this work. Exact task tokens are unavailable. These readings are account-wide, not session token counts or attributable usage deltas.

## Next boundary

Session 3 replaces direct live queries with scoped query hooks, notifications, revision reconciliation and explicit loading/error handling. Keep the web adapter as default. Do not wire desktop user storage before the later backup/recovery and migration gates.

Re-estimate after session 2: retain eight planned sessions (3–10) plus two contingency sessions. The 11 subscriptions still require the full query/notification work, so session 3 retains its provisional 18–28k token planning allowance. Remaining base allowances total 122–190k, or 152–240k including both reserves. These are scope estimates, not measured consumption; revisit after the SQLite parity gate in session 4. Successful web regression coverage has not reduced the native recovery, migration or installer scope.

All session-2 changes remain local and uncommitted on `codex-desktop-session-2`; no PR, push, deployment or user-data migration occurred. The session-1 files and spike remain preserved in the working tree.
