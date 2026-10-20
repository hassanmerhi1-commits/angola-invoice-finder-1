# NEXOR ERP - apply a verified server update pack.
# ASCII-only. Windows PowerShell 5.1 (LocalSystem via NexorBackend).
#
# Called by the backend AFTER download + SHA-512 + allowlist extract.
# This script: backup, stop service, copy allowlisted trees, optional npm ci,
# migrate, start, health check, rollback on failure.
#
# Never touches database.env, the IP file, certificates, or Postgres data.

param(
  [Parameter(Mandatory = $true)][string]$ExtractDir,
  [Parameter(Mandatory = $true)][string]$BackendDir,
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$StatusFile,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$ServiceName,
  [Parameter(Mandatory = $true)][string]$BuildId,
  [Parameter(Mandatory = $true)][string]$HealthUrl,
  [switch]$NeedNpmCi
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log([string]$text) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Write-Host $line
  try {
    $logDir = Split-Path -Parent $StatusFile
    if (-not (Test-Path -LiteralPath $logDir)) {
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    Add-Content -LiteralPath (Join-Path $logDir 'apply.log') -Value $line -Encoding UTF8
  } catch { }
}

function Write-Status([hashtable]$fields) {
  $obj = @{}
  if (Test-Path -LiteralPath $StatusFile) {
    try {
      $obj = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
      $obj = @{}
    }
  }
  $map = @{}
  foreach ($p in $obj.PSObject.Properties) { $map[$p.Name] = $p.Value }
  foreach ($key in $fields.Keys) { $map[$key] = $fields[$key] }
  $map['updatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  $json = $map | ConvertTo-Json -Depth 6
  $tmp = $StatusFile + '.tmp'
  Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
}

function Fail([string]$text) {
  Write-Log ("FAIL  " + $text)
  Write-Status @{
    phase = 'failed'
    message = $text
    ok = $false
    error = $text
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  exit 1
}

function Assert-SafeChild([string]$root, [string]$child) {
  $rootFull = [System.IO.Path]::GetFullPath($root)
  $childFull = [System.IO.Path]::GetFullPath($child)
  if (-not $childFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw ("Path escaped extract dir: " + $child)
  }
}

function Copy-Tree([string]$from, [string]$to) {
  if (-not (Test-Path -LiteralPath $from)) { return }
  $parent = Split-Path -Parent $to
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
}

function Backup-Live([string]$backupRoot) {
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  $webapp = Join-Path $BackendDir 'webapp'
  $src = Join-Path $BackendDir 'src'
  $pkg = Join-Path $BackendDir 'package.json'
  $lock = Join-Path $BackendDir 'package-lock.json'
  $stamp = Join-Path $BackendDir 'BUILD_STAMP.json'
  $ensure = Join-Path $BackendDir 'scripts\ensure-server-schema.js'
  if (Test-Path -LiteralPath $webapp) { Copy-Tree $webapp (Join-Path $backupRoot 'webapp') }
  if (Test-Path -LiteralPath $src) { Copy-Tree $src (Join-Path $backupRoot 'src') }
  if (Test-Path -LiteralPath $pkg) { Copy-Item -LiteralPath $pkg -Destination (Join-Path $backupRoot 'package.json') -Force }
  if (Test-Path -LiteralPath $lock) { Copy-Item -LiteralPath $lock -Destination (Join-Path $backupRoot 'package-lock.json') -Force }
  if (Test-Path -LiteralPath $stamp) { Copy-Item -LiteralPath $stamp -Destination (Join-Path $backupRoot 'BUILD_STAMP.json') -Force }
  if (Test-Path -LiteralPath $ensure) {
    New-Item -ItemType Directory -Force -Path (Join-Path $backupRoot 'scripts') | Out-Null
    Copy-Item -LiteralPath $ensure -Destination (Join-Path $backupRoot 'scripts\ensure-server-schema.js') -Force
  }
}

function Restore-Live([string]$backupRoot) {
  if (-not (Test-Path -LiteralPath $backupRoot)) { return }
  $webapp = Join-Path $BackendDir 'webapp'
  $src = Join-Path $BackendDir 'src'
  $bakWeb = Join-Path $backupRoot 'webapp'
  $bakSrc = Join-Path $backupRoot 'src'
  if (Test-Path -LiteralPath $bakWeb) {
    if (Test-Path -LiteralPath $webapp) { Remove-Item -LiteralPath $webapp -Recurse -Force }
    Copy-Tree $bakWeb $webapp
  }
  if (Test-Path -LiteralPath $bakSrc) {
    if (Test-Path -LiteralPath $src) { Remove-Item -LiteralPath $src -Recurse -Force }
    Copy-Tree $bakSrc $src
  }
  foreach ($name in @('package.json', 'package-lock.json', 'BUILD_STAMP.json')) {
    $bak = Join-Path $backupRoot $name
    if (Test-Path -LiteralPath $bak) {
      Copy-Item -LiteralPath $bak -Destination (Join-Path $BackendDir $name) -Force
    }
  }
  $bakEnsure = Join-Path $backupRoot 'scripts\ensure-server-schema.js'
  if (Test-Path -LiteralPath $bakEnsure) {
    $dest = Join-Path $BackendDir 'scripts\ensure-server-schema.js'
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Copy-Item -LiteralPath $bakEnsure -Destination $dest -Force
  }
}

function Wait-ServiceState([string]$name, [string]$want, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq $want) { return $true }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Test-Health([string]$url, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5
      if ($res.StatusCode -eq 200) {
        $json = $res.Content | ConvertFrom-Json
        if ($json.ok -eq $true) { return $true }
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Prune-OldBackups([string]$updatesRoot) {
  $dirs = @(Get-ChildItem -LiteralPath $updatesRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'backup-*' } |
    Sort-Object Name -Descending)
  if ($dirs.Count -gt 3) {
    $dirs | Select-Object -Skip 3 | ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

# -----------------------------------------------------------------------------
Write-Status @{
  phase = 'applying'
  message = 'Updater is running.'
  percent = 52
  applyAlive = $true
  buildId = $BuildId
}

if (-not $env:NEXOR_APPLY_INDEPENDENT) {
  Write-Log 'Re-launching apply outside NexorBackend so Stop-Service cannot kill it'
  if (-not (Test-Path -LiteralPath $StatusFile)) {
    $statusDir = Split-Path -Parent $StatusFile
    if ($statusDir -and -not (Test-Path -LiteralPath $statusDir)) {
      New-Item -ItemType Directory -Force -Path $statusDir | Out-Null
    }
  }
  $updatesRoot = Split-Path -Parent $StatusFile
  $self = $MyInvocation.MyCommand.Path
  $cmdPath = Join-Path $updatesRoot 'run-apply.cmd'
  $q = { param($s) '"{0}"' -f ([string]$s -replace '"', '') }
  $ps = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File {0} -ExtractDir {1} -BackendDir {2} -InstallDir {3} -StatusFile {4} -NodeExe {5} -ServiceName {6} -BuildId {7} -HealthUrl {8}' -f @(
    (& $q $self),
    (& $q $ExtractDir),
    (& $q $BackendDir),
    (& $q $InstallDir),
    (& $q $StatusFile),
    (& $q $NodeExe),
    (& $q $ServiceName),
    (& $q $BuildId),
    (& $q $HealthUrl)
  )
  if ($NeedNpmCi) { $ps = $ps + ' -NeedNpmCi' }
  @(
    '@echo off',
    'set NEXOR_APPLY_INDEPENDENT=1',
    $ps
  ) | Set-Content -LiteralPath $cmdPath -Encoding ASCII
  $stableDir = 'C:\ProgramData\NEXOR'
  $stableCmd = Join-Path $stableDir 'run-apply.cmd'
  try {
    if (-not (Test-Path -LiteralPath $stableDir)) {
      New-Item -ItemType Directory -Force -Path $stableDir | Out-Null
    }
    Copy-Item -LiteralPath $cmdPath -Destination $stableCmd -Force
    @(
      '@echo off',
      'REM NEXOR-APPLY-SHIM',
      'if exist "C:\ProgramData\NEXOR\run-apply.cmd" call "C:\ProgramData\NEXOR\run-apply.cmd" & goto :eof',
      'if exist "C:\NEXOR ERP\updates\run-apply.cmd" call "C:\NEXOR ERP\updates\run-apply.cmd"'
    ) | Set-Content -LiteralPath 'C:\NEXOR.cmd' -Encoding ASCII
  } catch {
    Write-Log ('stable launcher copy failed: ' + $_.Exception.Message)
    $stableCmd = $cmdPath
  }
  $tr = 'cmd.exe /c "{0}"' -f $stableCmd
  $launched = $false
  $ErrorActionPreference = 'Continue'
  & schtasks.exe /Create /F /TN 'NexorApplyUpdate' /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /TR $tr | Out-Null
  $createCode = $LASTEXITCODE
  if ($createCode -eq 0) {
    & schtasks.exe /Run /TN 'NexorApplyUpdate' | Out-Null
    $runCode = $LASTEXITCODE
    if ($runCode -eq 0) {
      $launched = $true
      Write-Log ('Apply re-launched via scheduled task NexorApplyUpdate TR=' + $tr)
    } else {
      Write-Log ('schtasks /Run failed with exit ' + $runCode)
    }
  } else {
    Write-Log ('schtasks /Create failed with exit ' + $createCode)
  }
  $ErrorActionPreference = 'Stop'
  if (-not $launched) {
    try {
      & wmic.exe process call create $stableCmd | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $launched = $true
        Write-Log 'Apply re-launched via wmic'
      } else {
        Write-Log ('wmic re-launch failed with exit ' + $LASTEXITCODE)
      }
    } catch {
      Write-Log ('wmic re-launch failed: ' + $_.Exception.Message)
    }
  }
  if ($launched) {
    Write-Status @{
      phase = 'restarting'
      message = 'Apply continues outside the service. Watch the percent bar.'
      percent = 58
      buildId = $BuildId
    }
    exit 0
  }
  Write-Log 'Independent re-launch failed — continuing in this process (may die when the service stops)'
}

if (-not (Test-Path -LiteralPath $ExtractDir)) { Fail 'Extract folder is missing' }
if (-not (Test-Path -LiteralPath (Join-Path $ExtractDir 'manifest.json'))) { Fail 'Extract folder has no manifest.json' }
if (-not (Test-Path -LiteralPath $BackendDir)) { Fail 'Backend folder is missing' }
if (-not (Test-Path -LiteralPath $NodeExe)) { Fail 'Node.exe path is invalid' }

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Fail ("Windows service not found: " + $ServiceName) }

$extractFull = [System.IO.Path]::GetFullPath($ExtractDir)
$backendFull = [System.IO.Path]::GetFullPath($BackendDir)
if ($extractFull.StartsWith($backendFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  Fail 'Extract folder must not sit inside the live backend folder'
}

$forbidden = @(
  (Join-Path $InstallDir 'database.env'),
  (Join-Path $InstallDir 'IP')
)
foreach ($item in $forbidden) {
  if ($extractFull.StartsWith(([System.IO.Path]::GetFullPath($item)), [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail 'Extract folder points at a protected path'
  }
}

$updatesRoot = Split-Path -Parent $StatusFile
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $updatesRoot ('backup-' + $stamp)
$rolledBack = $false

Write-Log ('Apply start  build=' + $BuildId + ' backend=' + $BackendDir)
# Give the SYSTEM task a moment to detach from NexorBackend before we stop it.
Start-Sleep -Seconds 2
Write-Status @{
  phase = 'applying'
  message = 'Backing up the current server files...'
  ok = $null
  buildId = $BuildId
  backupDir = $backupRoot
  percent = 55
}

try {
  Backup-Live $backupRoot
  Write-Log ('Backup OK  ' + $backupRoot)

  Write-Status @{ phase = 'applying'; message = 'Stopping NexorBackend...'; percent = 60 }
  if ($svc.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    if (-not (Wait-ServiceState $ServiceName 'Stopped' 45)) {
      throw 'NexorBackend did not stop in time'
    }
  }
  Write-Log 'Service stopped'

  $srcFrom = Join-Path $ExtractDir 'backend\src'
  $webFrom = Join-Path $ExtractDir 'webapp'
  $pkgFrom = Join-Path $ExtractDir 'backend\package.json'
  $lockFrom = Join-Path $ExtractDir 'backend\package-lock.json'
  $stampFrom = Join-Path $ExtractDir 'backend\BUILD_STAMP.json'
  $ensureFrom = Join-Path $ExtractDir 'backend\scripts\ensure-server-schema.js'
  Assert-SafeChild $ExtractDir $srcFrom
  Assert-SafeChild $ExtractDir $webFrom

  if (-not (Test-Path -LiteralPath $srcFrom)) { throw 'Pack is missing backend/src' }
  if (-not (Test-Path -LiteralPath $webFrom)) { throw 'Pack is missing webapp' }

  $srcLive = Join-Path $BackendDir 'src'
  $webLive = Join-Path $BackendDir 'webapp'
  $srcStaging = Join-Path $BackendDir 'src.nexor-new'
  $srcOld = Join-Path $BackendDir 'src.nexor-old'
  if (Test-Path -LiteralPath $srcStaging) { Remove-Item -LiteralPath $srcStaging -Recurse -Force }
  Copy-Tree $srcFrom $srcStaging
  $consistency = Join-Path $srcStaging 'routes\consistency.js'
  $stagedServer = Join-Path $srcStaging 'server.js'
  if (-not (Test-Path -LiteralPath $stagedServer)) { throw 'Pack copy is missing backend/src/server.js' }
  if (-not (Test-Path -LiteralPath $consistency)) { throw 'Pack copy is missing backend/src/routes/consistency.js' }
  if (Test-Path -LiteralPath $srcOld) { Remove-Item -LiteralPath $srcOld -Recurse -Force }
  if (Test-Path -LiteralPath $srcLive) { Rename-Item -LiteralPath $srcLive -NewName 'src.nexor-old' }
  Rename-Item -LiteralPath $srcStaging -NewName 'src'
  if (Test-Path -LiteralPath $srcOld) {
    try { Remove-Item -LiteralPath $srcOld -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }

  if (Test-Path -LiteralPath $webLive) { Remove-Item -LiteralPath $webLive -Recurse -Force }
  Copy-Tree $webFrom $webLive

  if (Test-Path -LiteralPath $pkgFrom) {
    Copy-Item -LiteralPath $pkgFrom -Destination (Join-Path $BackendDir 'package.json') -Force
  }
  if (Test-Path -LiteralPath $lockFrom) {
    Copy-Item -LiteralPath $lockFrom -Destination (Join-Path $BackendDir 'package-lock.json') -Force
  }
  if (Test-Path -LiteralPath $stampFrom) {
    Copy-Item -LiteralPath $stampFrom -Destination (Join-Path $BackendDir 'BUILD_STAMP.json') -Force
  }
  if (Test-Path -LiteralPath $ensureFrom) {
    $ensureDest = Join-Path $BackendDir 'scripts\ensure-server-schema.js'
    $ensureDir = Split-Path -Parent $ensureDest
    if (-not (Test-Path -LiteralPath $ensureDir)) { New-Item -ItemType Directory -Force -Path $ensureDir | Out-Null }
    Copy-Item -LiteralPath $ensureFrom -Destination $ensureDest -Force
  }

  $applySrc = Join-Path $ExtractDir 'scripts\apply-nexor-server-update.ps1'
  if (Test-Path -LiteralPath $applySrc) {
    Copy-Item -LiteralPath $applySrc -Destination (Join-Path $updatesRoot 'apply-nexor-server-update.ps1') -Force
  }

  Write-Log 'Files copied'
  Write-Status @{ phase = 'applying'; message = 'Files copied. Preparing the service...'; percent = 70 }

  if ($NeedNpmCi) {
    Write-Status @{ phase = 'applying'; message = 'Installing backend packages (lockfile changed)...'; percent = 75 }
    $npmCmd = Join-Path (Split-Path -Parent $NodeExe) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npmCmd)) { throw 'npm.cmd not found next to node.exe' }
    $npmLog = Join-Path $updatesRoot 'npm-ci.log'
    $p = Start-Process -FilePath $npmCmd -ArgumentList @('ci', '--omit=dev') -WorkingDirectory $BackendDir -Wait -PassThru -NoNewWindow -RedirectStandardOutput $npmLog -RedirectStandardError ($npmLog + '.err')
    if ($p.ExitCode -ne 0) { throw ('npm ci failed with exit ' + $p.ExitCode) }
    Write-Log 'npm ci OK'
  }

  Write-Status @{ phase = 'applying'; message = 'Updating the database schema...'; percent = 82 }
  $env:NEXOR_INSTALL_DIR = $InstallDir
  $migrate = Start-Process -FilePath $NodeExe -ArgumentList @('src\migrations\run.js') -WorkingDirectory $BackendDir -Wait -PassThru -NoNewWindow
  if ($migrate.ExitCode -ne 0) { throw ('migrate failed with exit ' + $migrate.ExitCode) }
  $ensure = Start-Process -FilePath $NodeExe -ArgumentList @('scripts\ensure-server-schema.js') -WorkingDirectory $BackendDir -Wait -PassThru -NoNewWindow
  if ($ensure.ExitCode -ne 0) { throw ('ensure-schema failed with exit ' + $ensure.ExitCode) }
  Write-Log 'Schema OK'

  Write-Status @{ phase = 'restarting'; message = 'Starting NexorBackend...'; percent = 88 }
  Start-Service -Name $ServiceName
  if (-not (Wait-ServiceState $ServiceName 'Running' 45)) {
    throw 'NexorBackend did not start'
  }

  Write-Status @{ phase = 'restarting'; message = 'Waiting for the server to answer...'; percent = 92 }
  $healthDeadline = (Get-Date).AddSeconds(90)
  $healthOk = $false
  do {
    $left = [Math]::Max(0, [int]($healthDeadline - (Get-Date)).TotalSeconds)
    $pct = [Math]::Min(98, 92 + [int]((90 - $left) / 15))
    Write-Status @{
      phase = 'restarting'
      message = ('Waiting for the server to answer… {0}s left' -f $left)
      percent = $pct
    }
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5
      if ($res.StatusCode -eq 200) {
        $json = $res.Content | ConvertFrom-Json
        if ($json.ok -eq $true) { $healthOk = $true; break }
      }
    } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $healthDeadline)
  if (-not $healthOk) {
    throw 'Server started but /api/health did not become OK — rolling back'
  }

  $current = @{
    product = 'nexor-erp'
    appVersion = '1.3.8'
    commit = $BuildId
    buildId = $BuildId
    appliedAt = (Get-Date).ToUniversalTime().ToString('o')
    backupDir = $backupRoot
  }
  $current | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $updatesRoot 'current.json') -Encoding UTF8

  $lockPath = Join-Path $updatesRoot 'apply.lock'
  if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force }

  Prune-OldBackups $updatesRoot
  Write-Log 'Apply OK'
  Write-Status @{
    phase = 'success'
    message = 'NEXOR was updated. Reload the screen if it still looks old.'
    ok = $true
    error = $null
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    buildId = $BuildId
    rollback = $false
    percent = 100
  }
  exit 0
} catch {
  $msg = [string]$_.Exception.Message
  Write-Log ('Apply failed: ' + $msg)
  try {
    $now = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($now -and $now.Status -ne 'Stopped') {
      Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
      Wait-ServiceState $ServiceName 'Stopped' 45 | Out-Null
    }
    Restore-Live $backupRoot
    $rolledBack = $true
    Write-Log 'Rollback files restored'
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    Wait-ServiceState $ServiceName 'Running' 45 | Out-Null
    Test-Health $HealthUrl 60 | Out-Null
  } catch {
    Write-Log ('Rollback failed: ' + $_.Exception.Message)
  }
  $lockPath = Join-Path $updatesRoot 'apply.lock'
  if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue }
  Write-Status @{
    phase = 'failed'
    message = $msg
    ok = $false
    error = $msg
    rollback = $rolledBack
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  exit 1
}
