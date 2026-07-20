# Build browser UI and refresh Docker so http://SERVER:3000/app works.
# Run on the NEXOR SERVER PC from the git repo root (or this scripts folder).
# ASCII-only for Windows PowerShell.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   .\scripts\fix-webapp-on-server.ps1

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
Write-Host "Repo: $root"

if (-not (Test-Path (Join-Path $root 'package.json'))) {
  throw "package.json not found in $root"
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host "Installing npm dependencies (first time, may take a few minutes)..."
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

Write-Host "Building web UI (npm run build:webapp)..."
npm run build:webapp
if ($LASTEXITCODE -ne 0) { throw 'npm run build:webapp failed' }

$dist = Join-Path $root 'dist'
$webapp = Join-Path $root 'backend\webapp'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
  throw "Build missing: $dist\index.html"
}

New-Item -ItemType Directory -Force -Path $webapp | Out-Null
$assetsDir = Join-Path $webapp 'assets'
if (Test-Path -LiteralPath $assetsDir) {
  Remove-Item -LiteralPath $assetsDir -Recurse -Force
}
Copy-Item -Path (Join-Path $dist '*') -Destination $webapp -Recurse -Force

$jsFiles = @(Get-ChildItem -Path (Join-Path $webapp 'assets') -Filter 'index-*.js' -ErrorAction SilentlyContinue)
if ($jsFiles.Count -lt 1) {
  throw "No index-*.js under $webapp\assets after copy"
}
Write-Host ("Copied webapp: {0} ({1:N1} MB)" -f $jsFiles[0].Name, ($jsFiles[0].Length / 1MB))

# Ensure compose mounts ./backend/webapp (needed after pull of blank-page fix).
$compose = Join-Path $root 'docker-compose.yml'
if (Test-Path -LiteralPath $compose) {
  $composeText = Get-Content -LiteralPath $compose -Raw
  if ($composeText -notmatch 'backend/webapp:/app/webapp') {
    Write-Host "WARNING: docker-compose.yml does not mount backend/webapp. Pull latest main first." -ForegroundColor Yellow
  }
}

Write-Host "Restarting nexor-backend so it serves the new files..."
docker compose up -d backend
if ($LASTEXITCODE -ne 0) {
  Write-Host "docker compose up failed — try: docker compose up -d --build backend" -ForegroundColor Yellow
} else {
  Start-Sleep -Seconds 3
}

try {
  $html = (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/app/' -UseBasicParsing -TimeoutSec 15).Content
  if ($html -match '/app/assets/([^"]+\.js)') {
    $name = $Matches[1]
    $js = Invoke-WebRequest -Uri ("http://127.0.0.1:3000/app/assets/$name") -UseBasicParsing -TimeoutSec 30
    if ($js.RawContentLength -gt 50000 -and $js.Content -notmatch '<!doctype html>') {
      Write-Host ("OK: /app asset {0} ({1:N0} bytes)" -f $name, $js.RawContentLength) -ForegroundColor Green
    } else {
      Write-Host "FAIL: asset still wrong. Check docker volume mount for backend/webapp." -ForegroundColor Red
    }
  } else {
    Write-Host "WARN: could not find asset name in /app HTML" -ForegroundColor Yellow
  }
} catch {
  Write-Host "Could not probe local /app: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Open in browser: http://<server-ip>:3000/app  (Ctrl+F5)"
Write-Host "Example: http://100.104.240.46:3000/app"
