param(
    [Parameter(Mandatory)][string]$FirstManifest,
    [Parameter(Mandatory)][string]$UpgradeManifest,
    [Parameter(Mandatory)][string]$TauriDriver,
    [Parameter(Mandatory)][string]$EdgeDriver,
    [ValidateSet('acceptance', 'personal-preview')][string]$Profile = 'acceptance',
    [string]$ToolsRoot = 'D:\KanbanBuildTools',
    [ValidateRange(1024, 65534)][int]$Port = 4454,
    [ValidateSet('session8', 'session9')][string]$EvidencePrefix = 'session8'
)
$ErrorActionPreference = 'Stop'
$identity = if ($Profile -eq 'acceptance') { 'io.github.tchanryan.kanban.installtest' } else { 'io.github.tchanryan.kanban.preview' }
$product = if ($Profile -eq 'acceptance') { 'Kanban Installer Acceptance' } else { 'Kanban Calendar Preview' }
$installDirectory = [IO.Path]::GetFullPath((Join-Path $ToolsRoot "installed/kanban-$Profile"))
$dataDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $identity
$ownership = Join-Path $dataDirectory 'installer-acceptance.txt'
if ((Test-Path -LiteralPath $dataDirectory) -and -not (Test-Path -LiteralPath $ownership)) { throw 'Existing acceptance data is not owned by this test; preserve and inspect it first.' }
if (Get-Process -Name 'kanban-desktop-preview' -ErrorAction SilentlyContinue) { throw 'Close the running preview before installer acceptance.' }
function Read-Build([string]$Path) {
    $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($manifest.identifier -ne $identity) { throw 'Installer does not match the guarded test profile.' }
    if ((Get-FileHash -LiteralPath $manifest.installer -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'Installer checksum differs from its build manifest.' }
    return $manifest
}
$first = Read-Build $FirstManifest
$upgrade = Read-Build $UpgradeManifest
if ([version]$upgrade.version -le [version]$first.version) { throw 'Upgrade version must be newer.' }
$registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
if (Test-Path $registry) {
    $existing = Get-ItemProperty -LiteralPath $registry
    if ($existing.InstallLocation.Trim('"').TrimEnd('\') -ne $installDirectory.TrimEnd('\')) { throw 'An acceptance installation exists at another location; it will not be changed.' }
}
function Run-Installer([object]$Build) {
    $process = Start-Process -FilePath $Build.installer -ArgumentList @('/S',("/D=$installDirectory")) -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) { throw 'Installer did not finish within two minutes; inspect it before retrying.' }
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $registered = Get-ItemProperty -LiteralPath $registry
    if ($registered.DisplayVersion -ne $Build.version) { throw 'Registered installer version is incorrect.' }
    $installedBinary = Join-Path $installDirectory 'kanban-desktop-preview.exe'
    $binaryVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($installedBinary).ProductVersion
    if ($binaryVersion -ne $Build.version) { throw "Installed binary version $binaryVersion differs from $($Build.version)." }
    $script:expectedAppVersion = $Build.version
}
Run-Installer $first
$null = New-Item -ItemType Directory -Path $dataDirectory -Force
Set-Content -LiteralPath $ownership -Value 'Synthetic installer acceptance profile. Never use for personal data.'
$Application = Join-Path $installDirectory 'kanban-desktop-preview.exe'
. (Join-Path $PSScriptRoot 'Native-TestHarness.ps1')
$olderDirectory = Join-Path $logs 'older-app'
$null = New-Item -ItemType Directory -Path $olderDirectory
$olderBinary = Join-Path $olderDirectory 'kanban-desktop-preview.exe'
Copy-Item -LiteralPath $Application -Destination $olderBinary
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('KanbanPreviewTest.FileEdit' -as [type])) {
    Add-Type -Namespace KanbanPreviewTest -Name FileEdit -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageW(System.IntPtr window, uint message, System.IntPtr wParam, System.IntPtr lParam);'
}
function Choose-Secondary([string]$Folder, [bool]$Cancel = $false) {
    Until { Script "return Array.from(document.querySelectorAll('button')).some(node=>node.textContent==='Choose backup folder' && !node.disabled);" } 'Backup folder controls did not become ready'
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle, 9)
    $null = Script "Array.from(document.querySelectorAll('button')).find(node=>node.textContent==='Choose backup folder').click();"
    $script:folderDialog = $null
    Until {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $previewProcess.Id))
        foreach ($owned in $windows) { if ($owned.Current.Name -match 'Folder|Browse') { $script:folderDialog = $owned; return $true } }
        $owner = [System.Windows.Automation.AutomationElement]::FromHandle($previewProcess.MainWindowHandle)
        $children = $owner.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window))
        foreach ($owned in $children) { if ($owned.Current.Name -match 'Folder|Browse') { $script:folderDialog = $owned; return $true } }
        return $false
    } 'Backup folder dialog did not appear'
    $byName = { param($name) [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $name) }
    if ($Cancel) {
        $button = $folderDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (& $byName 'Cancel'))
    } else {
        $edit = $folderDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
        if (-not $edit) { throw 'Folder path edit control was not found.' }
        ([System.Windows.Automation.ValuePattern]$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Folder)
        $editHandle = [IntPtr]$edit.Current.NativeWindowHandle
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle, 0x00B1, [IntPtr](-1), [IntPtr](-1))
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle, 0x0102, [IntPtr]32, [IntPtr]::Zero)
        $null = [KanbanPreviewTest.FileEdit]::SendMessageW($editHandle, 0x0102, [IntPtr]8, [IntPtr]::Zero)
        $button = $folderDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (& $byName 'OK'))
    }
    if (-not $button) { throw 'Folder dialog action was not found.' }
    ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    Until { Script "return !Array.from(document.querySelectorAll('button')).find(node=>node.textContent==='Choose backup folder').disabled;" } 'Folder action did not complete'
    $null = [KanbanPreviewTest.Window]::ShowWindowAsync($previewProcess.MainWindowHandle, 6)
}
function Close-Acceptance {
    if (-not $previewProcess.CloseMainWindow()) { throw 'Cannot request normal application close.' }
    if (-not $previewProcess.WaitForExit(15000)) { throw 'Application did not flush and close.' }
    End-DriverSession
}
function Canonical-Export {
    $data = Native 'portable_export'
    $data.PSObject.Properties.Remove('exportedAt')
    return ConvertTo-Json -InputObject $data -Depth 20 -Compress
}
function Assert-Preserved([string]$Stage) {
    Open-Preview
    if ((Canonical-Export) -ne $script:expected) { throw "Canonical data changed during $Stage." }
    if ((Native 'workspace_version').generation -ne $script:generation) { throw "Workspace identity changed during $Stage." }
    if ((Native 'import_history' | ConvertTo-Json -Depth 20 -Compress) -ne $script:history) { throw "Import history changed during $Stage." }
    $status = Native 'recovery_status'
    if ($status.appVersion -ne $script:expectedAppVersion) { throw "Application version metadata is incorrect during $Stage." }
    if (-not ($status.backups.id -contains $script:backup.id)) { throw "Verified backup disappeared during $Stage." }
    if ($status.secondary.directory -ne $script:secondaryDirectory -or -not ($status.secondary.backups.id -contains $script:backup.id) -or $status.secondary.error) { throw "Secondary backup settings or verified copies changed during $Stage." }
    if ($Stage -eq 'upgrade' -and -not ($status.backups | Where-Object { $_.reason -eq 'before-upgrade' -and $_.appVersion -eq $first.version })) { throw 'Automatic pre-upgrade backup is missing.' }
    Close-Acceptance
    Write-Output "Verified preservation after $Stage"
}
function Inspect-InteractiveUninstaller {
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    $inspection = Start-Process -FilePath $uninstaller -WindowStyle Hidden -PassThru
    $script:uninstallDialog = $null
    Until {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($owned in $windows) { if ($owned.Current.Name.Trim() -eq "$product Uninstall") { $script:uninstallDialog = $owned; return $true } }
        return $false
    } 'Interactive uninstaller did not appear'
    $uninstallerProcess = $uninstallDialog.Current.ProcessId
    try {
        $checkboxes = $uninstallDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox))
        if ($checkboxes.Count -ne 0) { throw 'Uninstaller still offers a checkbox that could delete application data.' }
        $cancel = $uninstallDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel'))
        if (-not $cancel) { throw 'Uninstaller Cancel control is missing.' }
        ([System.Windows.Automation.InvokePattern]$cancel.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
        Until { -not (Get-Process -Id $uninstallerProcess -ErrorAction SilentlyContinue) } 'Interactive cancellation did not close the uninstaller'
    } finally {
        if (Get-Process -Id $uninstallerProcess -ErrorAction SilentlyContinue) { Stop-Process -Id $uninstallerProcess -Force }
    }
    if (-not (Test-Path -LiteralPath $Application) -or -not (Test-Path $registry)) { throw 'Cancelling uninstall removed the application.' }
}
try {
    foreach ($candidate in @($Port, ($Port + 1))) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start() } finally { $listener.Stop() }
    }
    $driver = Start-Process -FilePath $driverPath -ArgumentList @('--native-driver', ('"' + $edgePath + '"'), '--port', $Port, '--native-port', ($Port + 1)) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $logs 'stderr.log') -RedirectStandardOutput (Join-Path $logs 'stdout.log')
    Until { try { (Request 'GET' '/status' $null).value.ready } catch { $false } } 'Driver did not start'
    Open-Preview
    $status = Native 'recovery_status'
    $resolvedStorage = [IO.Path]::GetFullPath($status.storagePath)
    if (-not $resolvedStorage.StartsWith($dataDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installed app selected data outside the acceptance profile.' }
    $fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../workspace/tests/fixtures/portable-v1.json') -Raw | ConvertFrom-Json
    $preview = Native 'portable_preview' @{ backup = $fixture }
    $null = Native 'portable_import' @{ ticket = $preview.ticket; confirmed = $true }
    $expected = Canonical-Export
    $generation = (Native 'workspace_version').generation
    $history = Native 'import_history' | ConvertTo-Json -Depth 20 -Compress
    $backup = Native 'backup_now'
    # Exercise a lazy route after the WebView has entered offline mode.
    $null = Script "location.hash='#/settings';"
    Until { Script "return !!document.querySelector('input[type=file]');" } 'Packaged settings did not load offline'
    $priorSecondary = (Native 'recovery_status').secondary.directory
    Choose-Secondary $logs $true
    if ((Native 'recovery_status').secondary.directory -ne $priorSecondary) { throw 'Cancelling folder selection changed settings.' }
    Choose-Secondary $logs
    $backup = Native 'backup_now'
    $secondary = (Native 'recovery_status').secondary
    if (-not $secondary.directory -or $secondary.error) { throw "Secondary folder setup failed: $($secondary.error)" }
    $secondaryDirectory = $secondary.directory
    $artifacts = Join-Path $PSScriptRoot '../../artifacts/native'
    $null = New-Item -ItemType Directory -Path $artifacts -Force
    $screenshot = (Request 'GET' "/session/$sessionId/screenshot" $null).value
    [IO.File]::WriteAllBytes((Join-Path $artifacts "$EvidencePrefix-settings-$Profile.png"), [Convert]::FromBase64String($screenshot))
    $runningUpgrade = Start-Process -FilePath $upgrade.installer -ArgumentList @('/S', ("/D=$installDirectory")) -WindowStyle Hidden -PassThru
    if (-not $runningUpgrade.WaitForExit(120000) -or $runningUpgrade.ExitCode -eq 0) { throw 'Installer did not reject an upgrade while Kanban was running.' }
    if ($previewProcess.HasExited -or (Canonical-Export) -ne $expected -or (Get-ItemProperty -LiteralPath $registry).DisplayVersion -ne $first.version) { throw 'Rejected running-app upgrade changed the process, data or installation.' }
    Close-Acceptance
    Run-Installer $upgrade
    Assert-Preserved 'upgrade'
    Open-Preview
    $null = Script "location.hash='#/settings';"
    Until { Script "return !!document.querySelector('input[type=file]');" } 'Settings did not open after upgrading'
    Choose-Secondary $logs
    $freshSecondary = (Native 'recovery_status').secondary
    if (-not $freshSecondary.directory -or $freshSecondary.error -or -not ($freshSecondary.backups.id -contains $backup.id)) { throw 'The upgraded application did not seed a new folder with every retained backup.' }
    $secondaryDirectory = $freshSecondary.directory
    Close-Acceptance
    $currentBinary = $binaryPath
    $binaryPath = $olderBinary
    try {
        Open-Preview $true
        if ((Native 'recovery_status').available) { throw 'An older executable opened newer application data for writes.' }
        $writeBlocked = $false
        try { $null = Native 'workspace_command' @{ command = @{ name = 'saveScratch'; args = @{ content = 'An older binary must not write this' } } } } catch { $writeBlocked = $true }
        if (-not $writeBlocked) { throw 'An older executable acknowledged a write.' }
        Stop-Process -Id $previewProcess.Id -Force
        End-DriverSession
    } finally { $binaryPath = $currentBinary }
    Assert-Preserved 'direct older executable'
    $downgrade = Start-Process -FilePath $first.installer -ArgumentList @('/S', ("/D=$installDirectory")) -WindowStyle Hidden -PassThru
    if (-not $downgrade.WaitForExit(120000) -or $downgrade.ExitCode -eq 0) { throw 'Older installer was not rejected.' }
    if ((Get-ItemProperty -LiteralPath $registry).DisplayVersion -ne $upgrade.version) { throw 'Rejected downgrade changed the registered version.' }
    Assert-Preserved 'rejected downgrade'
    Run-Installer $upgrade
    Assert-Preserved 'same-version repair'
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Acceptance uninstaller is missing.' }
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) { throw 'Uninstaller did not finish.' }
    Until { -not (Test-Path -LiteralPath $Application) -and -not (Test-Path $registry) } 'Uninstall did not remove the acceptance application'
    if (-not (Test-Path -LiteralPath $resolvedStorage)) { throw 'Uninstall removed the native database.' }
    Run-Installer $upgrade
    Assert-Preserved 'uninstall/reinstall'
    Inspect-InteractiveUninstaller
    Assert-Preserved 'cancelled interactive uninstall'
    $report = [ordered]@{ install = $true; upgrade = $true; rejectedDowngrade = $true; repair = $true; uninstallReinstall = $true; offlineSettings = $true; canonicalEquality = $true; backupsPreserved = $true; historyPreserved = $true; dataPath = $resolvedStorage; installedVersion = $upgrade.version; firstSha256 = $first.sha256; upgradeSha256 = $upgrade.sha256; completedAt = [DateTime]::UtcNow.ToString('o') }
    $artifacts = Join-Path $PSScriptRoot '../../artifacts/native'
    $null = New-Item -ItemType Directory -Path $artifacts -Force
    $report.secondaryFolder = $secondaryDirectory
    $report.folderCancel = $true
    $report.preUpgradeSnapshot = $true
    $report.profile = $Profile
    $report.runningAppRejected = $true
    $report.directOlderBinaryRejected = $true
    $report.newFolderFullySeeded = $true
    $report.interactiveUninstallPreservesData = $true
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifacts "$EvidencePrefix-installer-$Profile.json")
    $report | ConvertTo-Json
} catch {
    if ($previewProcess -and -not $previewProcess.HasExited) {
        $owned = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $previewProcess.Id))
        foreach ($element in $owned) { Write-Warning ("Owned window: " + $element.Current.Name) }
    }
    if ($sessionId) { try { Write-Warning (Script 'return document.body.innerText;') } catch {} }
    throw
} finally {
    if ($previewProcess -and -not $previewProcess.HasExited) { Stop-Process -Id $previewProcess.Id -Force }
    End-DriverSession
    if ($driver -and -not $driver.HasExited) { Stop-Process -Id $driver.Id }
}
