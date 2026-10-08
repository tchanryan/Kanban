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
if ($Profile -eq 'personal-preview' -and -not (Test-Path -LiteralPath (Join-Path $profileRoot 'installer-acceptance.txt'))) { throw 'Migration acceptance requires the owned synthetic preview profile.' }
$evidencePrefix = if ($Profile -eq 'personal-preview') { 'session9' } else { 'session7' }
. (Join-Path $PSScriptRoot 'Native-TestHarness.ps1')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('KanbanPreviewTest.FileEdit' -as [type])) {
    Add-Type -Namespace KanbanPreviewTest -Name FileEdit -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageW(System.IntPtr window, uint message, System.IntPtr wParam, System.IntPtr lParam);'
}
$fixture = (Resolve-Path (Join-Path $PSScriptRoot '../workspace/tests/fixtures/portable-v1.json')).Path
$fixtureHash = (Get-FileHash -LiteralPath $fixture).Hash
$outputDirectory = Join-Path $logs 'exports'
$null = New-Item -ItemType Directory -Path $outputDirectory
function Go-Settings {
    $null = Script "location.hash='#/settings';"
    Until { Script "return !!document.querySelector('input[type=file]');" } 'Settings import did not appear'
}
function Choose-Backup([string]$Path) {
    $element = (Request 'POST' "/session/$sessionId/element" @{ using='css selector'; value='input[type=file]' }).value.'element-6066-11e4-a52e-4f735466cecf'
    $null = Request 'POST' "/session/$sessionId/element/$element/value" @{ text=$Path }
}
function Review-Visible { Script "return Array.from(document.querySelectorAll('dialog h2')).some(node=>node.textContent==='Review replacement backup');" }
function Canonical-Export {
    $data = Native 'portable_export'
    $data.PSObject.Properties.Remove('exportedAt')
    return ConvertTo-Json -InputObject $data -Depth 20 -Compress
}
function Confirm-Import {
    $null = Script "Array.from(document.querySelectorAll('dialog button')).find(node=>node.textContent==='Confirm replace all data').click();"
}
function Set-Passphrase([string]$Text) {
    $element = (Request 'POST' "/session/$sessionId/element" @{ using='css selector'; value='input[type=password]' }).value.'element-6066-11e4-a52e-4f735466cecf'
    $null = Request 'POST' "/session/$sessionId/element/$element/value" @{ text=([string][char]0xE009+'a'+[char]0xE000+$Text) }
    $null = Script 'document.activeElement?.blur();'
}
function Save-Export([string]$Button, [string]$Path, [bool]$Cancel = $false) {
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle,9)
    $null = Script "document.activeElement?.blur(); Array.from(document.querySelectorAll('button')).find(node=>node.textContent===arguments[0]).click();" @($Button)
    $script:saveDialog = $null
    Until {
        $condition = [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $previewProcess.Id),
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Save Kanban backup'))
        $script:saveDialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,$condition)
        if (-not $script:saveDialog) {
            $owner = [System.Windows.Automation.AutomationElement]::FromHandle($previewProcess.MainWindowHandle)
            $script:saveDialog = $owner.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
        }
        $null -ne $script:saveDialog
    } 'Native save dialog did not appear'
    $byName = { param($name) [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name) }
    if ($Cancel) {
        $actionButton = $saveDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (& $byName 'Cancel'))
    } else {
        $editCondition = [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit),
            (& $byName 'File name:'))
        $edit = $saveDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$editCondition)
        if (-not $edit) { throw 'Native filename field not found' }
        ([System.Windows.Automation.ValuePattern]$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Path)
        $editHandle = [IntPtr]$edit.Current.NativeWindowHandle
        if ($editHandle -eq [IntPtr]::Zero) { throw 'Filename edit has no native handle' }
        # Notify the common dialog of an edit; ValuePattern alone updates its displayed text only.
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle,0x00B1,[IntPtr](-1),[IntPtr](-1))
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle,0x0102,[IntPtr]32,[IntPtr]::Zero)
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle,0x0102,[IntPtr]8,[IntPtr]::Zero)
        $selectedValue = ([System.Windows.Automation.ValuePattern]$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
        if ($selectedValue -ne $Path) { throw 'Save dialog did not accept the selected test filename' }
        $actionButton = $saveDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (& $byName 'Save'))
    }
    if (-not $actionButton) { throw 'Native save dialog action not found' }
    $actionButton.SetFocus()
    ([System.Windows.Automation.InvokePattern]$actionButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    if (-not $Cancel) {
        try { Until { Test-Path -LiteralPath $Path } 'Native export did not create a file' }
        catch {
            Write-Warning ("Expected export: $Path; selected: $selectedValue")
            try { Write-Warning ("Dialog state: " + $saveDialog.Current.Name + '; offscreen=' + $saveDialog.Current.IsOffscreen + '; Save control=' + $actionButton.Current.AutomationId) } catch {}
            throw
        }
    }
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle,6)
}
try {
    foreach ($candidate in @($Port,($Port+1))) { $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$candidate); try { $listener.Start() } finally { $listener.Stop() } }
    $driver=Start-Process -FilePath $driverPath -ArgumentList @('--native-driver',('"'+$edgePath+'"'),'--port',$Port,'--native-port',($Port+1)) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logs 'stderr.log') -RedirectStandardOutput (Join-Path $logs 'stdout.log')
    Until { try { (Request 'GET' '/status' $null).value.ready } catch { $false } } 'Driver did not start'
    Open-Preview
    $resolvedProfileStorage = [IO.Path]::GetFullPath((Native 'recovery_status').storagePath)
    $expectedProfileStorage = [IO.Path]::GetFullPath((Join-Path $profileRoot $storageFolder)) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedProfileStorage.StartsWith($expectedProfileStorage, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing import outside the selected synthetic profile.' }
    if (@(Native 'draft_list').Count -ne 0) { throw 'Resolve pending preview drafts before migration testing' }
    Go-Settings
    $before=Native 'workspace_version'
    Choose-Backup $fixture
    Until { Review-Visible } 'Backup review did not appear'
    if ((Native 'workspace_version').generation -ne $before.generation) { throw 'Preview changed the workspace' }
    $null = Script "Array.from(document.querySelectorAll('dialog button')).find(node=>node.textContent==='Cancel').click();"
    if ((Native 'workspace_version').revision -ne $before.revision) { throw 'Cancel mutated the workspace' }
    Choose-Backup $fixture
    Until { Review-Visible } 'Repeated review did not appear'
    $null=Native 'workspace_command' @{command=@{name='saveScratch';args=@{content='Acknowledged after preview'}}}
    Confirm-Import
    Until { Script "return document.body.textContent.includes('saved version changed');" } 'Stale preview did not reject replacement'
    if ((Native 'workspace_query' @{query=@{name='scratch'}}).value.content -ne 'Acknowledged after preview') { throw 'Stale preview overwrote newer notes' }
    $null = Script "Array.from(document.querySelectorAll('dialog button')).find(node=>node.textContent==='Cancel').click();"
    Choose-Backup $fixture
    Until { Review-Visible } 'Fresh review did not appear'
    Confirm-Import
    Until { try { (Native 'workspace_version').generation -ne $before.generation } catch { $false } } 'Import did not change generation'
    Until { try { Script "return !!document.querySelector('input[type=file]') && !document.getElementById('root').inert;" } catch { $false } } 'UI did not reload after import'
    $expected=Get-Content -LiteralPath $fixture -Raw | ConvertFrom-Json
    $exported=Native 'portable_export'
    if ($exported.items.Count -ne $expected.items.Count -or $exported.scratchpads[0].content -ne $expected.scratchpads[0].content) { throw 'Imported data differs from file' }
    $receipt=@(Native 'import_history')[0]
    if ($receipt.counts.items -ne $expected.items.Count -or -not $receipt.safetyBackupId) { throw 'Import receipt missing verification/safety data' }
    Stop-Process -Id $previewProcess.Id -Force
    $previewProcess.WaitForExit(); End-DriverSession; Open-Preview
    if (@(Native 'import_history')[0].id -ne $receipt.id) { throw 'Import receipt did not survive forced exit' }
    if ((Native 'portable_export').scratchpads[0].content -ne $expected.scratchpads[0].content) { throw 'Imported notes did not survive forced exit' }
    Go-Settings
    $plainPath=Join-Path $outputDirectory 'round-trip.json'
    Save-Export 'Export JSON' $plainPath
    $plain=Get-Content -LiteralPath $plainPath -Raw | ConvertFrom-Json
    if ($plain.format -ne 'kanban-calendar' -or $plain.items.Count -ne $expected.items.Count) { throw 'Native JSON export is invalid' }
    Save-Export 'Export JSON' (Join-Path $outputDirectory 'cancelled.json') $true
    Until { Script "return document.body.textContent.includes('Export cancelled');" } 'Cancelled export was reported as success'
    $encryptedPath=Join-Path $outputDirectory 'round-trip-encrypted.json'
    Set-Passphrase 'synthetic-test-passphrase'
    Save-Export 'Export encrypted' $encryptedPath
    $beforeEncrypted=Native 'workspace_version'
    $beforeEncryptedData=Canonical-Export
    $beforeEncryptedReceipts=@(Native 'import_history').Count
    Set-Passphrase 'incorrect-passphrase'
    Choose-Backup $encryptedPath
    Until { Script "return document.body.textContent.includes('Incorrect passphrase');" } 'Wrong passphrase did not fail'
    # Focus maintenance can advance revision without changing data; compare all canonical fields.
    if ((Native 'workspace_version').generation -ne $beforeEncrypted.generation -or (Canonical-Export) -ne $beforeEncryptedData -or @(Native 'import_history').Count -ne $beforeEncryptedReceipts -or (Review-Visible)) { throw 'Wrong passphrase changed data or opened review' }
    Set-Passphrase 'synthetic-test-passphrase'
    Choose-Backup $encryptedPath
    Until { Review-Visible } 'Encrypted export did not decrypt into review'
    Confirm-Import
    Until { try { (Native 'workspace_version').generation -ne $beforeEncrypted.generation } catch { $false } } 'Encrypted import did not commit'
    Until { try { Script "return !!document.querySelector('input[type=file]') && !document.getElementById('root').inert;" } catch { $false } } 'UI did not reload after encrypted import'
    if ((Native 'portable_export').scratchpads[0].content -ne $expected.scratchpads[0].content) { throw 'Encrypted round-trip changed notes' }
    if ((Get-FileHash -LiteralPath $fixture).Hash -ne $fixtureHash) { throw 'Source export was modified' }
    Go-Settings
    $artifacts=Join-Path $PSScriptRoot '../../artifacts/native'
    $null=New-Item -ItemType Directory -Path $artifacts -Force
    $screenshot=(Request 'GET' "/session/$sessionId/screenshot" $null).value
    [System.IO.File]::WriteAllBytes((Join-Path $artifacts "$evidencePrefix-migration-settings.png"),[Convert]::FromBase64String($screenshot))
    $report = @{preview=$true;cancel=$true;stalePreview=$true;jsonImport=$true;encryptedImport=$true;wrongPassword=$true;nativeSave=$true;cancelSave=$true;forcedExit=$true;sourceUnchanged=$true;exportDirectory=$outputDirectory} | ConvertTo-Json
    Set-Content -LiteralPath (Join-Path $artifacts "$evidencePrefix-migration.json") -Value $report
    $report
} catch {
    $owned = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$previewProcess.Id))
    foreach ($element in $owned) { Write-Warning ("Owned window: " + $element.Current.Name) }
    Get-Content -LiteralPath (Join-Path $logs 'stderr.log') -Tail 10 -ErrorAction SilentlyContinue | Write-Warning
    if ($sessionId) { try { Write-Warning (Script 'return document.body.innerText;') } catch {} }
    throw
} finally {
    if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
    End-DriverSession
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
