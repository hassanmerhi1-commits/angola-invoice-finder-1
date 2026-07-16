# NEXOR ERP — repair PostgreSQL schema on the SERVER PC (PowerShell).
# Usage: Right-click → Run with PowerShell (as Administrator if install is under Program Files)

$ErrorActionPreference = 'Stop'

$installDir = 'C:\NEXOR ERP'
if (-not (Test-Path (Join-Path $installDir 'database.env'))) {
  Write-Host '[ERROR] C:\NEXOR ERP\database.env not found. This must run on the PostgreSQL server PC.' -ForegroundColor Red
  exit 1
}

$backendCandidates = @(
  $env:NEXOR_BACKEND_ROOT,
  (Join-Path $PSScriptRoot 'backend'),
  (Join-Path $installDir 'backend'),
  'C:\Program Files\NEXOR ERP\resources\backend',
  'C:\Program Files (x86)\NEXOR ERP\resources\backend',
  (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\resources\backend'),
  (Join-Path $PSScriptRoot '..\backend')
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'scripts\ensure-server-schema.js')) }

if ($backendCandidates.Count -eq 0) {
  Write-Host '[ERROR] backend\scripts\ensure-server-schema.js not found.' -ForegroundColor Red
  Write-Host 'Install the latest NEXOR-ERP-x64.exe on this server, or run scripts\sync-nexor-backend.ps1'
  exit 1
}

$backend = $backendCandidates[0]
$runner = $null
$useElectron = $false

if (Get-Command node -ErrorAction SilentlyContinue) {
  $runner = 'node'
} elseif (Test-Path 'C:\Program Files\NEXOR ERP\NEXOR ERP.exe') {
  $runner = 'C:\Program Files\NEXOR ERP\NEXOR ERP.exe'
  $useElectron = $true
} elseif (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\NEXOR ERP.exe')) {
  $runner = (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\NEXOR ERP.exe')
  $useElectron = $true
} else {
  Write-Host '[ERROR] Neither node nor NEXOR ERP.exe found.' -ForegroundColor Red
  exit 1
}

$env:NEXOR_INSTALL_DIR = $installDir
if ($useElectron) { $env:ELECTRON_RUN_AS_NODE = '1' }

Write-Host "Install: $installDir"
Write-Host "Backend: $backend"
Write-Host "Runner:  $runner"
Write-Host ''

Push-Location $backend
try {
  & $runner scripts\ensure-server-schema.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host ''
  Write-Host '[OK] Restart NEXOR, then http://localhost:3000/api/health?lite=1' -ForegroundColor Green
} finally {
  Pop-Location
}
