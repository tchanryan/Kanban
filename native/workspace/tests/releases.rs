use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    model::{Result, StorageError},
    recovery::{ManagedWorkspace, NoFaults, RecoveryHooks},
};
use std::{fs, path::Path, sync::Arc};

fn open(root: &Path, version: &str, hooks: Arc<dyn RecoveryHooks>) -> ManagedWorkspace {
    ManagedWorkspace::open_versioned(
        root.to_owned(),
        Arc::new(SystemRuntime),
        hooks,
        version.into(),
    )
}
fn text(store: &mut ManagedWorkspace) -> String {
    store
        .storage()
        .unwrap()
        .query(Query::Scratch)
        .unwrap()
        .value["content"]
        .as_str()
        .unwrap()
        .into()
}
struct Failure(&'static str);
impl RecoveryHooks for Failure {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if phase == self.0 {
            Err(StorageError::invalid("Injected release failure"))
        } else {
            Ok(())
        }
    }
}

#[test]
fn lightweight_availability_does_not_admit_damaged_backups_or_missing_live_data() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut workspace = open(&root, "0.1.0", Arc::new(NoFaults));
    workspace
        .storage()
        .unwrap()
        .execute(Command::Initialize, None)
        .unwrap();
    let backup = workspace.backup_now().unwrap();
    fs::write(
        root.join("backups").join(format!("{}.sqlite", backup.id)),
        b"damaged snapshot",
    )
    .unwrap();
    assert!(workspace.is_available());
    assert!(workspace.status().backup_error.is_some());
    assert!(workspace.restore(&backup.id, true).is_err());
    let live = workspace.status().storage_path;
    drop(workspace);
    fs::remove_file(live).unwrap();
    let mut missing = open(&root, "0.1.0", Arc::new(NoFaults));
    assert!(!missing.is_available());
    assert!(missing.storage().is_err());
    assert!(missing.status().recovery_error.is_some());
}

#[test]
fn upgrade_snapshots_before_writes_and_blocks_direct_binary_downgrade() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut first = open(&root, "0.1.0", Arc::new(NoFaults));
    first
        .storage()
        .unwrap()
        .execute(
            Command::SaveScratch {
                content: "Before upgrade — 日本語".into(),
                expected: None,
                generation: None,
            },
            None,
        )
        .unwrap();
    let generation = first
        .storage()
        .unwrap()
        .query(Query::Counts)
        .unwrap()
        .version
        .generation;
    drop(first);
    let mut upgraded = open(&root, "0.2.0", Arc::new(NoFaults));
    assert_eq!(text(&mut upgraded), "Before upgrade — 日本語");
    assert_eq!(
        upgraded
            .storage()
            .unwrap()
            .query(Query::Counts)
            .unwrap()
            .version
            .generation,
        generation
    );
    let backup = upgraded
        .status()
        .backups
        .into_iter()
        .find(|entry| entry.reason == "before-upgrade")
        .unwrap();
    let count = upgraded.status().backups.len();
    assert_eq!(backup.app_version.as_deref(), Some("0.1.0"));
    drop(upgraded);
    let mut same = open(&root, "0.2.0", Arc::new(NoFaults));
    assert_eq!(same.status().backups.len(), count);
    drop(same);
    let before = fs::read(root.join("APP_VERSION.json")).unwrap();
    let mut older = open(&root, "0.1.9", Arc::new(NoFaults));
    assert!(!older.status().available);
    assert!(older.storage().is_err());
    assert!(older.restore(&backup.id, true).is_err());
    assert_eq!(fs::read(root.join("APP_VERSION.json")).unwrap(), before);
    drop(older);
    let mut current = open(&root, "0.2.0", Arc::new(NoFaults));
    assert_eq!(text(&mut current), "Before upgrade — 日本語");
}

#[test]
fn snapshot_and_publication_failure_block_upgrade_without_advancing_metadata() {
    for phase in ["before-snapshot", "before-release-publish"] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let mut first = open(&root, "1.0.0", Arc::new(NoFaults));
        first
            .storage()
            .unwrap()
            .execute(
                Command::SaveScratch {
                    content: "Retain me".into(),
                    expected: None,
                    generation: None,
                },
                None,
            )
            .unwrap();
        drop(first);
        let before = fs::read(root.join("APP_VERSION.json")).unwrap();
        let mut failed = open(&root, "1.1.0", Arc::new(Failure(phase)));
        assert!(!failed.status().available);
        assert!(failed.storage().is_err());
        assert_eq!(fs::read(root.join("APP_VERSION.json")).unwrap(), before);
        drop(failed);
        let mut retry = open(&root, "1.1.0", Arc::new(NoFaults));
        assert_eq!(text(&mut retry), "Retain me");
    }
}

#[test]
fn missing_or_malformed_version_metadata_never_becomes_a_fresh_workspace() {
    for corrupted in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        drop(open(&root, "1.0.0", Arc::new(NoFaults)));
        if corrupted {
            fs::write(root.join("APP_VERSION.json"), b"invalid").unwrap();
        } else {
            fs::remove_file(root.join("APP_VERSION.json")).unwrap();
        }
        let mut blocked = open(&root, "1.1.0", Arc::new(NoFaults));
        assert!(!blocked.status().available);
        assert!(root.join("workspace.sqlite").exists());
    }
    for invalid in ["1.0", "01.0.0", "1.0.0-beta", "1.0.4294967296"] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let mut blocked = open(&root, invalid, Arc::new(NoFaults));
        assert!(blocked.storage().is_err());
        assert!(!root.join("workspace.sqlite").exists());
    }
}

#[test]
fn an_altered_migration_checksum_blocks_startup_and_snapshot_admission() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let store = open(&root, "1.0.0", Arc::new(NoFaults));
    let path = store.active_path().to_owned();
    drop(store);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TABLE migration_ledger(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL); INSERT INTO migration_ledger VALUES(2, 'altered');").unwrap();
    drop(connection);
    let mut blocked = open(&root, "1.1.0", Arc::new(NoFaults));
    assert!(!blocked.status().available);
    assert!(blocked
        .status()
        .recovery_error
        .unwrap()
        .contains("checksum"));
    assert!(blocked.status().backups.is_empty());
    assert!(path.exists());
}

#[test]
fn upgrade_safety_snapshot_keeps_secondary_retention_in_step_with_local_restore_points() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut first = open(&root, "1.0.0", Arc::new(NoFaults));
    first.select_secondary(temp.path()).unwrap();
    for _ in 0..13 {
        first.backup_now().unwrap();
    }
    assert_eq!(first.status().backups.len(), 12);
    drop(first);
    let mut upgraded = open(&root, "1.1.0", Arc::new(NoFaults));
    let status = upgraded.status();
    assert_eq!(status.backups.len(), 13);
    assert!(status.secondary.error.is_none());
    assert!(status.backups.iter().all(|local| status
        .secondary
        .backups
        .iter()
        .any(|copy| copy.id == local.id)));
}

#[test]
fn backups_from_newer_applications_cannot_replace_an_older_workspace() {
    use kanban_workspace::recovery::BackupCatalog;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("current");
    let future = temp.path().join("newer");
    let mut current = open(&root, "1.0.0", Arc::new(NoFaults));
    current
        .storage()
        .unwrap()
        .execute(
            Command::SaveScratch {
                content: "Keep current notes".into(),
                expected: None,
                generation: None,
            },
            None,
        )
        .unwrap();
    let mut newer = open(&future, "2.0.0", Arc::new(NoFaults));
    let backup = newer.backup_now().unwrap();
    let source = BackupCatalog::new(
        future.join("backups"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    )
    .unwrap();
    let target = BackupCatalog::new(
        root.join("backups"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    )
    .unwrap();
    target.copy_verified(&source, &backup.id).unwrap();
    assert!(current.restore(&backup.id, true).is_err());
    assert_eq!(text(&mut current), "Keep current notes");
}
