# Run as Administrator on the SERVER PC so client laptops can connect over Wi-Fi.
# Right-click PowerShell → Run as administrator, then:
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   & "C:\path\to\allow-nexor-lan.ps1"

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "NEXOR ERP — opening LAN firewall (TCP 3000-3009, UDP 41234)..." -ForegroundColor Cyan

3000..3009 | ForEach-Object {
  netsh advfirewall firewall delete rule name="NEXOR-ERP-Backend-$_" | Out-Null
  netsh advfirewall firewall add rule name="NEXOR-ERP-Backend-$_" dir=in action=allow protocol=TCP localport=$_ profile=private,domain,public description="NEXOR ERP Express backend" | Out-Null
}

netsh advfirewall firewall delete rule name="NEXOR-ERP-Discovery-41234" | Out-Null
netsh advfirewall firewall add rule name="NEXOR-ERP-Discovery-41234" dir=in action=allow protocol=UDP localport=41234 profile=private,domain,public description="NEXOR ERP UDP discovery" | Out-Null

Write-Host ""
Write-Host "Done. Server Wi-Fi IP(s):" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | ForEach-Object {
  Write-Host "  http://$($_.IPAddress):3000/api/health"
}
Write-Host ""
Write-Host "On each CLIENT: put that IP in C:\NEXOR ERP\IP (not the .db path)." -ForegroundColor Yellow
