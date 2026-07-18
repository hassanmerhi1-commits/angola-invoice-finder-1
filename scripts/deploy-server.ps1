# Deploy NEXOR backend from the CORRECT GitHub repo (angola-invoice-finder-1).
# Run this on the SERVER PC only.
#
# Usage:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder   # or any clone
#   .\scripts\deploy-server.ps1
#   .\scripts\deploy-server.ps1 -ExpectedVersion 1.1.43
#
# This script refuses the old repo angola-invoice-finder (no -1) and retargets origin.

param(
  [string]$ExpectedVersion = '',
  [string]$RepoUrl = 'https://github.com/hassanmerhi1-commits/angola-invoice-finder-1.git',
  [switch]$SkipDocker
)

$ErrorActionPreference = 'Stop'

function Get-PackageVersion([string]$root) {
  $pkg = Join-Path $root 'package.json'
  if (-not (Test-Path -LiteralPath $pkg)) { return '' }
  try {
    return [string](Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version
  } catch {
    return ''
  }
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
Write-Host "Deploy root: $root"

if (-not (Test-Path (Join-Path $root '.git'))) {
  throw "Not a git repo: $root — clone $RepoUrl first."
}

$origin = (git remote get-url origin 2>$null)
Write-Host "Current origin: $origin"

$correct = $RepoUrl.TrimEnd('.git') -replace '/$', ''
$current = ([string]$origin).TrimEnd('.git') -replace '/$', ''
if ($current -notmatch 'angola-invoice-finder-1$') {
  Write-Host "WRONG REPO detected. Retargeting origin → angola-invoice-finder-1" -ForegroundColor Yellow
  git remote set-url origin $RepoUrl
  $origin = git remote get-url origin
  Write-Host "New origin: $origin"
}

Write-Host "Fetching origin/main..."
git fetch origin
git checkout main
git reset --hard origin/main

$pkgVer = Get-PackageVersion $root
Write-Host "package.json version: $pkgVer"

$composePath = Join-Path $root 'docker-compose.yml'
if (Test-Path -LiteralPath $composePath) {
  $compose = Get-Content -LiteralPath $composePath -Raw
  if ($pkgVer -and $compose -match 'NEXOR_APP_VERSION:\s*[^\r\n]+') {
    $updated = [regex]::Replace($compose, 'NEXOR_APP_VERSION:\s*[^\r\n]+', "NEXOR_APP_VERSION: $pkgVer")
    if ($updated -ne $compose) {
      Set-Content -LiteralPath $composePath -Value $updated -NoNewline
      Write-Host "Synced docker-compose NEXOR_APP_VERSION → $pkgVer"
    }
  }
}

if ($ExpectedVersion -and $pkgVer -and $pkgVer -ne $ExpectedVersion) {
  throw "Expected version $ExpectedVersion but package.json is $pkgVer after pull."
}

if (-not $SkipDocker) {
  Write-Host "Rebuilding backend container..."
  docker compose up -d --build backend
  Start-Sleep -Seconds 4
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 15
    Write-Host ("Health appVersion={0} backendPackageVersion={1} schema={2}" -f `
      $health.appVersion, $health.backendPackageVersion, $health.schemaVersion)
    if ($pkgVer -and $health.appVersion -ne $pkgVer -and $health.shellVersion -ne $pkgVer) {
      Write-Host "WARNING: health version does not match $pkgVer — something else may still own port 3000." -ForegroundColor Yellow
      Write-Host "Check: docker compose ps ; Get-NetTCPConnection -LocalPort 3000"
    } else {
      Write-Host "Deploy looks good." -ForegroundColor Green
    }
  } catch {
    Write-Host "Could not read local health yet: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Open http://<server-ip>:3000/api/health in a browser."
  }
}

Write-Host "Done. Always use this script (or repo angola-invoice-finder-1) for server deploys."
