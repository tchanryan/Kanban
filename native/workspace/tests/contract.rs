use chrono::{DateTime, Utc};
use kanban_workspace::{
    contracts::{Command, Query, Runtime, WorkspaceStorage},
    model::*,
    sqlite::SqliteWorkspace,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

struct FixtureRuntime {
    count: AtomicU64,
    time: Mutex<String>,
}
impl FixtureRuntime {
    fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            time: Mutex::new("2026-01-01T12:00:00.000Z".into()),
        }
    }
}
impl Runtime for FixtureRuntime {
    fn id(&self) -> String {
        format!(
            "00000000-0000-4000-8000-{:012}",
            self.count.fetch_add(1, Ordering::SeqCst) + 1
        )
    }
    fn now(&self) -> DateTime<Utc> {
        self.time.lock().unwrap().parse().unwrap()
    }
}
fn translate_generation(value: &mut Value, generation: &str) {
    match value {
        Value::String(s) if s == "initial" => *s = generation.into(),
        Value::Array(values) => values
            .iter_mut()
            .for_each(|v| translate_generation(v, generation)),
        Value::Object(values) => values
            .values_mut()
            .for_each(|v| translate_generation(v, generation)),
        _ => {}
    }
}

#[test]
fn every_repository_operation_matches_the_dexie_contract_fixture() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = Arc::new(FixtureRuntime::new());
    let mut store =
        SqliteWorkspace::open(&directory.path().join("parity.sqlite"), runtime.clone()).unwrap();
    let initial = store.query(Query::Counts).unwrap().version;
    let mut fixture: Value =
        serde_json::from_str(include_str!("fixtures/web-contract.json")).unwrap();
    translate_generation(&mut fixture, &initial.generation);
    let mut revision = 0;
    for (index, step) in fixture["steps"].as_array().unwrap().iter().enumerate() {
        runtime
            .count
            .store(step["idCounter"].as_u64().unwrap(), Ordering::SeqCst);
        *runtime.time.lock().unwrap() = step["now"].as_str().unwrap().into();
        let mut input = json!({"name":step["name"]});
        if let Some(args) = step.get("args") {
            input["args"] = args.clone();
        }
        let command = step["kind"] == "command";
        let result = if command {
            store.execute(serde_json::from_value(input).unwrap(), Some(revision))
        } else {
            store.query(serde_json::from_value(input).unwrap())
        };
        if step["error"] == true {
            assert!(
                result.is_err(),
                "step {index}: {} should fail",
                step["name"]
            );
            assert_eq!(
                store.query(Query::Counts).unwrap().version.revision,
                revision
            );
        } else {
            let reply = result.unwrap_or_else(|e| panic!("step {index}: {}: {e}", step["name"]));
            if command {
                revision += 1;
            }
            assert_eq!(reply.version.revision, revision, "step {index}");
            assert_eq!(reply.value, step["value"], "step {index}: {}", step["name"]);
        }
    }
}

fn initialize(store: &mut SqliteWorkspace) -> (String, String) {
    let board = store.execute(Command::Initialize, None).unwrap().value["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let column = store
        .execute(
            Command::SaveColumn {
                board_id: board.clone(),
                id: None,
                input: ColumnInput {
                    name: "Inbox".into(),
                    is_default_new_item_column: true,
                    starts_work_on_first_entry: false,
                    completes_item_on_entry: false,
                },
            },
            None,
        )
        .unwrap()
        .value["id"]
        .as_str()
        .unwrap()
        .to_owned();
    (board, column)
}
fn create(board: &str) -> Command {
    Command::Create {
        board_id: board.into(),
        title: "Task".into(),
        kind: ItemKind::Task,
        column_id: None,
    }
}

#[test]
fn failed_history_insert_rolls_back_item_and_workspace_revision_then_reopen_preserves_commit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rollback.sqlite");
    let runtime = Arc::new(FixtureRuntime::new());
    let mut store = SqliteWorkspace::open(&path, runtime.clone()).unwrap();
    let (board, _) = initialize(&mut store);
    let before = store.query(Query::Counts).unwrap();
    let probe = rusqlite::Connection::open(&path).unwrap();
    probe.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected history failure'); END;").unwrap();
    assert!(store.execute(create(&board), None).is_err());
    let after = store.query(Query::Counts).unwrap();
    assert_eq!(before.value, after.value);
    assert_eq!(before.version.revision, after.version.revision);
    probe.execute_batch("DROP TRIGGER fail_history").unwrap();
    let saved = store
        .execute(create(&board), Some(after.version.revision))
        .unwrap();
    let id = saved.value["id"].as_str().unwrap().to_owned();
    drop(store);
    let mut reopened = SqliteWorkspace::open(&path, runtime).unwrap();
    let result = reopened.query(Query::Item { id }).unwrap();
    assert_eq!(result.value, saved.value);
    assert_eq!(result.version.revision, saved.version.revision);
}

#[test]
fn stale_workspace_revision_and_generation_reject_without_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("conflicts.sqlite");
    let runtime = Arc::new(FixtureRuntime::new());
    let mut first = SqliteWorkspace::open(&path, runtime.clone()).unwrap();
    let (board, _) = initialize(&mut first);
    let mut second = SqliteWorkspace::open(&path, runtime).unwrap();
    let revision = first.query(Query::Counts).unwrap().version.revision;
    second.execute(create(&board), Some(revision)).unwrap();
    assert_eq!(
        first
            .execute(create(&board), Some(revision))
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(
        first
            .execute(
                Command::SaveScratch {
                    content: "unsafe".into(),
                    expected: None,
                    generation: Some("old-generation".into())
                },
                None
            )
            .unwrap_err()
            .code,
        "conflict"
    );
    assert_eq!(first.query(Query::Scratch).unwrap().value, Value::Null);
}

#[test]
fn archived_missing_column_restores_to_default_and_history_keeps_deleted_column_id() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("archive.sqlite");
    let runtime = Arc::new(FixtureRuntime::new());
    let mut store = SqliteWorkspace::open(&path, runtime).unwrap();
    let (board, column) = initialize(&mut store);
    let mut item = store.execute(create(&board), None).unwrap().value;
    let existing = store.execute(create(&board), None).unwrap().value;
    let id = item["id"].as_str().unwrap().to_owned();
    let missing = "00000000-0000-4000-8000-999999999999";
    item["columnId"] = json!(missing);
    item["orderKey"] = existing["orderKey"].clone();
    item["archivedAt"] = json!("2026-01-01T12:00:00.000Z");
    let probe = rusqlite::Connection::open(&path).unwrap();
    probe
        .execute(
            "UPDATE items SET data=?1 WHERE id=?2",
            rusqlite::params![item.to_string(), id],
        )
        .unwrap();
    assert_eq!(
        store
            .execute(Command::Restore { id: id.clone() }, None)
            .unwrap()
            .value,
        json!(true)
    );
    assert_eq!(
        store.query(Query::Item { id: id.clone() }).unwrap().value["columnId"],
        json!(column)
    );
    let history = store.query(Query::History { id }).unwrap().value;
    assert_eq!(
        history.as_array().unwrap().last().unwrap()["fromColumnId"],
        json!(missing)
    );
}

#[test]
fn schema_rejects_foreign_files_future_versions_and_active_missing_columns() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("foreign.sqlite");
    let runtime = Arc::new(FixtureRuntime::new());
    let probe = rusqlite::Connection::open(&path).unwrap();
    probe
        .execute_batch("CREATE TABLE other(id INTEGER); INSERT INTO other VALUES(42);")
        .unwrap();
    assert!(SqliteWorkspace::open(&path, runtime.clone()).is_err());
    assert_eq!(
        probe
            .query_row("SELECT id FROM other", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        42
    );
    let path = dir.path().join("future.sqlite");
    let mut store = SqliteWorkspace::open(&path, runtime.clone()).unwrap();
    let (board, _) = initialize(&mut store);
    let mut item = store.execute(create(&board), None).unwrap().value;
    item["columnId"] = json!("00000000-0000-4000-8000-999999999999");
    let probe = rusqlite::Connection::open(&path).unwrap();
    assert!(probe
        .execute("UPDATE items SET data=?1", [item.to_string()])
        .is_err());
    probe.pragma_update(None, "user_version", 99).unwrap();
    drop(store);
    assert!(SqliteWorkspace::open(&path, runtime).is_err());
}

#[test]
fn bounded_lock_failure_keeps_committed_state_and_succeeds_after_release() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lock.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(FixtureRuntime::new())).unwrap();
    let (board, _) = initialize(&mut store);
    let before = store.query(Query::Counts).unwrap();
    let probe = rusqlite::Connection::open(&path).unwrap();
    probe.execute_batch("BEGIN IMMEDIATE").unwrap();
    let started = std::time::Instant::now();
    assert!(store.execute(create(&board), None).is_err());
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    probe.execute_batch("ROLLBACK").unwrap();
    let after = store.query(Query::Counts).unwrap();
    assert_eq!(after.value, before.value);
    assert_eq!(after.version.revision, before.version.revision);
    store
        .execute(create(&board), Some(after.version.revision))
        .unwrap();
}

#[test]
fn durability_constraints_global_identities_and_archive_index_are_enforced() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("schema.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(FixtureRuntime::new())).unwrap();
    let (board, _) = initialize(&mut store);
    let probe = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        probe
            .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal"
    );
    let tag = json!({"id":board,"createdAt":"2026-01-01T12:00:00.000Z","updatedAt":"2026-01-01T12:00:00.000Z","revision":1,"name":"Collision","colorToken":"blue"});
    assert!(probe
        .execute(
            "INSERT INTO tags(id,data,normalized_name) VALUES(?1,?2,'collision')",
            rusqlite::params![board, tag.to_string()]
        )
        .is_err());
    let mut statement=probe.prepare("EXPLAIN QUERY PLAN SELECT data FROM items WHERE archived_at IS NOT NULL ORDER BY archive_sort DESC,id DESC").unwrap();
    let plan = statement
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    assert!(plan.iter().any(|s| s.contains("archive_page")), "{plan:?}");
}

#[test]
fn typed_boundary_rejects_unknown_operations_and_invalid_patch_shapes() {
    for command in [
        json!({"name":"rawSql","args":{"sql":"DROP TABLE items"}}),
        json!({"name":"update","args":{"id":"x","patch":{"title":null}}}),
        json!({"name":"update","args":{"id":"x","patch":{"boardId":"x"}}}),
        json!({"name":"saveSettings","args":{"patch":{"calendarMode":"invalid"}}}),
    ] {
        assert!(serde_json::from_value::<Command>(command).is_err());
    }
    let patch: ItemPatch = serde_json::from_value(json!({"dueDate":null})).unwrap();
    assert!(matches!(patch.due_date, Patch::Value(None)));
    assert!(matches!(patch.planned_start_date, Patch::Missing));
}

#[test]
fn archive_pagination_uses_exclusive_cursor_without_missing_tied_dates() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pagination.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(FixtureRuntime::new())).unwrap();
    let (board, _) = initialize(&mut store);
    let template = store.execute(create(&board), None).unwrap().value;
    let fixture: Value = serde_json::from_str(include_str!("fixtures/web-contract.json")).unwrap();
    let mut probe = rusqlite::Connection::open(&path).unwrap();
    probe.pragma_update(None, "foreign_keys", true).unwrap();
    let transaction = probe.transaction().unwrap();
    transaction
        .execute_batch("DELETE FROM events; DELETE FROM items;")
        .unwrap();
    for i in 0..230 {
        let mut item = template.clone();
        let id = format!("00000000-0000-4000-8000-{:012}", i + 10000);
        item["id"] = json!(id);
        item["title"] = json!(format!("Archive {i}"));
        item["orderKey"] = fixture["ordering"][i]["result"].clone();
        item["completedAt"] = json!("2026-01-01T12:00:00.000Z");
        item["archivedAt"] = json!("2026-01-15T12:00:00.000Z");
        transaction
            .execute(
                "INSERT INTO items(id,data) VALUES(?1,?2)",
                rusqlite::params![id, item.to_string()],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
    let mut cursor = None;
    let mut ids = vec![];
    loop {
        let page = store
            .query(Query::ArchivePage {
                query: "archive".into(),
                cursor,
                limit: 50,
            })
            .unwrap()
            .value;
        ids.extend(
            page["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().to_owned()),
        );
        cursor = serde_json::from_value(page["nextCursor"].clone()).unwrap();
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids.len(), 230);
    assert!(ids.windows(2).all(|pair| pair[0] > pair[1]));
    assert_eq!(
        store.query(Query::Items { board_id: board }).unwrap().value,
        json!([])
    );
}
