# Repair expense treasury ON DOCKER POSTGRES (no local erp.db).
#
# Usage (SERVER PC):
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   git pull origin main
#   .\scripts\repair-docker-treasury.ps1

$ErrorActionPreference = 'Continue'

$running = docker ps --filter 'name=nexor-backend' --format '{{.Names}}' 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend not running. Start: docker compose up -d backend' -ForegroundColor Red
  exit 1
}

Write-Host 'Running repair against Docker Postgres (cwd /app)...' -ForegroundColor Cyan
# backend/scripts is mounted into the container at /app/scripts
docker exec -w /app nexor-backend node scripts/repair-docker-treasury.js
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host '[ERROR] repair failed' -ForegroundColor Red
  exit $code
}

Write-Host ''
Write-Host 'If banks=0: open NEXOR -> Contas Bancarias -> create each bank (saves into Docker).' -ForegroundColor Yellow
Write-Host 'Then F5 and open New expense.' -ForegroundColor Yellow
