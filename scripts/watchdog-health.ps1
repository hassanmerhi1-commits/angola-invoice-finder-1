# Poll /api/health and alert on failure (P2-09).
# Usage:
#   .\scripts\watchdog-health.ps1 -ServerIp 100.104.240.46
#   .\scripts\watchdog-health.ps1 -ServerIp 127.0.0.1 -IntervalSec 60 -ExpectedVersion 1.1.65

param(
  [string]$ServerIp = '127.0.0.1',
  [int]$Port = 3000,
  [int]$IntervalSec = 60,
  [string]$ExpectedVersion = '1.1.66',
  [int]$MinSchema = 67,
  [switch]$Once
)

$ErrorActionPreference = 'Continue'
$verify = Join-Path $PSScriptRoot 'verify-server-health.ps1'

function Invoke-WatchCheck {
  & $verify -ServerIp $ServerIp -Port $Port -ExpectedVersion $ExpectedVersion -MinSchema $MinSchema
  return $LASTEXITCODE
}

do {
  $code = Invoke-WatchCheck
  if ($code -ne 0) {
    Write-Host "$(Get-Date -Format o) HEALTH FAIL (exit $code)" -ForegroundColor Red
    # Optional Windows toast / event log hook can be added by ops.
  } else {
    Write-Host "$(Get-Date -Format o) HEALTH OK" -ForegroundColor Green
  }
  if ($Once) { exit $code }
  Start-Sleep -Seconds ([Math]::Max(15, $IntervalSec))
} while ($true)
