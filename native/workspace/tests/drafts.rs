use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    drafts::{DraftRecord, DraftStorage, TextField},
    sqlite::SqliteWorkspace,
};
use std::sync::Arc;

fn draft(generation: String) -> DraftRecord {
    DraftRecord {
        id: "scratchpad-global".into(),
        token: uuid::Uuid::new_v4().to_string(),
        entity_id: "global".into(),
        field: TextField::Scratch,
        text: "Recover this text".into(),
        expected: "".into(),
        generation,
        label: "Notes".into(),
    }
}
#[test]
fn journal_reopens_and_success_clears_atomically_without_replaying() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("draft.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(SystemRuntime)).unwrap();
    let version = store.execute(Command::Initialize, None).unwrap().version;
    let record = draft(version.generation);
    assert_eq!(store.stage_draft(record.clone()).unwrap(), record.token);
    assert_eq!(
        store.query(Query::Counts).unwrap().version.revision,
        version.revision
    );
    drop(store);
    let mut store = SqliteWorkspace::open(&path, Arc::new(SystemRuntime)).unwrap();
    assert_eq!(store.recovery_drafts().unwrap()[0].text, record.text);
    assert!(store.query(Query::Scratch).unwrap().value.is_null());
    let reply = store.commit_draft(&record.id, &record.token).unwrap();
    assert_eq!(reply.version.revision, version.revision + 1);
    drop(store);
    let mut store = SqliteWorkspace::open(&path, Arc::new(SystemRuntime)).unwrap();
    assert!(store.recovery_drafts().unwrap().is_empty());
    assert_eq!(
        store.query(Query::Scratch).unwrap().value["content"],
        record.text
    );
    assert!(store.commit_draft(&record.id, &record.token).is_err());
}
#[test]
fn stale_generation_value_and_token_preserve_journal_and_revision() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("conflicts.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(SystemRuntime)).unwrap();
    let version = store.execute(Command::Initialize, None).unwrap().version;
    let mut record = draft(uuid::Uuid::new_v4().to_string());
    store.stage_draft(record.clone()).unwrap();
    assert!(store.commit_draft(&record.id, &record.token).is_err());
    record.generation = version.generation;
    record.expected = "conflicting original".into();
    store.stage_draft(record.clone()).unwrap();
    assert!(store.commit_draft(&record.id, &record.token).is_err());
    let previous = record.token.clone();
    record.token = uuid::Uuid::new_v4().to_string();
    store.stage_draft(record.clone()).unwrap();
    assert!(store.commit_draft(&record.id, &previous).is_err());
    store.discard_draft(&record.id, &previous).unwrap();
    assert_eq!(store.recovery_drafts().unwrap()[0].token, record.token);
    assert_eq!(
        store.query(Query::Counts).unwrap().version.revision,
        version.revision
    );
    store.discard_draft(&record.id, &record.token).unwrap();
    assert!(store.recovery_drafts().unwrap().is_empty());
}
#[test]
fn transaction_failure_cannot_clear_recovery_text_or_acknowledge_save() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("rollback.sqlite");
    let mut store = SqliteWorkspace::open(&path, Arc::new(SystemRuntime)).unwrap();
    let version = store.execute(Command::Initialize, None).unwrap().version;
    let record = draft(version.generation);
    store.stage_draft(record.clone()).unwrap();
    let probe = rusqlite::Connection::open(&path).unwrap();
    probe.execute_batch("CREATE TRIGGER fail_clear BEFORE DELETE ON drafts BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(store.commit_draft(&record.id, &record.token).is_err());
    assert!(store.query(Query::Scratch).unwrap().value.is_null());
    assert_eq!(
        store.query(Query::Counts).unwrap().version.revision,
        version.revision
    );
    assert_eq!(store.recovery_drafts().unwrap()[0].text, record.text);
}
