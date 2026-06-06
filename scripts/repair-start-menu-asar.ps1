#Requires -RunAsAdministrator
# Fix "Cannot find module './httpBinary.cjs'" — repack app.asar with full electron/ folder.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$asarPath = 'C:\Program Files\NEXOR ERP\resources\app.asar'
$asarWork = Join-Path $env:TEMP 'nexor-asar-repair'

Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path $asarWork) { Remove-Item -Recurse -Force $asarWork }
New-Item -ItemType Directory -Force -Path $asarWork | Out-Null

Push-Location $repoRoot
npx --yes asar extract $asarPath $asarWork
$electronDest = Join-Path $asarWork 'electron'
New-Item -ItemType Directory -Force -Path $electronDest | Out-Null
Get-ChildItem -Path (Join-Path $repoRoot 'electron') -File | ForEach-Object {
    Copy-Item -Force $_.FullName (Join-Path $electronDest $_.Name)
}
$backup = "$asarPath.bak-repair-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Force $asarPath $backup
npx --yes asar pack $asarWork $asarPath
Pop-Location

Write-Host "Repaired app.asar (backup: $backup)" -ForegroundColor Green
Write-Host 'Start NEXOR with: C:\NEXOR ERP\Start NEXOR ERP.bat'
