# Isolated desktop storage spike

**Session 1 verified:** five Rust tests, Clippy with warnings denied, native build and real Windows WebDriver/IPC probe passed. This is an isolated feasibility spike, not the production desktop app. Do not use it for real work or distribute it. Nothing imports this directory from the website.

The Rust modules demonstrate the intended boundaries: `contracts` defines the storage port, `model` owns DTOs, `sqlite` implements transaction and backup access, `service` coordinates the rollback probe, and `main` is the Tauri composition root. The UI has one command and cannot supply paths or SQL. Each invocation creates disposable data; each app launch creates a separate disposable WebView profile. No production app-data directory is used.

Verified versions: Tauri 2.11.6, tauri-build 2.6.3, rusqlite 0.40.2 (bundled SQLite), external tauri-driver 2.0.6. Cargo.lock resolves 442 packages and rust-toolchain.toml pins Rust 1.98.1 MSVC. Visual Studio Build Tools 17.14.41 and Windows SDK 10.0.26100.0 were used. EdgeDriver must match the installed WebView2/Edge build (153.0.4234.48 at this checkpoint). Initial disk-space installation failures described below were resolved after the user freed C: space.

## Run after completing prerequisites

The user approved `D:\KanbanBuildTools` on the Seagate HDD for toolchains, caches and build output. Dot-source the helper in a fresh PowerShell to use those paths for that shell only. The Rustup launcher remains in the user profile. Microsoft still requires 3.45 GB free on C: for shared components even when its install/cache/shared paths point to D:; the retry failed with `0x80070070`.

Finish Visual Studio C++ Build Tools with Windows SDK, then install tauri-driver and matching Microsoft EdgeDriver. Run from this directory:

```powershell
. .\Use-ExternalToolchain.ps1
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked
cargo install tauri-driver --version 2.0.6 --locked
.\Test-Native.ps1 -TauriDriver "$env:CARGO_HOME\bin\tauri-driver.exe" -EdgeDriver 'D:\KanbanBuildTools\drivers\153.0.4234.48\msedgedriver.exe' -Application "$env:CARGO_TARGET_DIR\debug\kanban-storage-spike.exe"
```

The EdgeDriver path is an example; supply its actual installed location. The test starts its own driver and native application, clicks the button using WebDriver, and requires real IPC to report successful commit, rollback, reopen and verified backup. It closes the session and stops only its own driver. The tests allocate their own SQLite files and never connect to IndexedDB. For interactive use, run `cargo run` and click **Verify SQLite storage**.

Minimal service initialization used by the real application and integration tests:

```rust
use kanban_storage_spike::{
    model::StorageResult, service::ProbeService, sqlite::SqliteNoteStore,
};

fn example() -> StorageResult<()> {
    let directory = tempfile::tempdir()?;
    let store = SqliteNoteStore::open(&directory.path().join("example.sqlite"))?;
    let mut service = ProbeService::new(store);
    let saved = service.prove_rollback()?;
    assert_eq!(saved.events, 1);
    Ok(())
}
```

The forced failure is a real duplicate primary-key insert after the note write. The tests verify that the earlier write is rolled back and that a closed/reopened connection preserves acknowledged data. The backup test snapshots an open WAL database, writes a later revision and verifies that the independent snapshot retains the earlier revision. It does not yet exercise concurrent writers, process termination, power loss, production recovery or installers; those remain later PRD gates.

If interrupted, disposable WebView directories may remain in the OS temporary directory. Do not automatically remove other temporary folders. See [session checkpoint](../../docs/desktop/SESSION_01.md) for evidence and the next action.
