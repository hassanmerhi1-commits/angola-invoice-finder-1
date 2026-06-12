# Deploy full PostgreSQL-ready backend from this repo.
# Copies src + scripts + node_modules (required — partial src-only deploy crashes on startup).

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoBackend = Join-Path $repoRoot 'backend'
if (-not (Test-Path (Join-Path $repoBackend 'src\server.js'))) {
    throw "Repo backend not found: $repoBackend"
}

Write-Host 'Stopping NEXOR ERP...' -ForegroundColor Yellow
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'server\.js|backend\\src|backend\\scripts' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

function Sync-FullBackend($destRoot) {
    if (-not $destRoot) { return $false }
    Write-Host "Deploying full backend to: $destRoot" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

    foreach ($folder in @('src', 'scripts')) {
        $from = Join-Path $repoBackend $folder
        $to = Join-Path $destRoot $folder
        if (-not (Test-Path $from)) { continue }
        robocopy $from $to /E /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -gt 7) {
            Write-Host "  $folder copy failed (exit $LASTEXITCODE)" -ForegroundColor Red
            return $false
        }
    }

    foreach ($file in @('package.json', 'package-lock.json')) {
        $from = Join-Path $repoBackend $file
        if (Test-Path $from) {
            Copy-Item -Force $from (Join-Path $destRoot $file)
        }
    }

    $nmRepo = Join-Path $repoBackend 'node_modules'
    $nmInstalled = 'C:\Program Files\NEXOR ERP\resources\backend\node_modules'
    $nmDest = Join-Path $destRoot 'node_modules'
    $lockRepo = Join-Path $repoBackend 'package-lock.json'
    $lockDest = Join-Path $destRoot 'package-lock.json'
    $needsNodeModulesSync = -not (Test-Path $nmDest)
    if (-not $needsNodeModulesSync -and (Test-Path $lockRepo) -and (Test-Path $lockDest)) {
        $repoHash = (Get-FileHash $lockRepo -Algorithm SHA256).Hash
        $destHash = (Get-FileHash $lockDest -Algorithm SHA256).Hash
        if ($repoHash -ne $destHash) {
            $needsNodeModulesSync = $true
            Write-Host '  package-lock.json changed — refreshing node_modules...' -ForegroundColor DarkGray
        }
    }
    if (-not $needsNodeModulesSync -and -not (Test-Path (Join-Path $nmDest 'node-forge'))) {
        $needsNodeModulesSync = $true
        Write-Host '  node_modules missing required packages — refreshing...' -ForegroundColor DarkGray
    }

    if ($needsNodeModulesSync) {
        $nmSource = $null
        if (Test-Path $nmRepo) { $nmSource = $nmRepo }
        elseif (Test-Path $nmInstalled) { $nmSource = $nmInstalled }
        if (-not $nmSource) {
            Write-Host '  WARN: run "cd backend && npm install" in the repo first.' -ForegroundColor Yellow
            return $false
        }
        Write-Host "  Copying node_modules from $nmSource (may take a minute)..." -ForegroundColor DarkGray
        robocopy $nmSource $nmDest /E /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -gt 7) {
            Write-Host '  node_modules copy failed' -ForegroundColor Red
            return $false
        }
    }

    $checks = @(
        (Join-Path $destRoot 'src\lib\sqlDialect.js'),
        (Join-Path $destRoot 'src\lib\loginUserLookup.js'),
        (Join-Path $destRoot 'scripts\lib\integrityRunner.js'),
        (Join-Path $destRoot 'node_modules\dotenv'),
        (Join-Path $destRoot 'node_modules\node-forge')
    )
    foreach ($c in $checks) {
        if (-not (Test-Path $c)) {
            Write-Host "  VERIFY FAILED: missing $c" -ForegroundColor Red
            return $false
        }
    }
    $lookupFile = Join-Path $destRoot 'src\lib\loginUserLookup.js'
    $lookupOk = Select-String -Path $lookupFile -Pattern 'activeUserWhere' -Quiet
    if (-not $lookupOk) {
        Write-Host '  VERIFY FAILED: loginUserLookup.js still old' -ForegroundColor Red
        return $false
    }

    Write-Host '  OK (PostgreSQL login fix verified)' -ForegroundColor Green
    return $true
}

$patched = $false
if (Sync-FullBackend 'C:\NEXOR ERP\backend') { $patched = $true }

foreach ($pf in @(
    'C:\Program Files\NEXOR ERP\resources\backend',
    'C:\Program Files (x86)\NEXOR ERP\resources\backend'
)) {
    if (-not (Test-Path (Split-Path $pf -Parent))) { continue }
    try {
        if (Sync-FullBackend $pf) { $patched = $true }
    } catch {
        Write-Host "  Skipped $pf - run PowerShell as Administrator" -ForegroundColor Yellow
    }
}

if (-not $patched) {
    Write-Host 'Deploy failed. For dev, repo backend is still used automatically.' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host 'Backend deployed. Start NEXOR and log in.' -ForegroundColor Green
Write-Host ('Logs: ' + $env:APPDATA + '\NEXOR ERP\logs\backend-*.log')
