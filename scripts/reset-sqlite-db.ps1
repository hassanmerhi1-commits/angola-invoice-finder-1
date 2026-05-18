# Full SQLite reset for NEXOR ERP (server mode, C:\nexor\erp.db by default).
# Close the app before running. Deletes main DB + WAL + SHM, then bootstraps a fresh schema.

param(
  [string]$DbPath = 'C:\nexor\erp.db',
  [switch]$KeepBackups
)

$ErrorActionPreference = 'Stop'
$DbPath = [System.IO.Path]::GetFullPath($DbPath)
$dir = Split-Path -Parent $DbPath
$name = [System.IO.Path]::GetFileNameWithoutExtension($DbPath)

if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

Write-Host "Stopping processes that may lock the database..."
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.js|backend' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $DbPath) {
  $backup = Join-Path $dir "$name.pre-reset-$stamp.db"
  Copy-Item -LiteralPath $DbPath -Destination $backup -Force
  Write-Host "Backed up current DB to: $backup"
}

foreach ($suffix in @('', '-wal', '-shm')) {
  $f = "$DbPath$suffix"
  if (Test-Path $f) {
    Remove-Item -LiteralPath $f -Force
    Write-Host "Removed: $f"
  }
}

if (-not $KeepBackups) {
  Get-ChildItem -Path $dir -Filter "$name.backup-*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Old backup still on disk (not removed): $($_.FullName)"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendEntry = Join-Path $repoRoot 'backend\src\server.js'
if (-not (Test-Path $backendEntry)) {
  Write-Host "WARN: backend not found; restart the app to create a fresh database."
  exit 0
}

Write-Host "Bootstrapping fresh schema..."
$env:SQLITE_PATH = $DbPath
$env:DATABASE_URL = ''
$env:DB_ENGINE = 'sqlite'
$env:PORT = '3099'
Push-Location (Join-Path $repoRoot 'backend')
try {
  $proc = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -PassThru -NoNewWindow
  Start-Sleep -Seconds 4
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
} finally {
  Pop-Location
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
}

if (Test-Path $DbPath) {
  $size = (Get-Item $DbPath).Length
  Write-Host "Done. New database at $DbPath ($size bytes)."
  Write-Host "Restart NEXOR ERP and use Settings > Database > Clear local cache if lists still look wrong."
} else {
  Write-Host "Database file was not created. Start the app once to bootstrap."
}
