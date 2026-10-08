param([string]$ToolsRoot = 'D:\KanbanBuildTools')

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $ToolsRoot -PathType Container)) {
    throw "Build tools folder does not exist: $ToolsRoot"
}
# Dot-source in the build shell; these settings do not change Windows defaults.
$env:RUSTUP_HOME = Join-Path $ToolsRoot 'rustup'
$env:CARGO_HOME = Join-Path $ToolsRoot 'cargo'
$env:CARGO_TARGET_DIR = Join-Path $ToolsRoot 'targets/kanban-storage-spike'
$env:TEMP = Join-Path $ToolsRoot 'temp'
$env:TMP = $env:TEMP
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:CARGO_HOME\bin;$env:PATH"
