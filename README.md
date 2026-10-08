# Kanban Calendar

A private, dark-mode, local-first work tracker for tasks, projects, calendars and notes. It runs as a Windows desktop application or an installable browser PWA. No backend, account, telemetry or paid service is required. There is no automatic synchronization between devices or between the desktop and browser versions.

## Windows desktop: install and start

The current personal-use desktop preview is **0.1.14**. The browser package version is **1.2.0**; these version numbers describe different parts of the project. Desktop acceptance passed on the development Windows 11 x64 PC with WebView2 already installed. First installation without WebView2 was explicitly deferred for personal use, so that case is not verified.

1. Close any running Kanban desktop window normally before installing or updating.
2. Run the locally built installer: `D:\KanbanBuildTools\installers\personal-preview\0.1.14\setup.exe`. Follow the installer and choose an installation folder. This path is specific to the development PC; the installer is not included in Git or published as a release download.
3. Start **Kanban Calendar Preview** from the Windows Start menu or its installed executable. The acceptance installation on this PC is `D:\KanbanBuildTools\installed\kanban-personal-preview\kanban-desktop-preview.exe`; your selected installation folder may differ.
4. Open **Settings → Native backups** to confirm the application version, active storage path and backup status. Once installed with WebView2, the desktop app starts and works offline without a development server.

The installer is unsigned for personal use, so Windows may show an unsigned-app warning. Verify the local build before running it. The checked 0.1.14 installer SHA-256 is:

```text
F3E84AF0C2FAAE11C8E3C28D31C52CC10E745A0FBF7F3AF0C016DC5F4DA09CB9
```

To check it in PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\KanbanBuildTools\installers\personal-preview\0.1.14\setup.exe'
```

WebView2 is required to display the desktop interface. The installer is configured to download its bootstrapper if the runtime is missing, which requires internet access. That missing-runtime installation path has not been tested. Node, Rust and the build toolchain are not needed to run the installed application.

**The current acceptance profile contains synthetic test records.** Acceptance scripts can replace its contents and deliberately test recovery. Do not run those scripts against personal work or mark a personal workspace as test-owned. Export anything you want to keep before using the existing preview for real work; once it holds personal data, stop using it for acceptance tests.

### Everyday startup and updates

Launch the installed app and continue working; saved tasks and notes reopen from the same Windows user's local workspace. A second launch focuses the existing instance. Use the normal close button so pending edits can finish. If an edit cannot save, the close flow lets you cancel closing or retain it for recovery; review **Settings → Recovery drafts** when reopening.

Updates are manual: export a backup, close the app, then run the newer personal-preview installer. The tested upgrade and repair paths preserve workspace data and backups. Older installers and executables are rejected to protect newer data. There is no automatic desktop updater. Uninstalling the tested preview preserves its local data; reinstalling with the same application identity and Windows user can reopen it. Uninstall is therefore not a way to erase your workspace.

### How the desktop app works

The React interface runs inside a Tauri Windows window. Typed commands send edits to the native service, which owns SQLite transactions, the draft recovery journal and verified backup/restore operations. The interface does not directly write database files. Changes autosave; recoverable drafts and completed canonical saves are distinct. External HTTP/HTTPS Markdown links open in your system browser, where network access depends on the destination.

Desktop workspace data is independent of the PWA's browser database. Clearing ordinary browser site data does not erase the native SQLite workspace. Moving the installed executable does not move your data, and installing the app on D: still stores primary data under your Windows profile on C: in the current setup.

### Where desktop data is stored

For the installed personal preview, the workspace folder is:

```text
%LOCALAPPDATA%\io.github.tchanryan.kanban.preview\data
```

Paste that path into File Explorer's address bar to inspect the folder. On this PC it resolves under `C:\Users\ryant\AppData\Local`. Settings shows the exact active database path; use that display rather than guessing which SQLite file is current.

| Location inside the workspace folder              | Purpose                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CURRENT.json`                                    | Selects the active SQLite file.                                                                   |
| `workspace.sqlite` or a UUID-named `.sqlite` file | Tasks, projects, notes, history, settings and recovery journal. Restore can switch to a new file. |
| `backups`                                         | Verified local SQLite snapshots and their metadata.                                               |
| `APP_VERSION.json`                                | Native application-version metadata used by upgrade/downgrade checks.                             |
| `SECONDARY.json`, when configured                 | The additional backup-folder configuration.                                                       |
| `webview`                                         | Embedded browser cache/profile; it is separate from the canonical SQLite data.                    |

Do not edit pointer/version files, replace the active database by hand or delete files while the app is running. SQLite journal sidecars may be present, and previous workspace copies may be retained after recovery. Use the app's export and restore controls rather than copying a single live `.sqlite` file as a backup.

Development launches using the base desktop configuration use a separate location: `%LOCALAPPDATA%\io.github.tchanryan.kanban.session5\disposable-preview`. They do not open the installed personal-preview workspace. See [desktop development instructions](native/desktop/README.md).

### Desktop backups, moving data and recovery

- In **Settings → Native backups**, choose **Back up now** for a verified local snapshot. Automatic snapshots run after changes while the app is running, with further changed data backed up within approximately five minutes when storage is healthy. Retention uses overlapping sets of 12 recent, 7 daily and 4 weekly snapshots; these are not necessarily 23 separate files.
- Configure an additional backup folder in Settings, preferably on another drive. The app creates a dedicated owned folder and copies retained verified snapshots. If that drive is unavailable, local saves continue and Settings reports the copy problem; reconnect it and choose **Back up now** to retry. This is backup copying, not synchronization of live workspaces.
- In **Settings → Data & Backups**, use **Export JSON** or **Export encrypted** for a portable file. Desktop exports use the Windows save dialog. Keep exports outside the repository and, for device-loss protection, on another drive or separately backed-up storage.
- To transfer browser work into desktop, export from the browser, select that file in desktop Settings, review the counts and confirm replacement. Desktop and browser edits remain independent afterward. Import replaces the destination workspace; it does not merge. The source file and browser workspace remain unchanged.
- Restore a native snapshot from Settings, or import a portable export after previewing it. Native restore verifies the snapshot and recovers into a separate copy. A healthy current workspace receives a safety snapshot first. If startup cannot open valid storage, recovery displays an error and retained backups instead of silently creating an empty workspace.

Live SQLite data and native snapshots are **not encrypted by the application**. Only an encrypted portable export is encrypted. Protect your Windows account and drive, retain its passphrase separately, and remember that backups on the same drive do not protect against drive loss.

### Startup troubleshooting

| Symptom                                  | What to do                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop window does not start            | Confirm WebView2 is installed and use the installed executable. A first missing-runtime setup needs internet and remains unverified. |
| Installer asks you to close Kanban       | Close normally, resolve any pending-edit prompt, then retry.                                                                         |
| Recovery appears instead of the board    | Preserve the workspace folder; use a listed verified backup or reviewed portable import. Do not delete the data to bypass the error. |
| Backup needs attention                   | Check free space and reconnect the selected backup drive. Retry **Back up now** and inspect Settings.                                |
| Browser and desktop show different tasks | They have separate stores; explicitly export/import to transfer work.                                                                |

See [session-9 acceptance and personal-use scope](docs/desktop/SESSION_09.md) and [the current handoff](docs/WORK_HANDOFF.md) for the recorded results and later work.

## Browser app: run locally

Use Node 24 LTS (`.nvmrc`).

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173). For a production/offline preview:

```sh
npm run build
npm run preview
```

The preview normally runs at http://127.0.0.1:4173. The dev server does not install a service worker. Different origins/ports have separate databases; export/import when transferring between development, preview and the hosted app.

## First use

The dashboard starts empty. Add a column, then capture a task or project. The first column is the default destination. Configure column behavior using its settings button: default creation, first work start, or completion. Names are entirely your choice.

Tasks open a right inspector with autosaved title, priority, dates, tags and Markdown notes. Every new project starts with its own **todo**, **in-progress**, and **completed** columns, independently of the dashboard. These respectively capture new tasks, record work starting, and record completion. You can rename, configure or add project columns without affecting other boards. Existing projects keep their current columns, and a fresh dashboard starts with none. Project progress is automatic; project status is manual. Completing a project with unfinished children requires confirmation and leaves the children unchanged.

If another tab changes text while you edit, your draft is retained and the saved version is shown. Choose **Use saved version** or explicitly **Keep my text** to resolve the conflict. Settings → **Recovery drafts** lists unsaved text and lets you download it before discarding it. In the browser version, drafts live in memory: resolve or download failed edits before closing the tab. The desktop version also journals recovery drafts in native storage; review retained drafts on reopening.

Drag cards/columns with the pointer or keyboard, or use **Move to…** in the inspector and column Move left/right buttons. Cards show assigned tags instead of move controls; untagged cards reserve no tag space. Keyboard shortcuts: N creates a task, Shift+N creates a dashboard project, / opens search, Escape closes details. Shortcuts do not fire while typing in editors.

Tags are shared across all tasks and projects. In the inspector, search for a tag and select a suggestion to assign it. If the name is new, choose a colour swatch and create it. Selected tags appear as removable chips. Removing a tag from one item leaves it available on other items; Settings manages the shared tag catalogue.

The board sizes columns to fit three across the available desktop space. Additional columns extend horizontally; narrow screens retain readable column widths. Columns fill the remaining page height, with task lists scrolling independently so column headings and task capture stay visible.

Use the zoom-out and zoom-in icons beside **+ Column** to scale columns and cards from 50% to 150%. Click the percentage to reset to 100%. Zoom changes only the board presentation and resets when you leave that board.

The trash icon on each task/project tile permanently deletes it after confirmation. Tasks and empty projects need one confirmation. Projects containing any tasks, including completed tasks, require a second confirmation before deleting the project and its tasks/history.

Confirmation messages use themed in-app dialogs. Cancel or Escape keeps the data; clearing the entire workspace still requires typing CLEAR. Confirmation dialogs default keyboard focus to Cancel.

The calendar offers month and timeline views, Actual/Planned/Compare, visibility toggles and project filtering. The dashboard has a compact calendar and global scratchpad. Top-level completed work archives after 14 days, including catch-up when reopening the app. Completed project tasks stay inside their project. Archive supports viewing, restoration and confirmed permanent deletion, with Previous/Next navigation through 50 results per page.

## Browser data ownership and backups

The IndexedDB database is named `kanban-calendar`. Data is local to the browser profile and origin; opening the app on another device does not synchronize work. Live data is not encrypted by the application. Protect the OS account and use disk encryption.

Settings → Data & Backups shows counts and storage information. Use **Export JSON** for a portable plain-text backup, or enter a passphrase of at least 12 characters and select **Export encrypted**. Encryption uses AES-GCM and PBKDF2-SHA256. The app never saves the passphrase and cannot recover it.

To restore, select a backup file (enter its passphrase first if encrypted), review the counts and confirm replacement. Invalid backups are rejected before changes. Pending edits must save first. Replacement is transactional and keeps a local recovery snapshot. The last five pre-replacement snapshots can be downloaded or restored in Settings. Merge is not included.

Browser site-data deletion, browser profile loss or device loss can destroy the live database and local snapshots. Keep exported backups outside the repository. Clearing live data requires typing CLEAR and keeps a recovery snapshot. Export before clearing browser data.

## Browser PWA installation

Load the production app once while online, then use Chrome/Edge's Install app button/menu. It runs in a standalone window and can start offline after the app shell is cached. Installation UI depends on the browser. Test offline behavior with the production build, not the dev server. Available updates show a restart button; pending edits save before restart.

## Quality checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

If the Chromium download is unavailable, use installed Chrome in an isolated test profile:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Vitest covers repository rollback, lifecycle, import, migration, draft races, encrypted backup failures and scale fixtures. Playwright covers capture/persistence, projects, archive, backups, calendar, offline startup, pointer/keyboard dragging, simultaneous-tab conflicts, deletion with failed drafts, automated accessibility checks and a large workspace. Synthetic test artifacts are ignored by Git. Automated accessibility checks supplement, and do not replace, manual keyboard and screen-reader testing.

## GitHub Pages

The repository remote is `tchanryan/Kanban`. `.github/workflows/deploy-pages.yml` builds with `/Kanban/` as the asset base and hash routing. On the repository, set **Settings → Pages → Source → GitHub Actions**. Push reviewed changes to `main` or run the deploy workflow manually, then verify the resulting Pages URL and installation/offline behavior. The workflow runs quality checks and browser tests before publishing.

The desktop migration and startup documentation are included in this source tree. Pushing to `main` triggers the existing browser Pages workflow; it does not publish a Windows installer. The desktop preview remains for personal use.

To validate the repository base path locally:

```powershell
$env:VITE_BASE_PATH='/Kanban/'
npm run build
$env:PLAYWRIGHT_BASE_PATH='/Kanban/'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Clear those environment variables before a normal root-path rebuild. Hosting contains only static app assets. Never add backups, task datasets, browser profiles, secrets or environment files to Git.

## Architecture and release status

- `src/domain`: runtime schemas, dates and lifecycle rules.
- `src/db`: versioned IndexedDB schema and migration.
- `src/repositories`: indexed queries and atomic domain operations.
- `src/contracts` and `src/platform`: shared interfaces and browser/desktop adapters.
- `src/services`: validated/encrypted backup replacement and retained autosave drafts.
- `native/workspace` and `native/desktop`: SQLite storage, verified recovery and the Windows host.
- `src/features`: board, inspector, calendar, archive/search and settings UI.
- `docs/adr`: decisions, including local-first persistence and configurable workflow semantics.

Implementation follows the supplied Kanban Calendar specification. The architecture uses [Vite](https://vite.dev/guide/) and [Dexie transactions](<https://dexie.org/docs/Dexie/Dexie.transaction()>). Version **1.2.0** adds substantial reliability, accessibility and performance improvements to the original application. See [implementation notes](docs/IMPLEMENTATION_NOTES.md) for deviations and [work handoff](docs/WORK_HANDOFF.md) for remaining acceptance work and usage tracking. Desktop preview 0.1.14 has completed session-9 acceptance for the approved personal-use scope on the tested PC. Missing-WebView2 installation is deferred and unverified; public distribution would require reopening that acceptance and signing. Later session work is tracked in the handoff.
