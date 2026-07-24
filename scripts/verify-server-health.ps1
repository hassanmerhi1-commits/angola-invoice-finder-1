# Quick check: is the PostgreSQL SERVER running the new backend?
# Run on the SERVER PC after install, or from a client using -ServerIp.

param(
  [string]$ServerIp = '127.0.0.1',
  [int]$Port = 3000,
  [string]$ExpectedVersion = '1.1.67',
  [int]$MinSchema = 67
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

$schemaOk = ($null -eq $r.schemaVersion -or [int]$r.schemaVersion -ge $MinSchema) `
  -and ($null -eq $r.schemaVersionExpected -or [int]$r.schemaVersionExpected -ge $MinSchema)
$versionOk = -not $ExpectedVersion `
  -or [string]$r.appVersion -eq $ExpectedVersion `
  -or [string]$r.backendPackageVersion -eq $ExpectedVersion

$ok = $r.ok -eq $true `
  -and $r.engine -eq 'postgres' `
  -and $schemaOk `
  -and $versionOk `
  -and ($r.schemaUpToDate -eq $true -or $null -eq $r.schemaUpToDate)

Write-Host ""
if ($ok) {
  Write-Host "OK — server backend and schema look current ($ExpectedVersion / schema >= $MinSchema)." -ForegroundColor Green
  exit 0
}

Write-Host "OUT OF DATE — update the SERVER PC (PostgreSQL host), not only LAN clients:" -ForegroundColor Red
Write-Host "  1. git pull origin main"
Write-Host "  2. docker compose up -d --build backend"
Write-Host "  3. Confirm /api/health appVersion=$ExpectedVersion and migrations through $MinSchema"
Write-Host "  4. Re-run: .\verify-server-health.ps1 -ServerIp $ServerIp"
Write-Host "See also: docs/BACKUP-OFFSITE-RTO.md"
exit 1
