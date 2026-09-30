# NEXOR ERP - run the native backend as a Windows service via NSSM.
# Run on the SERVER PC only, in PowerShell, as Administrator.
# ASCII-only file so Windows PowerShell 5.1 parses it reliably.
#
# Replaces what Docker's "restart: unless-stopped" used to do: start the API on
# boot and restart it if it crashes.
#
# Usage:
#   .\scripts\install-backend-service.ps1
#   .\scripts\install-backend-service.ps1 -Remove
#
# -ServiceName  Windows service name (default NexorBackend)
# -InstallDir   where database.env and data\secrets live (default C:\NEXOR ERP)
# -Port         API port (default 3000)
# -NssmPath     full path to nssm.exe if it is not on PATH
# -NoFirewall   skip the inbound rule for -Port
# -Remove       stop and delete the service, then exit
# -Force        answer yes to every confirmation
#
# The database password is NOT copied into the service environment: server.js
# reads <InstallDir>\database.env itself before it connects.

param(
  [string]$ServiceName = 'NexorBackend',
  [string]$InstallDir = 'C:\NEXOR ERP',
  [int]$Port = 3000,
  [string]$NssmPath = '',
  [switch]$NoFirewall,
  [switch]$Remove,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$script:StepNo = 0

function Write-Step([string]$text) {
  $script:StepNo = $script:StepNo + 1
  Write-Host ''
  Write-Host ("=== Step {0}: {1}" -f $script:StepNo, $text) -ForegroundColor Cyan
}

function Write-Ok([string]$text) { Write-Host ("    OK  " + $text) -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host ("    !!  " + $text) -ForegroundColor Yellow }
function Write-Info([string]$text) { Write-Host ("        " + $text) }

# Expected, actionable failures print one red block and exit, so the instruction
# is not buried under a PowerShell stack trace.
function Fail([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  Write-Host ''
  exit 1
}

function Confirm-Or-Exit([string]$question) {
  if ($Force) { return }
  $answer = Read-Host ($question + " [y/N]")
  if ($answer -ne 'y' -and $answer -ne 'Y') {
    Write-Host 'Aborted by user.' -ForegroundColor Yellow
    exit 1
  }
}

# nssm writes its errors to stderr; capturing them under ErrorActionPreference=Stop
# would raise NativeCommandError instead of giving us the exit code.
function Invoke-Nssm {
  param([string[]]$NssmArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $script:Nssm @NssmArgs 2>&1
    $lines = @()
    foreach ($item in $output) {
      if ($item -is [System.Management.Automation.ErrorRecord]) {
        $lines += $item.Exception.Message
      } else {
        $lines += [string]$item
      }
    }
    # nssm output is UTF-16-ish on some builds; strip stray nulls before matching.
    $text = (($lines -join "`n") -replace "`0", '').Trim()
    return @{ Text = $text; Code = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $previous
    $global:LASTEXITCODE = 0
  }
}

function Set-NssmValue([string]$key, [string[]]$values) {
  $res = Invoke-Nssm (@('set', $ServiceName, $key) + $values)
  if ($res.Code -ne 0) {
    Fail "nssm set $key failed (exit $($res.Code)): $($res.Text)"
  }
}

Write-Host '=== NEXOR ERP: backend as a Windows service ===' -ForegroundColor Cyan

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail @"
This must run as Administrator - creating a Windows service needs it.
Right-click PowerShell and choose "Run as administrator", then re-run.
"@
}
Write-Ok 'Running elevated'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$backendDir = Join-Path $repoRoot 'backend'
$serverEntry = Join-Path $backendDir 'src\server.js'

# ---------------------------------------------------------------- locate nssm
function Find-Nssm([string]$hint) {
  if ($hint) {
    if (Test-Path -LiteralPath $hint) { return $hint }
    Fail "nssm.exe not found at -NssmPath '$hint'."
  }
  $onPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $local = Join-Path $InstallDir 'tools\nssm.exe'
  if (Test-Path -LiteralPath $local) { return $local }
  return ''
}

function Install-Nssm {
  $toolsDir = Join-Path $InstallDir 'tools'
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $zip = Join-Path $env:TEMP 'nssm-2.24.zip'
  $extract = Join-Path $env:TEMP 'nssm-2.24-extract'

  Write-Info 'Downloading nssm 2.24 from https://nssm.cc ...'
  # PowerShell 5.1 still defaults to TLS 1.0, which nssm.cc refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
  } catch {
    Fail @"
Could not download nssm: $($_.Exception.Message)

Download nssm-2.24.zip manually on any machine, copy win64\nssm.exe to
  $toolsDir\nssm.exe
then re-run this script.
"@
  }
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $found = @(Get-ChildItem -LiteralPath $extract -Recurse -Filter 'nssm.exe' |
    Where-Object { $_.FullName -match '\\win64\\' })
  if ($found.Count -eq 0) {
    Fail "Downloaded archive did not contain win64\nssm.exe. Extracted to $extract"
  }
  $target = Join-Path $toolsDir 'nssm.exe'
  Copy-Item -LiteralPath $found[0].FullName -Destination $target -Force
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
  Write-Ok "nssm installed at $target"
  return $target
}

$script:Nssm = Find-Nssm $NssmPath

# ---------------------------------------------------------------- remove mode
if ($Remove) {
  Write-Step "Remove the $ServiceName service"
  if (-not $script:Nssm) { Fail 'nssm.exe not found, so the service cannot be removed with this script.' }
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $existing) {
    Write-Info "Service $ServiceName does not exist. Nothing to do."
    exit 0
  }
  Confirm-Or-Exit "Stop and delete the $ServiceName service? (the data is not touched)"
  Invoke-Nssm @('stop', $ServiceName) | Out-Null
  $res = Invoke-Nssm @('remove', $ServiceName, 'confirm')
  if ($res.Code -ne 0) { Fail "nssm remove failed: $($res.Text)" }
  Write-Ok "Service $ServiceName removed. The API is now stopped."
  Write-Info "Start it by hand with:  cd `"$backendDir`" ; npm start"
  exit 0
}

# ---------------------------------------------------------------- preflight
Write-Step 'Preflight checks'

if (-not (Test-Path -LiteralPath $serverEntry)) {
  Fail "Backend entry not found: $serverEntry`nRun this from the server repo clone."
}
Write-Ok "Backend: $backendDir"

if (-not (Test-Path -LiteralPath (Join-Path $backendDir 'node_modules\express\package.json'))) {
  Fail @"
Backend dependencies are missing. Install them first:
  cd "$backendDir"
  npm ci --omit=dev
"@
}
Write-Ok 'Backend node_modules present'

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail 'node.exe is not in PATH. Install Node.js 22 LTS on the server, then re-run.' }
# Services do not inherit your PATH reliably, so the service stores a full path.
$nodeExe = $nodeCmd.Source
Write-Ok ("node " + (& $nodeExe --version) + "  ($nodeExe)")

$envFile = Join-Path $InstallDir 'database.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  Fail @"
$envFile does not exist.

Without it the backend silently falls back to local SQLite and would serve an
empty database. Run the PostgreSQL move first:
  .\scripts\move-to-native-postgres.ps1 -Password '...' -ResumeFromRestore
"@
}
$envText = Get-Content -LiteralPath $envFile -Raw
if ($envText -notmatch 'DATABASE_URL\s*=\s*\S') {
  Fail "$envFile has no DATABASE_URL. The backend would fall back to SQLite."
}
if ($envText -notmatch 'DB_ENGINE\s*=\s*postgres') {
  Write-Warn2 "$envFile does not set DB_ENGINE=postgres."
  Confirm-Or-Exit 'Continue anyway?'
}
Write-Ok "database.env found with a DATABASE_URL"

# jwt.secret matters twice over: server.js exits under NODE_ENV=production if the
# secret cannot be persisted, and without the original every till re-logs in.
$jwtFile = Join-Path $InstallDir 'data\secrets\jwt.secret'
if (Test-Path -LiteralPath $jwtFile) {
  Write-Ok 'data\secrets\jwt.secret present - till sessions survive restarts'
} else {
  Write-Warn2 "No jwt.secret at $jwtFile."
  Write-Warn2 'One will be generated on first start, and every till will log in again.'
  Confirm-Or-Exit 'Continue without the original jwt.secret?'
}

if (-not $script:Nssm) {
  Write-Warn2 'nssm.exe was not found on this machine.'
  Write-Info  'nssm is a small open-source service wrapper (nssm.cc).'
  Confirm-Or-Exit 'Download nssm 2.24 now?'
  $script:Nssm = Install-Nssm
}
Write-Ok "nssm: $script:Nssm"

# Port 3000 free? Docker used to hold it.
$busy = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($busy.Count -gt 0) {
  $owners = @()
  foreach ($c in $busy) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p) { $owners += ("{0} (pid {1})" -f $p.ProcessName, $p.Id) }
  }
  Write-Warn2 ("Port {0} is already in use by: {1}" -f $Port, (($owners | Select-Object -Unique) -join ', '))
  Write-Warn2 'If that is the Docker backend or a manual "npm start", stop it first or the'
  Write-Warn2 'service will start and immediately die on EADDRINUSE.'
  Confirm-Or-Exit 'Continue anyway?'
} else {
  Write-Ok "Port $Port is free"
}

# ---------------------------------------------------------------- install
Write-Step "Create or update the $ServiceName service"

$logDir = Join-Path $InstallDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Info "Service $ServiceName already exists - reconfiguring it."
  if ($existing.Status -eq 'Running') {
    Invoke-Nssm @('stop', $ServiceName) | Out-Null
    Write-Info 'Stopped it so the settings can be replaced.'
  }
} else {
  $res = Invoke-Nssm @('install', $ServiceName, $nodeExe, 'src\server.js')
  if ($res.Code -ne 0) { Fail "nssm install failed: $($res.Text)" }
  Write-Ok "Service $ServiceName created"
}

Set-NssmValue 'Application' @($nodeExe)
Set-NssmValue 'AppParameters' @('src\server.js')
Set-NssmValue 'AppDirectory' @($backendDir)
Set-NssmValue 'DisplayName' @('NEXOR ERP Backend')
Set-NssmValue 'Description' @('NEXOR ERP API on port ' + $Port + ' (native PostgreSQL).')
Set-NssmValue 'Start' @('SERVICE_AUTO_START')

# Mirrors the docker-compose environment. DB_ENGINE and DATABASE_URL are
# deliberately absent: server.js loads them from database.env.
Set-NssmValue 'AppEnvironmentExtra' @(
  'NODE_ENV=production',
  ("PORT=" + $Port),
  ("NEXOR_INSTALL_DIR=" + $InstallDir),
  ("BACKUP_DIR=" + (Join-Path $InstallDir 'backups')),
  'AUTO_BACKUP=1',
  'AUTO_BACKUP_INTERVAL_HOURS=24',
  'AUTO_BACKUP_KEEP=14',
  'JWT_EXPIRES_IN=12h',
  'NEXOR_ALLOW_OPEN_CLIENT_INGEST=1'
)

# restart: unless-stopped equivalent.
Set-NssmValue 'AppExit' @('Default', 'Restart')
Set-NssmValue 'AppRestartDelay' @('5000')
# Ctrl+C first so Node can close the DB pool, only then kill.
Set-NssmValue 'AppStopMethodConsole' @('15000')

Set-NssmValue 'AppStdout' @((Join-Path $logDir 'backend.log'))
Set-NssmValue 'AppStderr' @((Join-Path $logDir 'backend.err.log'))
Set-NssmValue 'AppRotateFiles' @('1')
Set-NssmValue 'AppRotateOnline' @('1')
Set-NssmValue 'AppRotateBytes' @('10485760')
Write-Ok "Configured (auto-start, restart on crash, logs in $logDir)"

# ---------------------------------------------------------------- firewall
if (-not $NoFirewall) {
  Write-Step "Allow inbound TCP $Port for LAN and Tailscale clients"
  # Docker Desktop published the port and handled this; a native listener does not.
  $ruleName = "NEXOR ERP API $Port"
  $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($rule) {
    Write-Ok "Firewall rule '$ruleName' already exists"
  } else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
      -LocalPort $Port -Action Allow -Profile Any | Out-Null
    Write-Ok "Created firewall rule '$ruleName'"
  }
}

# ---------------------------------------------------------------- start
Write-Step 'Start the service and check health'
$res = Invoke-Nssm @('start', $ServiceName)
if ($res.Code -ne 0) {
  Write-Warn2 "nssm start reported: $($res.Text)"
}

$healthUrl = "http://127.0.0.1:$Port/api/health"
$health = $null
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
    break
  } catch {
    $health = $null
  }
}

if (-not $health) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  $state = 'unknown'
  if ($svc) { $state = $svc.Status }
  Fail @"
The service is '$state' but $healthUrl did not answer within 60 seconds.

Read the log first - the reason is almost always in there:
  Get-Content "$logDir\backend.err.log" -Tail 40

Common causes:
  - PostgreSQL is not running, or DATABASE_URL in database.env is wrong
  - port $Port is held by Docker or a manual npm start
  - the service account cannot write $InstallDir\data\secrets

The service stays installed, so fix the cause and run:  nssm restart $ServiceName
"@
}

Write-Ok ("Health OK - engine " + $health.engine + ", schema " + $health.schemaVersion)
if ($health.engine -ne 'postgres') {
  Write-Warn2 "engine is '$($health.engine)', not postgres - the API is NOT on your real data."
  Write-Warn2 "Check DATABASE_URL in $envFile, then: nssm restart $ServiceName"
}

# ---------------------------------------------------------------- done
Write-Host ''
Write-Host '=== Service installed ===' -ForegroundColor Green
Write-Host ''
Write-Info "Starts on boot, restarts if it crashes."
Write-Info "Logs:  $logDir\backend.log  and  backend.err.log"
Write-Host ''
Write-Host 'Day-to-day commands:' -ForegroundColor Cyan
Write-Host ("  nssm restart {0}" -f $ServiceName)
Write-Host ("  nssm stop {0}" -f $ServiceName)
Write-Host ("  Get-Content `"{0}\backend.err.log`" -Tail 40" -f $logDir)
Write-Host ''
Write-Host 'After every code update (git pull) on this server:' -ForegroundColor Yellow
Write-Host '  The Docker entrypoint used to run migrations on each start. The service'
Write-Host '  does not, so run them yourself:'
Write-Host ("    cd `"{0}`"" -f $backendDir)
Write-Host '    npm run migrate'
Write-Host '    npm run ensure-schema'
Write-Host ("    nssm restart {0}" -f $ServiceName)
Write-Host ''
Write-Host ("Remove the service again with:  .\scripts\install-backend-service.ps1 -Remove") -ForegroundColor Yellow
