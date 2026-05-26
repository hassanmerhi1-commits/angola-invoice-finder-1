# Restart NEXOR ERP local server (embedded Express on port 3000-3009).
# Run when login shows "Cannot connect to server" on the main/server PC.
# Close the app first, or this script will stop it for you.

$ErrorActionPreference = 'Stop'

Write-Host "Stopping NEXOR ERP and stray backend processes..."
Get-Process -Name 'NEXOR ERP','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.js|backend\\src' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Write-Host "`nIP file (must be a .db path on server PC):"
if (Test-Path 'C:\NEXOR ERP\IP') {
  Get-Content 'C:\NEXOR ERP\IP'
} else {
  Write-Host '  MISSING — run Setup in the app or create C:\NEXOR ERP\IP'
}

Write-Host "`nPorts 3000-3009:"
3000..3009 | ForEach-Object {
  $c = Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Write-Host "  LISTEN $_ PID $($c.OwningProcess)" }
}

Write-Host "`nDone. Start NEXOR ERP once from Start Menu or:"
Write-Host '  C:\Program Files\NEXOR ERP\NEXOR ERP.exe'
Write-Host "Wait 30 seconds on the login screen, then sign in (admin / changeme if fresh DB)."
Write-Host "Logs: $env:APPDATA\NEXOR ERP\logs\backend-*.log"
