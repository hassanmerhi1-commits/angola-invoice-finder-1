# NEXOR ERP — apply PostgreSQL schema migrations (incl. proformas table 025)
# Run on the SERVER PC in PowerShell (as Administrator if Docker needs it).

$ErrorActionPreference = 'Stop'

function Find-BackendDir {
    $here = Split-Path -Parent $PSScriptRoot
    $repoBackend = Join-Path $here 'backend'
    if (Test-Path (Join-Path $repoBackend 'package.json')) {
        return (Resolve-Path $repoBackend).Path
    }
    $installBackend = 'C:\NEXOR ERP\resources\backend'
    if (Test-Path (Join-Path $installBackend 'package.json')) {
        return (Resolve-Path $installBackend).Path
    }
    throw "Backend folder not found. Clone the repo or install NEXOR ERP, then run again."
}

function Load-DatabaseEnv {
    param([string]$InstallDir = 'C:\NEXOR ERP')
    $envFile = Join-Path $InstallDir 'database.env'
    if (-not (Test-Path $envFile)) {
        Write-Host "[migrate] No database.env at $envFile" -ForegroundColor Yellow
        Write-Host "[migrate] Copy database.env.example to C:\NEXOR ERP\database.env and set DATABASE_URL."
        return
    }
    Write-Host "[migrate] Loading $envFile"
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -le 0) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
        if ([string]::IsNullOrWhiteSpace($key)) { return }
        # Server database.env always wins for DATABASE_URL / DB_ENGINE
        if ($key -in @('DATABASE_URL', 'DB_ENGINE', 'POSTGRES_PASSWORD')) {
            Set-Item -Path "Env:$key" -Value $val
        } elseif (-not (Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue)) {
            Set-Item -Path "Env:$key" -Value $val
        }
    }
}

Write-Host '=== NEXOR ERP database migrate ===' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed or not in PATH. Install Node 20 LTS from https://nodejs.org/"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is not in PATH. Reinstall Node.js (includes npm)."
}

$backendDir = Find-BackendDir
Write-Host "[migrate] Backend: $backendDir"

Load-DatabaseEnv

# Optional: ensure Docker Postgres is up (ignore error if docker missing)
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $running = docker ps --filter 'name=kwanza-postgres' --format '{{.Names}}' 2>$null
    if (-not $running) {
        Write-Host '[migrate] Starting kwanza-postgres (docker compose)...' -ForegroundColor Yellow
        $composeRoot = Split-Path -Parent $backendDir
        if (Test-Path (Join-Path $composeRoot 'docker-compose.yml')) {
            Push-Location $composeRoot
            docker compose up -d postgres
            Pop-Location
            Start-Sleep -Seconds 3
        }
    } else {
        Write-Host "[migrate] Docker container running: $running"
    }
}

if (-not $env:DATABASE_URL) {
    throw @"
DATABASE_URL is not set.
Create C:\NEXOR ERP\database.env (copy from database.env.example) with:
  DB_ENGINE=postgres
  DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/kwanza_erp
"@
}

Push-Location $backendDir
if (-not (Test-Path 'node_modules')) {
    Write-Host '[migrate] Installing dependencies (first time)...' -ForegroundColor Yellow
    npm install
}
npm run migrate
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
    Write-Host ''
    Write-Host 'Migrate FAILED. Common fixes:' -ForegroundColor Red
    Write-Host '  1. C:\NEXOR ERP\database.env has correct DATABASE_URL and password'
    Write-Host '  2. Docker: docker compose up -d postgres'
    Write-Host '  3. cd backend && npm install'
    exit $code
}

Write-Host ''
Write-Host 'Migrate OK. Restart NEXOR ERP on the server.' -ForegroundColor Green
