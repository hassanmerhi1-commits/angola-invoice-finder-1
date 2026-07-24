# Nuclear fix when UI shows 1.1.54 but /api/health still shows 1.1.51.
# Run ON THE SERVER as Administrator:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   git pull origin main
#   powershell -ExecutionPolicy Bypass -File .\scripts\force-server-backend-update.ps1

$ErrorActionPreference = 'Continue'
$Expected = '1.1.64'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repoRoot 'backend\src\server.js'))) {
  $repoRoot = (Get-Location).Path
}
Set-Location $repoRoot

function Show-Section($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

function Get-PkgVersion($path) {
  if (-not (Test-Path $path)) { return '(missing)' }
  try { return (Get-Content $path -Raw | ConvertFrom-Json).version } catch { return '(unreadable)' }
}

Show-Section '1) Who owns port 3000?'
$listen = netstat -ano | Select-String ':3000' | Select-String 'LISTENING'
if ($listen) { $listen | ForEach-Object { Write-Host $_ } } else { Write-Host '(nothing listening on 3000)' -ForegroundColor Yellow }
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.js|nexor-backend|resources\\backend' } |
  ForEach-Object {
    Write-Host ("PID {0}: {1}" -f $_.ProcessId, $_.CommandLine.Substring(0, [Math]::Min(220, $_.CommandLine.Length)))
  }

Show-Section '2) Docker?'
$dockerOk = $false
$hasContainer = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" 2>&1 | ForEach-Object { Write-Host $_ }
  $names = docker ps --format '{{.Names}}' 2>$null
  if ($names -match 'nexor-backend') { $hasContainer = $true; $dockerOk = $true }
} else {
  Write-Host 'docker not in PATH'
}

Show-Section '3) Backend package.json on disk'
$paths = @(
  (Join-Path $repoRoot 'backend\package.json'),
  'C:\NEXOR ERP\backend\package.json',
  'C:\Program Files\NEXOR ERP\resources\backend\package.json',
  'C:\Program Files (x86)\NEXOR ERP\resources\backend\package.json'
)
foreach ($p in $paths) {
  Write-Host ("{0} => {1}" -f $p, (Get-PkgVersion $p))
}

Show-Section '4) Kill old API owners'
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server\.js|backend\\src' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# kill listeners on 3000
netstat -ano | Select-String ':3000' | Select-String 'LISTENING' | ForEach-Object {
  if ($_ -match '\s+(\d+)\s*$') {
    $pid = [int]$Matches[1]
    Write-Host "Killing PID $pid on :3000"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2

if ($hasContainer) {
  Show-Section '5) Docker path — rebuild nexor-backend (this is usually why sync-nexor fails)'
  & (Join-Path $PSScriptRoot 'fix-docker-backend.ps1') -ProjectRoot $repoRoot -SkipPull:$false
} else {
  Show-Section '5) Embedded path — sync backend trees'
  & (Join-Path $PSScriptRoot 'sync-nexor-backend.ps1')

  Show-Section '5b) Verify disk versions after sync'
  foreach ($p in @(
    'C:\NEXOR ERP\backend\package.json',
    'C:\Program Files\NEXOR ERP\resources\backend\package.json'
  )) {
    $v = Get-PkgVersion $p
    Write-Host ("{0} => {1}" -f $p, $v)
    if ((Test-Path $p) -and $v -ne $Expected) {
      Write-Host "WARN: still not $Expected — re-run THIS script as Administrator" -ForegroundColor Red
    }
  }

  Show-Section '5c) Schema ensure'
  $env:NEXOR_INSTALL_DIR = 'C:\NEXOR ERP'
  Push-Location 'C:\NEXOR ERP\backend'
  try { node scripts/ensure-server-schema.js } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
  Pop-Location

  Show-Section '5d) Start NEXOR'
  $exe = 'C:\Program Files\NEXOR ERP\NEXOR ERP.exe'
  if (Test-Path $exe) { Start-Process $exe } else { Start-Process 'C:\NEXOR ERP\Start NEXOR ERP.bat' }
}

Show-Section '6) Wait for health'
$ok = $false
for ($i = 1; $i -le 24; $i++) {
  Start-Sleep -Seconds 5
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:3000/api/health?lite=1' -TimeoutSec 5
    Write-Host ("attempt {0}: appVersion={1} shell={2} backendPkg={3} schemaExpected={4} entry={5}" -f `
      $i, $h.appVersion, $h.shellVersion, $h.backendPackageVersion, $h.schemaVersionExpected, $h.backendEntry)
    if ($h.appVersion -eq $Expected -or $h.backendPackageVersion -eq $Expected) {
      $ok = $true
      break
    }
  } catch {
    Write-Host ("attempt {0}: {1}" -f $i, $_.Exception.Message) -ForegroundColor DarkYellow
  }
}

Show-Section 'RESULT'
if ($ok) {
  Write-Host "SUCCESS — API is on $Expected" -ForegroundColor Green
} else {
  Write-Host "FAILED — API still not $Expected" -ForegroundColor Red
  Write-Host 'Paste the FULL output of this script back to Cursor.' -ForegroundColor Yellow
  Write-Host 'Most common cause: Docker nexor-backend still old, or Program Files sync needs Admin.' -ForegroundColor Yellow
  exit 1
}
