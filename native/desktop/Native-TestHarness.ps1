$ErrorActionPreference = 'Stop'
if (-not ('KanbanPreviewTest.Window' -as [type])) {
    Add-Type -Namespace KanbanPreviewTest -Name Window -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr window, int command);'
}
$binaryPath = (Resolve-Path -LiteralPath $Application).Path
$driverPath = (Resolve-Path -LiteralPath $TauriDriver).Path
$edgePath = (Resolve-Path -LiteralPath $EdgeDriver).Path
$endpoint = "http://127.0.0.1:$Port"
$sessionId = $null
$driver = $null
$previewProcess = $null
$logs = Join-Path ([System.IO.Path]::GetTempPath()) ('kanban-session5-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $logs
if (Get-Process -Name 'kanban-desktop-preview' -ErrorAction SilentlyContinue) { throw 'Close the existing disposable preview before running this test.' }
function Request([string]$Method, [string]$Route, [object]$Body) {
    $parameters = @{ Method = $Method; Uri = "$endpoint$Route"; TimeoutSec = 45 }
    if ($null -ne $Body) { $parameters.Body = ConvertTo-Json -InputObject $Body -Depth 15 -Compress; $parameters.ContentType = 'application/json' }
    return Invoke-RestMethod @parameters
}
function Script([string]$Code, [object[]]$Values = @()) {
    return (Request 'POST' "/session/$sessionId/execute/sync" @{ script = $Code; args = $Values }).value
}
function Native([string]$Command, [object]$Arguments = @{}) {
    $result = (Request 'POST' "/session/$sessionId/execute/async" @{
        script = 'const done=arguments[arguments.length-1]; window.__TAURI__.core.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,error}));'
        args = @($Command, $Arguments)
    }).value
    if (-not $result.ok) { throw "Native $Command failed: $($result.error | ConvertTo-Json -Compress)" }
    return $result.value
}
function Until([scriptblock]$Condition, [string]$Failure) {
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    }
    throw $Failure
}
function Open-Preview([bool]$ExpectRecovery = $false, [int]$ExpectedCards = -1) {
    $session = Request 'POST' '/session' @{ capabilities = @{ alwaysMatch = @{ 'tauri:options' = @{ application = $binaryPath } } } }
    $script:sessionId = $session.value.sessionId
    $null = Request 'POST' "/session/$sessionId/timeouts" @{ script = 15000; implicit = 5000 }
    if ($ExpectRecovery) {
        Until { Script "return document.body.textContent.includes('Workspace recovery');" } 'Recovery screen did not open'
    } else {
        Until { Script "return !!document.querySelector('#scratchpad-global') && !!document.querySelector('.board-area');" } 'Desktop board and notes did not open'
    }
    if ($ExpectedCards -ge 0) {
        Until { Script 'return document.querySelectorAll(".card-title").length===arguments[0];' @($ExpectedCards) } 'Cold board did not render'
        $script:coldBoardObservedMilliseconds = [double](Script 'return performance.now();')
    }
    $null = Request 'POST' "/session/$sessionId/ms/cdp/execute" @{ cmd = 'Network.enable'; params = @{} }
    $null = Request 'POST' "/session/$sessionId/ms/cdp/execute" @{ cmd = 'Network.emulateNetworkConditions'; params = @{ offline = $true; latency = 0; downloadThroughput = 0; uploadThroughput = 0 } }
    if (Script 'return navigator.onLine;') { throw 'WebView did not enter offline mode' }
    $script:previewProcess = Get-Process -Name 'kanban-desktop-preview' | Where-Object { $_.Path -eq $binaryPath } | Select-Object -First 1
    if (-not $previewProcess) { throw 'Cannot identify the disposable test process' }
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle, 6)
}
function End-DriverSession {
    if ($script:sessionId) {
        try { $null = Request 'DELETE' "/session/$sessionId" $null } catch { Write-Warning 'The already-closed app has no live driver session.' }
        $script:sessionId = $null
    }
}
function Type-Notes([string]$Text) {
    $element = (Request 'POST' "/session/$sessionId/element" @{ using = 'css selector'; value = '#scratchpad-global' }).value.'element-6066-11e4-a52e-4f735466cecf'
    $null = Request 'POST' "/session/$sessionId/element/$element/value" @{ text = ([string][char]0xE009 + 'a' + [char]0xE000 + $Text) }
}
