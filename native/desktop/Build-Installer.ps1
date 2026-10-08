param(
    [Parameter(Mandatory)][ValidatePattern('^0\.1\.[0-9]+$')][string]$Version,
    [ValidateSet('acceptance', 'personal-preview')][string]$Profile = 'acceptance',
    [string]$ToolsRoot = 'D:\KanbanBuildTools'
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
. (Join-Path $PSScriptRoot '../Use-WorkspaceToolchain.ps1') -ToolsRoot $ToolsRoot
$output = Join-Path $ToolsRoot "installers/$Profile/$Version"
if (Test-Path -LiteralPath $output) { throw "Keep existing build evidence; choose a new version or archive $output first." }
$null = New-Item -ItemType Directory -Path $output

# The pinned template is transformed narrowly; unexpected upstream changes fail the build.
$upstream = Join-Path $PSScriptRoot 'installer/upstream-installer.nsi'
if ((Get-FileHash -LiteralPath $upstream -Algorithm SHA256).Hash -ne 'DABED59013B1D78B879A1A85BC7F2EED2993B33A9A90CDABE5946DE3D3950597') { throw 'Pinned installer template checksum changed; review it before building.' }
$source = Get-Content -LiteralPath $upstream -Raw
$patterns = @(
    '(?s)Var DeleteAppDataCheckbox\r?\n.*?(?=!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive)',
    '(?s)  ; Delete app data if the checkbox is selected\r?\n.*?(?=  !ifmacrodef NSIS_HOOK_POSTUNINSTALL)'
)
foreach ($pattern in $patterns) {
    if ([regex]::Matches($source, $pattern).Count -ne 1) { throw 'Pinned installer template no longer matches the reviewed data-preservation patch.' }
    $source = [regex]::Replace($source, $pattern, '')
}
# Silent installation skips the version-comparison page in the upstream template.
# Compare again before any installation writes, independently of that page's registers.
$earlyCheck = '(?s)Section EarlyChecks\r?\n.*?SectionEnd'
if ([regex]::Matches($source, $earlyCheck).Count -ne 1) { throw 'Installer early-check boundary changed.' }
$replacement = @'
Section EarlyChecks
  !if "${ALLOWDOWNGRADES}" == "false"
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
    ${If} $R0 != ""
      nsis_tauri_utils::SemverCompare "${VERSION}" $R0
      Pop $R0
      ${If} $R0 = -1
        SetErrorLevel 1
        Abort "A newer version is installed. Application data has been retained."
      ${EndIf}
    ${EndIf}
  !endif
SectionEnd
'@
$source = [regex]::Replace($source, $earlyCheck, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
$runningGuard = @'
!macro KanbanRequireClosed executablePath
  ${If} ${FileExists} "${executablePath}"
    !insertmacro RestartManager_StartSession $R0
    ${If} $R0 == ""
      SetErrorLevel 1
      Abort "Cannot check running applications. Close Kanban and try again."
    ${EndIf}
    !insertmacro RestartManager_RegisterFile $R0 "${executablePath}"
    ${If} $0 <> 0
      !insertmacro RestartManager_EndSession $R0
      SetErrorLevel 1
      Abort "Cannot check the installed application. Close Kanban and try again."
    ${EndIf}
    System::Call 'RSTRTMGR::RmGetList(p R0, *i .r1, *i .r2, p 0, *i .r3) i .r0'
    StrCpy $R4 $0
    !insertmacro RestartManager_EndSession $R0
    ${If} $R4 <> 0
      SetErrorLevel 1
      Abort "Close Kanban normally before installing or uninstalling. Your data has been retained."
    ${EndIf}
  ${EndIf}
!macroend
'@
$anchor = '!include "Win\RestartManager.nsh"'
if (-not $source.Contains($anchor)) { throw 'Installer running-process check include changed.' }
$source = $source.Replace($anchor, $anchor + "`n" + $runningGuard)
$runningCheck = '!insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"'
if ([regex]::Matches($source, [regex]::Escape($runningCheck)).Count -ne 2) { throw 'Installer running-process check sites changed.' }
$source = $source.Replace($runningCheck, '!insertmacro KanbanRequireClosed "$INSTDIR\${MAINBINARYNAME}.exe"')
# Reject before the reinstall page can dispatch the previous uninstaller.
$initialization = '(?s)(Function \.onInit\r?\n.*?)(FunctionEnd)'
if ([regex]::Matches($source, $initialization).Count -ne 1) { throw 'Installer initialization boundary changed.' }
$source = [regex]::Replace($source, $initialization, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Groups[1].Value + '  !insertmacro KanbanRequireClosed "$INSTDIR\${MAINBINARYNAME}.exe"' + "`nFunctionEnd" })
if ($source -match 'DeleteAppData|RmDir /r "\$(LOCALAPPDATA|APPDATA)') { throw 'Installer still contains an app-data deletion path.' }
$template = Join-Path $output 'installer.nsi'
[IO.File]::WriteAllText($template, $source)
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "installer/$Profile.json") -Raw | ConvertFrom-Json
$config | Add-Member -NotePropertyName version -NotePropertyValue $Version
$config.bundle.windows.nsis | Add-Member -NotePropertyName template -NotePropertyValue $template
$configPath = Join-Path $output 'config.json'
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath
Push-Location $repository
try {
    npm run build:desktop
    if ($LASTEXITCODE -ne 0) { throw 'Desktop assets failed to build.' }
    Push-Location $PSScriptRoot
    try {
        & (Join-Path $repository 'node_modules/.bin/tauri.cmd') build --ci --no-sign --bundles nsis --config $configPath -- --locked --offline
        if ($LASTEXITCODE -ne 0) { throw 'Native installer build failed.' }
    } finally { Pop-Location }
    $installer = Join-Path $env:CARGO_TARGET_DIR "release/bundle/nsis/$($config.productName)_${Version}_x64-setup.exe"
    if (-not (Test-Path -LiteralPath $installer)) { throw 'Expected installer was not produced.' }
    $saved = Join-Path $output 'setup.exe'
    Copy-Item -LiteralPath $installer -Destination $saved
    $manifest = [ordered]@{
        version = $Version
        identifier = $config.identifier
        installer = $saved
        sha256 = (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash
        signature = (Get-AuthenticodeSignature -LiteralPath $saved).Status.ToString()
        builtAt = [DateTime]::UtcNow.ToString('o')
        profile = $Profile
        purpose = 'Unsigned personal preview or isolated acceptance only; public distribution requires signing.'
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'manifest.json')
    $manifest | ConvertTo-Json
} finally { Pop-Location }
