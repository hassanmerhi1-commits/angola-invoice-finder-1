#Requires -RunAsAdministrator
# Fix Start Menu NEXOR: full backend + fresh UI + updated Electron launcher (app.asar).

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repoRoot 'dist'
$pfRoot = 'C:\Program Files\NEXOR ERP'
$asarPath = Join-Path $pfRoot 'resources\app.asar'
$asarWork = Join-Path $env:TEMP 'nexor-asar-patch'

if (-not (Test-Path $dist)) {
    Write-Host 'Building frontend...' -ForegroundColor Cyan
    Push-Location $repoRoot
    npm run build
    Pop-Location
}

function Copy-Webapp($destWebapp) {
    if (-not $destWebapp) { return $false }
    New-Item -ItemType Directory -Force -Path $destWebapp | Out-Null
    robocopy $dist $destWebapp /E /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -gt 7) { return $false }
    $version = @{ builtAt = (Get-Date).ToUniversalTime().ToString('o'); appVersion = '1.0.47' } | ConvertTo-Json
    Set-Content -Path (Join-Path $destWebapp 'version.json') -Value $version -Encoding UTF8
    return $true
}

Write-Host 'Stopping NEXOR / dev processes...' -ForegroundColor Yellow
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'server\.js|backend\\src|vite|electron' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# Backend (src + scripts + node_modules)
& (Join-Path $PSScriptRoot 'sync-nexor-backend.ps1')

# UI bundles served by Express /app
foreach ($web in @(
    (Join-Path $repoRoot 'backend\webapp'),
    'C:\NEXOR ERP\backend\webapp',
    (Join-Path $pfRoot 'resources\backend\webapp')
)) {
    if (Copy-Webapp $web) {
        Write-Host "Webapp deployed: $web" -ForegroundColor Green
    }
}

# Patch app.asar launcher (backend path resolution + dev fixes)
if (-not (Test-Path $asarPath)) {
    throw "Installed app not found: $asarPath"
}

if (Test-Path $asarWork) { Remove-Item -Recurse -Force $asarWork }
New-Item -ItemType Directory -Force -Path $asarWork | Out-Null
Push-Location $repoRoot
npx --yes asar extract $asarPath $asarWork
Pop-Location

# Copy the full electron/ folder — main.cjs depends on httpBinary.cjs, httpJson.cjs, etc.
$electronSrc = Join-Path $repoRoot 'electron'
$electronDest = Join-Path $asarWork 'electron'
New-Item -ItemType Directory -Force -Path $electronDest | Out-Null
Get-ChildItem -Path $electronSrc -File | ForEach-Object {
    Copy-Item -Force $_.FullName (Join-Path $electronDest $_.Name)
}
Write-Host 'Patched full electron/ folder in app.asar' -ForegroundColor Green
$required = @('httpBinary.cjs', 'httpJson.cjs', 'backendManager.cjs', 'main.cjs', 'preload.cjs')
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $electronDest $f))) {
        throw "Missing electron/$f after patch"
    }
}

$asarBackup = "$asarPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Force $asarPath $asarBackup
Push-Location $repoRoot
npx --yes asar pack $asarWork $asarPath
Pop-Location
Write-Host "app.asar updated (backup: $asarBackup)" -ForegroundColor Green

# Hot-update off (empty serverUrl confuses some builds)
$hotPath = 'C:\NEXOR ERP\hot-update-config.json'
Set-Content -Path $hotPath -Value (@{
    enabled = $false
    serverUrl = ''
    autoConnect = $false
} | ConvertTo-Json) -Encoding UTF8

Write-Host ''
Write-Host 'Start Menu patch complete.' -ForegroundColor Green
Write-Host '1. Open NEXOR ERP from Start Menu'
Write-Host '2. Wait 30 seconds on the login screen'
Write-Host '3. Log in: admin / changeme (or your password)'
