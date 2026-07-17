# One-shot schema repair — copy this file to the server and run:
#   powershell -ExecutionPolicy Bypass -File repair-server-schema-now.ps1
# Or from repo on server USB:
#   powershell -ExecutionPolicy Bypass -File .\scripts\repair-server-schema-now.ps1

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fix = Join-Path $here 'fix-server-schema.ps1'
if (-not (Test-Path $fix)) {
  $fix = Join-Path (Split-Path $here -Parent) 'scripts\fix-server-schema.ps1'
}
if (-not (Test-Path $fix)) {
  Write-Host '[ERROR] fix-server-schema.ps1 not found next to this script.' -ForegroundColor Red
  exit 1
}
& $fix @args
