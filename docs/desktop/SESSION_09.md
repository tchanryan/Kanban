# Session 9 — Windows acceptance and performance

Dates: 6–8 October 2026. Branch: `codex-desktop-session-9`; baseline `e7c54a0` plus local migration changes. Previous gate: session 8 passed. **Complete for the approved personal-use scope. Session 10 may proceed.** No real user data is used. All changes remain local and uncommitted.

## 7 October continuation

Candidate 0.1.14 passed installed acceptance. SHA256: `F3E84AF0C2FAAE11C8E3C28D31C52CC10E745A0FBF7F3AF0C016DC5F4DA09CB9`. It adds independently validated system-browser links, a balanced Windows COM apartment, detached full backup inspection and byte-identical reuse for existing secondary copies. Source validation remains full; copy metadata/checksum/length must match exactly; status and restore still independently validate snapshots.

All 77 web unit tests, 29 journeys at each root and Pages path, lint/typecheck and production builds passed. All 48 workspace test entries and four host tests passed, along with Clippy on both native crates. The new inspection regression saves while an owned inspection is pending, damages a snapshot, then verifies inspection and restore reject that snapshot without losing the save.

The 0.1.11 diagnostic runs showed that WebDriver delayed the first HTML response before JavaScript ran. A normal owned launch after WebView origin/cache clearing reached all 703 cards at 557.7 ms, with first HTML response at 19.7 ms; the following driver-launched window reached the board at 2,794.5 ms. This is navigation-to-post-paint timing, excluding native host initialization. The normal launch uses process-scoped loopback CDP observation, not a warmed reload. Failed driver measurements remain retained. The unchanged 2,000 ms cold target now uses normal launch when `-MeasureNormalLaunch` is explicitly selected; driver timings remain separately reported. Warm routing also failed in this diagnostic run (4,114 ms); the detached inspection change addresses a source of contention, and the final 0.1.14 measurements below pass all performance targets.

The optional invocation interception attempt produced no native-call samples. That interception was removed; `-ProfileStartup` now records only reload/navigation timing. Do not treat its empty operation array as successful tracing. Two installer attempts timed out on the old 0.1.11 baseline before upgrade. The harness now waits for both board and notes under its existing readiness guard, avoiding native checks while startup work is queued. Timeouts and product thresholds were not increased. Full 0.1.11→0.1.14 acceptance passed after other heavy checks finished.

Starting continuation account reading: five-hour 1% used / weekly 46% used. Both reset credits remain available. Earlier results and usage readings below are historical.

## Final installed 0.1.14 evidence

All executable session-9 gates passed on the owned synthetic preview. Installer lifecycle acceptance covered upgrade preservation, running-app rejection, older binary and installer guards, secondary-folder setup, repair, uninstall/reinstall and cancelled uninstall. Runtime security, actual system-browser Markdown opening, pointer/keyboard ordering, column entry lifecycle and reload persistence passed. Crash/corruption recovery and JSON/encrypted migration passed; journal acknowledgement measured 87 ms. The migration screenshot captures the storage-check loading state; it is not evidence of completed backup status. Installer acceptance independently checked completed Settings status.

The isolated scale run used 1,000 active tasks, three projects, 10,000 archived tasks, 25,000 events and 20 columns (703 cards on the selected board):

| Measurement                      |       Result |
| -------------------------------- | -----------: |
| Normal cold board                |     544.1 ms |
| Warm board                       |     275.1 ms |
| Archive                          |     360.7 ms |
| Scratch command p95, 100 samples |       7.2 ms |
| UI save                          |     655.4 ms |
| Import, reported separately      | 12,323.14 ms |

Cold timing measures navigation through post-paint readiness after clearing the owned WebView origin/cache and restarting normally; it excludes native host initialization. Process-scoped loopback CDP observes this normal launch. The separately retained driver measurement was 3,730.0 ms; driver observation was 3,794.5 ms. This is not a claim about total OS application launch time. Browser clearing preserved native canonical data and generation, and the original synthetic workspace restored.

Final evidence under `artifacts/native`: `session9-installer-personal-preview.json`, `session9-external-links.json`, `session9-security.json`, `session9-browser-clearing.json`, `session9-interactions.json` and its inspected screenshot, `session9-scale.json`, `session9-native-personal-preview.json`, and `session9-migration.json`. Native and migration scripts targeted the installed 0.1.14 executable; those two report formats do not embed an application version.

Closing account snapshot: five-hour 5% used / weekly 1% used; both reset credits available. Earlier snapshots changed from 10% / 47% to 0% / 0% during continuation. No reset credit was redeemed by this work; the cause of the changed account window is unverified. These account-wide readings cannot establish exact task cost.

## Historical progress, 6 October

The following records preserve earlier findings and failed attempts. Base evidence filenames above now contain the final 0.1.14 results; archived version-labelled scale reports retain earlier measurements. Historical statements about pending checks and optional profiling are superseded by the continuation and final evidence above.

Installed preview 0.1.6 passed acknowledged save, live refresh, single owner, forced-exit commit/draft recovery, normal close, failed-draft close/cancel/retain, verified backup restore, corrupt-live-database recovery and forced exit after restore. Recovery preserved the damaged file. The UI journal acknowledgement measured 170 ms. Evidence: `artifacts/native/session9-native-personal-preview.json`.

Bounded runtime security probes on 0.1.6 passed: typed/unknown-command rejection, traversal rejection, unconfirmed restore rejection, import-ticket enforcement, filesystem/shell plugin absence, extra-window denial, remote-navigation denial, and explicit CSP connection/frame blocking. Canonical data was unchanged. Evidence: `artifacts/native/session9-security.json`. Source review found no runtime workspace-content networking or content logging, no embedded automation plugin or updater, and parameterized SQL plus native-owned transaction/file boundaries. This is scoped engineering acceptance, not a penetration-test certification or an assertion that Rust dependencies received CodeQL coverage.

Native scale uses the existing browser fixture: 1,000 active tasks, three projects, 10,000 archived tasks, 25,000 events and 20 columns. The first runs on 0.1.6 passed warm-board, archive, save and commit targets but failed cold-board readiness. Initial timing included post-readiness automation overhead; the corrected observation before later driver setup still failed, at 6,948.5 ms. That exposed two full backup-catalogue scans during frontend initialization. Startup now uses a lightweight availability contract; full status and restore verification remain. A regression covers damaged backups and missing live data.

Both scale runs cleared only the owned preview's WebView origin storage/cache, then closed and reopened offline. Canonical data and generation remained intact, and the pre-scale snapshot restored the original synthetic workspace. Evidence: `artifacts/native/session9-scale-initial.json` and `session9-scale-before-startup-fix.json`.

The expanded retained catalogue also exposed a folder-setup delay during 0.1.6→0.1.7 installer acceptance. Upgrade preservation passed; fresh folder setup exceeded the existing completion guard. No data assertion or timeout was relaxed. Choosing a new destination now avoids copying to the retired folder, and copied byte-identical snapshots reuse the validated source's checksum proof instead of repeated domain decoding. Closed snapshot checks reject nonempty journal sidecars and propagate access errors. SQLite can leave harmless empty sidecars; the initial stricter existence check was corrected after integration failures. Full validation remains at status/restore. Full 0.1.8→0.1.9 installer acceptance passed with the expanded catalogue. Cold driver observation still exceeded the target at 4,273.4 ms, while warm-board, archive, save and scratch-commit measurements passed. A bounded local post-paint readiness mark is being added to separate rendering time from driver observation. Both values will be retained; no threshold is increased. Final candidate measurements are pending.

Reference machine: Windows 11 Pro x64 build 26200, AMD Ryzen 7 3700X, 31.92 GiB RAM; installed executable/output on D:, primary app data on C:. Machine evidence: `artifacts/native/session9-reference-machine.json`. Timings are local observations, not hardware-wide guarantees.

The post-paint measurement on 0.1.10 confirmed that the remaining cold-board delay is real: 3,265.4 ms, with driver observation at 3,305.6 ms. Warm board 1,683.7 ms, archive 362.9 ms, scratch-command p95 10.8 ms across 100 sequential samples and UI save 956.6 ms passed their respective targets. Import took 12,446.23 ms and is reported separately. Browser clearing preserved native data and generation; the original synthetic workspace restored successfully. This timestamp excludes native host initialization. Cold readiness still fails the unchanged 2,000 ms threshold.

Unsigned candidate 0.1.11 adds a native navigation predicate rejecting credentials and non-default ports on the bundled hostname. All three host tests and Clippy passed. Installer SHA256: `5445ECD9B9961DEC1A71E3B8BEAD0475BE4B2E77D6F73A7C2F4F72B6240B620B`. Full 0.1.10→0.1.11 installation, upgrade, running-app rejection, older-binary/downgrade guards, secondary-folder setup, repair, uninstall/reinstall and cancelled interactive uninstall passed with canonical data, history and backups preserved. Evidence: `artifacts/native/session9-installer-personal-preview.json`.

The readiness-mark frontend passed all 29 browser journeys at both root and `/Kanban/` paths, along with 64 unit tests, strict typing and lint. The Pages production build passed with its existing main-chunk size advisory. Current desktop acceptance scripts parse successfully.

Installed 0.1.11 passed the expanded security probes, including alternate-port rejection and clearing cookies, local storage, IndexedDB and Cache Storage in a Playwright-created isolated Chrome profile (154.0.8037.98). Native canonical data remained unchanged. Evidence: `artifacts/native/session9-security.json` and `session9-browser-clearing.json`.

The same installed candidate passed native acknowledged save, refresh, single-owner, forced-exit persistence, draft recovery/close handling, verified restore, deliberate corruption recovery with damaged-file preservation and forced exit after restore. Save acknowledgement measured 89 ms. JSON and encrypted file round trips passed with native save/cancel dialogs, wrong-password rejection, preview/cancel, stale-preview rejection, forced-exit persistence and unchanged source file. Evidence: `artifacts/native/session9-native-personal-preview.json`, `session9-migration.json` and the visually inspected `session9-migration-settings.png`.

The final isolated scale run on 0.1.11 recorded warm board 481.8 ms, archive 346.1 ms, scratch-command p95 14.5 ms and UI save 832.1 ms. Cold board still failed at 3,597.5 ms (driver observation 3,644.3 ms). Import took 10,347.43 ms. WebView clearing preserved canonical data and generation, and the pre-test synthetic workspace restored successfully before the performance assertion failed. Evidence: `artifacts/native/session9-scale.json`; the earlier post-paint result is preserved in `session9-scale-0.1.10.json`.

An optional `-ProfileStartup` mode now instruments operation names and timing during a separate reload, with no arguments or workspace content recorded. This test-only addition parses successfully but is **not runtime verified**: the requested profiling execution was rejected, so neither that run nor its proposed evidence-copy command executed. The ordinary 0.1.11 measurement above is unaffected. Verify this optional mode before relying on its results; do not infer a performance improvement from source review.

## Personal-use scope decision, 8 October

The user confirmed this application is for personal use only and explicitly declined the missing-WebView2 clean-install test. Session 9 is complete for use on the tested Windows PC with its existing runtime. This is a scope waiver, not a passing clean-install result. All other session-9 checks passed; session 10 may proceed under the same personal-use scope.

The [clean-machine runbook](CLEAN_WINDOWS_ACCEPTANCE.md) remains unexecuted and deferred. Reopen missing-runtime installation acceptance and signing requirements if public distribution is considered. No BIOS/UEFI changes or additional virtualization setup are needed for current personal use.

All changes remain local and uncommitted. No publication is authorized by this scope decision.

## Repeatable acceptance commands

The installer lifecycle creates/refuses ownership markers before importing fixtures. The other tests require that owned profile and verify its resolved native path before mutation. Use only the synthetic preview; a normal personal workspace must never be marked as test-owned. Existing installer output directories and generated fixture files are intentionally not overwritten.

The installer example records the tested 0.1.11-to-0.1.14 pair. Use a fresh owned synthetic baseline for reproduction; do not downgrade the current 0.1.14 profile. Future upgrades should use 0.1.14 and a newer candidate. Run scale alone, without competing builds or browser suites.

```powershell
$ErrorActionPreference = 'Stop'
. ./native/Use-WorkspaceToolchain.ps1
./native/desktop/Test-Installer.ps1 -Profile personal-preview -EvidencePrefix session9 `
  -FirstManifest D:/KanbanBuildTools/installers/personal-preview/0.1.11/manifest.json `
  -UpgradeManifest D:/KanbanBuildTools/installers/personal-preview/0.1.14/manifest.json `
  -TauriDriver D:/KanbanBuildTools/cargo/bin/tauri-driver.exe `
  -EdgeDriver D:/KanbanBuildTools/drivers/154.0.4258.37/msedgedriver.exe
# Generate once; skip this line when reusing the existing fixture.
node native/desktop/Write-ScaleFixture.mjs D:/KanbanBuildTools/temp/session9-scale.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
./native/desktop/Test-Scale.ps1 -MeasureNormalLaunch `
  -Application D:/KanbanBuildTools/installed/kanban-personal-preview/kanban-desktop-preview.exe `
  -Fixture D:/KanbanBuildTools/temp/session9-scale.json `
  -TauriDriver D:/KanbanBuildTools/cargo/bin/tauri-driver.exe `
  -EdgeDriver D:/KanbanBuildTools/drivers/154.0.4258.37/msedgedriver.exe
```

`Test-Security.ps1` takes the same application/driver arguments. `Test-Native.ps1` and `Test-Migration.ps1` additionally require `-Profile personal-preview`. The native test deliberately damages only a resolved SQLite file under the marked profile, then verifies recovery preserves it. Scale restores its pre-test snapshot; migration replaces synthetic data with its reviewed fixture. Each script retains evidence under `artifacts/native` and closes only its owned app/driver processes.

`Test-Interactions.ps1 -Application <installed-preview> -Port <free-loopback-port>` verifies pointer and keyboard interactions. `Test-ExternalLinks.ps1` takes the application/driver arguments and verifies an actual system-browser click against a synthetic localhost page. Its browser tab may be closed manually after acceptance.
