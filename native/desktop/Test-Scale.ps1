param(
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [Parameter(Mandatory)][string]$Application,
    [Parameter(Mandatory)][string]$Fixture,
    [ValidateRange(1024, 65534)][int]$Port = 4454,
    [switch]$ProfileStartup,
    [switch]$MeasureNormalLaunch
)
$ErrorActionPreference = 'Stop'
$profileRoot = Join-Path $env:LOCALAPPDATA 'io.github.tchanryan.kanban.preview'
if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Scale acceptance requires the owned synthetic preview profile.' }
. (Join-Path $PSScriptRoot 'Native-TestHarness.ps1')
function Canonical-Export {
    $data = Native 'portable_export'
    $data.PSObject.Properties.Remove('exportedAt')
    ConvertTo-Json -InputObject $data -Depth 20 -Compress
}
function Measure-Route([string]$Route, [string]$Selector, [int]$Count) {
    $result = (Request 'POST' "/session/$sessionId/execute/async" @{
        script = 'const [route,selector,count,done]=arguments; const start=performance.now();location.hash=route;const timer=setInterval(()=>{if(document.querySelectorAll(selector).length===count){clearInterval(timer);done(performance.now()-start);}},16);'
        args = @($Route, $Selector, $Count)
    }).value
    [math]::Round($result, 2)
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
    if (-not ([IO.Path]::GetFullPath($status.storagePath).StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase))) { throw 'The application is not using the owned preview data directory.' }
    if (@(Native 'draft_list').Count) { throw 'Resolve existing synthetic drafts before scale acceptance.' }
    $original = Canonical-Export
    $safety = Native 'backup_now'
    $null = Request 'POST' "/session/$sessionId/timeouts" @{ script = 60000; implicit = 5000 }
    $fixtureData = Get-Content -LiteralPath $Fixture -Raw | ConvertFrom-Json
    $importStart = [Diagnostics.Stopwatch]::StartNew()
    $preview = Native 'portable_preview' @{ backup = $fixtureData }
    $receipt = Native 'portable_import' @{ ticket = $preview.ticket; confirmed = $true }
    $importMs = $importStart.Elapsed.TotalMilliseconds
    $null = Script "location.hash='#/settings';"
    Until { Script "return !!document.querySelector('input[type=file]');" } 'Settings did not load'
    $dashboardMs = Measure-Route '#/' '.card-title' 703
    $archiveMs = Measure-Route '#/archive' '.archive-row' 50
    $samples = (Request 'POST' "/session/$sessionId/execute/async" @{
        script = 'const done=arguments[arguments.length-1];(async()=>{const samples=[];for(let i=0;i<100;i++){const start=performance.now();await window.__TAURI__.core.invoke("workspace_command",{command:{name:"saveScratch",args:{content:"Synthetic latency sample "+i}}});samples.push(performance.now()-start);}done({ok:true,samples});})().catch(error=>done({ok:false,error:String(error)}));'
        args = @()
    }).value
    if (-not $samples.ok) { throw $samples.error }
    $sorted = @($samples.samples | Sort-Object)
    $commitP95 = [double]$sorted[[math]::Ceiling($sorted.Count * 0.95) - 1]
    $null = Measure-Route '#/' '.card-title' 703
    $saveMs = (Request 'POST' "/session/$sessionId/execute/async" @{
        script = 'const done=arguments[arguments.length-1];const input=document.querySelector("#scratchpad-global");const start=performance.now();const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(input,"Synthetic measured UI save");input.dispatchEvent(new Event("input",{bubbles:true}));const timer=setInterval(()=>{const state=input.closest(".field").querySelector(".save-state");if(state?.textContent==="Saved" && performance.now()-start>200){clearInterval(timer);done(performance.now()-start);}},16);'
        args = @()
    }).value
    if ((Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -ne 'Synthetic measured UI save') { throw 'UI timing did not correspond to a committed save.' }
    $canonical = Canonical-Export
    $generation = (Native 'workspace_version').generation
    $startupProfile = $null
    if ($ProfileStartup) {
        $null = Request 'POST' "/session/$sessionId/ms/cdp/execute" @{ cmd = 'Page.reload'; params = @{ ignoreCache = $true } }
        Until { Script 'return performance.getEntriesByType("navigation")[0]?.type==="reload" && performance.getEntriesByName("kanban:board-ready").some(entry=>entry.detail?.itemCount===703);' } 'Profiled reload did not reach board readiness'
        $startupProfile = Script 'return {navigation:performance.getEntriesByType("navigation").map(entry=>entry.toJSON()),board:performance.getEntriesByName("kanban:board-ready").map(entry=>entry.toJSON())};'
    }
    $origin = Script 'return location.origin;'
    $null = Request 'POST' "/session/$sessionId/ms/cdp/execute" @{ cmd = 'Storage.clearDataForOrigin'; params = @{ origin = $origin; storageTypes = 'all' } }
    $null = Request 'POST' "/session/$sessionId/ms/cdp/execute" @{ cmd = 'Network.clearBrowserCache'; params = @{} }
    if ((Canonical-Export) -ne $canonical) { throw 'WebView storage clearing changed canonical data.' }
    $null = $previewProcess.CloseMainWindow()
    if (-not $previewProcess.WaitForExit(15000)) { throw 'Could not close the measured preview normally.' }
    End-DriverSession
    $normalLaunch = $null
    if ($MeasureNormalLaunch) {
        $portCheck = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, ($Port + 2))
        try { $portCheck.Start() } finally { $portCheck.Stop() }
        $startInfo = [Diagnostics.ProcessStartInfo]::new($binaryPath)
        $startInfo.UseShellExecute = $false
        $startInfo.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$($Port + 2) --remote-debugging-address=127.0.0.1"
        $previewProcess = [Diagnostics.Process]::Start($startInfo)
        $normalEvidence = Join-Path $logs 'normal-cold-launch.json'
        & node (Join-Path $PSScriptRoot 'Measure-ColdLaunch.mjs') "http://127.0.0.1:$($Port + 2)" $normalEvidence
        if ($LASTEXITCODE -ne 0) { throw 'Normal native launch measurement failed.' }
        $normalLaunch = Get-Content -LiteralPath $normalEvidence -Raw | ConvertFrom-Json
        $null = $previewProcess.CloseMainWindow()
        if (-not $previewProcess.WaitForExit(15000)) { throw 'Normal measured preview did not close safely.' }
    }
    Open-Preview $false 703
    $driverObservedColdBoardMs = $coldBoardObservedMilliseconds
    Until { Script 'return performance.getEntriesByName("kanban:board-ready").some(entry=>entry.detail?.itemCount===703);' } 'Post-paint board readiness was not recorded'
    $coldBoardMs = [double](Script 'return performance.getEntriesByName("kanban:board-ready").find(entry=>entry.detail?.itemCount===703).startTime;')
    $coldNavigationProfile = Script 'return {navigation:performance.getEntriesByType("navigation").map(entry=>entry.toJSON()),resources:performance.getEntriesByType("resource").map(entry=>({name:entry.name,start:entry.startTime,duration:entry.duration,responseEnd:entry.responseEnd,initiatorType:entry.initiatorType}))};'
    if ((Canonical-Export) -ne $canonical -or (Native 'workspace_version').generation -ne $generation) { throw 'Reopening after WebView clearing changed canonical data or generation.' }
    $null = Native 'restore_backup' @{ id = $safety.id; confirmed = $true }
    if ((Canonical-Export) -ne $original) { throw 'Restoring the pre-scale snapshot changed the original synthetic workspace.' }
    $report = [ordered]@{ fixture = @{ activeTasks = 1000; projects = 3; archivedTasks = 10000; events = 25000; columns = 20 }; importMilliseconds = [math]::Round($importMs,2); warmBoardMilliseconds = $dashboardMs; coldBoardMilliseconds = [math]::Round($coldBoardMs,2); driverObservedColdBoardMilliseconds = [math]::Round($driverObservedColdBoardMs,2); archiveMilliseconds = $archiveMs; commitP95Milliseconds = [math]::Round($commitP95,2); commitOperation = 'saveScratch'; commitSamples = $samples.samples; saveMilliseconds = [math]::Round($saveMs,2); webViewClearingPreservedData = $true; originalRestored = $true; applicationVersion = $status.appVersion; coldBoardTiming = 'WebView navigation start to board post-paint readiness mark; host initialization precedes this clock'; completedAt = [DateTime]::UtcNow.ToString('o') }
    $artifacts = Join-Path $PSScriptRoot '../../artifacts/native'
    if ($startupProfile) { $report.startupProfile = $startupProfile }
    $report.coldNavigationProfile = $coldNavigationProfile
    if ($normalLaunch) {
        $report.normalLaunch = $normalLaunch
        $report.webDriverBoardMilliseconds = $report.coldBoardMilliseconds
        $coldBoardMs = [double]$normalLaunch.boardMilliseconds
        $report.coldBoardMilliseconds = [math]::Round($coldBoardMs, 2)
        $report.coldBoardTiming = 'Normal owned process after origin/cache clearing; navigation to post-paint mark, observed with loopback CDP; host initialization precedes this clock'
    }
    $null = New-Item -ItemType Directory -Path $artifacts -Force
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $artifacts 'session9-scale.json')
    $report | ConvertTo-Json -Depth 5
    if ($commitP95 -ge 200 -or $saveMs -gt 1000 -or $dashboardMs -gt 2000 -or $coldBoardMs -gt 2000 -or $archiveMs -gt 1000) { throw 'One or more PRD performance targets failed; retain measurements and investigate.' }
} finally {
    if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
    End-DriverSession
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
