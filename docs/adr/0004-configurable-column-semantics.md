# 0004 — Workflow behaviour is independent of names

Accepted 2026-09-14. A nonempty board has exactly one creation default, at most one completion column and any number of work-start columns. New projects clone the current root columns, then evolve independently. Projects cannot nest. Project progress is derived from child completion and never automatically changes parent workflow state.

Creation captures work without fabricating an actual start, including per-column quick creation. Moves into configured columns apply lifecycle behaviour transactionally. Reorders within the same column do not retrigger lifecycle transitions. Editing column flags affects future entries; it never rewrites historical timestamps. Deleting a populated column requires a destination and explicit confirmation, migrates all cards, and preserves historical events. The destination's workflow semantics apply to migrated cards.
