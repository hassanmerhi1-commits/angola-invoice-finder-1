# List candidate erp.db files and whether they contain treasury tables.
# Run on SERVER PC:
#   cd C:\Users\user\Documents\GitHub\angola-invoice-finder
#   .\scripts\find-erp-dbs.ps1

$ErrorActionPreference = 'Continue'
$roots = @(
  'C:\nexor',
  'C:\NEXOR ERP',
  'C:\NEXOR ERP\data',
  (Join-Path $env:APPDATA 'nexor-erp'),
  (Join-Path $env:LOCALAPPDATA 'nexor-erp'),
  (Join-Path $env:APPDATA 'NEXOR ERP'),
  'C:\Users\user\AppData\Roaming'
)

$files = @()
foreach ($root in $roots | Select-Object -Unique) {
  if (-not (Test-Path $root)) { continue }
  try {
    $files += Get-ChildItem -Path $root -Filter '*.db' -File -Recurse -Depth 3 -EA SilentlyContinue
  } catch {}
}

$files = $files | Sort-Object FullName -Unique | Sort-Object Length -Descending
if (-not $files) {
  Write-Host 'No .db files found.' -ForegroundColor Red
  exit 1
}

Write-Host ("{0,-10} {1,-8} {2,-8} {3,-8} {4}" -f 'MB', 'nexor', 'caixas', 'banks', 'Path') -ForegroundColor Cyan
foreach ($f in $files) {
  $mb = [math]::Round($f.Length / 1MB, 2)
  $nexor = '-'
  $caixas = '-'
  $banks = '-'
  try {
    # Use docker if available for sqlite3 probe; else just size
    $probe = docker run --rm -v "$($f.DirectoryName):/data" keppel/sqlite3:latest `
      "SELECT
        EXISTS(SELECT 1 FROM sqlite_master WHERE name='nexor_records'),
        EXISTS(SELECT 1 FROM sqlite_master WHERE name='caixas'),
        EXISTS(SELECT 1 FROM sqlite_master WHERE name='bank_accounts')" `
      "/data/$($f.Name)" 2>$null
    if ($probe) {
      $parts = ($probe -replace '\|', ' ').Trim() -split '\s+'
      if ($parts.Count -ge 3) {
        $nexor = $parts[0]
        $caixas = $parts[1]
        $banks = $parts[2]
      }
    }
  } catch {}
  Write-Host ("{0,-10} {1,-8} {2,-8} {3,-8} {4}" -f $mb, $nexor, $caixas, $banks, $f.FullName)
}

Write-Host ''
Write-Host 'Pick the largest file that has nexor=1 or caixas=1, then:' -ForegroundColor Yellow
Write-Host '  .\scripts\import-treasury-to-docker.ps1 -SqlitePath "FULL\PATH\TO\erp.db"'
