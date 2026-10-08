use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    drafts::{DraftRecord, DraftStorage},
    model::*,
    portable::PortableBackup,
    recovery::{BackupCatalog, ManagedWorkspace, NoFaults, RecoveryHooks},
};
use std::{
    fs,
    sync::{Arc, Mutex},
};

fn fixture() -> PortableBackup {
    serde_json::from_str(include_str!("fixtures/portable-v1.json")).unwrap()
}
fn open(path: &std::path::Path, hooks: Arc<dyn RecoveryHooks>) -> ManagedWorkspace {
    ManagedWorkspace::open(path.to_owned(), Arc::new(SystemRuntime), hooks)
}
fn initialize(store: &mut ManagedWorkspace) {
    store
        .storage()
        .unwrap()
        .execute(Command::Initialize, None)
        .unwrap();
    notes(store, "Before import");
}
fn notes(store: &mut ManagedWorkspace, content: &str) {
    store
        .storage()
        .unwrap()
        .execute(
            Command::SaveScratch {
                content: content.into(),
                expected: None,
                generation: None,
            },
            None,
        )
        .unwrap();
}
fn version(store: &mut ManagedWorkspace) -> WorkspaceVersion {
    store
        .storage()
        .unwrap()
        .query(Query::Counts)
        .unwrap()
        .version
}

#[test]
fn browser_fixture_round_trips_reopens_and_records_atomic_provenance_with_safety_copy() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("workspace");
    let mut store = open(&path, Arc::new(NoFaults));
    initialize(&mut store);
    let before = store.export_portable().unwrap();
    let before_version = version(&mut store);
    let backup = fixture();
    let preview = store.preview_import(backup.clone()).unwrap();
    assert_eq!(version(&mut store), before_version);
    assert!(store.import_history().unwrap().is_empty());
    let receipt = store.import_portable(&preview.ticket, true).unwrap();
    assert_eq!(receipt.previous, before_version);
    assert_ne!(receipt.current.generation, before_version.generation);
    assert_eq!(receipt.current.revision, before_version.revision + 1);
    assert_eq!(receipt.counts, backup.counts());
    assert_eq!(receipt.semantic_sha256, backup.semantic_hash().unwrap());
    let catalog = BackupCatalog::new(
        path.join("backups"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    )
    .unwrap();
    let (safety, _) = catalog.verify(&receipt.safety_backup_id).unwrap();
    assert_eq!(safety.reason, "before-import");
    drop(store);
    let mut reopened = open(&path, Arc::new(NoFaults));
    let mut exported = reopened.export_portable().unwrap();
    assert_eq!(
        exported.semantic_hash().unwrap(),
        backup.semantic_hash().unwrap()
    );
    assert_eq!(reopened.import_history().unwrap()[0].id, receipt.id);
    exported.exported_at = backup.exported_at.clone();
    let value = serde_json::to_value(&exported).unwrap();
    if std::env::var("WRITE_NATIVE_FIXTURES").as_deref() == Ok("1") {
        fs::write(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/portable-native.json"),
            serde_json::to_string_pretty(&value).unwrap() + "\n",
        )
        .unwrap();
    }
    reopened.restore(&receipt.safety_backup_id, true).unwrap();
    assert_eq!(
        reopened.export_portable().unwrap().semantic_hash().unwrap(),
        before.semantic_hash().unwrap()
    );
}

#[test]
fn tickets_require_confirmation_and_reject_replay_changed_workspace_and_pending_drafts() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = open(&dir.path().join("workspace"), Arc::new(NoFaults));
    initialize(&mut store);
    let ticket = store.preview_import(fixture()).unwrap().ticket;
    assert!(store.import_portable(&ticket, false).is_err());
    assert!(store.import_portable("unknown", true).is_err());
    notes(&mut store, "Newer acknowledged edit");
    assert_eq!(
        store.import_portable(&ticket, true).unwrap_err().code,
        "conflict"
    );
    let ticket = store.preview_import(fixture()).unwrap().ticket;
    let current = version(&mut store);
    let draft = DraftRecord {
        id: "scratchpad-global".into(),
        token: uuid::Uuid::new_v4().to_string(),
        entity_id: "global".into(),
        field: kanban_workspace::drafts::TextField::Scratch,
        text: "Retain me".into(),
        expected: "Newer acknowledged edit".into(),
        generation: current.generation,
        label: "Scratchpad".into(),
    };
    store.storage().unwrap().stage_draft(draft.clone()).unwrap();
    assert!(store.import_portable(&ticket, true).is_err());
    assert!(store.preview_import(fixture()).is_err());
    assert_eq!(
        store.storage().unwrap().recovery_drafts().unwrap()[0].text,
        "Retain me"
    );
    store
        .storage()
        .unwrap()
        .discard_draft(&draft.id, &draft.token)
        .unwrap();
    let ticket = store.preview_import(fixture()).unwrap().ticket;
    store.import_portable(&ticket, true).unwrap();
    assert!(store.import_portable(&ticket, true).is_err());
    let duplicate = store.preview_import(fixture()).unwrap();
    assert!(store.import_portable(&duplicate.ticket, false).is_err());
    assert_eq!(store.import_history().unwrap().len(), 1);
}

#[test]
fn malformed_backups_never_mutate_canonical_data_or_create_import_ledger() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = open(&dir.path().join("workspace"), Arc::new(NoFaults));
    initialize(&mut store);
    let original = version(&mut store);
    let original_data = store.export_portable().unwrap().semantic_hash().unwrap();
    let base = serde_json::to_value(fixture()).unwrap();
    let changes = [
        ("/version", serde_json::json!(99)),
        ("/format", serde_json::json!("other")),
        (
            "/relations/0/itemId",
            serde_json::json!(uuid::Uuid::new_v4().to_string()),
        ),
        (
            "/boards/0/projectId",
            serde_json::json!(uuid::Uuid::new_v4().to_string()),
        ),
        ("/items/0/orderKey", serde_json::json!("not valid!")),
        ("/items/0/id", base["boards"][0]["id"].clone()),
        ("/items/0/dueDate", serde_json::json!("2026-02-30")),
    ];
    for (pointer, value) in changes {
        let mut invalid = base.clone();
        *invalid.pointer_mut(pointer).unwrap() = value;
        let decoded = serde_json::from_value::<PortableBackup>(invalid);
        if let Ok(backup) = decoded {
            assert!(store.preview_import(backup).is_err(), "{pointer}");
        }
        assert_eq!(version(&mut store), original);
    }
    let mut duplicate = fixture();
    duplicate.items.push(duplicate.items[0].clone());
    assert!(store.preview_import(duplicate).is_err());
    let mut wrong_owner = fixture();
    wrong_owner
        .items
        .iter_mut()
        .find(|i| i.parent_project_id.is_some())
        .unwrap()
        .parent_project_id = None;
    assert!(store.preview_import(wrong_owner).is_err());
    assert!(store.import_history().unwrap().is_empty());
    assert!(store.status().backups.is_empty());
    assert_eq!(
        store.export_portable().unwrap().semantic_hash().unwrap(),
        original_data
    );
}

struct Fault(Mutex<Option<&'static str>>);
impl RecoveryHooks for Fault {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if *self.0.lock().unwrap() == Some(phase) {
            Err(std::io::Error::from(std::io::ErrorKind::StorageFull).into())
        } else {
            Ok(())
        }
    }
}
#[test]
fn backup_failure_and_interrupted_transaction_preserve_original_generation_and_receipts() {
    for phase in [
        "before-snapshot",
        "after-import-clear",
        "before-import-commit",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        let faults = Arc::new(Fault(Mutex::new(None)));
        let mut store = open(&root, faults.clone());
        initialize(&mut store);
        let original = store.export_portable().unwrap().semantic_hash().unwrap();
        let original_version = version(&mut store);
        let ticket = store.preview_import(fixture()).unwrap().ticket;
        *faults.0.lock().unwrap() = Some(phase);
        assert!(store.import_portable(&ticket, true).is_err());
        assert_eq!(version(&mut store), original_version);
        assert!(store.import_history().unwrap().is_empty());
        drop(store);
        let mut reopened = open(&root, Arc::new(NoFaults));
        assert_eq!(
            reopened.export_portable().unwrap().semantic_hash().unwrap(),
            original
        );
        assert_eq!(version(&mut reopened), original_version);
    }
}

#[test]
fn locked_writer_rejects_import_without_partial_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = open(&dir.path().join("workspace"), Arc::new(NoFaults));
    initialize(&mut store);
    let original = version(&mut store);
    let ticket = store.preview_import(fixture()).unwrap().ticket;
    let lock = rusqlite::Connection::open(store.active_path()).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert!(store.import_portable(&ticket, true).is_err());
    lock.execute_batch("ROLLBACK").unwrap();
    assert_eq!(version(&mut store), original);
    assert!(store.import_history().unwrap().is_empty());
}

struct PauseBeforeCommit(std::path::PathBuf);
impl RecoveryHooks for PauseBeforeCommit {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if phase == "before-import-commit" {
            fs::write(&self.0, b"transaction staged")?;
            loop {
                std::thread::park();
            }
        }
        Ok(())
    }
}
#[test]
fn import_crash_child() {
    let Ok(root) = std::env::var("KANBAN_IMPORT_CRASH_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let mut store = open(&root, Arc::new(PauseBeforeCommit(root.join("paused"))));
    let ticket = store.preview_import(fixture()).unwrap().ticket;
    store.import_portable(&ticket, true).unwrap();
}
#[test]
fn forced_exit_during_import_recovers_original_data_and_no_partial_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut store = open(&root, Arc::new(NoFaults));
    initialize(&mut store);
    let original = store.export_portable().unwrap().semantic_hash().unwrap();
    let original_version = version(&mut store);
    drop(store);
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "import_crash_child", "--nocapture"])
        .env("KANBAN_IMPORT_CRASH_ROOT", &root)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    while !root.join("paused").exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let reached = root.join("paused").exists();
    let _ = child.kill();
    child.wait().unwrap();
    assert!(reached, "Child did not reach import commit boundary");
    let mut reopened = open(&root, Arc::new(NoFaults));
    assert_eq!(version(&mut reopened), original_version);
    assert_eq!(
        reopened.export_portable().unwrap().semantic_hash().unwrap(),
        original
    );
    assert!(reopened.import_history().unwrap().is_empty());
    assert_eq!(reopened.status().backups.len(), 1);
}
