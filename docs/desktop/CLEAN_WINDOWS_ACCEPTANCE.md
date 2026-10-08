# Missing-WebView2 acceptance runbook

Status: **not executed; deferred for personal use by the user on 8 October 2026**. Session 9 is complete for the tested PC with its existing runtime. This is a scope waiver, not proof of missing-runtime installation. Reopen this acceptance if public distribution is considered. A disposable Windows environment is required to execute it; none is currently available. Do not remove or modify WebView2 on the development host.

8 October host readiness check: Windows 11 Pro build 26200 reports virtualization monitor extensions supported, but firmware virtualization disabled. Windows Sandbox and Hyper-V feature-state queries require an administrator session and were not completed. No firmware, Windows feature or runtime settings were changed. Local isolation first requires enabling AMD SVM/virtualization in firmware and restarting, then verifying the Windows feature and guest baseline. A Sandbox or VM alone does not establish runtime absence. See [Microsoft virtualization setup guidance](https://support.microsoft.com/en-us/windows/experience/enable-virtualization-on-windows).

Use a disposable Windows 11 x64 VM or spare test machine with synthetic data only. Take a VM snapshot before testing. Windows 11 normally includes the runtime, so a new VM alone does not prove it is absent. Check both machine and user registrations using the [Microsoft runtime detection procedure](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-webview2-runtime-is-already-installed). No registry value should be edited to pretend that an installed runtime is absent.

In that test environment, record the OS build and the `pv` values from these locations:

```powershell
$runtimeKeys = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
foreach ($runtimeKey in $runtimeKeys) {
  [pscustomobject]@{
    key = $runtimeKey
    version = (Get-ItemProperty -LiteralPath $runtimeKey -Name pv -ErrorAction SilentlyContinue).pv
  }
}
```

At least one version greater than `0.0.0.0` means the runtime is present. If present, the missing-runtime case cannot pass on that baseline. Use a legitimately prepared disposable image without it; any runtime removal must be restricted to that disposable environment. No removal commands are provided for the host.

Copy the candidate installer and its manifest into the VM. Verify SHA-256 and `io.github.tchanryan.kanban.preview` before running it. Keep the candidate version fixed throughout this acceptance; use the latest session-9 checkpoint's candidate and checksum. It is an unsigned personal preview, not a publicly signed release.

## Offline failure and online recovery

1. With no runtime installed, disconnect the VM's network and run the installer interactively. Retain screenshots and the installer exit/result. The missing-runtime download must fail visibly rather than reporting a working application. Verify no existing native data was changed. A fresh profile may have no data yet.
2. Return to the clean VM snapshot, confirm both runtime registrations are absent again, then connect the network and run the same installer. Record the bootstrapper download/install result and installer exit. The runtime should be installed and the application should launch normally.
3. Create synthetic tasks and notes, close normally and reopen. Export portable JSON and create a verified native backup.
4. Disconnect the network. Reopen and exercise Dashboard, Calendar, Archive and Settings. Confirm all synthetic data and lazy routes remain available. Close and reopen once more.
5. Record runtime versions after installation, application version, installer checksum, timestamps, screenshots and observed errors. Retain the synthetic JSON export and backup. Review any partial-install leftovers from the offline case explicitly; do not treat an installer failure message alone as proof of a clean rollback.

A failure blocks this gate. Do not increase retries to hide a reproducible failure, claim that a simulated registry value is equivalent evidence, or change packaging to bypass runtime detection. The download-bootstrapper route requires internet for a first installation without WebView2; offline application use with the installed runtime is a separate claim. See [Tauri Windows installer options](https://v2.tauri.app/distribute/windows-installer/).

After this gate passes, add the evidence location and exact candidate checksum to `SESSION_09.md`. Signing and final distribution review remain later work; a clean-machine pass does not authorize publication.
