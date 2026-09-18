# Run this ON the cashier PC that still shows pending sales / old layout.
# The installed NEXOR app ignores city-server UI until Hot Updates is on.
# After this file exists, restart "NEXOR ERP" so it loads http://SERVER:3000/app.

param(
    [string]$ServerUrl = ''
)

$ErrorActionPreference = 'Stop'
$installDir = 'C:\NEXOR ERP'
$hotPath = Join-Path $installDir 'hot-update-config.json'

function Read-TextFile([string]$path) {
    if (-not (Test-Path $path)) { return '' }
    return (Get-Content -Raw -Encoding UTF8 -Path $path).Trim()
}

function Normalize-ServerUrl([string]$raw) {
    $s = [string]$raw
    if (-not $s) { return '' }
    $s = $s.Trim().TrimEnd('/')
    if ($s -notmatch '^https?://') { $s = "http://$s" }
    try {
        $u = [Uri]$s
        $hostName = $u.Host.ToLowerInvariant()
        if ($hostName -in @('localhost', '127.0.0.1', '::1')) { return '' }
        $port = if ($u.IsDefaultPort) { 3000 } else { $u.Port }
        return "http://$($u.Host):$port"
    } catch {
        return ''
    }
}

$resolved = Normalize-ServerUrl $ServerUrl

if (-not $resolved) {
    $resolved = Normalize-ServerUrl (Read-TextFile (Join-Path $installDir 'city-api.base'))
}

if (-not $resolved -and (Test-Path (Join-Path $installDir 'setup-config.json'))) {
    try {
        $cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $installDir 'setup-config.json') | ConvertFrom-Json
        $ip = [string]$cfg.clientConfig.serverIp
        $port = $cfg.clientConfig.httpPort
        if (-not $port) { $port = $cfg.clientConfig.apiPort }
        if (-not $port) { $port = 3000 }
        if ($ip) { $resolved = Normalize-ServerUrl "${ip}:${port}" }
    } catch { }
}

if (-not $resolved) {
    $ipFile = Join-Path $installDir 'NEXOR-IP.txt'
    if (-not (Test-Path $ipFile)) { $ipFile = Join-Path $installDir 'ip.txt' }
    $rawIp = Read-TextFile $ipFile
    if ($rawIp -and $rawIp -notmatch '\.(db|nexor)$') {
        $resolved = Normalize-ServerUrl $rawIp
    }
}

if (-not $resolved) {
    throw "Could not find the city server URL. Run: .\enable-till-live-ui.ps1 -ServerUrl http://100.104.240.46:3000"
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$payload = @{
    enabled = $true
    serverUrl = $resolved
    autoConnect = $true
} | ConvertTo-Json
Set-Content -Path $hotPath -Value $payload -Encoding UTF8

Write-Host "Wrote $hotPath" -ForegroundColor Green
Write-Host "City UI: $resolved/app" -ForegroundColor Green
Write-Host ""
Write-Host "1. Close NEXOR ERP on this PC"
Write-Host "2. Open NEXOR ERP again"
Write-Host "3. On POS, Updates should show UI source = Server"
Write-Host "4. Hard-refresh if needed (Ctrl+Shift+R)"
