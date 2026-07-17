# NEXOR ERP — repair PostgreSQL schema on the SERVER PC.
# Picks the NEWEST viable backend (same logic as the running app), stops NEXOR, logs output.

param(
  [switch]$DiagnoseOnly
)

$ErrorActionPreference = 'Stop'

$installDir = 'C:\NEXOR ERP'
$logFile = Join-Path $installDir 'fix-server-schema.log'

function Write-Log($msg, $color) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
  if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg }
}

function Test-ViableBackend($backendRoot) {
  if (-not $backendRoot) { return $false }
  $checks = @(
    (Join-Path $backendRoot 'scripts\ensure-server-schema.js'),
    (Join-Path $backendRoot 'node_modules\dotenv'),
    (Join-Path $backendRoot 'src\lib\deploymentStatus.js'),
    (Join-Path $backendRoot 'src\lib\sqlDialect.js')
  )
  return ($checks | ForEach-Object { Test-Path $_ }) -notcontains $false
}

function Get-BackendSchemaExpectation($backendRoot) {
  $statusFile = Join-Path $backendRoot 'src\lib\deploymentStatus.js'
  if (-not (Test-Path $statusFile)) { return 0 }
  $text = Get-Content -Raw -Path $statusFile
  if ($text -match 'EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)') {
    return [int]$Matches[1]
  }
  return 0
}

function Get-BackendFeatureScore($backendRoot) {
  $score = 0
  if (Test-Path (Join-Path $backendRoot 'src\lib\certificationDemoProfile.js')) { $score += 100 }
  $certRoute = Join-Path $backendRoot 'src\routes\certification.js'
  if (Test-Path $certRoute) {
    $text = Get-Content -Raw -Path $certRoute
    if ($text -match 'apply-demo-profile') { $score += 50 }
    if ($text -match 'applyCertificationDemoProfile') { $score += 25 }
  }
  return $score
}

function Resolve-BestBackend {
  $candidates = @(
    $env:NEXOR_BACKEND_ROOT,
    (Join-Path $PSScriptRoot 'backend'),
    (Join-Path $installDir 'backend'),
    'C:\Program Files\NEXOR ERP\resources\backend',
    'C:\Program Files (x86)\NEXOR ERP\resources\backend',
    (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\resources\backend'),
    (Join-Path $PSScriptRoot '..\backend')
  ) | Where-Object { $_ } | Select-Object -Unique

  $packaged = 'C:\Program Files\NEXOR ERP\resources\backend'
  if (-not (Test-Path $packaged)) {
    $packaged = Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\resources\backend'
  }

  $viable = @()
  foreach ($root in $candidates) {
    if (Test-ViableBackend $root) {
      $viable += [pscustomobject]@{
        Path = $root
        Schema = Get-BackendSchemaExpectation $root
        Features = Get-BackendFeatureScore $root
        IsPackaged = ($root -eq $packaged)
      }
    } elseif (Test-Path (Join-Path $root 'scripts\ensure-server-schema.js')) {
      Write-Log "SKIP incomplete backend (missing node_modules): $root" 'DarkYellow'
    }
  }

  if ($viable.Count -eq 0) { return $null }

  return $viable | Sort-Object Schema, Features, @{ Expression = { if ($_.IsPackaged) { 1 } else { 0 } }; Descending = $true } | Select-Object -First 1
}

function Resolve-NodeRunner {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    return @{ Runner = 'node'; UseElectron = $false }
  }
  foreach ($exe in @(
    'C:\Program Files\NEXOR ERP\NEXOR ERP.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\NEXOR ERP.exe')
  )) {
    if (Test-Path $exe) {
      return @{ Runner = $exe; UseElectron = $true }
    }
  }
  return $null
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Write-Log '=== NEXOR schema repair started ===' 'Cyan'

if (-not (Test-Path (Join-Path $installDir 'database.env'))) {
  Write-Log '[ERROR] C:\NEXOR ERP\database.env not found.' 'Red'
  Write-Log 'This must run on the PostgreSQL SERVER PC (not LAN clients).' 'Red'
  exit 1
}

$ipFile = Join-Path $installDir 'IP'
if (Test-Path $ipFile) {
  $ipContent = (Get-Content -Raw -Path $ipFile).Trim()
  if ($ipContent -match '\.db$' -or $ipContent -match '\\') {
    Write-Log "WARN: C:\NEXOR ERP\IP points to SQLite ($ipContent). Edit IP to: postgres" 'Yellow'
  }
}

$allBackends = @(
  (Join-Path $installDir 'backend'),
  'C:\Program Files\NEXOR ERP\resources\backend',
  (Join-Path $env:LOCALAPPDATA 'Programs\NEXOR ERP\resources\backend')
) | Where-Object { Test-Path $_ }

Write-Log 'Backend folders found:' 'Cyan'
foreach ($b in $allBackends) {
  $schema = Get-BackendSchemaExpectation $b
  $ok = Test-ViableBackend $b
  Write-Log "  $b  schema=$schema  viable=$ok"
}

$best = Resolve-BestBackend
if (-not $best) {
  Write-Log '[ERROR] No complete backend found (need scripts + node_modules).' 'Red'
  Write-Log 'Install NEXOR-ERP-1.1.32-x64.exe on this SERVER PC, then run this again.' 'Red'
  Write-Log 'Or from repo USB: .\scripts\sync-nexor-backend.ps1 (as Administrator)' 'Red'
  exit 1
}

$runnerInfo = Resolve-NodeRunner
if (-not $runnerInfo) {
  Write-Log '[ERROR] Neither node nor NEXOR ERP.exe found.' 'Red'
  exit 1
}

Write-Log "Using backend: $($best.Path) (schema $($best.Schema))" 'Green'
Write-Log "Runner: $($runnerInfo.Runner)" 'Green'

if ($DiagnoseOnly) {
  Write-Log 'DiagnoseOnly — not running repair.' 'Cyan'
  exit 0
}

Write-Log 'Stopping NEXOR ERP...' 'Yellow'
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.js|ensure-server-schema' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$env:NEXOR_INSTALL_DIR = $installDir
if ($runnerInfo.UseElectron) { $env:ELECTRON_RUN_AS_NODE = '1' } else { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }

Push-Location $best.Path
try {
  $output = & $runnerInfo.Runner scripts\ensure-server-schema.js 2>&1
  $output | ForEach-Object { Write-Log $_ }
  $code = $LASTEXITCODE
  if ($null -eq $code) { $code = 0 }
} catch {
  Write-Log "[ERROR] $($_.Exception.Message)" 'Red'
  $code = 1
} finally {
  Pop-Location
}

Write-Log ''
if ($code -ne 0) {
  Write-Log "[FAILED] Exit code $code — full log: $logFile" 'Red'
  Write-Log 'Common fixes:' 'Yellow'
  Write-Log '  1. Install latest NEXOR-ERP-x64.exe on THIS server PC'
  Write-Log '  2. Confirm PostgreSQL is running (Docker or service)'
  Write-Log '  3. Check C:\NEXOR ERP\database.env DATABASE_URL'
  Write-Log '  4. Set C:\NEXOR ERP\IP to: postgres'
  exit $code
}

Write-Log '[OK] Schema repair finished. Restart NEXOR on this server.' 'Green'
Write-Log 'Verify: http://localhost:3000/api/health?lite=1' 'Green'
Write-Log 'Expect: engine=postgres, schemaVersion=56, schemaVersionExpected=56' 'Green'
exit 0
