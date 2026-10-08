use kanban_workspace::{
    contracts::{Command, Query, SystemRuntime, WorkspaceStorage},
    model::{Result, StorageError},
    recovery::{BackupCatalog, ManagedWorkspace, NoFaults, RecoveryHooks},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

struct Fault(Mutex<Option<&'static str>>);
impl RecoveryHooks for Fault {
    fn checkpoint(&self, phase: &'static str) -> Result<()> {
        if *self.0.lock().unwrap() == Some(phase) {
            Err(StorageError::invalid("Injected secondary failure"))
        } else {
            Ok(())
        }
    }
}
fn open(root: &Path, hooks: Arc<dyn RecoveryHooks>) -> ManagedWorkspace {
    ManagedWorkspace::open(root.into(), Arc::new(SystemRuntime), hooks)
}

#[test]
fn changing_folders_does_not_copy_to_the_retired_destination_and_rejects_journals() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut workspace = open(&root, Arc::new(NoFaults));
    notes(&mut workspace, "Original");
    workspace.select_secondary(temp.path()).unwrap();
    let old = folder(&mut workspace);
    let old_ids: Vec<_> = workspace
        .status()
        .secondary
        .backups
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    notes(&mut workspace, "New folder selection");
    workspace.select_secondary(temp.path()).unwrap();
    let new_status = workspace.status();
    assert_ne!(
        new_status.secondary.directory.as_ref().unwrap(),
        &old.display().to_string()
    );
    assert!(new_status.secondary.error.is_none());
    let retired =
        BackupCatalog::open_existing(old, Arc::new(SystemRuntime), Arc::new(NoFaults)).unwrap();
    assert_eq!(
        retired
            .list()
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        old_ids
    );
    let entry = &new_status.backups[0];
    let journal = root
        .join("backups")
        .join(format!("{}.sqlite-wal", entry.id));
    fs::write(&journal, b"Unexpected journal").unwrap();
    assert!(workspace.restore(&entry.id, true).is_err());
    assert_eq!(read(&mut workspace), "New folder selection");
    assert!(journal.exists());
}
fn notes(store: &mut ManagedWorkspace, value: &str) {
    store
        .storage()
        .unwrap()
        .execute(
            Command::SaveScratch {
                content: value.into(),
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
fn folder(store: &mut ManagedWorkspace) -> PathBuf {
    PathBuf::from(store.status().secondary.directory.unwrap())
}

#[test]
fn verified_copies_reopen_restore_and_disable_without_removing_external_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut store = open(&root, Arc::new(NoFaults));
    notes(&mut store, "Second drive — 😀");
    store.backup_now().unwrap();
    store.select_secondary(temp.path()).unwrap();
    assert!(store.status().secondary.error.is_none());
    let external = folder(&mut store);
    let initial = store.status().secondary.backups[0].clone();
    let primary = BackupCatalog::new(
        root.join("backups"),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    )
    .unwrap();
    let mirror = BackupCatalog::new(
        external.clone(),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults),
    )
    .unwrap();
    assert_eq!(
        fs::read(primary.verify(&initial.id).unwrap().1).unwrap(),
        fs::read(mirror.verify(&initial.id).unwrap().1).unwrap()
    );
    notes(&mut store, "Later edit");
    store.backup_now().unwrap();
    drop(store);
    let mut reopened = open(&root, Arc::new(NoFaults));
    assert!(reopened.status().secondary.error.is_none());
    assert!(reopened.restore_secondary(&initial.id, false).is_err());
    reopened.restore_secondary(&initial.id, true).unwrap();
    assert_eq!(read(&mut reopened), "Second drive — 😀");
    reopened.disable_secondary().unwrap();
    assert!(reopened.status().secondary.directory.is_none());
    assert!(external.join(format!("{}.sqlite", initial.id)).exists());
}

#[test]
fn unavailable_or_replaced_drive_cannot_be_recreated_and_local_saves_continue() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let mut store = open(&root, Arc::new(NoFaults));
    notes(&mut store, "initial");
    store.select_secondary(temp.path()).unwrap();
    let external = folder(&mut store);
    let disconnected = temp.path().join("disconnected");
    fs::rename(&external, &disconnected).unwrap();
    assert!(BackupCatalog::open_existing(
        external.clone(),
        Arc::new(SystemRuntime),
        Arc::new(NoFaults)
    )
    .is_err());
    assert!(!external.exists());
    notes(&mut store, "Saved while unplugged");
    store.backup_now().unwrap();
    assert!(!external.exists());
    assert!(store.status().secondary.error.is_some());
    assert_eq!(read(&mut store), "Saved while unplugged");
    fs::create_dir(&external).unwrap();
    fs::write(
        external.join("kanban.owner"),
        uuid::Uuid::new_v4().to_string(),
    )
    .unwrap();
    store.backup_now().unwrap();
    assert!(store.status().secondary.error.is_some());
    assert_eq!(fs::read_dir(&external).unwrap().count(), 1);
    fs::remove_file(external.join("kanban.owner")).unwrap();
    fs::remove_dir(&external).unwrap();
    fs::rename(disconnected, &external).unwrap();
    store.backup_now().unwrap();
    assert!(store.status().secondary.error.is_none());
}

#[test]
fn interrupted_copy_is_retryable_and_corruption_prevents_restore_and_retention() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let hooks = Arc::new(Fault(Mutex::new(None)));
    let mut store = open(&root, hooks.clone());
    notes(&mut store, "initial");
    store.select_secondary(temp.path()).unwrap();
    let external = folder(&mut store);
    *hooks.0.lock().unwrap() = Some("before-secondary-publish");
    notes(&mut store, "Committed despite failed copy");
    let local = store.backup_now().unwrap();
    assert!(store.status().secondary.error.is_some());
    assert_eq!(read(&mut store), "Committed despite failed copy");
    *hooks.0.lock().unwrap() = None;
    store.backup_now().unwrap();
    assert!(store.status().secondary.error.is_none());
    fs::write(
        external.join(format!("{}.sqlite", local.id)),
        b"damaged copy",
    )
    .unwrap();
    let metadata = external.join(format!("{}.json", local.id));
    assert!(store.restore_secondary(&local.id, true).is_err());
    store.backup_now().unwrap();
    assert!(metadata.exists());
    assert!(store.status().secondary.error.is_some());
    assert_eq!(read(&mut store), "Committed despite failed copy");
}

#[test]
fn folder_selection_failure_preserves_settings_and_existing_catalog_can_recover_missing_primary() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let hooks = Arc::new(Fault(Mutex::new(None)));
    let mut store = open(&root, hooks.clone());
    notes(&mut store, "Recover from external only");
    assert!(store.select_secondary(&root).is_err());
    assert!(store.select_secondary(Path::new("relative")).is_err());
    store.select_secondary(temp.path()).unwrap();
    let external = folder(&mut store);
    let id = store.status().secondary.backups[0].id.clone();
    let settings = fs::read(root.join("SECONDARY.json")).unwrap();
    *hooks.0.lock().unwrap() = Some("before-secondary-settings");
    assert!(store.disable_secondary().is_err());
    assert_eq!(fs::read(root.join("SECONDARY.json")).unwrap(), settings);
    *hooks.0.lock().unwrap() = None;
    drop(store);
    let lost = temp.path().join("lost-primary");
    fs::rename(&root, &lost).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("initialized"), b"existing workspace").unwrap();
    let mut recovery = open(&root, Arc::new(NoFaults));
    assert!(!recovery.status().available);
    recovery.select_secondary(&external).unwrap();
    recovery.restore_secondary(&id, true).unwrap();
    assert_eq!(read(&mut recovery), "Recover from external only");
    assert!(lost.join("workspace.sqlite").exists());
}
