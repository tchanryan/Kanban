# Code organization

The app uses composition for React views and classes for stateful persistence and workflow coordination. A class is useful when it owns a dependency or enforces a lifecycle; a small function is preferable for a pure calculation. UI components do not need inheritance to be modular.

## Responsibilities

- `src/app/App.tsx` coordinates routes, selection, notifications, service-worker updates and workspace initialization. `Sidebar` owns navigation markup.
- `src/features/Board.tsx` coordinates board state and dragging. `features/board` contains cards, columns, column editing, collision targeting and pure filter/tag selectors.
- Search, scratchpad and tag management are separate features with their own state and subscriptions. Shared controls, autosave and modal behavior live in `src/components`.
- `WorkItemActions` coordinates confirmation for moves and tile deletion. Both the board and inspector use the same completion policy. Its repository and confirmation callback are injected so tests exercise workflows against an isolated database.
- `WorkspaceRepository` owns transactional writes and validates persisted relationships. Keep multi-table operations within its transactions; splitting each table into an independent service would make project/child/history consistency harder to maintain.
- `Database` owns IndexedDB schema, indexes and migrations. Domain schemas and pure date/workflow calculations live in `src/domain`.
- Backup validation, encryption and replacement are in `services/backups`. Draft serialization and recovery remain in `services/drafts`; confirmed deletion uses `services/mutations` to wait for affected saves before clearing drafts.
- `services/operations` defines the shared UI operation callback. Feature types must not depend on the board view simply to report errors or notices.

## Editing conventions

Use named components for independently editable UI sections. Keep their state close to where it is used, pass explicit dependencies, and preserve accessible labels when extracting markup. Use descriptive names for workflow operations. Keep computed filtering separate from database reads; board tags and filtering share a single relation subscription rather than reading relations per card.

Run Prettier through `npm run format` and verify it with `npm run format:check`. Formatting is enforced by CI. It complements component boundaries and meaningful names; it does not establish correctness by itself.

## Verification

Both quality and Pages workflows run formatting, lint, typecheck, unit tests, production build and Playwright tests. Quality builds at `/`; Pages builds and tests at `/Kanban/`. Build before browser tests and use matching `VITE_BASE_PATH` and `PLAYWRIGHT_BASE_PATH` values. Local installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`; CI installs Chromium.

Unit tests cover domain and persistence rules, backups, drafts, UI safety, filtering and confirmed actions. Browser tests cover complete user journeys, keyboard/pointer dragging, accessibility, persistence, offline startup, layout and tag-filter updates.

Text editors read their value and dataset generation together. Saves check both in a transaction, so a replacement in another tab invalidates old drafts even when restored text matches. Drafts retain their original save callback until the user explicitly chooses to keep their text against the new saved version.

Browser regressions cover replacement, clearing and deletion across tabs, plus a real two-build service-worker update with pending and failed drafts. Desktop and mobile keyboard journeys verify initial focus, trapping and restoration. Manual screen-reader speech-output acceptance remains a separate human check.

CodeQL analysis and actual Pages deployment run on GitHub and are separate from local CLI verification. Dependency decisions and remaining acceptance work are tracked in the improvement queue.
