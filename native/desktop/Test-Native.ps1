param(
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [Parameter(Mandatory)][string]$Application,
    [ValidateRange(1024, 65534)][int]$Port = 4454,
    [ValidateSet('development', 'personal-preview')][string]$Profile = 'development'
)
$identity = if ($Profile -eq 'personal-preview') { 'io.github.tchanryan.kanban.preview' } else { 'io.github.tchanryan.kanban.session5' }
$storageFolder = if ($Profile -eq 'personal-preview') { 'data' } else { 'disposable-preview' }
$profileRoot = Join-Path $env:LOCALAPPDATA $identity
if ($Profile -eq 'personal-preview' -and -not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Refusing destructive acceptance on a personal profile without synthetic test ownership.' }
. (Join-Path $PSScriptRoot "Native-TestHarness.ps1")
try {
    foreach ($candidate in @($Port, ($Port + 1))) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start() } finally { $listener.Stop() }
    }
    $driver = Start-Process -FilePath $driverPath -ArgumentList @('--native-driver', ('"' + $edgePath + '"'), '--port', $Port, '--native-port', ($Port + 1)) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logs 'stderr.log') -RedirectStandardOutput (Join-Path $logs 'stdout.log')
    Until { try { (Request 'GET' '/status' $null).value.ready } catch { $false } } 'Driver did not start'
    Open-Preview
    $resolvedProfileStorage = [IO.Path]::GetFullPath((Native 'recovery_status').storagePath)
    $expectedProfileStorage = [IO.Path]::GetFullPath((Join-Path $profileRoot $storageFolder)) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedProfileStorage.StartsWith($expectedProfileStorage, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing mutation outside the selected synthetic profile.' }
    # Reconcile a scratchpad fixture retained by an interrupted earlier test.
    $stale = @(Native 'draft_list' | Where-Object { $_.id -eq 'scratchpad-global' -and $_.text -match '^(Pending recovery|Native UI save|Normal close) ' })
    if ($stale.Count -gt 0) {
        $null = Script "Array.from(document.querySelector('#scratchpad-global').closest('.field').querySelectorAll('button')).find(node=>node.textContent==='Use saved version').click();"
        Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Fixture discard confirmation not shown'
        $null = Script "document.querySelector('.confirmation-dialog .danger').click();"
        Until { @(Native 'draft_list' | Where-Object { $_.id -eq 'scratchpad-global' }).Count -eq 0 } 'Previous fixture was not discarded'
    }
    $nonce = [guid]::NewGuid().ToString()
    $savedText = "Native UI save $nonce"
    Type-Notes $savedText
    Until { (Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -eq $savedText } 'UI text was not committed'
    Until { (Script "return document.querySelector('#scratchpad-global').closest('.field').querySelector('.save-state').textContent;") -eq 'Saved' } 'UI did not acknowledge Saved'
    if (@(Native 'draft_list').Count -ne 0) { throw 'Successful save left a journal entry' }
    $root = (Native 'workspace_query' @{ query = @{ name = 'root' } }).value
    $columns = @(Native 'workspace_query' @{ query = @{ name = 'columns'; args = @{ boardId = $root.id } } })
    if ($columns[0].value.Count -eq 0) {
        $null = Native 'workspace_command' @{ command = @{ name = 'saveColumn'; args = @{ boardId = $root.id; input = @{ name = 'Test backlog'; isDefaultNewItemColumn = $true; startsWorkOnFirstEntry = $false; completesItemOnEntry = $false } } } }
    }
    $item = (Native 'workspace_command' @{ command = @{ name = 'create'; args = @{ boardId = $root.id; title = "IPC live refresh $nonce"; kind = 'task' } } }).value
    Until { Script 'return document.body.textContent.includes(arguments[0]);' @($item.title) } 'Committed task did not refresh the board'
    # Single-instance focus handoff must not accept unrelated physical keyboard input.
    $null = Script "document.activeElement?.blur(); document.getElementById('root').inert=true;"
    $second = Start-Process -FilePath $binaryPath -WindowStyle Hidden -PassThru
    if (-not $second.WaitForExit(10000)) { throw 'Second launch did not hand off to the existing process' }
    if (@(Get-Process -Name 'kanban-desktop-preview').Count -ne 1) { throw 'More than one workspace owner' }
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle, 6)
    # Leave a native-acknowledged pending draft, then terminate without a close callback.
    $version = Native 'workspace_version'
    $pendingText = "Pending recovery $nonce"
    $record = @{ id = 'scratchpad-global'; token = [guid]::NewGuid().ToString(); entityId = 'global'; field = 'scratch'; text = $pendingText; expected = $savedText; generation = $version.generation; label = 'Scratchpad' }
    if ((Native 'draft_stage' @{ record = $record }) -ne $record.token) { throw 'Journal acknowledgement mismatch' }
    Stop-Process -Id $previewProcess.Id -Force
    $previewProcess.WaitForExit()
    End-DriverSession
    Open-Preview
    if ((Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -ne $savedText) { throw 'Forced exit lost an acknowledged save' }
    if ((Script "return document.querySelector('#scratchpad-global').value;") -ne $pendingText) { throw 'Recovered draft not offered in editor' }
    if ((Native 'draft_list')[0].text -ne $pendingText) { throw 'Journal did not survive forced exit' }
    $null = Script "document.querySelector('#scratchpad-global').closest('.field').querySelector('.save-state button').click();"
    Until { (Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -eq $pendingText } 'Explicit recovered draft retry failed'
    $closedText = "Normal close $nonce"
    Type-Notes $closedText
    if (-not $previewProcess.CloseMainWindow()) { throw 'Could not request native close' }
    if (-not $previewProcess.WaitForExit(15000)) { throw 'Normal close did not flush and exit' }
    End-DriverSession
    Open-Preview
    if ((Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -ne $closedText) { throw 'Normal close lost pending text' }
    if (@(Native 'draft_list').Count -ne 0) { throw 'Saved draft resurrected after reopen' }
    # Invalid title text still needs a durable copy and a deliberate close choice.
    $null = Script "Array.from(document.querySelectorAll('.card-title')).find(node=>node.textContent===arguments[0]).click();" @($item.title)
    Until { Script 'return !!document.getElementById(arguments[0]);' @($item.id + '-title') } 'Inspector did not open'
    $titleElement = (Request 'POST' "/session/$sessionId/element" @{ using = 'css selector'; value = "[id='$($item.id)-title']" }).value.'element-6066-11e4-a52e-4f735466cecf'
    $started = [DateTime]::UtcNow
    $null = Request 'POST' "/session/$sessionId/element/$titleElement/clear" @{}
    $null = Request 'POST' "/session/$sessionId/element/$titleElement/value" @{ text = ' ' }
    Until { @(Native 'draft_list' | Where-Object { $_.id -eq ($item.id + '-title') -and $_.text -eq ' ' }).Count -eq 1 } 'UI edit was not journalled'
    $journalMilliseconds = [int]([DateTime]::UtcNow - $started).TotalMilliseconds
    Until { Script "return document.getElementById(arguments[0]).closest('.field').textContent.includes('Save failed');" @($item.id + '-title') } 'Invalid title was not retained after save failure'
    $null = $previewProcess.CloseMainWindow()
    Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Failed draft close choice was not shown'
    $null = Script "Array.from(document.querySelectorAll('.confirmation-dialog button')).find(node=>node.textContent==='Cancel').click();"
    Until { Script "return !document.getElementById('root').inert;" } 'Cancelled close left editing disabled'
    if ($previewProcess.HasExited) { throw 'Cancel unexpectedly closed the preview' }
    $null = $previewProcess.CloseMainWindow()
    Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Retain close choice was not shown'
    $null = Script "Array.from(document.querySelectorAll('.confirmation-dialog button')).find(node=>node.textContent==='Continue').click();"
    if (-not $previewProcess.WaitForExit(15000)) { throw 'Retain drafts did not close' }
    End-DriverSession
    Open-Preview
    $recovered = @(Native 'draft_list' | Where-Object { $_.id -eq ($item.id + '-title') })
    if ($recovered.Count -ne 1 -or $recovered[0].text -ne ' ') { throw 'Retained failed UI draft was lost' }
    if ((Native 'workspace_query' @{ query = @{ name = 'item'; args = @{ id = $item.id } } }).value.title -ne $item.title) { throw 'Invalid recovered title replaced saved data' }
    # Explicitly discard this fixture through the UI so subsequent runs begin without recovery work.
    $null = Script "Array.from(document.querySelectorAll('.card-title')).find(node=>node.textContent===arguments[0]).click();" @($item.title)
    Until { Script 'return !!document.getElementById(arguments[0]);' @($item.id + '-title') } 'Recovered inspector did not open'
    $null = Script "Array.from(document.querySelectorAll('button')).find(node=>node.textContent==='Use saved version').click();"
    Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Discard confirmation not shown'
    $null = Script "document.querySelector('.confirmation-dialog .danger').click();"
    Until { @(Native 'draft_list').Count -eq 0 } 'Discarded recovery draft remained in journal'
    $null = Script "location.hash='#/settings';"
    Until { Script "return Array.from(document.querySelectorAll('section')).some(node=>node.getAttribute('aria-label')==='Native backups and recovery');" } 'Native backup controls did not appear'
    $priorBackupIds = @((Native 'recovery_status').backups | ForEach-Object { $_.id })
    $null = Script "Array.from(document.querySelectorAll('button')).find(node=>node.textContent==='Back up now').click();"
    Until { @((Native 'recovery_status').backups | Where-Object { $_.id -notin $priorBackupIds }).Count -gt 0 } 'Manual backup did not publish'
    $checkpoint = Native 'recovery_status'
    $backup = $checkpoint.backups[0]
    $null = Native 'workspace_command' @{ command = @{ name = 'saveScratch'; args = @{ content = "Changed after backup $nonce" } } }
    $null = Script "Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')==='Restore backup '+arguments[0]).click();" @($backup.id)
    Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Restore confirmation did not appear'
    $null = Script "document.querySelector('.confirmation-dialog .primary').click();"
    Until { try { (Native 'recovery_status').storagePath -ne $checkpoint.storagePath } catch { $false } } 'Restore did not switch to a separate copy'
    Until { try { (Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -eq $closedText } catch { $false } } 'Restored content differs from snapshot'
    Stop-Process -Id $previewProcess.Id -Force
    $previewProcess.WaitForExit()
    End-DriverSession
    Open-Preview
    if ((Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -ne $closedText) { throw 'Restored pointer did not survive forced exit' }
    $damagedPath = (Native 'recovery_status').storagePath
    $safeRoot = [System.IO.Path]::GetFullPath((Join-Path $profileRoot $storageFolder)) + [System.IO.Path]::DirectorySeparatorChar
    $resolvedDamage = [System.IO.Path]::GetFullPath($damagedPath)
    if (-not $resolvedDamage.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetExtension($resolvedDamage) -ne '.sqlite') { throw 'Refusing corruption outside the disposable preview' }
    $null = $previewProcess.CloseMainWindow()
    if (-not $previewProcess.WaitForExit(15000)) { throw 'Could not close before corruption drill' }
    End-DriverSession
    [System.IO.File]::WriteAllText($resolvedDamage, 'deliberately damaged synthetic workspace')
    Open-Preview $true
    if ((Native 'recovery_status').available) { throw 'Damaged database silently opened as a fresh workspace' }
    $null = Script "Array.from(document.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')==='Restore backup '+arguments[0]).click();" @($backup.id)
    Until { Script "return !!document.querySelector('.confirmation-dialog');" } 'Recovery restore confirmation not shown'
    $null = Script "document.querySelector('.confirmation-dialog .primary').click();"
    Until { try { (Native 'recovery_status').available } catch { $false } } 'Recovery restore did not open healthy workspace'
    Until { try { Script "return !!document.querySelector('#scratchpad-global');" } catch { $false } } 'Application did not reopen after recovery'
    if ((Native 'workspace_query' @{ query = @{ name = 'scratch' } }).value.content -ne $closedText) { throw 'Recovery restored the wrong text' }
    if ([System.IO.File]::ReadAllText($resolvedDamage) -ne 'deliberately damaged synthetic workspace') { throw 'Recovery overwrote damaged evidence' }
    $databases = (Request 'POST' "/session/$sessionId/execute/async" @{ script = 'const done=arguments[arguments.length-1];indexedDB.databases().then(done);'; args = @() }).value
    if (@($databases).Count -ne 0) { throw 'Desktop opened an IndexedDB database' }
    $null = New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '../../test-results') -Force
    $screenshot = (Request 'GET' "/session/$sessionId/screenshot" $null).value
    [System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot '../../test-results/desktop-session6.png'), [Convert]::FromBase64String($screenshot))
    $report = @{ uiSave = $true; liveRefresh = $true; singleOwner = $true; forcedExitCommit = $true; recoveredDraft = $true; normalClose = $true; noIndexedDb = $true; offline = $true; failedDraftClose = $true; backupRestore = $true; damagedRecovery = $true; restoreForcedExit = $true; journalMilliseconds = $journalMilliseconds; profile = $Profile; completedAt = [DateTime]::UtcNow.ToString('o') }
    $artifacts = Join-Path $PSScriptRoot '../../artifacts/native'
    $null = New-Item -ItemType Directory -Path $artifacts -Force
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts "session9-native-$Profile.json")
    $report | ConvertTo-Json
} catch {
    Get-Content -LiteralPath (Join-Path $logs 'stderr.log') -Tail 20 -ErrorAction SilentlyContinue | Write-Warning
    if ($sessionId) { try { Write-Warning (Script 'return JSON.stringify({text:document.body.innerText,notes:document.querySelector("#scratchpad-global")?.value});') } catch {} }
    throw
} finally {
    if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
    End-DriverSession
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
