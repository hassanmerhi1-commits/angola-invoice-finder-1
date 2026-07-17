# Repair expense treasury ON DOCKER POSTGRES.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   git pull origin main
#   .\scripts\repair-docker-treasury.ps1
#
# Or paste this one-liner (same thing):
#   docker exec -w /app nexor-backend node scripts/repair-docker-treasury.js

$ErrorActionPreference = 'Continue'

$running = docker ps --filter 'name=nexor-backend' --format '{{.Names}}' 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend not running. Start: docker compose up -d backend' -ForegroundColor Red
  exit 1
}

Write-Host 'Checking script inside container...' -ForegroundColor Cyan
docker exec -w /app nexor-backend sh -c "ls -la scripts/repair-docker-treasury.js && head -n 5 scripts/repair-docker-treasury.js"
if ($LASTEXITCODE -ne 0) {
  Write-Host '[ERROR] scripts/repair-docker-treasury.js missing in container.' -ForegroundColor Red
  Write-Host 'Run: git pull origin main' -ForegroundColor Yellow
  Write-Host 'Then: docker compose up -d backend' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Running: docker exec -w /app nexor-backend node scripts/repair-docker-treasury.js' -ForegroundColor Cyan
docker exec -w /app nexor-backend node scripts/repair-docker-treasury.js
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host '[ERROR] repair failed' -ForegroundColor Red
  exit $code
}

Write-Host ''
Write-Host 'If banks=0: open NEXOR -> Contas Bancarias -> create banks, then F5.' -ForegroundColor Yellow
