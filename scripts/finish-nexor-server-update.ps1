# Finish a city-server pack apply that died at "restarting".
# Run ON THE CITY SERVER as Administrator (not from the NEXOR app):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEXOR ERP\updates\staging\extract\scripts\finish-nexor-server-update.ps1"
#
# Uses the already-downloaded extract. Does not overwrite database.env or Postgres.

$ErrorActionPreference = 'Stop'
$InstallDir = $env:NEXOR_INSTALL_DIR
if (-not $InstallDir) { $InstallDir = 'C:\NEXOR ERP' }

$ExtractDir = Join-Path $InstallDir 'updates\staging\extract'
$StatusFile = Join-Path $InstallDir 'updates\status.json'
$BackendDir = Join-Path $InstallDir 'backend'
$Apply = Join-Path $ExtractDir 'scripts\apply-nexor-server-update.ps1'
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = 'C:\Program Files\nodejs\node.exe' }

if (-not (Test-Path -LiteralPath $Apply)) { throw "Extracted apply script not found: $Apply. Click Update NEXOR once so the pack downloads, then run this again." }
if (-not (Test-Path -LiteralPath $ExtractDir)) { throw "Extract folder missing: $ExtractDir" }
if (-not (Test-Path -LiteralPath $NodeExe)) { throw "node.exe not found: $NodeExe" }

$buildId = 'unknown'
if (Test-Path -LiteralPath $StatusFile) {
  try {
    $st = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($st.buildId) { $buildId = [string]$st.buildId }
  } catch { }
}
if ($buildId -eq 'unknown') {
  $stamp = Join-Path $ExtractDir 'backend\BUILD_STAMP.json'
  if (Test-Path -LiteralPath $stamp) {
    try {
      $js = Get-Content -LiteralPath $stamp -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($js.commit) { $buildId = [string]$js.commit }
      elseif ($js.buildId) { $buildId = [string]$js.buildId }
    } catch { }
  }
}

$port = 3000
$envFile = Join-Path $InstallDir 'database.env'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
  }
}

$env:NEXOR_APPLY_INDEPENDENT = '1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Apply `
  -ExtractDir $ExtractDir `
  -BackendDir $BackendDir `
  -InstallDir $InstallDir `
  -StatusFile $StatusFile `
  -NodeExe $NodeExe `
  -ServiceName 'NexorBackend' `
  -BuildId $buildId `
  -HealthUrl ('http://127.0.0.1:{0}/api/health' -f $port)
exit $LASTEXITCODE
