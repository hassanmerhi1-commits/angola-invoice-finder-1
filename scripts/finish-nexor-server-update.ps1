# Finish a city-server pack apply that died at "restarting".
# Applies into the backend NexorBackend actually runs (NSSM AppDirectory),
# not a guessed C:\NEXOR ERP\backend copy.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\NEXOR ERP\updates\staging\extract\scripts\finish-nexor-server-update.ps1"

$ErrorActionPreference = 'Stop'
$InstallDir = $env:NEXOR_INSTALL_DIR
if (-not $InstallDir) { $InstallDir = 'C:\NEXOR ERP' }

function Get-NssmText([string]$nssm, [string]$key) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $raw = & $nssm get NexorBackend $key 2>&1 | Out-String
  } finally {
    $ErrorActionPreference = $prev
  }
  return (($raw -replace "`0", '').Trim())
}

function Get-LiveBackendDir([string]$fallback) {
  $nssmCandidates = @(
    (Join-Path $InstallDir 'tools\nssm.exe'),
    'C:\Program Files\nssm\nssm.exe',
    (Get-Command nssm -ErrorAction SilentlyContinue).Source
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($nssm in $nssmCandidates) {
    $dir = Get-NssmText $nssm 'AppDirectory'
    if ($dir -and (Test-Path -LiteralPath (Join-Path $dir 'src\server.js'))) { return $dir }
  }
  $svc = Get-CimInstance Win32_Service -Filter "Name='NexorBackend'" -ErrorAction SilentlyContinue
  $pathName = [string]$svc.PathName
  if ($pathName -match '(?i)((?:[A-Z]:\\[^\s"]+?)backend)\\src\\server\.js') {
    return $Matches[1]
  }
  return $fallback
}

$ExtractDir = Join-Path $InstallDir 'updates\staging\extract'
$StatusFile = Join-Path $InstallDir 'updates\status.json'
$BackendDir = Get-LiveBackendDir (Join-Path $InstallDir 'backend')
Write-Host ("LIVE service backend: " + $BackendDir)
$Apply = Join-Path $ExtractDir 'scripts\apply-nexor-server-update.ps1'
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { $NodeExe = 'C:\Program Files\nodejs\node.exe' }

if (-not (Test-Path -LiteralPath $Apply)) { throw "Extracted apply script not found: $Apply. Run scripts\apply-published-pack.ps1 instead." }
if (-not (Test-Path -LiteralPath $ExtractDir)) { throw "Extract folder missing: $ExtractDir" }
if (-not (Test-Path -LiteralPath $NodeExe)) { throw "node.exe not found: $NodeExe" }
if (-not (Test-Path -LiteralPath (Join-Path $BackendDir 'src\server.js'))) {
  throw "Live backend has no src\server.js: $BackendDir"
}

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
