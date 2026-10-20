# Download the published v1.3.8 pack and apply it to the BACKEND THE
# NexorBackend service actually runs — not a guessed C:\NEXOR ERP\backend copy.
# Run as Administrator on the city server.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\apply-published-pack.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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

function Get-LiveBackendDir {
  $nssmCandidates = @(
    'C:\NEXOR ERP\tools\nssm.exe',
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
  throw 'Could not read NexorBackend AppDirectory. Install nssm or paste: Get-CimInstance Win32_Service -Filter "Name=''NexorBackend''" | Format-List PathName, State'
}

$Install = if ($env:NEXOR_INSTALL_DIR) { $env:NEXOR_INSTALL_DIR } else { 'C:\NEXOR ERP' }
$BackendDir = Get-LiveBackendDir
Write-Host ("LIVE service backend: " + $BackendDir) -ForegroundColor Cyan

$Staging = Join-Path $Install 'updates\staging'
$Extract = Join-Path $Staging 'extract'
$Zip = Join-Path $Staging 'nexor-server-update.zip'
$Status = Join-Path $Install 'updates\status.json'
New-Item -ItemType Directory -Force -Path $Staging | Out-Null
if (Test-Path -LiteralPath $Extract) { Remove-Item -LiteralPath $Extract -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Extract | Out-Null

$base = 'https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/download/v1.3.8'
Write-Host 'Downloading pack...'
Invoke-WebRequest -UseBasicParsing -Uri "$base/nexor-server-update.zip" -OutFile $Zip
Write-Host ("Zip bytes: " + (Get-Item -LiteralPath $Zip).Length)
tar -xf $Zip -C $Extract
if (-not (Test-Path -LiteralPath (Join-Path $Extract 'manifest.json'))) {
  throw 'tar extract failed — no manifest.json'
}
$Apply = Join-Path $Extract 'scripts\apply-nexor-server-update.ps1'
if (-not (Test-Path -LiteralPath $Apply)) { throw "No apply script at $Apply" }
$Stamp = Get-Content -LiteralPath (Join-Path $Extract 'backend\BUILD_STAMP.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ("Pack build: " + $Stamp.commit)

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $Node)) { throw "node.exe not found: $Node" }

$env:NEXOR_APPLY_INDEPENDENT = '1'
Write-Host 'Applying to the live service backend...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Apply `
  -ExtractDir $Extract `
  -BackendDir $BackendDir `
  -InstallDir $Install `
  -StatusFile $Status `
  -NodeExe $Node `
  -ServiceName 'NexorBackend' `
  -BuildId $Stamp.commit `
  -HealthUrl 'http://127.0.0.1:3000/api/health'
Write-Host ("apply exit: " + $LASTEXITCODE)
Write-Host '---- live BUILD_STAMP ----'
Get-Content -LiteralPath (Join-Path $BackendDir 'BUILD_STAMP.json')
Write-Host '---- health ----'
Invoke-RestMethod http://127.0.0.1:3000/api/health
