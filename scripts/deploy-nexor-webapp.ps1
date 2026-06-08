# Build frontend and deploy to NEXOR install dirs (served by Express at /app).
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    Write-Host 'Building frontend (npm run build)...' -ForegroundColor Cyan
    npm run build
} finally {
    Pop-Location
}

$dist = Join-Path $repoRoot 'dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) {
    throw "Build output missing: $dist\index.html"
}

function Deploy-Webapp($dest) {
    if (-not $dest) { return $false }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    robocopy $dist $dest /E /MIR /NFL /NDL /NJH /NJS /nc /ns /np /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -gt 7) {
        Write-Host "  webapp copy failed: $dest (exit $LASTEXITCODE)" -ForegroundColor Red
        return $false
    }
    $version = @{ builtAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
    Set-Content -Path (Join-Path $dest 'version.json') -Value $version -Encoding UTF8
    Write-Host "  Webapp OK: $dest" -ForegroundColor Green
    return $true
}

Write-Host 'Deploying webapp...' -ForegroundColor Cyan
$ok = $false
foreach ($target in @(
    (Join-Path $repoRoot 'backend\webapp'),
    'C:\NEXOR ERP\backend\webapp',
    'C:\Program Files\NEXOR ERP\resources\backend\webapp'
)) {
    try {
        if (Deploy-Webapp $target) { $ok = $true }
    } catch {
        Write-Host "  Skipped $target - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $ok) { throw 'No webapp destination deployed' }
Write-Host ''
Write-Host 'Done. Restart NEXOR ERP (Start NEXOR ERP.bat) to load the new UI.' -ForegroundColor Green
