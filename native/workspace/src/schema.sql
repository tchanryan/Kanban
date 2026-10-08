CREATE TABLE workspace_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991), generation TEXT NOT NULL);
CREATE TABLE identities (id TEXT PRIMARY KEY, entity TEXT NOT NULL);
CREATE TABLE boards (
 id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id),
 kind TEXT GENERATED ALWAYS AS (json_extract(data,'$.kind')) STORED NOT NULL CHECK(kind IN ('root','project')),
 project_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.projectId')) STORED UNIQUE REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='root' AND project_id IS NULL) OR (kind='project' AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_root ON boards(kind) WHERE kind='root';
CREATE TABLE columns (
 id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id), normalized_name TEXT NOT NULL,
 board_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.boardId')) STORED NOT NULL REFERENCES boards(id) DEFERRABLE INITIALLY DEFERRED,
 order_key TEXT GENERATED ALWAYS AS (json_extract(data,'$.orderKey')) STORED NOT NULL,
 is_default INTEGER GENERATED ALWAYS AS (json_extract(data,'$.isDefaultNewItemColumn')) STORED NOT NULL CHECK(is_default IN (0,1)),
 completes INTEGER GENERATED ALWAYS AS (json_extract(data,'$.completesItemOnEntry')) STORED NOT NULL CHECK(completes IN (0,1)),
 UNIQUE(board_id,normalized_name), UNIQUE(board_id,order_key)
);
CREATE UNIQUE INDEX one_default ON columns(board_id) WHERE is_default=1;
CREATE UNIQUE INDEX one_completion ON columns(board_id) WHERE completes=1;
CREATE TABLE items (
 id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id),
 board_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.boardId')) STORED NOT NULL REFERENCES boards(id) DEFERRABLE INITIALLY DEFERRED,
 column_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.columnId')) STORED NOT NULL,
 parent_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.parentProjectId')) STORED REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
 kind TEXT GENERATED ALWAYS AS (json_extract(data,'$.kind')) STORED NOT NULL CHECK(kind IN ('task','project')),
 order_key TEXT GENERATED ALWAYS AS (json_extract(data,'$.orderKey')) STORED NOT NULL,
 archived_at TEXT GENERATED ALWAYS AS (json_extract(data,'$.archivedAt')) STORED,
 completed_at TEXT GENERATED ALWAYS AS (json_extract(data,'$.completedAt')) STORED,
 archive_after TEXT GENERATED ALWAYS AS (json_extract(data,'$.archiveAfter')) STORED,
 archive_sort TEXT GENERATED ALWAYS AS (CASE WHEN archived_at IS NOT NULL THEN COALESCE(completed_at,archived_at) END) STORED,
 CHECK(parent_id IS NULL OR (kind='task' AND archived_at IS NULL AND archive_after IS NULL)),
 CHECK(archive_after IS NULL OR completed_at IS NOT NULL), UNIQUE(column_id,order_key)
);
CREATE INDEX active_board ON items(board_id,order_key) WHERE archived_at IS NULL;
CREATE INDEX board_items ON items(board_id,id);
CREATE INDEX project_children ON items(parent_id,id);
CREATE INDEX item_kind ON items(kind,id);
CREATE INDEX archive_page ON items(archive_sort DESC,id DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX archive_due ON items(archive_after) WHERE archived_at IS NULL;
CREATE TABLE events (
 id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id),
 item_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.itemId')) STORED NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
 occurred_at TEXT GENERATED ALWAYS AS (json_extract(data,'$.occurredAt')) STORED NOT NULL
);
-- Historical from/to column UUIDs deliberately have no foreign key.
CREATE INDEX item_history ON events(item_id,occurred_at,id);
CREATE TABLE tags (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id), normalized_name TEXT NOT NULL UNIQUE);
CREATE TABLE relations (item_id TEXT NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED, tag_id TEXT NOT NULL REFERENCES tags(id) DEFERRABLE INITIALLY DEFERRED, PRIMARY KEY(item_id,tag_id));
CREATE INDEX tag_items ON relations(tag_id,item_id);
CREATE TABLE scratchpads (id TEXT PRIMARY KEY CHECK(id='global'), data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id));
CREATE TABLE settings (id TEXT PRIMARY KEY CHECK(id='app'), data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data,'$.id')=id));
-- Archived imported records may refer to a deleted column; active records may not.
CREATE TRIGGER item_column_insert BEFORE INSERT ON items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM boards WHERE id=NEW.board_id AND project_id IS NEW.parent_id) OR (NEW.kind='project' AND NEW.parent_id IS NOT NULL) THEN RAISE(ABORT,'Invalid item ownership') END;
 SELECT CASE WHEN (NEW.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM columns WHERE id=NEW.column_id)) OR EXISTS(SELECT 1 FROM columns WHERE id=NEW.column_id AND board_id<>NEW.board_id) THEN RAISE(ABORT,'Invalid item column') END;
END;
CREATE TRIGGER item_column_update BEFORE UPDATE ON items BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM boards WHERE id=NEW.board_id AND project_id IS NEW.parent_id) OR (NEW.kind='project' AND NEW.parent_id IS NOT NULL) THEN RAISE(ABORT,'Invalid item ownership') END;
 SELECT CASE WHEN (NEW.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM columns WHERE id=NEW.column_id)) OR EXISTS(SELECT 1 FROM columns WHERE id=NEW.column_id AND board_id<>NEW.board_id) THEN RAISE(ABORT,'Invalid item column') END;
END;
CREATE TRIGGER active_column_delete BEFORE DELETE ON columns BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM items WHERE column_id=OLD.id AND archived_at IS NULL) THEN RAISE(ABORT,'Active items still reference column') END;
END;
CREATE TABLE drafts (id TEXT PRIMARY KEY, token TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TRIGGER delete_item_drafts AFTER DELETE ON items BEGIN
 DELETE FROM drafts WHERE id=OLD.id||'-title' OR id=OLD.id||'-description';
END;
PRAGMA user_version=2;
PRAGMA application_id=1262636593;
