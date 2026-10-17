@echo off
REM Double-click this ON the cashier PC. Cashiers do not need Settings or an ERP admin login.
REM Writes C:\NEXOR ERP\hot-update-config.json so the installed app loads the city screen.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$install='C:\NEXOR ERP';" ^
  "New-Item -ItemType Directory -Force -Path $install | Out-Null;" ^
  "$url='';" ^
  "if (Test-Path (Join-Path $install 'city-api.base')) { $url = (Get-Content -Raw (Join-Path $install 'city-api.base')).Trim() };" ^
  "if (-not $url -and (Test-Path (Join-Path $install 'setup-config.json'))) { try { $c = Get-Content -Raw (Join-Path $install 'setup-config.json') | ConvertFrom-Json; $ip = [string]$c.clientConfig.serverIp; if ($ip) { $url = $ip } } catch {} };" ^
  "if ($url -and $url -notmatch '^https?://') { $url = 'http://' + $url.Trim().TrimEnd('/') };" ^
  "if ($url -and $url -notmatch ':\d+$') { $url = $url.TrimEnd('/') + ':3000' };" ^
  "if (-not $url -or $url -match 'localhost|127\.0\.0\.1') { $url = 'http://100.104.240.46:3000' };" ^
  "$cfg = @{ enabled = $true; serverUrl = $url.TrimEnd('/'); autoConnect = $true } | ConvertTo-Json;" ^
  "Set-Content -Path (Join-Path $install 'hot-update-config.json') -Value $cfg -Encoding UTF8;" ^
  "Write-Host ('City screen: ' + $url.TrimEnd('/') + '/app') -ForegroundColor Green;" ^
  "Write-Host 'Close NEXOR ERP completely, then open it again.' -ForegroundColor Yellow"

echo.
echo Done. Close NEXOR ERP on this PC, then open it again.
pause
