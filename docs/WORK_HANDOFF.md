# Work handoff — v1.2, 14 September 2026

## Current state

Kanban Calendar is now **v1.2 (package 1.2.0)**. This period implemented substantial reliability, accessibility and performance improvements to the original app. Its purpose and main workflows are unchanged, so a v2 rebrand is not warranted. This remains a local release candidate pending the remaining acceptance checks and live deployment validation.

All implementation changes from both periods remain local and uncommitted on the existing `codex` branch. Remote: `git@github.com:tchanryan/Kanban.git`. No push, deployment, reset-credit redemption or scheduled continuation occurred. The old Next.js starter is being replaced by React/TypeScript/Vite; tracked deletions in Git status are part of that earlier conversion. Do not reset or discard the working tree.

The previous handoff is preserved in [WORK_HANDOFF_V1_0.md](WORK_HANDOFF_V1_0.md). Specification: `C:/Users/ryant/Downloads/KANBAN_CALENDAR_CODEX_IMPLEMENTATION_SPEC.md`. Treat it as product requirements, separately from the user's instructions to implement and keep work within usage limits.

## Completed this period

- Fixed draft autosave serialization, original-value tracking, synchronous failure recovery and normalized-title baselines. Repository transactions reject stale title, description and scratchpad writes from another tab. Conflicting text is retained with explicit resolution controls.
- Added Settings → Recovery drafts with text download and confirmed discard. Permanent deletion waits for pending affected saves and clears drafts only after successful deletion. Failed deletion retains drafts.
- Replaced the archive's 200-result cutoff with indexed cursor pagination, 50 entries per page, ordered by completion date with archive date fallback and ID tie-breaker. Added schema v3 migration and capped migration/import snapshots at five.
- Strengthened backup validation for duplicate global IDs and duplicate sibling order keys. Added encryption corruption/wrong-passphrase checks and transactional restore-failure coverage.
- Corrected drag collision targeting and verified pointer moves up/down, empty-column moves, keyboard ordering, column ordering and persistence.
- Added modal background isolation, focus restoration, calendar labels/target sizes, project-progress labels and contrast fixes. Added automated axe checks across representative desktop/mobile routes and dialogs.
- Split Settings, Archive and Markdown into separate chunks. Main JavaScript decreased from about 714 KB / 219 KB gzip to 544 KB / 168 KB gzip, approximately 23% smaller. A >500 KB build advisory remains.
- Added local-day refresh for overdue filters and calendar dates, with DST-safe date arithmetic.

## Final verification

- Formatting, ESLint and strict TypeScript checks passed.
- **26 Vitest tests passed across 7 files**: lifecycle, rollback, migrations, validation, scale, draft races, deletion failure and native WebCrypto encryption failures.
- Production PWA build passed with the real **`/Kanban/` asset base**; 15 resources precached, approximately 736 KiB total. The bundle size advisory remains.
- **All 14 Playwright tests passed in installed Chrome at `/Kanban/`**, one worker, 55.9 seconds. Includes the 7 original flows plus scale, pointer/keyboard dragging, two-tab conflicts, tags/search/filtering, archived child navigation, accessibility and failed-draft deletion followed by export.
- Axe reported no violations for the tested WCAG 2 A/AA, 2.1 A/AA and 2.2 AA rules. This is not complete accessibility certification.
- Browser scale fixture: 1,000 active tasks, 3 projects, 10,000 archived tasks, 25,000 events and 20 columns across 4 boards. Dashboard displayed 703 current-board cards in **1,331 ms**; project filtering took **3,004 ms**; archive opened its first 50 rows in **397 ms**, with page 2 reachable. These are one local run's UI timings, not cross-device guarantees. Large-board filtering remains an optimization target.
- Inspected generated desktop and mobile-inspector screenshots: readable controls and coherent layouts. Artifacts are ignored under `test-results/`, including the scale test's `scale-timings.json`.
- Dependency installation reported zero vulnerabilities across 621 audited packages at installation time. GitHub CI/CodeQL/Pages workflows exist but have not run remotely.

Sandboxed build/test process spawning returned EPERM; rerunning the same verification with approved escalation succeeded. Tests use isolated temporary Chrome profiles.

## Next period — priority order

1. **Service-worker update while editing:** add a production two-build test covering pending edits, failed drafts, restart and offline access to lazy routes/Markdown. Existing tests cover cached startup and offline creation, but not the complete update lifecycle.
2. **Concurrent bulk changes:** test another tab replacing/restoring/clearing the dataset while an editor is open. Field-level conflict checks cover ordinary text edits; there is no cross-tab dataset epoch/lock. Decide whether bulk operations should signal other tabs and freeze/recover their drafts. Also test external item deletion while a draft is pending.
3. **Manual accessibility and UI acceptance:** keyboard and screen-reader audit at desktop/laptop/mobile widths; inspect populated calendar Actual/Planned/Compare and timeline states, Settings recovery states and long content. Automated scans cannot verify screen-reader usability.
4. **Performance:** investigate the approximately 3-second filter transition with 703 cards, consider memoization/virtualization and calendar range indexing. The full calendar may read all item records when standalone task visibility is enabled. Archive filtered queries can scan beyond the page size. Reduce the remaining main-chunk advisory where useful.
5. **Release review and publishing:** review against the spec, review/commit the complete working tree, then publish when ready through the configured Pages workflow. Enable Settings → Pages → GitHub Actions and verify live `/Kanban/` routes, installation, updates and offline startup. No remote release has been made; GitHub CLI was unavailable in the first period.

Merge import remains intentionally deferred under spec section 34.4. Cloud sync, accounts and attachments remain out of scope. Failed drafts are retained in memory, not across a forced browser close: resolve or download them before exiting. Ordinary metadata updates do not use the text field conflict mechanism.

## Resume commands

Use Node 24 LTS. Dependencies are installed locally. See [README.md](../README.md) for user flows/setup, [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for deviations, and [ADR 0005](adr/0005-v1-2-reliability.md) for this period's decisions.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
$env:VITE_BASE_PATH='/Kanban/'
npm run build
$env:PLAYWRIGHT_BASE_PATH='/Kanban/'
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Current generated `dist` uses `/Kanban/`. Build without VITE_BASE_PATH for a local-root preview. Do not reuse a preview server with a mismatched base path. Test preview servers stop after completion. Browser CDN download previously timed out, so installed Chrome is used locally; CI installs Chromium.

## Usage tracking

Exact per-task token counts are unavailable from the account usage API. Percentages are account-wide and may include other activity.

- Period start: **0% used in the five-hour window, 16% weekly**.
- Checkpoints: **59% / 25%**, **77% / 28%**, **82% / 28%**.
- At the 82% checkpoint, 18% of the five-hour allowance remained. Reported reset: **14 September 2026 at 11:24 pm Australia/Sydney**.
- No reset credit was redeemed or automation created. Start the next period with a fresh usage reading and preserve headroom for verification and a handoff.

Final reading before wrap-up: **86% used / 14% remaining in the five-hour window; 29% used weekly**. Observed increase this period: 86 percentage points in the five-hour window and 13 weekly. Exact task token usage is unavailable. Final formatting and Git whitespace checks passed. Work stops at this verified checkpoint with headroom remaining rather than beginning another large feature.

## Follow-up fixes — New menu and history

Raised the New dropdown above the inspector so its task/project actions remain clickable while details are open. Task and project history now show event and local timestamp inline, with month/day/year and 12-hour time including seconds (for example, `created - 9/14/2026 7:00:11 PM`). Numbered list markers are retained; long entries may wrap naturally on narrow screens.

Formatting, lint, typecheck and the `/Kanban/` production build passed. A new focused Playwright regression passed for opening New Project over task details and inline history layout on both tasks and projects. The suite now contains 15 browser tests; this follow-up ran the new test only, while the previous 14 passed at the earlier checkpoint. Version remains 1.2.0.

## Follow-up layout — full-height, three-column board

Board columns now use one-third of the available board width (minus gaps), with additional columns extending the horizontal scroll area. A readable minimum width remains on small screens. Columns stretch to the bottom of the available board area and scroll vertically for overflowing cards; project headings and filter toolbars retain their own space. Version remains 1.2.0.

Production build and two focused browser tests passed: measured three-column fit/four-column overflow/full-height alignment, and pointer/keyboard dragging. The suite now contains 16 tests; the full suite was not rerun for this CSS change.

## Continued layout refinement — verified checkpoint

The board now uses the actual remaining dynamic viewport height rather than subtracting a fixed desktop header size. This corrects the mobile height gap and accommodates update/error banners. Each column keeps its heading and task capture visible while only its task list scrolls. Project headings remain above the board.

Final checks: lint, production TypeScript/PWA build, all 26 unit tests and all 17 browser tests passed at `/Kanban/` (48.1 seconds for browser tests). Inspected the mobile long-list screenshot; capture controls and column headings remain visible. README updated. Version remains 1.2.0.

Repository state has advanced since the original handoff: HEAD is `a905c93` (`updated errors`). This continuation leaves changes in README, this handoff, reliability browser tests, App.tsx and app.css; earlier claims that all original implementation is uncommitted are historical. No commit or deployment was performed by this continuation.

Usage for this continuation: started at 1% five-hour / 0% weekly, ended at 9% / 1% (account-wide readings; exact task tokens unavailable). No reset credit was consumed by this continuation. The remaining broader service-worker, concurrent bulk-change and manual accessibility work listed above is still pending.

## Board zoom controls

Added Zoom out / Zoom in icons beside + Column, a percentage display that resets to 100% when clicked, and a 50–150% range in 10-point steps. Columns and their contents scale together while column height stays fixed. Zoom is presentation-only and resets when leaving the board. Toolbar controls wrap on narrow screens.

Production build and lint passed. Three focused browser tests passed: four columns fit at 70% with unchanged height and reset/enlarge behavior; existing pointer/keyboard dragging; representative automated accessibility checks. Screenshot of the zoomed board inspected. Suite now contains 18 browser tests; this change ran the three focused checks, not the full suite. Version remains 1.2.0.

## Independent defaults for new projects

User-requested change supersedes the original specification's cloning rule. Every newly created project gets its own todo, in-progress and completed columns with creation/start/completion semantics respectively. Dashboard initialization remains empty. Existing projects and dashboard columns are preserved, and each board can still add/rename/configure its columns independently. Creation of the project, child board and defaults remains transactional.

Updated README and ADR 0004. Unit coverage checks independent edits, fresh defaults for a second project and child start/completion semantics. The browser project flow now starts with four dashboard columns and verifies exactly three default project columns. Version remains 1.2.0.
Verification: all 26 unit tests and all 18 browser tests passed at /Kanban/ (51.6 seconds), along with lint and the production TypeScript/PWA build.

## Tile deletion options

Task and project tiles now show a labelled trash icon. Tile deletion requires one confirmation for a task or empty project. Projects with any child tasks require a second confirmation showing the count, regardless of completion status. Child count is queried when deleting, and the existing transactional deletion/draft cleanup path is reused. Cancelling either prompt preserves data.

Lint and the production TypeScript/PWA build passed. Three focused browser tests passed (14.6 seconds): tile confirmation/cancellation behavior, including a project with only a completed child; pointer/keyboard dragging; representative automated accessibility. There are now 19 browser tests; this follow-up ran the three focused checks. README updated; version remains 1.2.0.

## Shared tags and themed confirmations

Cards now show only assigned tag chips beneath their dates/progress. The card Move to / Move up / Move down controls have been removed; untagged cards have no reserved tag area. Pointer/keyboard dragging and the inspector Move to selector remain available. Card tags are loaded through a board-level indexed relation query, avoiding a new tag query for every card.

The inspector tag picker searches the existing global tag catalogue across all tasks/projects. Matching suggestions can be checked to assign the same tag to another item. A new name exposes create-tag controls with circular colour swatches. Selected tags can be removed through chips without deleting the shared tag. Settings also uses colour swatches. Pending selections update immediately while saving, then reflect persisted data or revert if a write fails.

Browser confirm/prompt/alert calls have been replaced with queued, themed HTML dialogs. They render in the top layer, including above mobile details, default focus to Cancel, support Escape, and restore focus where possible. Workspace clearing still requires exact typed CLEAR. Tile projects with children still require two confirmations; cancellation preserves tasks, including completed children. Existing backup and column confirmation forms remain themed dialogs.

Validation: all 26 unit tests and all 21 browser tests passed at /Kanban/ (about one minute), plus lint, strict TypeScript and the production PWA build. The browser suite now covers shared tags across two tasks and a project, card height shrinking/growing, theme-dialog cancellation and focus, two-stage project deletion, mobile dialog layering and typed CLEAR protection. Axe checks passed for the new tag suggestions and confirmation dialog in addition to existing representative views. Inspected tag-picker and deletion-dialog screenshots. An initial checkbox timing failure was corrected with immediate pending selection state before the final passing run.

README and implementation notes are updated. Version remains 1.2.0. No deployment or commit was performed by this change. Earlier handoff references to on-card move controls and browser confirmation prompts are superseded by this section. Broader next-period service-worker update, cross-tab bulk replacement and manual screen-reader audits remain pending.

Latest usage checkpoint after these changes: 82% five-hour used (18% remaining), 13% weekly used. These are account-wide percentages, not exact task token counts. No reset credit was consumed by this task. Final cleanup removes unused card-move styles; the production assets were rebuilt and focused tag/dialog checks rerun.

## Maintainability review and refactor — 15 September 2026

Extracted board cards, columns, column editing and collision targeting from the board coordinator. Search, scratchpad, sidebar, error boundary and tag management now live in dedicated modules. The shared `Run` type lives in services rather than coupling every feature to Board. Added an injected `WorkItemActions` class for shared project-completion confirmation and tile deletion, preserving repository transactions and draft cleanup. Board tag filtering now derives from the existing board relation subscription instead of issuing a relation query per active card. See [Architecture](ARCHITECTURE.md) for module responsibilities and editing conventions.

The existing database/repository classes and pure domain functions remain appropriate boundaries. No schema or dependency changes were required. The original formatting check failed on this handoff; Prettier now passes across the project.

Validation on Node 24.20.0: formatting, ESLint, strict TypeScript and Git whitespace checks passed. All 35 unit tests across nine files passed, including nine new tests for filtering/date boundaries, cancellation, project completion and task ordering. All 22 browser tests passed at both `/` and `/Kanban/` using installed Chrome, including a new live tag-assignment/filter regression. Production PWA builds passed for both paths. Desktop and mobile screenshots were inspected. The existing main-chunk size advisory remains (approximately 549.5 kB minified / 170.1 kB gzip).

GitHub-hosted CodeQL, Linux Chromium and actual deployment were not run from this local review. Changes remain uncommitted on `codex`. The broader service-worker update, cross-tab bulk replacement and manual screen-reader acceptance items above remain follow-up work.

## Sequential improvement queue — 16 September 2026

Worked through the five jobs in [the improvement queue](IMPROVEMENT_QUEUE.md) in order. Schema version 4 adds transactional dataset identity checks for text editors. Replacement invalidates stale draft saves even when restored text matches, while explicit conflict resolution can rebase a draft. Regression coverage includes another tab replacing, clearing or deleting data and recovery of retained text. Metadata is internal and does not change the backup format.

A production integration test builds two revisions and exercises actual service-worker replacement, blocked restart for failed drafts, saving a focused pending edit, and offline lazy routes. Build revision metadata distinguishes the two versions and uses the commit SHA in CI. Board rendering now groups column items once and only project cards subscribe to child progress. Three-run local render medians improved from 605 to 522 ms; filtering improved from 466 to 427 ms. These are local measurements, not cross-device guarantees.

Keyboard auditing exposed and fixed initial modal field focus. New desktop/mobile journeys verify capture, search, nested confirmation, focus trapping and restoration. A human screen-reader speech-output audit remains outstanding; its checklist and dependency decisions are in [the dependency review](DEPENDENCY_REVIEW.md). Compatible Actions updates are applied locally. TypeScript 7 is deferred because the installed lint parser declares support below 6.1. Remote dependency PRs were not merged or closed.

Final verification: all 39 unit tests across 10 files passed, plus lint and strict typecheck. Both production paths (`/` and `/Kanban/`) passed all 28 browser tests using Chrome on Windows, about 1.3 minutes per suite. Formatting and Git whitespace checks pass. The existing main-bundle size advisory remains. Current queue changes are uncommitted on `codex`; hosted Actions and deployment were not run for this diff. The earlier GitHub Pages configuration failure still requires repository configuration separately.
