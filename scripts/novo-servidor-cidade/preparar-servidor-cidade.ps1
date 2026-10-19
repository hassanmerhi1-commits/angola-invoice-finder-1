# NEXOR ERP - first-time city server (no git, no technician).
# ASCII-only. Windows PowerShell 5.1. Run as Administrator.
#
# Prepares THIS PC only: IP file, database.env, backend files, schema, NexorBackend.
# Never drops a database. Never writes another city's Tailscale IP.
#
# Usage:
#   Right-click preparar-servidor-cidade.cmd -> Run as administrator
#   or:  .\scripts\novo-servidor-cidade\preparar-servidor-cidade.ps1
#   or:  .\scripts\novo-servidor-cidade\preparar-servidor-cidade.ps1 -PgPassword '...'

param(
  [string]$InstallDir = 'C:\NEXOR ERP',
  [string]$BackendDir = '',
  [string]$PgPassword = '',
  [string]$PgUser = 'postgres',
  [string]$PgHost = '127.0.0.1',
  [int]$PgPort = 5432,
  [string]$DatabaseName = 'kwanza_erp',
  [string]$PackUrl = 'https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/download/v1.3.8/nexor-server-update.zip',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:StepNo = 0

if (-not $BackendDir) { $BackendDir = Join-Path $InstallDir 'backend' }

function Write-Step([string]$text) {
  $script:StepNo = $script:StepNo + 1
  Write-Host ''
  Write-Host ("=== Passo {0}: {1} ===" -f $script:StepNo, $text) -ForegroundColor Cyan
}
function Write-Ok([string]$text) { Write-Host ("    OK  " + $text) -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host ("    !!  " + $text) -ForegroundColor Yellow }
function Write-Info([string]$text) { Write-Host ("        " + $text) }
function Fail([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  Write-Host ''
  exit 1
}

function Get-Psql {
  $onPath = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $found = @(Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter 'psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1)
  if ($found) { return $found.FullName }
  return ''
}

function Get-InstallerBackend {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} 'NEXOR ERP\resources\backend'),
    (Join-Path ${env:ProgramFiles} 'NEXOR ERP\resources\app.asar.unpacked\backend')
  )
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'NEXOR ERP\resources\backend')
  }
  foreach ($dir in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $dir 'src\server.js')) { return $dir }
  }
  return ''
}

Write-Host '=== NEXOR ERP: preparar servidor da cidade ===' -ForegroundColor Cyan
Write-Host 'Este script configura SO este PC. Nao mexe noutra cidade.' -ForegroundColor Yellow

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail @"
Tem de correr como Administrador.
Feche esta janela, clique com o botao direito em preparar-servidor-cidade.cmd
e escolha "Executar como administrador".
"@
}
Write-Ok 'A correr como Administrador'

# ---------------------------------------------------------------- node + postgres
Write-Step 'Verificar Node.js e PostgreSQL'

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Fail @"
Node.js nao esta instalado.
Instale Node.js 22 LTS de https://nodejs.org  (botao verde LTS)
e volte a correr este script.
"@
}
Write-Ok ("Node " + (& $nodeCmd.Source --version))

$pgService = @(Get-Service | Where-Object { $_.Name -match 'postgre' })
if ($pgService.Count -eq 0) {
  Fail @"
PostgreSQL nao esta instalado neste PC.
Instale PostgreSQL 18 (Next, Next). A senha que escolher e a do utilizador postgres.
Depois volte a correr este script.
"@
}
$pgStopped = @($pgService | Where-Object { $_.Status -ne 'Running' })
if ($pgStopped.Count -gt 0) {
  try { Start-Service -Name $pgStopped[0].Name } catch { }
  Start-Sleep -Seconds 3
}
$pgRunning = @(Get-Service | Where-Object { $_.Name -match 'postgre' -and $_.Status -eq 'Running' })
if ($pgRunning.Count -eq 0) {
  Fail 'PostgreSQL esta instalado mas nao arrancou. Abra Services e inicie o servico postgresql.'
}
Write-Ok ("PostgreSQL a correr: " + $pgRunning[0].Name)

# ---------------------------------------------------------------- folders + password
Write-Step 'Pastas e senha da base de dados'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data\secrets') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'backups') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'updates') | Out-Null
Write-Ok $InstallDir

$envFile = Join-Path $InstallDir 'database.env'
if ((Test-Path -LiteralPath $envFile) -and -not $Force) {
  Write-Ok 'database.env ja existe - a senha deste PC e mantida'
} else {
  if (-not $PgPassword) {
    $secure = Read-Host 'Senha do PostgreSQL (utilizador postgres)' -AsSecureString
    $PgPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    )
  }
  if (-not $PgPassword) { Fail 'A senha do PostgreSQL e obrigatoria.' }
  $safePass = $PgPassword.Replace('\', '\\').Replace('@', '%40')
  $dump = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter 'pg_dump.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  $dumpLine = ''
  if ($dump) { $dumpLine = "PG_DUMP_PATH=$($dump.FullName)`r`n" }
  $jwtBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
  $jwtSecret = -join ($jwtBytes | ForEach-Object { $_.ToString('x2') })
  $envText = @"
DB_ENGINE=postgres
DATABASE_URL=postgres://${PgUser}:${safePass}@${PgHost}:${PgPort}/${DatabaseName}
JWT_SECRET=$jwtSecret
${dumpLine}
"@
  Set-Content -LiteralPath $envFile -Value $envText.TrimEnd() -Encoding ASCII
  Write-Ok 'database.env criado (so neste PC, com JWT_SECRET)'
}

$ipFile = Join-Path $InstallDir 'IP'
Set-Content -LiteralPath $ipFile -Value 'postgres' -Encoding ASCII
Write-Ok 'IP = postgres (este PC e o servidor da cidade)'

# ---------------------------------------------------------------- create database
Write-Step 'Confirmar a base de dados kwanza_erp'
$psql = Get-Psql
if (-not $psql) {
  Write-Warn2 'psql.exe nao encontrado. A continuar - migrate vai falhar se a base nao existir.'
} else {
  $env:PGPASSWORD = $PgPassword
  if (-not $env:PGPASSWORD) {
    $urlLine = (Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1)
    if ($urlLine -match 'postgres://[^:]+:([^@]+)@') {
      $env:PGPASSWORD = [Uri]::UnescapeDataString($Matches[1])
    }
  }
  $exists = & $psql -U $PgUser -h $PgHost -p $PgPort -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail @"
Nao consegui ligar ao PostgreSQL com essa senha.
Confirme a senha que escolheu no instalador do PostgreSQL e volte a correr
com:  .\preparar-servidor-cidade.ps1 -Force
"@
  }
  if ("$exists".Trim() -ne '1') {
    Write-Info "A criar a base $DatabaseName ..."
    & $psql -U $PgUser -h $PgHost -p $PgPort -d postgres -c "CREATE DATABASE $DatabaseName" | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Nao consegui criar a base $DatabaseName." }
    Write-Ok "Base $DatabaseName criada (vazia, so neste PC)"
  } else {
    Write-Ok "Base $DatabaseName ja existe - nao foi apagada"
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- backend files
Write-Step 'Copiar o programa NEXOR para este PC'
New-Item -ItemType Directory -Force -Path $BackendDir | Out-Null
$serverEntry = Join-Path $BackendDir 'src\server.js'
$haveBackend = Test-Path -LiteralPath $serverEntry

if (-not $haveBackend) {
  $fromInstaller = Get-InstallerBackend
  if ($fromInstaller) {
    Write-Info "A copiar do instalador: $fromInstaller"
    Copy-Item -LiteralPath $fromInstaller -Destination $BackendDir -Recurse -Force
    $haveBackend = Test-Path -LiteralPath $serverEntry
  }
}

if (-not $haveBackend) {
  Write-Info 'A descarregar o pacote oficial NEXOR (v1.3.8)...'
  $zip = Join-Path $env:TEMP 'nexor-server-update.zip'
  $extract = Join-Path $env:TEMP 'nexor-server-update-extract'
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $PackUrl -OutFile $zip
  } catch {
    Fail @"
Nao consegui descarregar o pacote NEXOR.
Verifique a internet neste PC, ou instale primeiro NEXOR-ERP-1.3.8-x64.exe
e volte a correr o script.
$($_.Exception.Message)
"@
  }
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  tar -xf $zip -C $extract
  $root = $extract
  if (-not (Test-Path -LiteralPath (Join-Path $root 'manifest.json'))) {
    $kids = @(Get-ChildItem -LiteralPath $extract -Directory)
    if ($kids.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $kids[0].FullName 'manifest.json'))) {
      $root = $kids[0].FullName
    }
  }
  $src = Join-Path $root 'backend\src'
  if (-not (Test-Path -LiteralPath $src)) { Fail 'O pacote descarregado nao tem backend/src.' }
  if (Test-Path -LiteralPath (Join-Path $BackendDir 'src')) {
    Remove-Item -LiteralPath (Join-Path $BackendDir 'src') -Recurse -Force
  }
  Copy-Item -LiteralPath $src -Destination (Join-Path $BackendDir 'src') -Recurse -Force
  foreach ($name in @('package.json', 'package-lock.json', 'BUILD_STAMP.json')) {
    $f = Join-Path $root "backend\$name"
    if (Test-Path -LiteralPath $f) {
      Copy-Item -LiteralPath $f -Destination (Join-Path $BackendDir $name) -Force
    }
  }
  $ensureFrom = Join-Path $root 'backend\scripts\ensure-server-schema.js'
  if (Test-Path -LiteralPath $ensureFrom) {
    New-Item -ItemType Directory -Force -Path (Join-Path $BackendDir 'scripts') | Out-Null
    Copy-Item -LiteralPath $ensureFrom -Destination (Join-Path $BackendDir 'scripts\ensure-server-schema.js') -Force
  }
  $webFrom = Join-Path $root 'webapp'
  if (Test-Path -LiteralPath $webFrom) {
    $webTo = Join-Path $BackendDir 'webapp'
    if (Test-Path -LiteralPath $webTo) { Remove-Item -LiteralPath $webTo -Recurse -Force }
    Copy-Item -LiteralPath $webFrom -Destination $webTo -Recurse -Force
  }
  $applyFrom = Join-Path $root 'scripts\apply-nexor-server-update.ps1'
  if (Test-Path -LiteralPath $applyFrom) {
    Copy-Item -LiteralPath $applyFrom -Destination (Join-Path $InstallDir 'updates\apply-nexor-server-update.ps1') -Force
  }
  $haveBackend = Test-Path -LiteralPath $serverEntry
}

if (-not $haveBackend) {
  Fail 'Ainda nao ha backend\src\server.js. Instale NEXOR-ERP-1.3.8-x64.exe e volte a tentar.'
}
Write-Ok $BackendDir

# ---------------------------------------------------------------- npm + schema
Write-Step 'Instalar dependencias e criar as tabelas'
$npmCmd = Join-Path (Split-Path -Parent $nodeCmd.Source) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd)) { Fail 'npm.cmd nao encontrado ao lado do node.exe.' }
$env:NEXOR_INSTALL_DIR = $InstallDir
Push-Location $BackendDir
try {
  if (-not (Test-Path -LiteralPath (Join-Path $BackendDir 'node_modules\express\package.json'))) {
    Write-Info 'npm ci (pode demorar uns minutos)...'
    & $npmCmd 'ci' '--omit=dev'
    if ($LASTEXITCODE -ne 0) { Fail 'npm ci falhou. Veja a internet / Node 22 e tente outra vez.' }
  } else {
    Write-Ok 'node_modules ja estava presente'
  }
  Write-Info 'A aplicar o schema...'
  & $nodeCmd.Source 'src\migrations\run.js'
  if ($LASTEXITCODE -ne 0) { Fail 'migrate falhou. Confirme a senha em C:\NEXOR ERP\database.env.' }
  if (Test-Path -LiteralPath (Join-Path $BackendDir 'scripts\ensure-server-schema.js')) {
    & $nodeCmd.Source 'scripts\ensure-server-schema.js'
    if ($LASTEXITCODE -ne 0) { Fail 'ensure-schema falhou.' }
  }
} finally {
  Pop-Location
}
Write-Ok 'Base de dados pronta'

# ---------------------------------------------------------------- service
Write-Step 'Instalar o servico NexorBackend'
$installer = $null
foreach ($candidate in @(
    (Join-Path $PSScriptRoot 'install-backend-service.ps1'),
    (Join-Path $PSScriptRoot '..\install-backend-service.ps1'),
    (Join-Path $InstallDir 'updates\install-backend-service.ps1')
  )) {
  if (Test-Path -LiteralPath $candidate) { $installer = $candidate; break }
}
if (-not $installer) {
  Write-Info 'A descarregar install-backend-service.ps1...'
  $installer = Join-Path $InstallDir 'updates\install-backend-service.ps1'
  Invoke-WebRequest -UseBasicParsing `
    -Uri 'https://raw.githubusercontent.com/hassanmerhi1-commits/angola-invoice-finder-1/main/scripts/install-backend-service.ps1' `
    -OutFile $installer
}
& $installer -Force -InstallDir $InstallDir -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Fail 'A instalacao do servico falhou. Veja as mensagens acima.' }

# ---------------------------------------------------------------- health + tailscale
Write-Step 'Verificacao final'
$health = $null
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 8 } catch { }
if (-not $health -or $health.ok -ne $true) {
  Fail "http://127.0.0.1:3000/api/health nao respondeu. Veja C:\NEXOR ERP\logs\backend.err.log"
}
if ($health.engine -ne 'postgres') {
  Fail "O motor e '$($health.engine)', nao postgres. Nao abra o NEXOR ate isto estar postgres."
}
Write-Ok ("Saude OK  engine=" + $health.engine + "  schema=" + $health.schemaVersion)

$tailscaleIp = ''
$ts = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if ($ts) {
  try { $tailscaleIp = (& $ts.Source 'ip' '-4' 2>$null | Select-Object -First 1).Trim() } catch { }
}
if (-not $tailscaleIp) {
  Write-Warn2 'Tailscale nao encontrado. Instale Tailscale, inicie sessao, e anote: tailscale ip -4'
} else {
  Write-Ok ("IP Tailscale deste servidor: " + $tailscaleIp)
}

Write-Host ''
Write-Host '=== Servidor da cidade pronto ===' -ForegroundColor Green
Write-Host ''
Write-Host '1. Abra o icone NEXOR neste PC e entre com admin / changeme.'
Write-Host '   Depois altere a senha em Definicoes.'
Write-Host '2. Nas caixas desta cidade, C:\NEXOR ERP\IP deve ter SO este IP:'
if ($tailscaleIp) {
  Write-Host ("     " + $tailscaleIp) -ForegroundColor Yellow
} else {
  Write-Host '     (o IP Tailscale deste PC)' -ForegroundColor Yellow
}
Write-Host '3. Depois disto, as actualizacoes sao o botao Actualizar NEXOR.'
Write-Host '   Nao volte a correr este script noutra cidade com estes ficheiros de senha.'
Write-Host ''
