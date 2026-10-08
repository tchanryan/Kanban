param(
    [Parameter(Mandatory)][string]$Application,
    [ValidateRange(1024, 65534)][int]$Port = 4724
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../Use-WorkspaceToolchain.ps1')
$profileRoot = Join-Path $env:LOCALAPPDATA 'io.github.tchanryan.kanban.preview'
if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Interactions require the owned synthetic profile.' }
if (Get-Process -Name kanban-desktop-preview -ErrorAction SilentlyContinue) { throw 'Close the existing preview before interaction acceptance.' }
$portCheck = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $portCheck.Start() } finally { $portCheck.Stop() }
$startInfo = [Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $Application).Path)
$startInfo.UseShellExecute = $false
$startInfo.Environment['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
$preview = [Diagnostics.Process]::Start($startInfo)
try {
    & node (Join-Path $PSScriptRoot 'Test-Interactions.mjs') "http://127.0.0.1:$Port" (Join-Path $PSScriptRoot '../workspace/tests/fixtures/portable-v1.json') (Join-Path $profileRoot 'data') (Join-Path $PSScriptRoot '../../artifacts/native/session9-interactions.json')
    if ($LASTEXITCODE -ne 0) { throw 'Native interaction acceptance failed.' }
} finally {
    if (-not $preview.HasExited) {
        $null = $preview.CloseMainWindow()
        if (-not $preview.WaitForExit(15000)) { Stop-Process -Id $preview.Id -Force }
    }
}
