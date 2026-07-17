# Import local Electron caixas + bank_accounts into Docker PostgreSQL.
# Tries several erp.db locations until one has treasury data.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   .\scripts\import-treasury-to-docker.ps1
#   .\scripts\import-treasury-to-docker.ps1 -SqlitePath "D:\backup\erp.db"

param(
  [string]$SqlitePath = '',
  [string]$ProjectRoot = ''
)

$ErrorActionPreference = 'Stop'

function Get-CandidateErpDbs {
  $candidates = [System.Collections.Generic.List[string]]::new()
  $roots = @(
    'C:\nexor\erp.db',
    'C:\NEXOR ERP\data\erp.db',
    (Join-Path $env:APPDATA 'nexor-erp\erp.db'),
    (Join-Path $env:LOCALAPPDATA 'nexor-erp\erp.db')
  )
  foreach ($p in $roots) {
    if ($p -and (Test-Path $p)) { $candidates.Add((Resolve-Path $p).Path) }
  }
  foreach ($dir in @('C:\NEXOR ERP\data', 'C:\nexor', (Join-Path $env:APPDATA 'nexor-erp'))) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Filter '*.db' -File -EA SilentlyContinue | ForEach-Object {
      $candidates.Add($_.FullName)
    }
  }
  return $candidates | Select-Object -Unique | Sort-Object {
    if (Test-Path $_) { (Get-Item $_).Length } else { 0 }
  } -Descending
}

function Test-SqliteHasTreasury {
  param([string]$ContainerPath)
  $js = @'
const Database=require("better-sqlite3");
const db=new Database(process.env.SQLITE_PATH,{readonly:true,fileMustExist:true});
const t=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const hasN=t("nexor_records"), hasC=t("caixas"), hasB=t("bank_accounts");
let nC=0,nB=0;
if(hasN){nC=db.prepare("SELECT COUNT(*) n FROM nexor_records WHERE table_name='caixas'").get().n;nB=db.prepare("SELECT COUNT(*) n FROM nexor_records WHERE table_name='bank_accounts'").get().n;}
if(hasC){nC+=db.prepare("SELECT COUNT(*) n FROM caixas").get().n;}
if(hasB){nB+=db.prepare("SELECT COUNT(*) n FROM bank_accounts").get().n;}
console.log(JSON.stringify({hasNexor:hasN,hasCaixas:hasC,hasBanks:hasB,caixaCount:nC,bankCount:nB,tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name)}));
db.close();
'@
  $probeFile = '/tmp/probe-treasury.js'
  $js | docker exec -i nexor-backend sh -c "cat > $probeFile"
  $out = docker exec -e "SQLITE_PATH=$ContainerPath" nexor-backend node $probeFile 2>&1
  if ($LASTEXITCODE -ne 0) { return $null }
  try { return ($out | Out-String).Trim() | ConvertFrom-Json } catch { return $null }
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

$running = docker ps --filter "name=nexor-backend" --format "{{.Names}}" 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend is not running. Start: docker compose up -d backend' -ForegroundColor Red
  exit 1
}

$toTry = @()
if ($SqlitePath) {
  if (-not (Test-Path $SqlitePath)) {
    Write-Host "[ERROR] Not found: $SqlitePath" -ForegroundColor Red
    exit 1
  }
  $toTry = @((Resolve-Path $SqlitePath).Path)
} else {
  $toTry = @(Get-CandidateErpDbs)
}

if (-not $toTry.Count) {
  Write-Host '[ERROR] No erp.db candidates found.' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host "Candidates:" -ForegroundColor Cyan
foreach ($p in $toTry) {
  $mb = [math]::Round((Get-Item $p).Length / 1MB, 2)
  Write-Host ("  {0,6} MB  {1}" -f $mb, $p)
}

Push-Location $ProjectRoot
$selected = $null
$selectedInfo = $null
try {
  foreach ($candidate in $toTry) {
    Write-Host ""
    Write-Host "Probing: $candidate" -ForegroundColor Yellow
    $tempDb = Join-Path $env:TEMP ("nexor-import-" + [guid]::NewGuid().ToString('n') + '.db')
    try {
      Copy-Item -Force $candidate $tempDb
    } catch {
      Write-Host "  skip — locked/copy failed (close NEXOR and retry): $($_.Exception.Message)" -ForegroundColor DarkYellow
      continue
    }
    $containerSqlite = '/tmp/import-erp.db'
    docker cp $tempDb "nexor-backend:$containerSqlite" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -Force $tempDb -EA SilentlyContinue
      Write-Host '  skip — docker cp failed' -ForegroundColor DarkYellow
      continue
    }
    $info = Test-SqliteHasTreasury -ContainerPath $containerSqlite
    Remove-Item -Force $tempDb -EA SilentlyContinue
    if (-not $info) {
      Write-Host '  skip — cannot read SQLite' -ForegroundColor DarkYellow
      continue
    }
    Write-Host ("  tables: nexor={0} caixas={1} banks={2} | rows caixas={3} banks={4}" -f `
      $info.hasNexor, $info.hasCaixas, $info.hasBanks, $info.caixaCount, $info.bankCount)
    if ($info.hasNexor -or $info.hasCaixas -or $info.hasBanks) {
      $selected = $candidate
      $selectedInfo = $info
      # Prefer a file that actually has rows
      if (($info.caixaCount + $info.bankCount) -gt 0) { break }
    }
  }

  if (-not $selected) {
    Write-Host ''
    Write-Host '[ERROR] None of the erp.db files have treasury tables/data.' -ForegroundColor Red
    Write-Host 'Your caixas/banks may only exist in Postgres COA already, or were never saved locally.' -ForegroundColor Yellow
    Write-Host 'Next:' -ForegroundColor Yellow
    Write-Host '  1) Open NEXOR → Contas Bancárias → create bank accounts again'
    Write-Host '  2) Open New expense (v1.1.35+) — caixas sync from COA 45x accounts'
    Write-Host '  3) If you have a backup .db from before Docker, pass it:'
    Write-Host '     .\scripts\import-treasury-to-docker.ps1 -SqlitePath "D:\backup\erp.db"'
    exit 1
  }

  Write-Host ''
  Write-Host "Using: $selected" -ForegroundColor Green
  $tempDb = Join-Path $env:TEMP ("nexor-import-" + [guid]::NewGuid().ToString('n') + '.db')
  Copy-Item -Force $selected $tempDb
  docker cp $tempDb 'nexor-backend:/tmp/import-erp.db' | Out-Null
  Remove-Item -Force $tempDb -EA SilentlyContinue

  Write-Host 'Importing caixas + bank_accounts...' -ForegroundColor Yellow
  docker exec -e 'SQLITE_PATH=/tmp/import-erp.db' nexor-backend node scripts/import-treasury-from-sqlite.js
  if ($LASTEXITCODE -ne 0) { throw "import failed ($LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Counts in Postgres:' -ForegroundColor Cyan
  docker exec nexor-backend node -e "const db=require('./src/db');(async()=>{const c=await db.query('select count(*)::int n from caixas');const b=await db.query('select count(*)::int n from bank_accounts');console.log('caixas',c.rows[0].n,'banks',b.rows[0].n);process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})"

  Write-Host ''
  Write-Host 'OK — F5 in NEXOR, open New expense again.' -ForegroundColor Green
} finally {
  Pop-Location
}
