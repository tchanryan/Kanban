param(
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [Parameter(Mandatory)][string]$Application,
    [ValidateRange(1024, 65534)][int]$Port = 4704
)
$ErrorActionPreference = 'Stop'
$profileRoot = Join-Path $env:LOCALAPPDATA 'io.github.tchanryan.kanban.preview'
if (-not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Link acceptance requires the owned synthetic profile.' }
. (Join-Path $PSScriptRoot 'Native-TestHarness.ps1')
$listener = $null
$safety = $null
function Canonical-Export {
    $data = Native 'portable_export'
    $data.PSObject.Properties.Remove('exportedAt')
    ConvertTo-Json -InputObject $data -Depth 20 -Compress
}
try {
    foreach ($candidate in @($Port, ($Port + 1))) {
        $portCheck = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $portCheck.Start() } finally { $portCheck.Stop() }
    }
    $driver = Start-Process -FilePath $driverPath -ArgumentList @('--native-driver', ('"' + $edgePath + '"'), '--port', $Port, '--native-port', ($Port + 1)) -WindowStyle Hidden -PassThru
    Until { try { (Request 'GET' '/status' $null).value.ready } catch { $false } } 'Driver did not start'
    Open-Preview
    $status = Native 'recovery_status'
    $safeRoot = [IO.Path]::GetFullPath((Join-Path $profileRoot 'data')) + [IO.Path]::DirectorySeparatorChar
    if (-not ([IO.Path]::GetFullPath($status.storagePath).StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase))) { throw 'Application is outside the owned profile.' }
    if (@(Native 'draft_list').Count) { throw 'Resolve pending synthetic drafts before link acceptance.' }
    $original = Canonical-Export
    foreach ($address in @('file:///C:/Windows/win.ini', 'javascript:alert(1)', 'https://user:secret@example.com', 'mailto:user@example.com', '/relative')) {
        $rejected = $false
        try { $null = Native 'open_external_link' @{ address = $address } } catch { $rejected = $true }
        if (-not $rejected) { throw 'Unsafe link reached the browser launcher.' }
    }
    $safety = Native 'backup_now'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $token = [guid]::NewGuid().ToString('N')
    $address = "http://127.0.0.1:$($listener.LocalEndpoint.Port)/external-link-acceptance/$token"
    $accept = $listener.AcceptTcpClientAsync()
    $null = Native 'workspace_command' @{ command = @{ name = 'saveScratch'; args = @{ content = "[Synthetic browser acceptance]($address)" } } }
    Until { Script 'return !!document.querySelector(".scratchpad .section-heading button");' } 'Notes did not load'
    $null = Script 'document.querySelector(".scratchpad .section-heading button").click();'
    Until { Script 'return !!Array.from(document.querySelectorAll(".scratchpad a")).find(link=>link.textContent==="Synthetic browser acceptance");' } 'Markdown link did not render'
    $origin = Script 'return location.origin;'
    $null = Script 'Array.from(document.querySelectorAll(".scratchpad a")).find(link=>link.textContent==="Synthetic browser acceptance").click();'
    if (-not $accept.Wait(15000)) { throw 'System browser did not request the local acceptance page.' }
    $client = $accept.Result
    try {
        $stream = $client.GetStream()
        $stream.ReadTimeout = 15000
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
        try {
            $requestLine = $reader.ReadLine()
            if ($requestLine -ne "GET /external-link-acceptance/$token HTTP/1.1") { throw 'Browser requested an unexpected acceptance path.' }
            $headerCount = 0
            do {
                $header = $reader.ReadLine()
                if ($null -eq $header -or ++$headerCount -gt 100) { throw 'Invalid acceptance request headers.' }
            } while ($header -ne '')
            $body = '<!doctype html><title>Kanban link acceptance</title><p>The synthetic system-browser link test passed. You may close this tab.</p>'
            $response = "HTTP/1.1 200 OK`r`nContent-Type: text/html; charset=utf-8`r`nContent-Length: $([Text.Encoding]::UTF8.GetByteCount($body))`r`nConnection: close`r`n`r`n$body"
            $bytes = [Text.Encoding]::UTF8.GetBytes($response)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush()
        } finally { $reader.Dispose() }
    } finally { $client.Dispose() }
    if ((Script 'return location.origin;') -ne $origin) { throw 'External link navigated the embedded window.' }
    $null = Native 'restore_backup' @{ id = $safety.id; confirmed = $true }
    $safety = $null
    if ((Canonical-Export) -ne $original) { throw 'Link acceptance did not restore the original workspace.' }
    $report = @{ invalidLinksRejected = $true; markdownClickOpenedSystemBrowser = $true; loopbackPageRequested = $true; embeddedOriginPreserved = $true; originalRestored = $true; applicationVersion = $status.appVersion; completedAt = [DateTime]::UtcNow.ToString('o') }
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '../../artifacts/native/session9-external-links.json')
    $report | ConvertTo-Json
} finally {
    if ($listener) { $listener.Stop() }
    try {
        if ($safety -and $sessionId) { $null = Native 'restore_backup' @{ id = $safety.id; confirmed = $true } }
    } finally {
        if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
        End-DriverSession
        if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
    }
}
