# Verify offsite backup freshness (P2-08).
# Usage:
#   .\scripts\verify-offsite-backup.ps1 -OffsiteDir 'D:\NEXOR-backups-offsite'
#   .\scripts\verify-offsite-backup.ps1 -OffsiteDir 'D:\NEXOR-backups-offsite' -MaxAgeDays 8

param(
  [Parameter(Mandatory = $true)]
  [string]$OffsiteDir,
  [int]$MaxAgeDays = 8
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $OffsiteDir)) {
  Write-Host "MISSING: offsite folder does not exist: $OffsiteDir" -ForegroundColor Red
  Write-Host "See docs/BACKUP-OFFSITE-RTO.md" -ForegroundColor Yellow
  exit 1
}

$files = Get-ChildItem -LiteralPath $OffsiteDir -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending

if (-not $files -or $files.Count -eq 0) {
  Write-Host "EMPTY: no backup files in $OffsiteDir" -ForegroundColor Red
  exit 1
}

$latest = $files[0]
$age = (Get-Date) - $latest.LastWriteTime
Write-Host "Latest: $($latest.Name)"
Write-Host "Modified: $($latest.LastWriteTime)"
Write-Host ("AgeHours: {0:N1}" -f $age.TotalHours)

if ($age.TotalDays -gt $MaxAgeDays) {
  Write-Host "STALE: older than $MaxAgeDays days" -ForegroundColor Red
  exit 1
}

Write-Host "OK — offsite backup is fresh." -ForegroundColor Green
exit 0
