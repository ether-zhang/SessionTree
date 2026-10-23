param([string] $SnapshotPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($SnapshotPath) {
    & node (Join-Path $PSScriptRoot 'plugin-manager.mjs') rollback $SnapshotPath
} else {
    & node (Join-Path $PSScriptRoot 'plugin-manager.mjs') rollback
}
if ($LASTEXITCODE -ne 0) { throw 'SessionTree rollback failed; original backup files were preserved.' }
Write-Output 'Previous plugin version restored. Fully quit and reopen Codex to load it. Conversation history was not changed.'
