# Update the Docker nexor-backend container to current repo code + schema.
# Run on the SERVER PC where "docker ps" shows kwanza-postgres and nexor-backend.
#
# Usage:
#   cd C:\path\to\angola-invoice-finder-1
#   .\scripts\fix-docker-backend.ps1
#
# Or auto-find compose folder:
#   .\scripts\fix-docker-backend.ps1 -AutoFind

param(
  [string]$ProjectRoot = '',
  [switch]$AutoFind,
  [switch]$SkipPull
)

$ErrorActionPreference = 'Stop'

function Find-ComposeRoot {
  if ($ProjectRoot -and (Test-Path (Join-Path $ProjectRoot 'docker-compose.yml'))) {
    return (Resolve-Path $ProjectRoot).Path
  }
  $repoRoot = Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $repoRoot 'docker-compose.yml')) {
    return $repoRoot
  }
  $searchRoots = @('C:\', 'D:\', $env:USERPROFILE)
  foreach ($root in $searchRoots) {
    if (-not (Test-Path $root)) { continue }
    try {
      $hit = Get-ChildItem -Path $root -Filter 'docker-compose.yml' -Recurse -Depth 4 -EA SilentlyContinue |
        Where-Object {
          $content = Get-Content -Raw -Path $_.FullName -EA SilentlyContinue
          $content -match 'kwanza-postgres' -and $content -match 'nexor-backend'
        } |
        Select-Object -First 1
      if ($hit) { return $hit.Directory.FullName }
    } catch { }
  }
  return $null
}

if ($AutoFind -or -not $ProjectRoot) {
  $ProjectRoot = Find-ComposeRoot
}
if (-not $ProjectRoot) {
  Write-Host '[ERROR] docker-compose.yml not found. Pass -ProjectRoot C:\path\to\angola-invoice-finder-1' -ForegroundColor Red
  exit 1
}

Write-Host "Project: $ProjectRoot" -ForegroundColor Cyan

if (-not (Get-Command docker -EA SilentlyContinue)) {
  Write-Host '[ERROR] Docker not in PATH. Start Docker Desktop first.' -ForegroundColor Red
  exit 1
}

Push-Location $ProjectRoot
try {
  if (-not $SkipPull -and (Test-Path (Join-Path $ProjectRoot '.git'))) {
    Write-Host 'git pull...' -ForegroundColor Yellow
    git pull origin main
  }

  Write-Host 'Rebuilding and restarting nexor-backend...' -ForegroundColor Yellow
  docker compose up -d --build backend
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed ($LASTEXITCODE)" }

  Start-Sleep -Seconds 5

  Write-Host 'Applying schema inside container...' -ForegroundColor Yellow
  docker exec nexor-backend node scripts/ensure-server-schema.js
  if ($LASTEXITCODE -ne 0) { throw "ensure-server-schema failed ($LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Health:' -ForegroundColor Cyan
  $h = Invoke-RestMethod 'http://localhost:3000/api/health?lite=1' -TimeoutSec 20
  $h | Format-List ok, engine, appVersion, schemaVersion, schemaVersionExpected, schemaUpToDate

  if ([int]$h.schemaVersionExpected -lt 56) {
    Write-Host ''
    Write-Host 'WARN: backend code on disk is still old (expected schema < 56).' -ForegroundColor Yellow
    Write-Host 'Copy the latest repo/USB to this PC, then run this script again.' -ForegroundColor Yellow
    exit 1
  }

  Write-Host ''
  Write-Host 'OK — Docker backend updated. LAN clients: keep IP as hostname:3000, restart NEXOR app.' -ForegroundColor Green
} finally {
  Pop-Location
}
