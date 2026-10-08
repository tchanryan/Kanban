# Session 8 — installer and storage settings

Date: 5–6 October 2026. Branch: `codex-desktop-session-8`. Baseline: `e7c54a0`. Prior session gate: session 7 passed. Status: **complete; session-8 exit gate passed**. Session 9 is next and has not started. Migration changes remain local and uncommitted.

## Implemented behavior

The stable unsigned Windows x64 personal preview is **Kanban Calendar Preview**, identifier `io.github.tchanryan.kanban.preview`, with app-local `data/workspace.sqlite`. Development and installer acceptance profiles have separate identities. Product and application version are visible. The pinned Tauri CLI 2.12.1 packages a bundled frontend with current-user NSIS, WebView2 bootstrapper handling, no updater and no embedded automation plugin. Toolchains, caches and build output remain on `D:/KanbanBuildTools`.

The build checksums the pinned MIT-licensed upstream template and guards its structure. Generated templates remove the data-deletion checkbox/block, reject older versions before writes and require normal app closure before installation or uninstall. The default template's silent downgrade path failed actual acceptance, so the explicit guard was added. Experimental acceptance 0.1.0/0.1.1 are failure evidence and must not be distributed. The corrected isolated acceptance 0.1.2→0.1.3 milestone passed on 5 October (`artifacts/native/session8-installer.json`).

Native-owned `APP_VERSION.json` plus a release marker sit outside WebView storage. Startup rejects older executables and malformed/missing metadata for initialized data before opening a writable database. Upgrades create verified `before-upgrade` snapshots before migration, then publish the new version after successful startup. Snapshot metadata records the creating application's version; restore rejects a newer-version snapshot. Existing migration ledgers must match the pinned schema-2 checksum. Failure retains original files and enters recovery.

Optional second-folder backups use a native Windows picker behind a destination contract. Dedicated folders have ownership markers; selecting a folder seeds every retained primary snapshot before publishing settings. Copies are flushed, hashed and validated before publication. Unavailable or replaced drives show an error without blocking local saves or recreating absent paths. Back up now retries copying. Confirmed secondary restore uses the verified native staging workflow. Disabling copying retains files. Selecting an existing owned backup folder supports lost-primary recovery. Local snapshots and copies are unencrypted; Settings explains that limitation and why another drive matters.

Actual upgrade testing exposed a retention mismatch: the extra upgrade snapshot could retire an external copy still retained locally. Secondary retention now pins every primary ID, and manual backup prunes primary retention before synchronization. A 12-to-13 snapshot regression test covers this boundary. Automation was corrected to wait for enabled folder controls and enumerate the interactive uninstall window without assuming its UI Automation control type, and trim the NSIS caption suffix whitespace. Data assertions were retained throughout.

See [manual installer upgrade instructions](../../native/desktop/installer/README.md) and [architecture](../ARCHITECTURE.md). Run the isolated composition example from the repository root:

```powershell
. ./native/Use-WorkspaceToolchain.ps1
cargo run --locked --offline --manifest-path native/workspace/Cargo.toml --example storage_settings
```

## Verification

- Native suites: 45 library test entries, including two child-process helpers, plus two desktop host tests passed. Both crates passed Clippy for all targets with warnings denied. The executable storage example passed. Tests cover interrupted copy/publication, corrupt snapshots, absent/replaced drives, retained files, lost-primary restore, invalid release metadata, upgrade failure, direct downgrade, newer-snapshot rejection and altered migration ledger checksums.
- Web: lint, strict TypeScript and all 64 unit tests passed. Production builds and all 29 browser journeys passed at both `/` and `/Kanban/` (58 executions). Existing main-chunk size advisory remains, approximately 564 KB before gzip.
- Narrow compatible transitive updates addressed `brace-expansion`, `fast-uri`, `serialize-javascript` and `source-map-js`. The dependency audit reported zero vulnerabilities. No major dependency upgrade was made.
- Installed personal-preview lifecycle **passed** in one complete 0.1.5→0.1.6 run: install, upgrade, running-app rejection, pre-upgrade snapshot, full secondary-folder seeding, folder cancellation, direct older-executable rejection, installer downgrade rejection, repair, uninstall/reinstall and cancelled interactive uninstall. Canonical records, generation, import history and verified backups remained intact, and Settings loaded offline. Evidence: `artifacts/native/session8-installer-personal-preview.json`, completed 6 October 2026 at 10:25:05 UTC. Earlier runs passed data checks but failed automation locators; those failures were corrected rather than weakening assertions. No test app, driver or uninstaller process remained running afterward.
- Settings screenshot inspected: paths wrap, controls remain readable and every retained secondary copy appears without an error. Evidence: `artifacts/native/session8-settings-personal-preview.png`.

## Candidate and remaining release gates

Personal preview 0.1.6 installer: `D:/KanbanBuildTools/installers/personal-preview/0.1.6/setup.exe`. SHA-256: `47211D108238C7A8E015CA809BB58C8CE178B536457E5D638A60BFC6ECBC4A46`. Baseline 0.1.5 SHA-256: `361ACFF85472C3622CBFCC72F1104DFC7AE94DD75E9E6A6427F95D8A858D833B`. Build manifests record profile, version, timestamp and `NotSigned` status. Existing immutable output versions are never overwritten.

The installed test product retains synthetic fixtures only at `D:/KanbanBuildTools/installed/kanban-personal-preview`, with native data under `%LOCALAPPDATA%/io.github.tchanryan.kanban.preview/data`. No real user workspace was imported. No release was published, commit pushed, automation scheduled or reset credit redeemed.

Session 9 must run full Windows integration, native scale/performance, destructive tests in disposable profiles and security review on the candidate. This host already has WebView2: configuration/source handling is enabled and first-install network requirements are documented, but an actual absent-runtime installation still needs disposable-machine acceptance. Do not uninstall the user's shared WebView2 runtime to simulate it. Signing remains mandatory before public distribution.

## Usage

The 5 October installer milestone ended at account-wide five-hour 92% used / weekly 33% used. The 6 October continuation's first reading after initial work was 6% / 35%; a later reading was 33% / 39%. These are shared account windows, not exact task-token usage or a cumulative cost estimate. Exact task tokens are unavailable. Final closing reading: five-hour 40% used (60% remaining), weekly 40% used (60% remaining). Both reset credits remain untouched.
