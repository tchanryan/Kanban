param([string]$ToolsRoot = 'D:\KanbanBuildTools')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../spikes/desktop-storage/Use-ExternalToolchain.ps1') -ToolsRoot $ToolsRoot
$env:CARGO_TARGET_DIR = Join-Path $ToolsRoot 'targets/kanban-workspace'
