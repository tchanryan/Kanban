param(
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [Parameter(Mandatory)][string]$Application,
    [ValidateRange(1024, 65534)][int]$Port = 4454
)
$ErrorActionPreference = 'Stop'
$profileRoot = Join-Path $env:LOCALAPPDATA 'io.github.tchanryan.kanban.preview'
if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Security acceptance requires the owned synthetic preview profile.' }
. (Join-Path $PSScriptRoot 'Native-TestHarness.ps1')
function Canonical-Export {
    $data = Native 'portable_export'
    $data.PSObject.Properties.Remove('exportedAt')
    ConvertTo-Json -InputObject $data -Depth 20 -Compress
}
function Assert-Rejected([string]$Command, [object]$Arguments) {
    $rejected = $false
    try { $null = Native $Command $Arguments } catch { $rejected = $true }
    if (-not $rejected) { throw "Restricted operation unexpectedly succeeded: $Command" }
}
try {
    foreach ($candidate in @($Port, ($Port + 1))) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start() } finally { $listener.Stop() }
    }
    $driver = Start-Process -FilePath $driverPath -ArgumentList @('--native-driver', ('"' + $edgePath + '"'), '--port', $Port, '--native-port', ($Port + 1)) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logs 'stderr.log') -RedirectStandardOutput (Join-Path $logs 'stdout.log')
    Until { try { (Request 'GET' '/status' $null).value.ready } catch { $false } } 'Driver did not start'
    Open-Preview
    $status = Native 'recovery_status'
    $safeRoot = [IO.Path]::GetFullPath((Join-Path $profileRoot 'data')) + [IO.Path]::DirectorySeparatorChar
    if (-not ([IO.Path]::GetFullPath($status.storagePath).StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase))) { throw 'The application is not using the owned preview profile.' }
    $expected = Canonical-Export
    $browserEvidence = Join-Path $logs 'browser-clearing.json'
    & node (Join-Path $PSScriptRoot 'Clear-BrowserFixture.mjs') $browserEvidence
    if ($LASTEXITCODE -ne 0) { throw 'Disposable Chrome storage-clearing fixture failed.' }
    if ((Canonical-Export) -ne $expected) { throw 'Clearing disposable Chrome data changed the native workspace.' }
    Assert-Rejected 'workspace_command' @{ command = @{ name = 'executeSql'; args = @{ sql = 'SELECT 1' } } }
    Assert-Rejected 'workspace_command' @{ command = @{ name = 'saveScratch'; args = @{ content = 123 } } }
    Assert-Rejected 'restore_backup' @{ id = '../../outside'; confirmed = $true }
    Assert-Rejected 'restore_secondary_backup' @{ id = '../../outside'; confirmed = $true }
    Assert-Rejected 'restore_backup' @{ id = $status.backups[0].id; confirmed = $false }
    Assert-Rejected 'portable_import' @{ ticket = 'unissued-ticket'; confirmed = $true }
    Assert-Rejected 'open_external_link' @{ address = 'file:///C:/Windows/win.ini' }
    Assert-Rejected 'open_external_link' @{ address = 'https://user:secret@example.com' }
    Assert-Rejected 'plugin:fs|read_file' @{ path = 'C:/Windows/win.ini' }
    Assert-Rejected 'plugin:shell|execute' @{ program = 'cmd'; args = @('/c','exit') }
    Assert-Rejected 'plugin:webview|create_webview_window' @{ options = @{ label = 'unauthorized'; url = 'https://example.invalid' } }
    $csp = (Request 'POST' "/session/$sessionId/execute/async" @{
        script = 'const done=arguments[arguments.length-1];const violations=[];const listener=event=>violations.push(event.effectiveDirective);document.addEventListener("securitypolicyviolation",listener);fetch("https://example.invalid/security-probe").catch(()=>{});const frame=document.createElement("iframe");frame.src="https://example.invalid/frame-probe";document.body.append(frame);setTimeout(()=>{frame.remove();document.removeEventListener("securitypolicyviolation",listener);done(violations);},250);'
        args = @()
    }).value
    if ($csp -notcontains 'connect-src' -or $csp -notcontains 'frame-src') { throw 'CSP did not explicitly block external connection and frame probes.' }
    $origin = Script 'return location.origin;'
    $handles = @((Request 'GET' "/session/$sessionId/window/handles" $null).value)
    $null = Script 'window.open("https://example.invalid/new-window-probe","_blank");'
    if (@((Request 'GET' "/session/$sessionId/window/handles" $null).value).Count -ne $handles.Count) { throw 'An external privileged window was created.' }
    $null = Script 'const anchor=document.createElement("a");anchor.href="https://example.invalid/navigation-probe";document.body.append(anchor);anchor.click();anchor.remove();'
    if ((Script 'return location.origin;') -ne $origin) { throw 'Remote navigation escaped the bundled origin.' }
    $null = Script 'const destination=new URL(location.origin);destination.port="6553";const anchor=document.createElement("a");anchor.href=destination.href;document.body.append(anchor);anchor.click();anchor.remove();'
    if ((Script 'return location.origin;') -ne $origin) { throw 'Alternate-port navigation escaped the bundled origin.' }
    if ((Canonical-Export) -ne $expected) { throw 'Rejected security probes changed canonical data.' }
    $report = [ordered]@{ invalidCommandsRejected = $true; invalidTypesRejected = $true; traversalRejected = $true; restoreConfirmationRequired = $true; importTicketRequired = $true; filesystemAndShellUnavailable = $true; extraWindowDenied = $true; remoteNavigationDenied = $true; cspConnectAndFrameDenied = $true; canonicalDataPreserved = $true; applicationVersion = $status.appVersion; completedAt = [DateTime]::UtcNow.ToString('o') }
    $artifacts = Join-Path $PSScriptRoot '../../artifacts/native'
    $null = New-Item -ItemType Directory -Path $artifacts -Force
    Copy-Item -LiteralPath $browserEvidence -Destination (Join-Path $artifacts 'session9-browser-clearing.json')
    $report.browserClearingPreservedData = $true
    $report.alternatePortNavigationDenied = $true
    $report.unsafeExternalLinksRejected = $true
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts 'session9-security.json')
    $report | ConvertTo-Json
} finally {
    if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
    End-DriverSession
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
