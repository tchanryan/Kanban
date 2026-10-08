use chrono::{DateTime, Utc};
use kanban_workspace::{
    contracts::{Command, Query, Runtime, SystemRuntime, WorkspaceStorage},
    model::*,
    recovery::{
        BackupCatalog, BackupEntry, ManagedWorkspace, NoFaults, RecoveryHooks, RetentionPolicy,
    },
};
use std::{
    fs,
    sync::{Arc, Mutex},
};

struct Fault(Mutex<Option<&'static str>>);
impl RecoveryHooks for Fault {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if *self.0.lock().unwrap() == Some(phase) {
            Err(StorageError::invalid(format!(
                "Injected failure at {phase}"
            )))
        } else {
            Ok(())
        }
    }
}
fn notes(store: &mut ManagedWorkspace, text: &str) {
    store
        .storage()
        .unwrap()
        .execute(
            Command::SaveScratch {
                content: text.into(),
                expected: None,
                generation: None,
            },
            None,
        )
        .unwrap();
}
fn read(store: &mut ManagedWorkspace) -> String {
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

#[test]
fn verified_restore_changes_generation_preserves_original_and_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let mut managed = ManagedWorkspace::open(
        dir.path().join("workspace"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    );
    managed
        .storage()
        .unwrap()
        .execute(Command::Initialize, None)
        .unwrap();
    notes(&mut managed, "first");
    let backup = managed.backup_now().unwrap();
    notes(&mut managed, "second");
    let original = managed.active_path().to_owned();
    let version = managed.restore(&backup.id, true).unwrap();
    assert_ne!(version.generation, backup.version.generation);
    assert_eq!(read(&mut managed), "first");
    assert!(original.exists());
    assert!(managed
        .status()
        .backups
        .iter()
        .any(|entry| entry.reason == "before-restore"));
    drop(managed);
    let mut reopened = ManagedWorkspace::open(
        dir.path().join("workspace"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    );
    assert_eq!(read(&mut reopened), "first");
    let mut original_store =
        kanban_workspace::sqlite::SqliteWorkspace::open(&original, Arc::new(SystemRuntime))
            .unwrap();
    assert_eq!(
        original_store.query(Query::Scratch).unwrap().value["content"],
        "second"
    );
}

#[test]
fn snapshot_and_restore_failures_leave_last_backup_and_active_data_untouched() {
    for phase in [
        "before-snapshot",
        "after-snapshot",
        "before-publish",
        "before-restore-copy",
        "before-restore-switch",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let hooks = Arc::new(Fault(Mutex::new(None)));
        let mut managed = ManagedWorkspace::open(
            dir.path().join("workspace"),
            Arc::new(SystemRuntime),
            hooks.clone(),
        );
        managed
            .storage()
            .unwrap()
            .execute(Command::Initialize, None)
            .unwrap();
        notes(&mut managed, "backup");
        let backup = managed.backup_now().unwrap();
        notes(&mut managed, "active");
        let path = managed.active_path().to_owned();
        *hooks.0.lock().unwrap() = Some(phase);
        assert!(managed.restore(&backup.id, true).is_err(), "{phase}");
        assert_eq!(read(&mut managed), "active", "{phase}");
        assert_eq!(managed.active_path(), path);
        let catalog = BackupCatalog::new(
            dir.path().join("workspace/backups"),
            Arc::new(SystemRuntime),
            Arc::new(NoFaults),
        )
        .unwrap();
        catalog.verify(&backup.id).unwrap();
        drop(managed);
        let mut reopened = ManagedWorkspace::open(
            dir.path().join("workspace"),
            Arc::new(SystemRuntime),
            Arc::new(NoFaults),
        );
        assert_eq!(read(&mut reopened), "active", "{phase}");
    }
}

#[test]
fn missing_or_corrupt_active_file_enters_recovery_and_can_restore_without_overwrite() {
    for missing in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        let mut managed =
            ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
        notes(&mut managed, "recover me");
        let backup = managed.backup_now().unwrap();
        let original = managed.active_path().to_owned();
        drop(managed);
        if missing {
            fs::remove_file(&original).unwrap();
        } else {
            fs::write(&original, b"damaged original").unwrap();
        }
        let mut recovery =
            ManagedWorkspace::open(root, Arc::new(SystemRuntime), Arc::new(NoFaults));
        assert!(!recovery.status().available);
        assert!(recovery.storage().is_err());
        assert_eq!(original.exists(), !missing);
        recovery.restore(&backup.id, true).unwrap();
        assert_eq!(read(&mut recovery), "recover me");
        if !missing {
            assert_eq!(fs::read(original).unwrap(), b"damaged original");
        }
    }
}

#[test]
fn corrupt_backup_is_rejected_and_failed_destination_does_not_prevent_normal_saves() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "safe");
    let backup = managed.backup_now().unwrap();
    fs::write(
        root.join("backups").join(format!("{}.sqlite", backup.id)),
        b"truncated",
    )
    .unwrap();
    assert!(managed.restore(&backup.id, true).is_err());
    assert_eq!(read(&mut managed), "safe");
    let other = dir.path().join("blocked");
    let mut managed =
        ManagedWorkspace::open(other.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    fs::write(other.join("backups"), b"not a directory").unwrap();
    notes(&mut managed, "still saved");
    assert!(managed.backup_now().is_err());
    assert!(managed.status().backup_error.is_some());
    assert_eq!(read(&mut managed), "still saved");
}

struct Clock(Mutex<DateTime<Utc>>);
impl Runtime for Clock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }
    fn id(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
#[test]
fn automatic_backup_is_immediate_then_due_after_five_minutes_and_reconciles_restart() {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(Clock(Mutex::new("2026-10-01T00:00:00Z".parse().unwrap())));
    let root = dir.path().join("workspace");
    let mut managed = ManagedWorkspace::open(root.clone(), clock.clone(), Arc::new(NoFaults));
    notes(&mut managed, "first");
    managed.backup_if_due();
    assert_eq!(managed.status().backups.len(), 1);
    notes(&mut managed, "second");
    managed.backup_if_due();
    assert_eq!(managed.status().backups.len(), 1);
    *clock.0.lock().unwrap() += chrono::Duration::seconds(301);
    drop(managed);
    let mut reopened = ManagedWorkspace::open(root, clock, Arc::new(NoFaults));
    reopened.backup_if_due();
    assert_eq!(reopened.status().backups.len(), 2);
}

#[test]
fn retention_deduplicates_rolling_daily_weekly_buckets_and_keeps_latest() {
    let start: DateTime<Utc> = "2026-10-01T00:00:00Z".parse().unwrap();
    let entries: Vec<_> = (0..300)
        .map(|i| BackupEntry {
            app_version: None,
            id: i.to_string(),
            created_at: (start - chrono::Duration::hours(i * 4))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            version: WorkspaceVersion {
                revision: 1,
                generation: String::new(),
            },
            sha256: String::new(),
            bytes: 0,
            reason: "automatic".into(),
        })
        .collect();
    let keep = RetentionPolicy::default().keep(&entries);
    for i in 0..12 {
        assert!(keep.contains(&i.to_string()));
    }
    for i in [1, 7, 13, 19, 25, 31] {
        assert!(keep.contains(&i.to_string()));
    }
    assert!(keep.len() <= 23);
    assert!(!keep.contains("299"));
}

#[test]
fn schema_one_upgrades_only_a_copy_after_verified_safety_backup() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "legacy notes");
    let original = managed.active_path().to_owned();
    drop(managed);
    let probe = rusqlite::Connection::open(&original).unwrap();
    probe
        .execute_batch("DROP TRIGGER delete_item_drafts; DROP TABLE drafts; PRAGMA user_version=1;")
        .unwrap();
    drop(probe);
    let mut upgraded = ManagedWorkspace::open(root, Arc::new(SystemRuntime), Arc::new(NoFaults));
    assert_eq!(read(&mut upgraded), "legacy notes");
    assert_ne!(upgraded.active_path(), original);
    assert!(upgraded
        .status()
        .backups
        .iter()
        .any(|entry| entry.reason == "before-migration"));
    let old = rusqlite::Connection::open(&original).unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    let new = rusqlite::Connection::open(upgraded.active_path()).unwrap();
    let checksum: String = new
        .query_row(
            "SELECT checksum FROM migration_ledger WHERE version=2",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(checksum.len(), 64);
}

#[test]
fn concurrent_online_snapshots_contain_one_committed_revision() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "1");
    let path = managed.active_path().to_owned();
    let writer = std::thread::spawn(move || {
        let mut store =
            kanban_workspace::sqlite::SqliteWorkspace::open(&path, Arc::new(SystemRuntime))
                .unwrap();
        for revision in 2..25 {
            store
                .execute(
                    Command::SaveScratch {
                        content: revision.to_string(),
                        expected: None,
                        generation: None,
                    },
                    None,
                )
                .unwrap();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    });
    for _ in 0..4 {
        let backup = managed.backup_now().unwrap();
        let catalog = BackupCatalog::new(
            root.join("backups"),
            Arc::new(SystemRuntime),
            Arc::new(NoFaults),
        )
        .unwrap();
        let (_, snapshot) = catalog.verify(&backup.id).unwrap();
        let connection = rusqlite::Connection::open_with_flags(
            snapshot,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let content: String = connection
            .query_row(
                "SELECT json_extract(data,'$.content') FROM scratchpads",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(content, backup.version.revision.to_string());
    }
    writer.join().unwrap();
}

#[test]
fn retention_prunes_only_after_success_and_corrupt_catalog_keeps_other_restore_points_visible() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let clock = Arc::new(Clock(Mutex::new("2026-10-01T00:00:00Z".parse().unwrap())));
    let hooks = Arc::new(Fault(Mutex::new(None)));
    let mut managed = ManagedWorkspace::open(root.clone(), clock.clone(), hooks.clone());
    notes(&mut managed, "safe");
    let catalog = BackupCatalog::new(root.join("backups"), clock.clone(), hooks.clone()).unwrap();
    for _ in 0..15 {
        catalog.create(managed.storage().unwrap(), "test").unwrap();
        *clock.0.lock().unwrap() += chrono::Duration::seconds(1);
    }
    *hooks.0.lock().unwrap() = Some("before-prune");
    assert!(catalog.prune().is_err());
    assert_eq!(catalog.list().unwrap().len(), 15);
    *hooks.0.lock().unwrap() = None;
    catalog.prune().unwrap();
    assert_eq!(catalog.list().unwrap().len(), 12);
    fs::write(
        root.join("backups")
            .join(format!("{}.json", uuid::Uuid::new_v4())),
        b"truncated metadata",
    )
    .unwrap();
    assert!(catalog.prune().is_err());
    let status = managed.status();
    assert_eq!(status.backups.len(), 12);
    assert!(status.backup_error.is_some());
}

#[cfg(windows)]
#[test]
fn locked_backup_fails_without_touching_active_workspace() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "saved");
    let backup = managed.backup_now().unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(root.join("backups").join(format!("{}.sqlite", backup.id)))
        .unwrap();
    assert!(managed.restore(&backup.id, true).is_err());
    assert_eq!(read(&mut managed), "saved");
    drop(locked);
    managed.restore(&backup.id, true).unwrap();
}

struct PauseBeforeSwitch(std::path::PathBuf);
impl RecoveryHooks for PauseBeforeSwitch {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if phase == "before-restore-switch" {
            fs::write(self.0.join("paused"), b"ready")?;
            loop {
                std::thread::park();
            }
        }
        Ok(())
    }
}
#[test]
fn restoration_crash_child() {
    let Some(root) = std::env::var_os("KANBAN_CRASH_TEST_ROOT") else {
        return;
    };
    let root = std::path::PathBuf::from(root);
    let id = std::env::var("KANBAN_CRASH_BACKUP_ID").unwrap();
    let mut managed = ManagedWorkspace::open(
        root.clone(),
        Arc::new(SystemRuntime),
        Arc::new(PauseBeforeSwitch(root)),
    );
    managed.restore(&id, true).unwrap();
    panic!("Child should be terminated before returning");
}
#[test]
fn forced_process_exit_before_pointer_switch_reopens_original_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "snapshot");
    let backup = managed.backup_now().unwrap();
    notes(&mut managed, "acknowledged latest");
    let original = managed.active_path().to_owned();
    drop(managed);
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "restoration_crash_child",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("KANBAN_CRASH_TEST_ROOT", &root)
        .env("KANBAN_CRASH_BACKUP_ID", &backup.id)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    while !root.join("paused").exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let reached_switch = root.join("paused").exists();
    let _ = child.kill();
    child.wait().unwrap();
    assert!(
        reached_switch,
        "Child did not reach the intended interruption point"
    );
    let mut reopened = ManagedWorkspace::open(root, Arc::new(SystemRuntime), Arc::new(NoFaults));
    assert_eq!(reopened.active_path(), original);
    assert_eq!(read(&mut reopened), "acknowledged latest");
}

struct DiskFull;
impl RecoveryHooks for DiskFull {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if phase == "before-snapshot" {
            return Err(std::io::Error::from(std::io::ErrorKind::StorageFull).into());
        }
        Ok(())
    }
}
#[test]
fn simulated_disk_full_blocks_destructive_restore_and_schema_upgrade() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "snapshot");
    let backup = managed.backup_now().unwrap();
    notes(&mut managed, "latest");
    let original = managed.active_path().to_owned();
    drop(managed);
    let mut failed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(DiskFull));
    assert_eq!(
        failed.restore(&backup.id, true).unwrap_err().code,
        "filesystem"
    );
    assert_eq!(read(&mut failed), "latest");
    drop(failed);
    let probe = rusqlite::Connection::open(&original).unwrap();
    probe
        .execute_batch("DROP TRIGGER delete_item_drafts; DROP TABLE drafts; PRAGMA user_version=1;")
        .unwrap();
    drop(probe);
    let mut blocked = ManagedWorkspace::open(root, Arc::new(SystemRuntime), Arc::new(DiskFull));
    assert!(!blocked.status().available);
    let probe = rusqlite::Connection::open(&original).unwrap();
    assert_eq!(
        probe
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn missing_pointer_cannot_silently_reopen_the_old_pre_restore_database() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "old workspace");
    let backup = managed.backup_now().unwrap();
    managed.restore(&backup.id, true).unwrap();
    notes(&mut managed, "latest workspace");
    drop(managed);
    fs::remove_file(root.join("CURRENT.json")).unwrap();
    let mut reopened = ManagedWorkspace::open(root, Arc::new(SystemRuntime), Arc::new(NoFaults));
    assert!(!reopened.status().available);
    assert!(reopened.storage().is_err());
}

#[test]
fn detached_inspection_allows_live_edits_and_rechecks_snapshot_integrity() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    let mut managed =
        ManagedWorkspace::open(root.clone(), Arc::new(SystemRuntime), Arc::new(NoFaults));
    notes(&mut managed, "snapshot");
    let backup = managed.backup_now().unwrap();
    let inspection = managed.recovery_inspection();
    notes(&mut managed, "saved while inspection is pending");
    assert_eq!(read(&mut managed), "saved while inspection is pending");
    fs::write(
        root.join("backups").join(format!("{}.sqlite", backup.id)),
        b"damaged",
    )
    .unwrap();
    let status = std::thread::spawn(move || inspection.inspect())
        .join()
        .unwrap();
    assert!(status.available);
    assert!(status.backups.iter().all(|entry| entry.id != backup.id));
    assert!(status.backup_error.is_some());
    assert!(managed.restore(&backup.id, true).is_err());
    assert_eq!(read(&mut managed), "saved while inspection is pending");
}
