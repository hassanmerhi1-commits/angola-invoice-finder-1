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
  $candidates = New-Object System.Collections.Generic.List[string]
  $roots = @(
    'C:\nexor\erp.db',
    'C:\NEXOR ERP\data\erp.db',
    (Join-Path $env:APPDATA 'nexor-erp\erp.db'),
    (Join-Path $env:LOCALAPPDATA 'nexor-erp\erp.db')
  )
  foreach ($p in $roots) {
    if ($p -and (Test-Path -LiteralPath $p)) {
      $candidates.Add((Resolve-Path -LiteralPath $p).Path)
    }
  }
  foreach ($dir in @('C:\NEXOR ERP\data', 'C:\nexor', (Join-Path $env:APPDATA 'nexor-erp'))) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Get-ChildItem -Path $dir -Filter '*.db' -File -ErrorAction SilentlyContinue | ForEach-Object {
      $candidates.Add($_.FullName)
    }
  }
  return @($candidates | Select-Object -Unique | Sort-Object {
    if (Test-Path -LiteralPath $_) { (Get-Item -LiteralPath $_).Length } else { 0 }
  } -Descending)
}

function Test-SqliteHasTreasury {
  param([string]$ContainerPath)

  $probeLocal = Join-Path $env:TEMP ('probe-treasury-' + [guid]::NewGuid().ToString('n') + '.js')
  @(
    'const Database=require("better-sqlite3");'
    'const db=new Database(process.env.SQLITE_PATH,{readonly:true,fileMustExist:true});'
    'const t=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type=''table'' AND name=?").get(name);'
    'const hasN=t("nexor_records"), hasC=t("caixas"), hasB=t("bank_accounts");'
    'let nC=0,nB=0;'
    'if(hasN){nC=db.prepare("SELECT COUNT(*) n FROM nexor_records WHERE table_name=''caixas''").get().n;nB=db.prepare("SELECT COUNT(*) n FROM nexor_records WHERE table_name=''bank_accounts''").get().n;}'
    'if(hasC){nC+=db.prepare("SELECT COUNT(*) n FROM caixas").get().n;}'
    'if(hasB){nB+=db.prepare("SELECT COUNT(*) n FROM bank_accounts").get().n;}'
    'console.log(JSON.stringify({hasNexor:hasN,hasCaixas:hasC,hasBanks:hasB,caixaCount:nC,bankCount:nB}));'
    'db.close();'
  ) | Set-Content -Path $probeLocal -Encoding ASCII

  docker cp $probeLocal 'nexor-backend:/tmp/probe-treasury.js' | Out-Null
  Remove-Item -Force $probeLocal -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { return $null }

  $out = docker exec -e "SQLITE_PATH=$ContainerPath" nexor-backend node /tmp/probe-treasury.js 2>&1
  if ($LASTEXITCODE -ne 0) { return $null }
  try {
    $text = ($out | Out-String).Trim()
    return ($text | ConvertFrom-Json)
  } catch {
    return $null
  }
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

$running = docker ps --filter 'name=nexor-backend' --format '{{.Names}}' 2>$null
if ($running -notmatch 'nexor-backend') {
  Write-Host '[ERROR] nexor-backend is not running. Start: docker compose up -d backend' -ForegroundColor Red
  exit 1
}

if ($SqlitePath) {
  if (-not (Test-Path -LiteralPath $SqlitePath)) {
    Write-Host "[ERROR] Not found: $SqlitePath" -ForegroundColor Red
    exit 1
  }
  $toTry = @((Resolve-Path -LiteralPath $SqlitePath).Path)
} else {
  $toTry = @(Get-CandidateErpDbs)
}

if (-not $toTry -or $toTry.Count -eq 0) {
  Write-Host '[ERROR] No erp.db candidates found.' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host 'Candidates:' -ForegroundColor Cyan
foreach ($p in $toTry) {
  $mb = [math]::Round((Get-Item -LiteralPath $p).Length / 1MB, 2)
  Write-Host ("  {0,6} MB  {1}" -f $mb, $p)
}

Push-Location $ProjectRoot
$selected = $null
try {
  foreach ($candidate in $toTry) {
    Write-Host ''
    Write-Host "Probing: $candidate" -ForegroundColor Yellow
    $tempDb = Join-Path $env:TEMP ('nexor-import-' + [guid]::NewGuid().ToString('n') + '.db')
    try {
      Copy-Item -Force -LiteralPath $candidate -Destination $tempDb
    } catch {
      Write-Host ("  skip - locked/copy failed (close NEXOR and retry): {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
      continue
    }

    docker cp $tempDb 'nexor-backend:/tmp/import-erp.db' | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -Force $tempDb -ErrorAction SilentlyContinue
      Write-Host '  skip - docker cp failed' -ForegroundColor DarkYellow
      continue
    }

    $info = Test-SqliteHasTreasury -ContainerPath '/tmp/import-erp.db'
    Remove-Item -Force $tempDb -ErrorAction SilentlyContinue
    if (-not $info) {
      Write-Host '  skip - cannot read SQLite' -ForegroundColor DarkYellow
      continue
    }

    Write-Host ("  tables: nexor={0} caixas={1} banks={2} | rows caixas={3} banks={4}" -f `
      $info.hasNexor, $info.hasCaixas, $info.hasBanks, $info.caixaCount, $info.bankCount)

    if ($info.hasNexor -or $info.hasCaixas -or $info.hasBanks) {
      $selected = $candidate
      if ((([int]$info.caixaCount) + ([int]$info.bankCount)) -gt 0) { break }
    }
  }

  if (-not $selected) {
    Write-Host ''
    Write-Host '[ERROR] None of the erp.db files have treasury tables/data.' -ForegroundColor Red
    Write-Host 'Your caixas/banks may only exist in Postgres COA already, or were never saved locally.' -ForegroundColor Yellow
    Write-Host 'Next:' -ForegroundColor Yellow
    Write-Host '  1) Open NEXOR -> Contas Bancarias -> create bank accounts again'
    Write-Host '  2) Open New expense (v1.1.35+) - caixas sync from COA 45x accounts'
    Write-Host '  3) If you have a backup .db from before Docker, pass it:'
    Write-Host '     .\scripts\import-treasury-to-docker.ps1 -SqlitePath "D:\backup\erp.db"'
    exit 1
  }

  Write-Host ''
  Write-Host "Using: $selected" -ForegroundColor Green
  $tempDb = Join-Path $env:TEMP ('nexor-import-' + [guid]::NewGuid().ToString('n') + '.db')
  Copy-Item -Force -LiteralPath $selected -Destination $tempDb
  docker cp $tempDb 'nexor-backend:/tmp/import-erp.db' | Out-Null
  Remove-Item -Force $tempDb -ErrorAction SilentlyContinue

  Write-Host 'Importing caixas + bank_accounts...' -ForegroundColor Yellow
  docker exec -e 'SQLITE_PATH=/tmp/import-erp.db' nexor-backend node scripts/import-treasury-from-sqlite.js
  if ($LASTEXITCODE -ne 0) { throw "import failed ($LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Counts in Postgres:' -ForegroundColor Cyan
  docker exec nexor-backend node -e "const db=require('./src/db');(async()=>{const c=await db.query('select count(*)::int n from caixas');const b=await db.query('select count(*)::int n from bank_accounts');console.log('caixas',c.rows[0].n,'banks',b.rows[0].n);process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})"

  Write-Host ''
  Write-Host 'OK - F5 in NEXOR, open New expense again.' -ForegroundColor Green
} finally {
  Pop-Location
}
