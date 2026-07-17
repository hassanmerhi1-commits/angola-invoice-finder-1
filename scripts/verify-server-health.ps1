# Quick check: is the PostgreSQL SERVER running the new backend?
# Run on the SERVER PC after install, or from a client using -ServerIp.

param(
  [string]$ServerIp = '127.0.0.1',
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$uri = "http://${ServerIp}:${Port}/api/health?lite=1"
Write-Host "GET $uri" -ForegroundColor Cyan

try {
  $r = Invoke-RestMethod -Uri $uri -TimeoutSec 15
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "If this is a LAN client, pass -ServerIp <postgres-server-ip>" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "engine:                  $($r.engine)"
Write-Host "appVersion:              $($r.appVersion)"
Write-Host "backendPackageVersion:   $($r.backendPackageVersion)"
Write-Host "schemaVersion:           $($r.schemaVersion)"
Write-Host "schemaVersionExpected:   $($r.schemaVersionExpected)"
Write-Host "schemaUpToDate:          $($r.schemaUpToDate)"
Write-Host "backendEntry:            $($r.backendEntry)"
Write-Host "installDir:              $($r.installDir)"
if ($r.schemaRepairHint) {
  Write-Host ""
  Write-Host "schemaRepairHint:" -ForegroundColor Yellow
  Write-Host $r.schemaRepairHint
}

$ok = $r.ok -eq $true `
  -and $r.engine -eq 'postgres' `
  -and [int]$r.schemaVersionExpected -ge 56 `
  -and ($null -eq $r.schemaVersion -or [int]$r.schemaVersion -ge 56)

Write-Host ""
if ($ok) {
  Write-Host "OK — server backend and schema look current." -ForegroundColor Green
  exit 0
}

Write-Host "OUT OF DATE — update the SERVER PC (PostgreSQL host), not only LAN clients:" -ForegroundColor Red
Write-Host "  1. Close NEXOR on the server"
  Write-Host "  2. Install NEXOR-ERP-1.1.33-x64.exe (or newer) on the SERVER"
Write-Host "  3. Run C:\NEXOR ERP\repair-server-schema-now.ps1 (or fix-server-schema.cmd)"
Write-Host "  4. Restart NEXOR on the server"
Write-Host "  5. Re-run: .\verify-server-health.ps1 -ServerIp $ServerIp"
exit 1
