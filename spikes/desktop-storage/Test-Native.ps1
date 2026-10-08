param(
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [string]$Application = (Join-Path $PSScriptRoot 'target/debug/kanban-storage-spike.exe'),
    [ValidateRange(1024, 65534)][int]$Port = 4444
)

$ErrorActionPreference = 'Stop'
$driverPath = (Resolve-Path -LiteralPath $TauriDriver).Path
$edgePath = (Resolve-Path -LiteralPath $EdgeDriver).Path
$binaryPath = (Resolve-Path -LiteralPath $Application).Path
$endpoint = "http://127.0.0.1:$Port"
$sessionId = $null
$driver = $null
$logDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('kanban-driver-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $logDirectory
$errorLog = Join-Path $logDirectory 'stderr.log'

function Invoke-WebDriver {
    param([string]$Method, [string]$Route, [object]$Body)
    $arguments = @{
        Method = $Method
        Uri = "$endpoint$Route"
        TimeoutSec = 45
    }
    if ($null -ne $Body) {
        $arguments.Body = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
        $arguments.ContentType = 'application/json'
    }
    try { return Invoke-RestMethod @arguments }
    catch { throw "WebDriver $Method $Route failed: $($_.Exception.Message)" }
}

try {
    # Never attach to a driver belonging to another test run.
    foreach ($candidate in @($Port, ($Port + 1))) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start() } finally { $listener.Stop() }
    }
    $driver = Start-Process -FilePath $driverPath -ArgumentList @(
        '--native-driver', ('"' + $edgePath + '"'),
        '--port', $Port, '--native-port', ($Port + 1)
    ) -WindowStyle Hidden -PassThru -RedirectStandardError $errorLog -RedirectStandardOutput (Join-Path $logDirectory 'stdout.log')
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($driver.HasExited) { throw 'Native driver exited before startup' }
        try {
            $status = Invoke-WebDriver 'GET' '/status' $null
            if ($status.value.ready) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'Native driver did not become ready' }
    $session = Invoke-WebDriver 'POST' '/session' @{
        capabilities = @{ alwaysMatch = @{ 'tauri:options' = @{ application = $binaryPath } } }
    }
    $sessionId = $session.value.sessionId
    if (-not $sessionId) { throw 'Driver did not return a session ID' }
    $button = Invoke-WebDriver 'POST' "/session/$sessionId/element" @{ using = 'css selector'; value = '#run' }
    $elementId = $button.value.'element-6066-11e4-a52e-4f735466cecf'
    if (-not $elementId) { throw 'Native window did not expose the probe button' }
    $null = Invoke-WebDriver 'POST' "/session/$sessionId/element/$elementId/click" @{}
    $report = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline) {
        $result = Invoke-WebDriver 'POST' "/session/$sessionId/execute/sync" @{
            script = "return document.querySelector('#result').textContent;"
            args = @()
        }
        if ($result.value -eq 'Failed') { throw 'Real native IPC/storage probe failed' }
        if ($result.value.StartsWith('{')) { $report = $result.value | ConvertFrom-Json; break }
        Start-Sleep -Milliseconds 100
    }
    foreach ($check in @('committed', 'rolledBack', 'reopened', 'backupVerified')) {
        if ($null -eq $report -or $report.$check -ne $true) { throw "Native probe failed: $check" }
    }
    $report | ConvertTo-Json
} catch {
    if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Tail 30 | Write-Warning }
    throw
} finally {
    if ($sessionId) {
        try { $null = Invoke-WebDriver 'DELETE' "/session/$sessionId" $null }
        catch { Write-Warning 'Native session cleanup failed; inspect the disposable spike window.' }
    }
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
