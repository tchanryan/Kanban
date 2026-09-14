# 0005 — v1.2 reliability and archive pagination

Accepted 2026-09-14. This is an incremental release of the same local-first Kanban Calendar application. Version 1.2 reflects material reliability, accessibility and performance work; it is not a v2 rebrand or a new product.

## Concurrent text editing

Each in-memory text draft retains the field value that existed when editing began. Repository transactions compare that value with the currently stored field before saving. Changes to unrelated metadata remain compatible; a different title/description/scratchpad value produces a conflict instead of silently replacing another tab's work. The editor displays the saved value and asks the user to choose it or explicitly keep their draft. Repeated queued saves update their baseline only after their own earlier save succeeds.

This is field-level optimistic concurrency, not distributed sync. Manual workflow moves are still serialized transactions. No new cloud service or account is introduced. Recovery drafts can be downloaded from Settings if their original item was deleted or replaced. Drafts remain in memory, so closing the browser still requires saving or exporting them.

Confirmed permanent deletion suspends affected draft writes, waits for in-flight writes, then deletes through the repository. On success it discards only affected drafts; on failure drafts remain. Backup export/replacement and app restart continue to flush drafts first.

## Archive indexing

Schema v3 adds a private derived compound index `[archiveSortAt+id]`. The sort timestamp is completion time, falling back to archive time. This fixes the old behavior that limited records by archive time before sorting the resulting subset. A cursor pages through the correctly ordered whole archive; UUID breaks timestamp ties. The default page contains 50 items. Migration snapshots are capped at five, like pre-import snapshots. Backups stay on format version 1 and do not expose the derived fields.

## Loading and access

Archive, Settings and Markdown are loaded in separate chunks and all are precached by the service worker. Native dialogs handle modal forms; a narrow inspector makes surrounding content inert as well as trapping Tab focus. An axe-core Playwright dependency is test-only and makes no remote reports. Manual screen-reader testing is still necessary for a complete accessibility assessment.

Automated-test references: [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) and [dnd-kit sortable guidance](https://dndkit.com/legacy/presets/sortable/overview/).
