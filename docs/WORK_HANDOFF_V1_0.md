# Work handoff — 14 September 2026

## What exists

The original Next.js starter has been replaced by a working React/TypeScript/Vite local-first PWA. The current tree contains configurable boards/columns, tasks and project boards, drag and accessible move/reorder controls, workflow history, retained autosave drafts, tags, search/filtering, calendar month/timeline modes, scratchpad, archive/restore/deletion, JSON and encrypted backups, validated transactional replacement, recovery snapshots and versioned IndexedDB migration.

The application is a **v1.0 release candidate**, not a claim that every acceptance item has received exhaustive certification. All changes are local and uncommitted on the existing `codex` branch. The remote matches `git@github.com:tchanryan/Kanban.git`. No user datasets or backup files were added. No push or public deployment was performed.

## Verified in this work period

- Strict TypeScript check and production PWA build passed.
- ESLint passed without errors; a hook dependency warning found during development was corrected and the final lint run is clean.
- 16 Vitest tests pass: lifecycle/reopen, project clone/cascade, transaction failure rollback, safe column deletion, archive maintenance, order keys, tag uniqueness, backup validation/replacement, dates, Markdown safety, autosave failure recovery, version 1 → 2 migration, and a scale fixture with 1,000 active tasks, 10,000 archived tasks, multiple boards and 25,000+ events.
- Six core Playwright flows pass in installed Chrome at the normal local base path: first use/persistence/lifecycle, projects, archive, JSON + encrypted backup replacement, offline reload and offline creation, and calendar modes.
- Dependency installation reported zero vulnerabilities across 619 audited packages at installation time.
- Git diff whitespace check passed.
- GitHub Pages workflow, CI, Dependabot and CodeQL configuration added. These have not been executed on GitHub.

Additional repository-path and visual-test results are recorded in the final verification note below.

## Next work period — priority order

1. Review this release candidate against the supplied spec acceptance checklist. Expand automated coverage for pointer drag in both directions/cross-column, keyboard drag, tag picker/search/filter combinations, failed imports during transactional writes, corrupt/wrong-passphrase encrypted backups, project archive navigation, and service-worker update behavior while editing. Existing tests cover the main paths but do not exhaust every edge case.
2. Perform a full keyboard/screen-reader and contrast audit at desktop/laptop/mobile widths. The mobile inspector traps focus, but this is not a completed WCAG audit. Review the generated desktop/mobile screenshots and all calendar/settings states.
3. Profile real-browser rendering with the scale fixture. Repository indexed-query behavior is tested; full-calendar range indexing, archive pagination/virtualization and route/Markdown code splitting remain worthwhile improvements. Main JS currently reports a ~714 KB minified / ~219 KB gzip bundle warning.
4. Review simultaneous-tab editing and snapshot retention during repeated migration/import, and destructive actions while a failed draft exists. The app retains failed text and blocks export/replacement/restart until it saves; this deserves more adversarial testing.
5. Review and commit the working tree, then publish through the configured GitHub Pages workflow when ready. Enable Settings → Pages → GitHub Actions. Verify live `/Kanban/` routes, PWA installation, service-worker update and offline startup. GitHub CLI is not installed in this environment; use Git/browser or install the CLI if needed.

Merge import remains an intentional deferral allowed by spec section 34.4, not an unfinished replace-import implementation. Automatic cloud sync, accounts and attachments remain out of scope.

## Commands and files

Read README.md for setup, tests, backup/restore, installation and Pages deployment. Run `npm ci`, `npm run dev` for development. To verify: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

Chromium's download CDN repeatedly timed out. Use `$env:PLAYWRIGHT_CHANNEL='chrome'` for local E2E tests with installed Chrome; profiles are temporary. For Pages-path testing set `$env:VITE_BASE_PATH='/Kanban/'` before build and `$env:PLAYWRIGHT_BASE_PATH='/Kanban/'` before E2E. Do not reuse a preview server started with a different base path. The current generated dist uses `/Kanban/`; `npm run build` without that variable regenerates a normal local-root build.

Source specification: `C:/Users/ryant/Downloads/KANBAN_CALENDAR_CODEX_IMPLEMENTATION_SPEC.md`. It was read in full during implementation. Architecture decisions are under docs/adr; deviations are in docs/IMPLEMENTATION_NOTES.md.

## Usage tracking

The app exposes account-wide usage percentages, not exact per-task token counts. No exact token total is claimed. Starting usage: 12% of the five-hour window, 2% weekly. Checkpoints: 48%/7%, 78%/12%, 90%/14%. These changes may include other account activity. At the 90% checkpoint, 10% of the five-hour allowance remained. Its reported reset is **14 September 2026, 6:19 pm Australia/Sydney**. No reset credit was redeemed and no continuation automation was created.

## Final verification note

Final usage reading: **96% used / 4% remaining in the five-hour window; 15% used weekly**. The observed account-wide increase during this period was 84 percentage points in the five-hour window and 13 weekly. Exact task token usage is unavailable. Final formatting, lint and whitespace checks all passed.

The final production build at `/Kanban/` passed **all 7 Playwright tests** (15.1 seconds). The seventh flow covers safe populated-column deletion, manual ordering, and desktop/mobile inspector presentation. Screenshots at `test-results/desktop-board.png` and `test-results/mobile-inspector.png` were visually inspected: layout is readable and has no obvious clipping in the inspected states. These synthetic screenshots are ignored by Git.

The repository-path manifest has `start_url` and `scope` set to `/Kanban/`, with 192/512 PNG icons and standalone display. The service worker precaches the app shell. The preview configuration explicitly forwards the test base path, including in CI. The final downward DnD ordering fix is included in the passing build; pointer-specific regression coverage remains in the next-period list.
