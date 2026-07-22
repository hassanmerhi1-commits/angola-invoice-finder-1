# Run this ON THE SERVER PC (the machine whose Tailscale/LAN IP is in C:\NEXOR ERP\IP).
# Deploys the credit-sale / transaction abort fixes and restarts NEXOR.
#
# Usage (PowerShell as Administrator recommended):
#   cd <repo>
#   git pull origin main
#   .\scripts\fix-on-account-on-server.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host '=== NEXOR: deploy on-account sale fix to this server ===' -ForegroundColor Cyan

& (Join-Path $PSScriptRoot 'sync-nexor-backend.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Applying schema (sales.client_id / credit payment)...' -ForegroundColor Yellow
$backend = 'C:\NEXOR ERP\backend'
if (-not (Test-Path (Join-Path $backend 'scripts\ensure-server-schema.js'))) {
  $backend = Join-Path $repoRoot 'backend'
}
$env:NEXOR_INSTALL_DIR = 'C:\NEXOR ERP'
Push-Location $backend
try {
  node scripts/ensure-server-schema.js
} catch {
  Write-Host "Schema script warning: $($_.Exception.Message)" -ForegroundColor Yellow
} finally {
  Pop-Location
}

Write-Host 'Starting NEXOR ERP...' -ForegroundColor Yellow
$exe = 'C:\Program Files\NEXOR ERP\NEXOR ERP.exe'
if (Test-Path $exe) {
  Start-Process $exe
} elseif (Test-Path 'C:\NEXOR ERP\Start NEXOR ERP.bat') {
  Start-Process 'C:\NEXOR ERP\Start NEXOR ERP.bat'
}

Write-Host ''
Write-Host 'Wait ~20s then check health — expect appVersion >= 1.1.54 and schemaVersionExpected 59:' -ForegroundColor Green
Write-Host '  Invoke-RestMethod http://127.0.0.1:3000/api/health?lite=1'
Write-Host 'Then retry the on-account (credit) sale from the client.'
