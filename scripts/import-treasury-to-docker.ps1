# Import local Electron caixas + bank_accounts into Docker PostgreSQL.
# Run on the SERVER PC after Docker backend is up.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   .\scripts\import-treasury-to-docker.ps1

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

# Read password from database.env if present
$dbEnv = 'C:\NEXOR ERP\database.env'
$url = $env:DATABASE_URL
if (-not $url -and (Test-Path $dbEnv)) {
  Get-Content $dbEnv | ForEach-Object {
    if ($_ -match '^\s*DATABASE_URL\s*=\s*(.+)$') { $url = $Matches[1].Trim().Trim('"') }
  }
}
if (-not $url) {
  # Default docker-compose postgres
  $url = 'postgres://postgres:postgres@127.0.0.1:5432/kwanza_erp'
  Write-Host "Using default DATABASE_URL (override with `$env:DATABASE_URL if needed)" -ForegroundColor Yellow
}

Push-Location $ProjectRoot
try {
  # Mounted as ./import:/import:ro in docker-compose.yml
  $importDir = Join-Path $ProjectRoot 'import'
  New-Item -ItemType Directory -Force -Path $importDir | Out-Null
  $hostCopy = Join-Path $importDir 'erp.db'
  Write-Host 'Copying SQLite into .\import\erp.db for container...' -ForegroundColor Yellow
  Copy-Item -Force $SqlitePath $hostCopy

  # DATABASE_URL inside container points at kwanza-postgres service
  Write-Host 'Importing caixas + bank_accounts...' -ForegroundColor Yellow
  docker exec `
    -e 'SQLITE_PATH=/import/erp.db' `
    nexor-backend `
    node scripts/import-treasury-from-sqlite.js
  if ($LASTEXITCODE -ne 0) { throw "import failed ($LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Counts in Postgres:' -ForegroundColor Cyan
  docker exec nexor-backend node -e "const db=require('./src/db');(async()=>{const c=await db.query('select count(*)::int n from caixas');const b=await db.query('select count(*)::int n from bank_accounts');console.log('caixas',c.rows[0].n,'banks',b.rows[0].n);process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})"

  Write-Host ''
  Write-Host 'OK — open Expenses again (or press F5). Banks and all caixas should appear.' -ForegroundColor Green
} finally {
  Pop-Location
}
