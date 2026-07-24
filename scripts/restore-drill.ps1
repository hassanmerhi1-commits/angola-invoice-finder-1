# Restore drill on a COPY database (P1-06) — never restore over live production.
#
# This script validates backup freshness and prints a timed checklist.
# It does NOT overwrite the live DB.
#
# Usage:
#   .\scripts\restore-drill.ps1
#   .\scripts\restore-drill.ps1 -BackupDir 'D:\NEXOR-backups-offsite' -ServerIp 127.0.0.1

param(
  [string]$BackupDir = '',
  [string]$ServerIp = '127.0.0.1',
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$started = Get-Date

Write-Host "=== NEXOR restore drill (COPY DB only) ===" -ForegroundColor Cyan
Write-Host "Started: $started"
Write-Host ""
Write-Host "Goal: recover from latest backup into a STAGING copy in under 60 minutes."
Write-Host "See: docs/BACKUP-OFFSITE-RTO.md"
Write-Host ""

if ($BackupDir) {
  if (-not (Test-Path -LiteralPath $BackupDir)) {
    Write-Host "FAIL: BackupDir not found: $BackupDir" -ForegroundColor Red
    exit 1
  }
  $latest = Get-ChildItem -LiteralPath $BackupDir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) {
    Write-Host "FAIL: no files in $BackupDir" -ForegroundColor Red
    exit 1
  }
  Write-Host "Latest backup: $($latest.FullName) ($($latest.LastWriteTime))"
} else {
  Write-Host "Tip: pass -BackupDir to verify the newest dump file exists."
}

Write-Host ""
Write-Host "Checklist (do manually on a staging compose project / copy DB):" -ForegroundColor Yellow
Write-Host "  1. Stop writes on the drill target (not production)."
Write-Host "  2. Restore latest .sql/.db into the COPY database only."
Write-Host "  3. Start a staging backend pointed at the copy."
Write-Host "  4. GET http://${ServerIp}:${Port}/api/health?lite=1  (adjust if staging uses another port)"
Write-Host "  5. Login + spot-check: sales list, one journal, one product stock."
Write-Host "  6. Record actual minutes taken below."
Write-Host ""

$verify = Join-Path $PSScriptRoot 'verify-server-health.ps1'
if (Test-Path -LiteralPath $verify) {
  Write-Host "Running health probe against ${ServerIp}:${Port} (optional — use staging host)..."
  try {
    & $verify -ServerIp $ServerIp -Port $Port
  } catch {
    Write-Host "Health probe skipped/failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

$elapsed = (Get-Date) - $started
Write-Host ""
Write-Host ("Script prep time: {0:N1} minutes" -f $elapsed.TotalMinutes)
Write-Host "Write the full drill duration (backup→login→spot-check) in your ops log."
Write-Host "PASS criteria: restore + verify under 60 minutes on a copy DB." -ForegroundColor Green
exit 0
