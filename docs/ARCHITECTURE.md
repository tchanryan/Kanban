# Code organization

The app uses composition for React views and classes for stateful persistence and workflow coordination. A class is useful when it owns a dependency or enforces a lifecycle; a small function is preferable for a pure calculation. UI components do not need inheritance to be modular.

## Responsibilities

- `src/app/App.tsx` coordinates routes, selection, notifications, service-worker updates and workspace initialization. `Sidebar` owns navigation markup.
- `src/features/Board.tsx` coordinates board state and dragging. `features/board` contains cards, columns, column editing, collision targeting and pure filter/tag selectors.
- Search, scratchpad and tag management are separate features with their own state and subscriptions. Shared controls, autosave and modal behavior live in `src/components`.
- `WorkItemActions` coordinates confirmation for moves and tile deletion. Its narrow repository contract, confirmation callback and deletion service are injected. `WorkItemMutations` handles draft flushing and confirmed deletion through its own smaller contract.
- `WorkspaceRepository` owns transactional writes and validates persisted relationships. Keep multi-table operations within its transactions; splitting each table into an independent service would make project/child/history consistency harder to maintain.
- `Database` owns IndexedDB schema, indexes and migrations. Domain schemas and pure date/workflow calculations live in `src/domain`.
- `native/workspace` is the Rust SQLite implementation, exercised with disposable databases and the isolated Tauri preview. Typed command/query enums implement the repository operations behind a transaction owner with an injected clock/UUID provider. Canonical record JSON has generated relational/index projections; no connection or SQL is exposed to the renderer. See [native architecture and runnable example](../native/workspace/README.md). User-data migration remains a later gate.
- `contracts/workspace` defines typed queries, commands and domain results. `WorkspaceRepository` implements these contracts with a private Dexie database; components cannot access tables or transaction handles.
- `domain/backup` validates portable v1 data; `services/backupCodec` handles JSON/encryption without storage or DOM dependencies. `BackupService` validates confirmation and flushes drafts before calling `WorkspaceBackupStore`. `DexieBackupStore` exports consistent data and replaces data, safety snapshot and generation in one transaction. Its internal snapshot export deliberately bypasses draft orchestration.
- `app/createServices` wires application services using injected workspace, backup and platform contracts. `platform/web/createWebServices` supplies Dexie, browser file/storage services and draft callbacks. `app/services` creates the single web runtime. `vite.desktop.config.ts` selects `platform/desktop/services` and native draft bindings at build time, rejects browser storage imports and excludes the service worker. Both builds await service readiness before mounting the UI; initialization errors remain visible.
- `native/desktop` owns the isolated preview lifecycle and typed IPC. `WorkspaceService` serializes SQLite access on blocking workers. `DesktopWorkspaceRepository` validates responses. `DurableDrafts` serializes recovery writes and canonical saves; the Rust transaction atomically saves text and clears its journal token. Native close flushes or explicitly retains drafts. See [desktop composition and runnable example](../native/desktop/README.md).
- All 11 former `useLiveQuery` consumer modules use `useWorkspaceQuery`, keyed by a typed query name and its arguments. `WorkspaceQueryStore` shares active subscriptions and cached snapshots; `useQuery` connects them to React through `useSyncExternalStore`. Loading, ready (including genuinely missing values), and error states are distinct. `QueryStatus` offers local retry without clearing data or reloading the application.
- `QuerySource` receives the typed scope plus a repository read callback. `DexieQuerySource` owns the only `liveQuery` import, tracks affected read ranges and reconciles commits during reads before publishing, including cross-tab writes. Subscription epochs reject retired callbacks after navigation, retry or unmount. Last-listener cleanup releases the result cache and source subscription. Browser file selection and service-worker lifecycle remain web UI concerns until their desktop-specific sessions.
- `services/operations` defines the shared UI operation callback. Feature types must not depend on the board view simply to report errors or notices.

## Editing conventions

Use named components for independently editable UI sections. Keep their state close to where it is used, pass explicit dependencies, and preserve accessible labels when extracting markup. Use descriptive names for workflow operations. Keep computed filtering separate from database reads; board tags and filtering share a single relation subscription rather than reading relations per card.

Run Prettier through `npm run format` and verify it with `npm run format:check`. Formatting is enforced by CI. It complements component boundaries and meaningful names; it does not establish correctness by itself.

ESLint prevents contracts, domain code, feature components, shared components and portable workflow services from importing concrete storage or Dexie React hooks. Adapter integration tests may instantiate Database to exercise real transactions. Generated native schema/build directories are excluded from formatting and lint.

## Composition example

Run this from an application module with IndexedDB available (production already composes its services in `src/app/services.ts`):

```ts
import { Database } from '../db/database';
import { createWebServices } from '../platform/web/createWebServices';

const exampleDatabase = new Database('kanban-example');
const app = createWebServices(exampleDatabase);
const board = await app.workspace.initialize();
await app.workspace.saveColumn(board.id, {
  name: 'Inbox',
  isDefaultNewItemColumn: true,
  startsWorkOnFirstEntry: false,
  completesItemOnEntry: false,
});
await app.workspace.create(board.id, 'Plan the next session');
const backup = await app.backups.exportBackup();
app.platform.files.download(backup);
exampleDatabase.close();
```

This uses a separate example database. Application services receive interfaces; only the web factory knows which persistence implementation is selected. Settings saves now return `Promise<void>` after commit, rather than leaking Dexie's returned record key; no caller used that key.

To observe a scoped result before closing that example database:

```ts
const items = app.queries.query('items', board.id);
const stop = items.subscribe(() => {
  const result = items.getSnapshot();
  if (result.status === 'ready') console.log(result.data);
  if (result.status === 'error') console.error(result.error.message);
});
await app.workspace.create(board.id, 'Observed after commit');
// Keep the subscription while the view is mounted; call stop on unmount.
stop();
```

Components call `useWorkspaceQuery('items', boardId)` and render `QueryStatus` while the result is not ready. A different key gets a separate loading snapshot immediately, so a late response cannot display the previous board or search results. Errors are never represented as an empty successful query. Query callbacks must be read-only and their arguments treated as immutable.

Web reconciliation uses Dexie's observed ranges and accumulated committed mutations, not an invented persistent workspace revision. See [Dexie liveQuery](https://dexie.org/docs/liveQuery%28%29). The adapter also surfaces read failures such as database closure that raw `liveQuery` suppresses. `NativeQuerySource` subscribes before reading, coalesces commit notifications, discards overtaken reads and invalidates on revision gaps or generation changes. Desktop composition polls the committed native version every two seconds and on focus to reconcile missed notifications. Native invalidation currently refreshes all active scopes; narrower invalidation and scale measurement remain later work.

## Verification

The installed desktop composition uses `ManagedWorkspace::open_versioned`. Native-owned `APP_VERSION.json` and a release marker live outside WebView storage. Startup rejects older executables and malformed or missing metadata for an initialized workspace before opening a writable database. A newer executable creates a verified `before-upgrade` snapshot before migration, then publishes its version. Migration ledger checksums are checked at startup and snapshot admission. Restore preserves the existing staging workflow and rejects snapshots recorded by a newer application.

`SecondaryBackups` owns optional second-folder configuration and copy policy; `BackupCatalog` verifies and publishes closed SQLite snapshots. The renderer receives typed status and commands, never a filesystem handle or arbitrary destination path. `FolderDestination` abstracts the Windows picker, with the host wiring its implementation and the shared COM apartment lifetime. Selection creates a dedicated folder with an ownership marker, copies all retained primary backups before publishing settings, and checks identity when reopening. An unavailable or replaced drive produces a visible warning while local saves continue. Disabling copying retains files. Confirmed secondary restore first verifies and admits a copy into the primary catalogue. Secondary retention pins all currently retained primary IDs, including a temporary extra upgrade snapshot.

An executable composition example uses isolated temporary storage:

```powershell
. ./native/Use-WorkspaceToolchain.ps1
cargo run --locked --offline --manifest-path native/workspace/Cargo.toml --example storage_settings
```

Personal preview packaging uses the stable `io.github.tchanryan.kanban.preview` identity and app-local `data` directory. Installer templates reject downgrades and require normal app closure before install/uninstall writes; uninstall retains native data. Packages are unsigned and use documented manual upgrades. No updater or embedded automation plugin is included.

Desktop portable migration uses `DesktopBackupStore` behind the shared backup contract. Review submits a validated DTO to native code and receives a one-use ticket bound to the workspace version. Confirmation uses that ticket; a different payload, changed workspace or unresolved draft requires another review. `ManagedWorkspace` creates a verified safety snapshot, then native portable storage replaces canonical records, verifies semantic equality and records the receipt/generation in one SQLite transaction. The browser adapter retains its existing replacement behavior. Native file delivery receives only backup content, opens an OS save dialog and publishes flushed temporary output; renderer-selected filesystem paths are not accepted.

Both quality and Pages workflows run formatting, lint, typecheck, unit tests, production build and Playwright tests. Quality builds at `/`; Pages builds and tests at `/Kanban/`. Build before browser tests and use matching `VITE_BASE_PATH` and `PLAYWRIGHT_BASE_PATH` values. Local installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`; CI installs Chromium.

Unit tests cover domain and persistence rules, backups, drafts, UI safety, filtering and confirmed actions. Browser tests cover complete user journeys, keyboard/pointer dragging, accessibility, persistence, offline startup, layout and tag-filter updates.

Text editors read their value and dataset generation together. Saves check both in a transaction, so a replacement in another tab invalidates old drafts even when restored text matches. Drafts retain their original save callback until the user explicitly chooses to keep their text against the new saved version.

Browser regressions cover replacement, clearing and deletion across tabs, plus a real two-build service-worker update with pending and failed drafts. Desktop and mobile keyboard journeys verify initial focus, trapping and restoration. Manual screen-reader speech-output acceptance remains a separate human check.

CodeQL analysis and actual Pages deployment run on GitHub and are separate from local CLI verification. Dependency decisions and remaining acceptance work are tracked in the improvement queue.

## Session-9 startup and copy boundaries

`RecoveryService.isAvailable` is a typed, read-only startup probe backed by `ManagedWorkspace::is_available`. Native initialization has already validated the live database and release guards. The probe reports that state without scanning backup catalogues; full `status` verification remains available in Settings and recovery, and every restore still verifies its snapshot. This avoids duplicate full-catalogue checks before the initial board renders. A regression test confirms that availability does not admit a corrupt backup or recreate missing live data.

Changing secondary folders creates a local safety snapshot and seeds the new destination before publishing its configuration. It does not synchronize the retired destination. If selection fails, old configuration and local snapshots remain, and status can flag missing copies for explicit retry. Copy publication validates the closed source, then checks SHA-256 and byte length for the destination. Identical bytes inherit the source's integrity/domain validation; repeated decoding during that copy is unnecessary. Snapshot admission rejects nonempty WAL/journal sidecars, and restore/status continue full validation. These changes avoid redundant verification without relying on modification timestamps or a persistent validation cache.

Security review must distinguish core/plugin permissions from custom commands: Tauri exposes registered custom application commands to app windows by default. The current host creates only the bundled `main` window, denies new windows and remote navigation, and has no remote capability scope. CSP limits connection destinations to native IPC and disallows frames/objects. Plugin filesystem and shell access are absent. Any future webview/window or remote capability requires a fresh review of these command boundaries. See [Tauri capabilities](https://v2.tauri.app/security/capabilities/) and [CSP](https://v2.tauri.app/security/csp/).

The native navigation predicate also rejects URL credentials and non-default ports on bundled hostnames. Its unit tests cover allowed packaged routes and rejected remote, lookalike, credential-bearing and alternate-port URLs. Markdown click handling uses the separate `ExternalLinkOpener` platform contract. `ValidatedExternalLinks` accepts absolute HTTP/HTTPS URLs without credentials, control characters or excessive length. The native `ExternalLinks<BrowserLauncher>` boundary independently validates the URL, then the Windows implementation opens it through the default browser with no command interpreter or arbitrary arguments. The worker owns a balanced COM apartment, following [Microsoft's ShellExecute guidance](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew). Native new-window/navigation restrictions remain intact. Opening failures produce a generic inline message.

Example composition for the desktop transport:

```typescript
import { ValidatedExternalLinks } from '../services/externalLinks';
import type { NativeTransport } from '../platform/desktop/transport';

export async function openDocumentation(
  transport: NativeTransport,
): Promise<void> {
  const links = new ValidatedExternalLinks({
    async open(address: string): Promise<void> {
      await transport.invoke('open_external_link', { address });
    },
  });
  await links.open('https://example.com/documentation');
}
```

`RecoveryInspection` captures owned catalogue configuration and live-status metadata without a SQLite connection. The host releases the workspace mutex before full file inspection on a worker. Its result is a point-in-time status, not restore authorization; every restore checks the current file again. A regression edits live data while inspection is pending, damages a snapshot and confirms inspection/restore both reject that snapshot. Existing secondary copies inherit full source validation only after exact metadata equality, checksum and length checks; status and restore still decode and validate snapshots independently.

`useViewReadiness` records a bounded local performance mark after two animation frames when the board's typed queries are ready. It records only the board key and item count and sends nothing externally. Native scale acceptance uses this navigation-to-post-paint timestamp and separately retains driver observation time. Native host initialization happens before navigation, so this timestamp is not end-to-end operating-system launch time.

`Test-Scale.ps1 -MeasureNormalLaunch` measures an owned normal process after clearing the owned WebView origin/cache, using loopback CDP only as an observer. Its unchanged 2,000 ms cold-board gate uses this normal-launch mark; WebDriver timing remains separately reported. Comparison found a multi-second first-HTML delay in the WebDriver-launched window that was absent from the normal process. Diagnostic helpers never ship in the installer and debugging arguments are scoped to the owned test process. The test also reports navigation/resource timing, rather than substituting a warmed reload for cold launch.
