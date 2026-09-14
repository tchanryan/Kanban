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
