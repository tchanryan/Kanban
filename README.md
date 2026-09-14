# Kanban Calendar v1.2

A private, dark-mode, offline-first work tracker built with React, strict TypeScript, Vite, Dexie and an installable PWA shell. Tasks, projects, notes and history stay in this browser profile. No backend, account, telemetry or paid service is required.

## Run locally

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

If another tab changes text while you edit, your draft is retained and the saved version is shown. Choose **Use saved version** or explicitly **Keep my text** to resolve the conflict. Settings → **Recovery drafts** lists unsaved text and lets you download it before discarding it. Drafts live in memory: resolve or download failed edits before closing the tab.

Drag cards/columns with the pointer or keyboard, or use **Move to…** in the inspector and column Move left/right buttons. Cards show assigned tags instead of move controls; untagged cards reserve no tag space. Keyboard shortcuts: N creates a task, Shift+N creates a dashboard project, / opens search, Escape closes details. Shortcuts do not fire while typing in editors.

Tags are shared across all tasks and projects. In the inspector, search for a tag and select a suggestion to assign it. If the name is new, choose a colour swatch and create it. Selected tags appear as removable chips. Removing a tag from one item leaves it available on other items; Settings manages the shared tag catalogue.

The board sizes columns to fit three across the available desktop space. Additional columns extend horizontally; narrow screens retain readable column widths. Columns fill the remaining page height, with task lists scrolling independently so column headings and task capture stay visible.

Use the zoom-out and zoom-in icons beside **+ Column** to scale columns and cards from 50% to 150%. Click the percentage to reset to 100%. Zoom changes only the board presentation and resets when you leave that board.

The trash icon on each task/project tile permanently deletes it after confirmation. Tasks and empty projects need one confirmation. Projects containing any tasks, including completed tasks, require a second confirmation before deleting the project and its tasks/history.

Confirmation messages use themed in-app dialogs. Cancel or Escape keeps the data; clearing the entire workspace still requires typing CLEAR. Confirmation dialogs default keyboard focus to Cancel.

The calendar offers month and timeline views, Actual/Planned/Compare, visibility toggles and project filtering. The dashboard has a compact calendar and global scratchpad. Top-level completed work archives after 14 days, including catch-up when reopening the app. Completed project tasks stay inside their project. Archive supports viewing, restoration and confirmed permanent deletion, with Previous/Next navigation through 50 results per page.

## Data ownership and backups

The IndexedDB database is named `kanban-calendar`. Data is local to the browser profile and origin; opening the app on another device does not synchronize work. Live data is not encrypted by the application. Protect the OS account and use disk encryption.

Settings → Data & Backups shows counts and storage information. Use **Export JSON** for a portable plain-text backup, or enter a passphrase of at least 12 characters and select **Export encrypted**. Encryption uses AES-GCM and PBKDF2-SHA256. The app never saves the passphrase and cannot recover it.

To restore, select a backup file (enter its passphrase first if encrypted), review the counts and confirm replacement. Invalid backups are rejected before changes. Pending edits must save first. Replacement is transactional and keeps a local recovery snapshot. The last five pre-replacement snapshots can be downloaded or restored in Settings. Merge is not included.

Browser site-data deletion, browser profile loss or device loss can destroy the live database and local snapshots. Keep exported backups outside the repository. Clearing live data requires typing CLEAR and keeps a recovery snapshot. Export before clearing browser data.

## PWA installation

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

This work session has not pushed, enabled Pages, or published the application. The local branch is `codex`.

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
- `src/services`: validated/encrypted backup replacement and retained autosave drafts.
- `src/features`: board, inspector, calendar, archive/search and settings UI.
- `docs/adr`: decisions, including local-first persistence and configurable workflow semantics.

Implementation follows the supplied Kanban Calendar specification. The architecture uses [Vite](https://vite.dev/guide/) and [Dexie transactions](<https://dexie.org/docs/Dexie/Dexie.transaction()>). Version **1.2.0** adds substantial reliability, accessibility and performance improvements to the original application. See [implementation notes](docs/IMPLEMENTATION_NOTES.md) for deviations and [work handoff](docs/WORK_HANDOFF.md) for remaining acceptance work and usage tracking. This remains a local release candidate pending the remaining review and live deployment validation.
