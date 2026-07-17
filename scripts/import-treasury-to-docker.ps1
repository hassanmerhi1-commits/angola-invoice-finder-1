# Import local Electron caixas + bank_accounts into Docker PostgreSQL.
# Run on the SERVER PC after Docker backend is up.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   .\scripts\import-treasury-to-docker.ps1
#
# If NEXOR has the .db locked, close NEXOR first, or pass another copy:
#   .\scripts\import-treasury-to-docker.ps1 -SqlitePath "C:\NEXOR ERP\data\erp.db"

param(
  [string]$SqlitePath = '',
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'

function Find-LargestErpDb {
  $candidates = @(
    'C:\nexor\erp.db',
    'C:\NEXOR ERP\data\erp.db'
  )
  $dataDir = 'C:\NEXOR ERP\data'
  if (Test-Path $dataDir) {
    $candidates += Get-ChildItem -Path $dataDir -Filter '*.db' -File -EA SilentlyContinue | ForEach-Object { $_.FullName }
  }
  $appData = Join-Path $env:APPDATA 'nexor-erp\erp.db'
  if (Test-Path $appData) { $candidates += $appData }

  $best = $null
  $bestSize = -1
  foreach ($p in $candidates | Select-Object -Unique) {
    if (-not (Test-Path $p)) { continue }
    $size = (Get-Item $p).Length
    if ($size -gt $bestSize) {
      $best = $p
      $bestSize = $size
    }
  }
  return $best
}

if (-not $ProjectRoot) {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $repo = Split-Path -Parent $here
  if (Test-Path (Join-Path $repo 'docker-compose.yml')) {
    $ProjectRoot = $repo
  } else {
    $ProjectRoot = (Get-Location).Path
  }
}

if (-not $SqlitePath) {
  $SqlitePath = Find-LargestErpDb
}
if (-not $SqlitePath -or -not (Test-Path $SqlitePath)) {
  Write-Host '[ERROR] No erp.db found. Pass -SqlitePath C:\path\to\erp.db' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host "SQLite:  $SqlitePath ($([math]::Round((Get-Item $SqlitePath).Length/1MB,1)) MB)" -ForegroundColor Cyan

# Ensure container is running
$running = docker ps --filter "name=nexor-backend" --format "{{.Names}}" 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend container is not running. Start it first:' -ForegroundColor Red
  Write-Host '  docker compose up -d backend'
  exit 1
}

Push-Location $ProjectRoot
try {
  # Copy to a local temp file first (avoids lock if NEXOR has erp.db open)
  $tempDb = Join-Path $env:TEMP ("nexor-import-" + [guid]::NewGuid().ToString('n') + '.db')
  Write-Host "Copying SQLite to temp (unlock-safe): $tempDb" -ForegroundColor Yellow
  try {
    Copy-Item -Force $SqlitePath $tempDb
  } catch {
    Write-Host '[ERROR] Could not copy erp.db — close NEXOR ERP completely, then retry.' -ForegroundColor Red
    throw
  }

  # IMPORTANT: do NOT use ./import:/import:ro — better-sqlite3 fails on read-only mounts.
  # docker cp into /tmp inside the container (writable).
  $containerSqlite = '/tmp/import-erp.db'
  Write-Host "docker cp → nexor-backend:$containerSqlite" -ForegroundColor Yellow
  docker cp $tempDb "nexor-backend:$containerSqlite"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed ($LASTEXITCODE)" }

  Write-Host 'Importing caixas + bank_accounts...' -ForegroundColor Yellow
  docker exec `
    -e "SQLITE_PATH=$containerSqlite" `
    nexor-backend `
    node scripts/import-treasury-from-sqlite.js
  if ($LASTEXITCODE -ne 0) { throw "import failed ($LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Counts in Postgres:' -ForegroundColor Cyan
  docker exec nexor-backend node -e "const db=require('./src/db');(async()=>{const c=await db.query('select count(*)::int n from caixas');const b=await db.query('select count(*)::int n from bank_accounts');console.log('caixas',c.rows[0].n,'banks',b.rows[0].n);process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})"

  Write-Host ''
  Write-Host 'OK — open Expenses again (or press F5). Banks and all caixas should appear.' -ForegroundColor Green
} finally {
  if ($tempDb -and (Test-Path $tempDb)) {
    Remove-Item -Force $tempDb -EA SilentlyContinue
  }
  Pop-Location
}
