Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'plugin-manager.mjs') install
if ($LASTEXITCODE -ne 0) { throw 'SessionTree installation failed. See the saved rollback snapshot.' }
Write-Output 'SessionTree installed. Fully quit and reopen Codex to load the updated plugin. The skill is for explicit tests only.'
