# Windows personal preview installer

The personal preview is an unsigned, current-user Windows x64 package named **Kanban Calendar Preview**, with stable identifier `io.github.tchanryan.kanban.preview`. The development and synthetic acceptance products have separate identities. Public distribution requires signing. Installers and manifests remain under `D:/KanbanBuildTools/installers/<profile>/<version>`.

The build pins the [Tauri CLI 2.12.1 NSIS template](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi), verifies its checksum and expected structure, and removes the app-data deletion checkbox and block. It adds version rejection before writes and requires the app to be closed normally before installation or uninstall. Generated templates are retained beside the packages. Review these transformations when updating the CLI.

WebView2 bootstrapper handling remains enabled. A machine missing WebView2 needs internet access for first installation; the bundled application works offline once its runtime is present. This host already has WebView2. Missing-runtime installation on a disposable Windows environment remains session-9 release acceptance. See [Tauri Windows packaging](https://v2.tauri.app/distribute/windows-installer/).

## Build and verify

From the repository root, using the installed Windows toolchain:

```powershell
. ./native/Use-WorkspaceToolchain.ps1
./native/desktop/Build-Installer.ps1 -Profile personal-preview -Version 0.1.5
./native/desktop/Build-Installer.ps1 -Profile personal-preview -Version 0.1.6
./native/desktop/Test-Installer.ps1 -Profile personal-preview `
  -FirstManifest D:/KanbanBuildTools/installers/personal-preview/0.1.5/manifest.json `
  -UpgradeManifest D:/KanbanBuildTools/installers/personal-preview/0.1.6/manifest.json `
  -TauriDriver D:/KanbanBuildTools/cargo/bin/tauri-driver.exe `
  -EdgeDriver D:/KanbanBuildTools/drivers/154.0.4258.37/msedgedriver.exe
```

Existing output directories are deliberately rejected to retain build evidence. For later reruns, build a newer version pair compatible with the currently installed product; do not force a downgrade. `-Profile acceptance` selects the isolated installer-test product instead.

The test uses packaged release executables and an external driver, without embedding an automation plugin. It refuses unowned existing data or registration at a different location. It imports synthetic fixtures, checks canonical data/history/generation and backups after upgrade, repair and uninstall/reinstall, checks offline Settings, native folder selection and cancellation, pre-upgrade snapshots, direct older-executable rejection, and the interactive uninstall page. It leaves its reinstalled product and synthetic data for inspection. Successful evidence is written to `artifacts/native/session8-installer-personal-preview.json`.

## Manual upgrade

1. Resolve failed saves and recovery drafts. In Settings, choose **Back up now** and confirm a verified snapshot. Export portable JSON or encrypted JSON to another location as an additional recovery copy.
2. Close the app normally after saves finish. The installer refuses to proceed while it is open.
3. Verify the installer's identity, version and SHA-256 against its manifest. Run the newer installer for the same product. These personal preview packages are unsigned.
4. Reopen and inspect notes, tasks, tags, archive and backup status. First startup creates a verified `before-upgrade` snapshot before migration or writable database access. Keep your export and prior installer until verification finishes.

Settings shows the application version, primary storage path and optional second backup folder. Choosing a folder creates an owned backup subfolder and seeds all retained snapshots; choosing that existing owned folder supports recovery when primary storage is lost. Copies are unencrypted. Use encrypted portable exports when confidentiality is needed. An absent or replaced drive shows a warning while local saves continue. Reconnect it and choose **Back up now** to retry. Stopping copying retains files. Secondary restore requires explicit confirmation and uses verified native recovery staging.

Uninstall retains native data. App rollback and data rollback are separate operations: do not open newer data or restore a newer-version snapshot using an older executable. Keep newer data and use a compatible current application to verify a recovery copy. Experimental acceptance packages 0.1.0/0.1.1 are failure evidence and must not be distributed.
