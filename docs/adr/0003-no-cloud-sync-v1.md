# 0003 — Manual transfer with validated backups

Accepted 2026-09-14. Devices own independent datasets. Versioned JSON export and replace import provide manual transfer; this is not live sync. Import validates IDs, dates, entities, unique keys, workflow constraints and ownership references before changing live data. Replacement previews counts and snapshots the previous dataset in the same transaction. Retain five recovery snapshots.

Encrypted export uses Web Crypto AES-256-GCM with a random 16-byte salt, random 12-byte IV, PBKDF2-SHA256 and 600,000 iterations. The versioned envelope fixes parameters and bounds input sizes. Passphrases are never persisted. Local snapshots cannot protect against disk loss or clearing browser data.

Merge is intentionally deferred, as expressly allowed in section 34.4. Revisions and stable IDs leave an upgrade path, but divergent board structures require a deliberate conflict-resolution design. No nonfunctional sync controls or provider calls are added.
