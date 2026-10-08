use kanban_storage_spike::{contracts::NoteStore, service::ProbeService, sqlite::SqliteNoteStore};

#[test]
fn database_uses_wal_and_passes_integrity_check() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let mut store = SqliteNoteStore::open(&path).unwrap();
    store.save("Stored in WAL", 1).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    let journal: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal, "wal");
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}

#[test]
fn failed_history_write_rolls_back_note_and_survives_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let committed = {
        let mut service = ProbeService::new(SqliteNoteStore::open(&path).unwrap());
        service.prove_rollback().unwrap()
    };
    assert_eq!(committed.text, "Acknowledged native save");
    assert_eq!(committed.events, 1);
    assert_eq!(
        SqliteNoteStore::open(&path).unwrap().read().unwrap(),
        committed
    );
}

#[test]
fn online_backup_is_consistent_while_source_connection_stays_open() {
    let directory = tempfile::tempdir().unwrap();
    let mut source = SqliteNoteStore::open(&directory.path().join("source.sqlite")).unwrap();
    source.save("Snapshot revision", 1).unwrap();
    let destination = directory.path().join("backup.sqlite");
    source.backup(&destination).unwrap();
    source.save("Later revision", 2).unwrap();
    let snapshot = SqliteNoteStore::open(&destination).unwrap();
    assert_eq!(snapshot.read().unwrap().text, "Snapshot revision");
    assert_eq!(snapshot.read().unwrap().events, 1);
    assert_eq!(source.read().unwrap().events, 2);
    assert!(source.backup(&destination).is_err());
}

#[test]
fn invalid_input_does_not_change_committed_data() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = SqliteNoteStore::open(&directory.path().join("source.sqlite")).unwrap();
    store.save("Keep me", 1).unwrap();
    for (text, event_id) in [("", 2), ("Valid", 0), ("   ", 2)] {
        assert!(store.save(text, event_id).is_err());
    }
    assert!(store.save(&"x".repeat(201), 2).is_err());
    assert_eq!(store.read().unwrap().text, "Keep me");
    assert_eq!(store.read().unwrap().events, 1);
}
