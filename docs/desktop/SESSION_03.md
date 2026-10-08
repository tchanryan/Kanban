# Desktop session 3: scoped query subscriptions

Date: 22 September 2026. Status: complete; session-3 exit gate passed.

Starting tracked revision: `e7c54a0`. Branch: `codex-desktop-session-3`, created from the completed session-2 working checkout. Earlier uncommitted work remains preserved. This session keeps the web storage adapter as default.

## Implemented

- Added typed query scopes, observer/source contracts, and distinct loading/ready/error snapshots. A missing entity is a ready result, not a read failure.
- Added `WorkspaceQueryStore`, injected through the application factory. Active consumers share a subscription for the same query name and arguments. Retired subscription callbacks cannot overwrite a current result; the last consumer releases its subscription and cached data.
- Replaced all direct React–Dexie subscriptions across 11 consumer modules with application hooks. Scoped reads cover board filters, project progress, archive pages, calendar, editors, search, tags, counts and recovery snapshots.
- Added local loading and retry UI. Failed queries do not masquerade as empty boards, search results or recovery lists. Failed editor loads preserve the existing recovery-draft mechanism.
- Added the web `DexieQuerySource`. Its tracked ranges preserve narrow commit notifications and cross-tab updates. Reads that fail because the database is closed now surface an error rather than staying in loading indefinitely.
- Extended lint boundaries to prohibit storage/Dexie hooks in UI components. Removed the unused `dexie-react-hooks` dependency and updated the lockfile.

Executable subscription and composition examples: [Architecture](../ARCHITECTURE.md#composition-example).

## Reconciliation boundary

The web adapter reconciles committed changes during reads using Dexie's accumulated mutation/range tracking. A focused test holds the initial read open, commits a change concurrently, and verifies that only the current result is published. Application subscription epochs reject callbacks from obsolete keys or retries. Restore changes editor generation and refreshes affected queries without changing backup formats or expected-value conflict checks.

These epochs are subscription lifetimes, not persistent workspace revisions. The native source contract requires revision-gap and generation reconciliation; implementing the native committed revision protocol still belongs to sessions 4–5. No native production storage, migration or installer work is claimed here.

## Verification

- All 50 unit tests passed across 13 files (43 retained and 7 added).
- New coverage: shared subscription ownership, loading/error/retry, late callback rejection, navigation and StrictMode cleanup, concurrent startup commit reconciliation, cross-connection updates and rollback, unrelated-scope isolation, replacement generation and closed-database recovery.
- TypeScript, ESLint, formatting and whitespace checks passed.
- Final production builds and all 28 Chrome browser journeys passed at both `/` and `/Kanban/` (56 browser checks total), including cross-tab replacement/deletion, active filters, archive pagination, calendar, keyboard focus and offline updates.
- The existing bundle-size advisory remains (main JavaScript about 558 KB, 173 KB gzip). Tests run against disposable databases/profiles; no user workspace migration occurred.

Vite process startup hit the existing sandbox `EPERM` restriction; approved external execution was used for unit/build/browser checks. The initial race-test writer inherited Dexie's read context; moving that writer to a separate event turn made the test model a real concurrent writer, and the focused and full unit suites passed. No tests were skipped or retries increased.

## Usage and next boundary

Starting account readings: five-hour 24% used, weekly 19% used. Final checkpoint readings: five-hour 63% used (37% remaining), weekly 25% used (75% remaining). Exact task token usage is unavailable; account readings are shared across tasks and are not session token counts. No reset credit was redeemed.

Next is session 4: SQLite schema, native transaction owner, typed commands, validation, indexes and backend parity fixtures. Preserve the web query boundary and implement native transaction/revision semantics behind it. The session-4 allowance remains a provisional 18–28k tokens; re-estimate remaining work after its parity gate as required by the PRD.

Changes remain local and uncommitted; no PR, push or deployment occurred. Preserve the working tree, including the prior PRD and isolated native spike.
