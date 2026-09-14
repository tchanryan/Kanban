# 0002 — IndexedDB and atomic repositories

Accepted 2026-09-14. Dexie is the persistence implementation. Feature components read through repository methods with reactive query hooks; all writes use repository methods or the backup service. UUIDs, UTC timestamps and monotonically increasing revisions identify mutable work. Tag relations are normalized. Lifecycle events are append-only until an explicit permanent deletion or dataset replacement.

Version 1 defines the domain tables. Version 2 adds a private derived `activeBoardId` index, because null archive timestamps are not valid IndexedDB keys. Creation/update hooks maintain it; the upgrade snapshots the old dataset and populates the index transactionally. Exports omit this implementation field through validation on import. The active-board query never enumerates archived root tasks or history. A migration failure aborts without clearing the database.

Fractional indexing avoids rewriting sibling cards when ordering changes. Column deletion, workflow moves, project creation/deletion and backup replacement are atomic. Date-only values stay `YYYY-MM-DD`; only timestamps represent instants. Calendar day arithmetic uses UTC components to avoid DST-length days, without reinterpreting user dates for display.

Unsaved text is held in a small in-memory draft coordinator independent of editor lifetime. Writes debounce, failed drafts remain recoverable, and export/replacement/restart flush drafts before proceeding. Browser closure with unsaved work prompts the browser's standard unload protection. No application database lives in localStorage.
