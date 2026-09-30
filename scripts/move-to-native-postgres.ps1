# NEXOR ERP - move PostgreSQL and the backend out of Docker onto native Windows.
# Run on the SERVER PC only, in PowerShell, as Administrator.
# ASCII-only file so Windows PowerShell 5.1 parses it reliably.
#
# What it does (nothing is deleted - Docker is only stopped):
#   1. Preflight checks (Docker containers, native psql, node)
#   2. Stops nexor-backend so no writes happen after the dump
#   3. Dumps kwanza_erp from inside the container and copies the file out
#   4. Copies jwt.secret / master.key / AGT signing certs out of the backend volume
#   5. Creates the native database plus uuid-ossp and pgcrypto
#   6. Restores the dump with ON_ERROR_STOP
#   7. Compares row counts for every table, container vs native
#   8. Writes C:\NEXOR ERP\database.env and installs the secrets
#   9. Runs npm ci --omit=dev, npm run migrate, npm run ensure-schema
#
# The container publishes host port 5432, which is the port the PostgreSQL
# installer wants, so both cannot be up at once. Hence two phases:
#
#   Phase A - Docker still running, PostgreSQL not installed yet:
#       .\scripts\move-to-native-postgres.ps1 -DumpOnly
#     Stops the backend, dumps the data, copies the secrets out, then stops.
#
#   Then:  docker compose down      (frees port 5432, keeps kwanza_pgdata)
#   Then:  install PostgreSQL 16 on port 5432
#
#   Phase B - native server up:
#       .\scripts\move-to-native-postgres.ps1 -Password 'NewStrongPassword' -ResumeFromRestore
#     Restores, verifies row counts, writes database.env, applies migrations.
#
# One shot is possible only if the native server is on a free port, e.g.
#   .\scripts\move-to-native-postgres.ps1 -Password '...' -Port 5433
#
# -Password         password of the 'postgres' user on the NEW native server
# -Port             port of the NEW native server (default 5432)
# -SkipNpmInstall   backend deps already installed before the downtime window
# -Force            answer yes to every confirmation - for unattended reruns only
#
# Rollback at any point before step 8: docker compose up -d
# The Docker volume kwanza_pgdata is never touched.

param(
  [string]$Password = '',
  [int]$Port = 5432,
  [string]$PgBin = '',
  [string]$WorkDir = 'C:\nexor-move',
  [string]$InstallDir = 'C:\NEXOR ERP',
  [string]$Database = 'kwanza_erp',
  [string]$DbUser = 'postgres',
  [string]$PgContainer = 'kwanza-postgres',
  [string]$BackendContainer = 'nexor-backend',
  [switch]$DumpOnly,
  [switch]$ResumeFromRestore,
  [switch]$SkipNpmInstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$script:StepNo = 0

function Write-Step([string]$text) {
  $script:StepNo = $script:StepNo + 1
  Write-Host ''
  Write-Host ("=== Step {0}: {1}" -f $script:StepNo, $text) -ForegroundColor Cyan
}

function Write-Ok([string]$text) { Write-Host ("    OK  " + $text) -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host ("    !!  " + $text) -ForegroundColor Yellow }
function Write-Info([string]$text) { Write-Host ("        " + $text) }

# Expected, actionable failures print one red block and exit. A raw throw would
# bury the instruction under a PowerShell stack trace.
function Fail([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  Write-Host ''
  exit 1
}

function Confirm-Or-Exit([string]$question) {
  if ($Force) { return }
  $answer = Read-Host ($question + " [y/N]")
  if ($answer -ne 'y' -and $answer -ne 'Y') {
    Write-Host 'Aborted by user. Nothing was changed.' -ForegroundColor Yellow
    exit 1
  }
}

function Find-PgBin([string]$hint) {
  if ($hint) {
    if (Test-Path -LiteralPath (Join-Path $hint 'psql.exe')) { return $hint }
    Fail "psql.exe not found in -PgBin '$hint'."
  }
  # 16 first: the Docker server is postgres:16, so a 16 client always matches.
  foreach ($v in @('16', '17', '18', '15')) {
    $candidate = "C:\Program Files\PostgreSQL\$v\bin"
    if (Test-Path -LiteralPath (Join-Path $candidate 'psql.exe')) { return $candidate }
  }
  $onPath = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($onPath) { return (Split-Path -Parent $onPath.Source) }
  Fail @"
Native PostgreSQL client not found.
Install PostgreSQL 16 for Windows first (match the postgres:16 container), then re-run.
If it is installed elsewhere, pass -PgBin "D:\PostgreSQL\16\bin".
"@
}

function Invoke-Psql {
  param(
    [string[]]$ExtraArgs,
    [string]$TargetDb = '',
    [switch]$PassThru
  )
  $argList = @('-h', '127.0.0.1', '-p', "$Port", '-U', $DbUser, '-v', 'ON_ERROR_STOP=1')
  if ($TargetDb) { $argList += @('-d', $TargetDb) }
  $argList += $ExtraArgs
  if ($PassThru) {
    return (& $script:Psql @argList 2>&1)
  }
  & $script:Psql @argList
  if ($LASTEXITCODE -ne 0) { throw "psql failed (exit $LASTEXITCODE): $($argList -join ' ')" }
}

# Capturing a native command's output while redirecting stderr turns docker's
# own error text into a NativeCommandError under ErrorActionPreference=Stop.
function Invoke-Docker {
  param([string[]]$DockerArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & docker @DockerArgs 2>&1
    # Flatten to plain text: piping ErrorRecord objects through Out-String
    # would paste PowerShell's whole stack trace into the message.
    $lines = @()
    foreach ($item in $output) {
      if ($item -is [System.Management.Automation.ErrorRecord]) {
        $lines += $item.Exception.Message
      } else {
        $lines += [string]$item
      }
    }
    return @{ Text = (($lines -join "`n").Trim()); Code = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $previous
    $global:LASTEXITCODE = 0
  }
}

function Assert-DockerDaemon {
  $probe = Invoke-Docker @('version', '--format', '{{.Server.Version}}')
  if ($probe.Code -ne 0) {
    Fail @"
The Docker daemon is not responding, so the current data cannot be read out.
Start Docker Desktop, wait until it reports Running, then re-run this script.

docker said:
$($probe.Text)
"@
  }
  Write-Ok ("Docker daemon " + $probe.Text)
}

function Get-ContainerState([string]$name) {
  $probe = Invoke-Docker @('inspect', '-f', '{{.State.Running}}', $name)
  if ($probe.Code -ne 0) { return 'missing' }
  if ($probe.Text -eq 'true') { return 'running' }
  return 'stopped'
}

# Row counts for every base table, as "table,count" lines. The query_to_xml trick
# avoids one psql round trip per table.
$CountSql = @"
SELECT table_name || ',' || (xpath('/row/c/text()', query_to_xml(
         format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
         false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
"@

Write-Host '=== NEXOR ERP: Docker to native PostgreSQL ===' -ForegroundColor Cyan

if ($DumpOnly -and $ResumeFromRestore) {
  Fail '-DumpOnly and -ResumeFromRestore are opposite phases. Pass only one.'
}
if (-not $DumpOnly -and -not $Password) {
  Fail @"
-Password is required: the password of the '$DbUser' user on the NEW native server.

If PostgreSQL is not installed yet, run the export phase first:
  .\scripts\move-to-native-postgres.ps1 -DumpOnly
"@
}
if ($DumpOnly) {
  Write-Info 'Mode: export only. Nothing will be written to a native server.'
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$backendDir = Join-Path $repoRoot 'backend'
if (-not (Test-Path -LiteralPath (Join-Path $backendDir 'package.json'))) {
  throw "backend\package.json not found under $repoRoot. Run this from the server repo clone."
}
Write-Info "Repo:    $repoRoot"
Write-Info "Backend: $backendDir"

$dumpFile = Join-Path $WorkDir 'kwanza_erp.sql'
$secretsStage = Join-Path $WorkDir 'nexor-data'
$countsBefore = Join-Path $WorkDir 'counts-docker.txt'
$countsAfter = Join-Path $WorkDir 'counts-native.txt'

# ---------------------------------------------------------------- preflight
Write-Step 'Preflight checks'

# In -DumpOnly the native server does not exist yet, so nothing native is checked.
if (-not $DumpOnly) {
  $script:PgBinDir = Find-PgBin $PgBin
  $script:Psql = Join-Path $script:PgBinDir 'psql.exe'
  Write-Ok "psql: $script:Psql"

  $pgVersionLine = & $script:Psql --version
  Write-Info $pgVersionLine
  if ($pgVersionLine -notmatch '\s16\.') {
    Write-Warn2 'Native client is not PostgreSQL 16. The container runs postgres:16.'
    Write-Warn2 'Restoring a 16 dump into a newer server works, but 16 is the tested match.'
    Confirm-Or-Exit 'Continue with this version anyway?'
  }

  foreach ($tool in @('node', 'npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
      Fail "$tool is not in PATH. Install Node.js 22 LTS on the server, then re-run."
    }
  }
  Write-Ok ("node " + (node --version))
}

# Resume mode reads nothing from Docker - by then the containers are usually down.
$pgState = 'skipped'
$beState = 'skipped'
if (-not $ResumeFromRestore) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'docker is not in PATH. It is needed to read the current data out of the container.'
  }
  Assert-DockerDaemon

  $pgState = Get-ContainerState $PgContainer
  $beState = Get-ContainerState $BackendContainer
  Write-Info ("container {0}: {1}" -f $PgContainer, $pgState)
  Write-Info ("container {0}: {1}" -f $BackendContainer, $beState)

  if ($pgState -ne 'running') {
    Fail "Container $PgContainer is '$pgState'. Start it first: docker compose up -d postgres"
  }
  if ($beState -eq 'missing') {
    Write-Warn2 "Container $BackendContainer not found - secrets cannot be copied automatically."
    Write-Warn2 'If this server never ran the backend in Docker, that is expected.'
    Confirm-Or-Exit 'Continue without copying secrets from the backend container?'
  }
}

# Native server must be reachable before we promise anything.
if (-not $DumpOnly) {
  $env:PGPASSWORD = $Password
  $env:PGCLIENTENCODING = 'UTF8'
  try {
    Invoke-Psql -ExtraArgs @('-t', '-A', '-c', 'SELECT version();') -TargetDb 'postgres' | Out-Null
    Write-Ok "Native PostgreSQL on 127.0.0.1:$Port accepted the password."
  } catch {
    $portHint = ''
    if ($Port -eq 5432 -and $pgState -eq 'running') {
      $portHint = @"

The Docker container is still running and publishes host port 5432, so the
installer may have put the native server on 5433 instead. Either finish the
export first and run 'docker compose down', or pass -Port 5433.
"@
    }
    Fail @"
Cannot log in to the native PostgreSQL on 127.0.0.1:$Port as '$DbUser'.
Check the service is running and that -Password matches the password set during install.
$portHint
Original error:
$($_.Exception.Message)
"@
  }
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Write-Ok "Work folder: $WorkDir"

if (-not $ResumeFromRestore) {
  # ------------------------------------------------------------- quiesce
  Write-Step 'Stop the Docker backend so nothing writes after the dump'
  Write-Info 'Tills will be offline from here until the native backend is up.'
  Confirm-Or-Exit 'Stop nexor-backend now?'
  if ($beState -eq 'running') {
    $stop = Invoke-Docker @('stop', $BackendContainer)
    if ($stop.Code -ne 0) { throw "Could not stop $BackendContainer : $($stop.Text)" }
    Write-Ok "Stopped $BackendContainer (port 3000 is now free)"
  } else {
    Write-Info 'Backend container was not running.'
  }

  # ------------------------------------------------------------- dump
  Write-Step 'Dump the database from inside the container'
  # Written inside the container and copied out: PowerShell 5.1 redirection
  # would re-encode the dump as UTF-16 and corrupt it.
  $dump = Invoke-Docker @(
    'exec', $PgContainer, 'pg_dump', '-U', $DbUser, '-d', $Database,
    '--no-owner', '--no-acl', '-f', '/tmp/nexor-move.sql'
  )
  if ($dump.Code -ne 0) { throw "pg_dump inside the container failed: $($dump.Text)" }
  if (Test-Path -LiteralPath $dumpFile) { Remove-Item -LiteralPath $dumpFile -Force }
  $copy = Invoke-Docker @('cp', ("{0}:/tmp/nexor-move.sql" -f $PgContainer), $dumpFile)
  if ($copy.Code -ne 0) { throw "docker cp of the dump failed: $($copy.Text)" }

  $dumpInfo = Get-Item -LiteralPath $dumpFile
  if ($dumpInfo.Length -lt 1024) {
    Fail "Dump is only $($dumpInfo.Length) bytes - refusing to continue. Nothing was changed."
  }
  $tail = (Get-Content -LiteralPath $dumpFile -Tail 5) -join ' '
  if ($tail -notmatch 'PostgreSQL database dump complete') {
    Fail 'Dump does not end with the completion marker - it is truncated. Re-run the script.'
  }
  Write-Ok ("Dump: {0} ({1:N1} MB), completion marker present" -f $dumpFile, ($dumpInfo.Length / 1MB))

  Invoke-Docker @('exec', $PgContainer, 'rm', '-f', '/tmp/nexor-move.sql') | Out-Null

  # ------------------------------------------------------------- counts
  Write-Step 'Record row counts from the container (for verification later)'
  $sqlOneLine = ($CountSql -replace '\r?\n', ' ')
  $probe = Invoke-Docker @('exec', $PgContainer, 'psql', '-U', $DbUser, '-d', $Database, '-t', '-A', '-c', $sqlOneLine)
  if ($probe.Code -ne 0) {
    throw "Could not read row counts from the container. psql said: $($probe.Text)"
  }
  $before = @($probe.Text -split '\r?\n' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
  if ($before.Count -eq 0) { throw 'Row count query returned nothing - refusing to continue.' }
  Set-Content -LiteralPath $countsBefore -Value $before -Encoding ASCII
  Write-Ok ("{0} tables recorded in {1}" -f $before.Count, $countsBefore)

  # ------------------------------------------------------------- secrets
  Write-Step 'Copy secrets and AGT certificates out of the backend volume'
  # NEXOR_INSTALL_DIR=/app/data in compose, and nexorSecrets uses
  # <installDir>/data/secrets, so inside the container that is /app/data/data.
  if ($beState -ne 'missing') {
    if (Test-Path -LiteralPath $secretsStage) {
      Remove-Item -LiteralPath $secretsStage -Recurse -Force
    }
    $copySecrets = Invoke-Docker @('cp', ("{0}:/app/data/data" -f $BackendContainer), $secretsStage)
    if ($copySecrets.Code -ne 0) {
      Write-Warn2 "Could not read /app/data/data from $BackendContainer."
      Write-Info  ("docker said: " + $copySecrets.Text)
      Write-Warn2 'If that path does not exist, this server never persisted secrets in the'
      Write-Warn2 'container. Continuing means every till logs in again, and any encrypted'
      Write-Warn2 'AGT key must be re-entered.'
      Confirm-Or-Exit 'Continue without the secrets?'
    } else {
      $jwt = Join-Path $secretsStage 'secrets\jwt.secret'
      $master = Join-Path $secretsStage 'secrets\master.key'
      if (Test-Path -LiteralPath $jwt) {
        Write-Ok 'jwt.secret found - till sessions will survive the move.'
      } else {
        Write-Warn2 'jwt.secret NOT found. Every till will need to log in again after the move.'
      }
      if (Test-Path -LiteralPath $master) {
        Write-Ok 'master.key found - encrypted AGT keys stay readable.'
      } else {
        Write-Warn2 'master.key NOT found. Encrypted AGT keys and PKCS#12 passphrases'
        Write-Warn2 'cannot be decrypted without it and would need re-entering.'
      }
      $signing = Join-Path $secretsStage 'signing'
      if (Test-Path -LiteralPath $signing) {
        $pfx = @(Get-ChildItem -LiteralPath $signing -Filter '*.pfx' -ErrorAction SilentlyContinue).Count
        Write-Ok ("signing folder copied ({0} pfx file(s))" -f $pfx)
      }
      if (-not (Test-Path -LiteralPath $jwt) -or -not (Test-Path -LiteralPath $master)) {
        Confirm-Or-Exit 'Continue even though a secret is missing?'
      }
    }
  }
} else {
  Write-Step 'Resume mode: skipping stop, dump and secret copy'
  if (-not (Test-Path -LiteralPath $dumpFile)) { throw "No dump at $dumpFile - run without -ResumeFromRestore." }
  Write-Ok "Using existing dump $dumpFile"
}

if ($DumpOnly) {
  Write-Host ''
  Write-Host '=== Export complete - nothing has been cut over yet ===' -ForegroundColor Green
  Write-Host ''
  Write-Info ("Dump:    " + $dumpFile)
  Write-Info ("Secrets: " + $secretsStage)
  Write-Info ("Counts:  " + $countsBefore)
  Write-Host ''
  Write-Host 'Copy that folder somewhere off this machine before continuing.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Next, in order:' -ForegroundColor Cyan
  Write-Host '  1. docker compose down          (frees port 5432, keeps the data volume)'
  Write-Host '  2. Install PostgreSQL 16 for Windows, port 5432, and note the postgres password'
  Write-Host '  3. .\scripts\move-to-native-postgres.ps1 -Password ''ThatPassword'' -ResumeFromRestore'
  Write-Host ''
  Write-Host 'To abandon the move and go back: docker compose up -d' -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------- create db
Write-Step 'Create the native database and extensions'
$exists = Invoke-Psql -PassThru -TargetDb 'postgres' -ExtraArgs @(
  '-t', '-A', '-c', "SELECT 1 FROM pg_database WHERE datname = '$Database';"
)
if (($exists -join '').Trim() -eq '1') {
  $tableCount = Invoke-Psql -PassThru -TargetDb $Database -ExtraArgs @(
    '-t', '-A', '-c', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
  )
  $tableCount = [int](($tableCount -join '').Trim())
  Write-Warn2 "Database '$Database' already exists with $tableCount table(s) in public."
  if ($tableCount -gt 0) {
    Write-Warn2 'Restoring on top of existing tables will produce duplicate-key errors.'
    Write-Info  "To start clean:  psql -U $DbUser -c ""DROP DATABASE $Database;"""
    Confirm-Or-Exit 'Attempt the restore into this existing database anyway?'
  }
} else {
  Invoke-Psql -TargetDb 'postgres' -ExtraArgs @('-c', "CREATE DATABASE $Database;")
  Write-Ok "Created database $Database"
}

Invoke-Psql -TargetDb $Database -ExtraArgs @(
  '-c', 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS pgcrypto;'
)
Write-Ok 'Extensions uuid-ossp and pgcrypto present'

# ---------------------------------------------------------------- restore
Write-Step 'Restore the dump'
Write-Info 'This can take a while on a large database.'
& $script:Psql '-h' '127.0.0.1' '-p' "$Port" '-U' $DbUser '-d' $Database `
  '-v' 'ON_ERROR_STOP=1' '--single-transaction' '-f' $dumpFile
if ($LASTEXITCODE -ne 0) {
  Fail @"
Restore FAILED and was rolled back (--single-transaction), so the native database
is unchanged and no cutover happened.

Your data is still in Docker. To bring the old server back up:
  docker compose up -d
"@
}
Write-Ok 'Restore completed with no errors'

# ---------------------------------------------------------------- verify
Write-Step 'Compare row counts, container vs native'
$afterRaw = Invoke-Psql -PassThru -TargetDb $Database -ExtraArgs @(
  '-t', '-A', '-c', ($CountSql -replace '\r?\n', ' ')
)
$after = @($afterRaw | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
Set-Content -LiteralPath $countsAfter -Value $after -Encoding ASCII

if (Test-Path -LiteralPath $countsBefore) {
  $beforeMap = @{}
  foreach ($line in (Get-Content -LiteralPath $countsBefore)) {
    $parts = $line.Split(',')
    if ($parts.Count -ge 2) { $beforeMap[$parts[0]] = [int]$parts[1] }
  }
  $afterMap = @{}
  foreach ($line in $after) {
    $parts = $line.Split(',')
    if ($parts.Count -ge 2) { $afterMap[$parts[0]] = [int]$parts[1] }
  }

  $mismatch = @()
  $totalRows = 0
  foreach ($tbl in $beforeMap.Keys) {
    $want = $beforeMap[$tbl]
    $totalRows = $totalRows + $want
    $got = -1
    if ($afterMap.ContainsKey($tbl)) { $got = $afterMap[$tbl] }
    if ($got -ne $want) { $mismatch += ("  {0}: docker={1} native={2}" -f $tbl, $want, $got) }
  }

  if ($mismatch.Count -eq 0) {
    Write-Ok ("All {0} tables match ({1:N0} rows total)" -f $beforeMap.Count, $totalRows)
  } else {
    Write-Warn2 ("{0} table(s) do not match:" -f $mismatch.Count)
    foreach ($m in $mismatch) { Write-Host $m -ForegroundColor Yellow }
    Write-Warn2 "Full lists: $countsBefore and $countsAfter"
    Confirm-Or-Exit 'Continue with the cutover despite the mismatch?'
  }
} else {
  Write-Warn2 "No container counts on file (resume mode) - skipped comparison."
}

# ---------------------------------------------------------------- cutover
Write-Step 'Install secrets and write database.env'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

if (Test-Path -LiteralPath $secretsStage) {
  $targetData = Join-Path $InstallDir 'data'
  New-Item -ItemType Directory -Force -Path $targetData | Out-Null
  robocopy $secretsStage $targetData /E /NFL /NDL /NJH /NJS /NP | Out-Null
  # robocopy exit codes below 8 are success.
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
  $global:LASTEXITCODE = 0
  Write-Ok "Secrets and certificates installed under $targetData"
} else {
  Write-Warn2 'No staged secrets to install.'
}

$envFile = Join-Path $InstallDir 'database.env'
$connString = "postgres://{0}:{1}@127.0.0.1:{2}/{3}" -f $DbUser, $Password, $Port, $Database
if (Test-Path -LiteralPath $envFile) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $envFile -Destination ("{0}.bak-{1}" -f $envFile, $stamp) -Force
  Write-Info ("Existing database.env backed up as database.env.bak-{0}" -f $stamp)
}
$envLines = @(
  '# Written by scripts\move-to-native-postgres.ps1',
  'DB_ENGINE=postgres',
  ("DATABASE_URL=" + $connString),
  '',
  '# pg_dump for Settings -> Database backup, now that the container is gone.',
  ("PG_DUMP_PATH=" + (Join-Path $script:PgBinDir 'pg_dump.exe')),
  ("PSQL_PATH=" + $script:Psql)
)
Set-Content -LiteralPath $envFile -Value $envLines -Encoding ASCII
Write-Ok "Wrote $envFile"

$ipFile = Join-Path $InstallDir 'IP'
if (-not (Test-Path -LiteralPath $ipFile)) {
  Set-Content -LiteralPath $ipFile -Value 'postgres' -Encoding ASCII
  Write-Ok "Wrote $ipFile (server marker)"
}

# ---------------------------------------------------------------- backend
Write-Step 'Install backend dependencies and apply schema'
$env:DB_ENGINE = 'postgres'
$env:DATABASE_URL = $connString
$env:NEXOR_INSTALL_DIR = $InstallDir

Push-Location $backendDir
try {
  # npm ci wipes node_modules and reinstalls, so pre-installing before the downtime
  # window only helps if we are told to leave it alone.
  if ($SkipNpmInstall) {
    if (-not (Test-Path -LiteralPath 'node_modules\express\package.json')) {
      Fail @"
-SkipNpmInstall was passed but $backendDir\node_modules looks incomplete.
Run this first, then re-run with -ResumeFromRestore:
  cd "$backendDir"
  npm ci --omit=dev
"@
    }
    Write-Ok 'Using the backend node_modules already on disk (-SkipNpmInstall)'
  } elseif (Test-Path -LiteralPath 'package-lock.json') {
    npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci for the backend failed.' }
  } else {
    npm install --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm install for the backend failed.' }
  }

  npm run migrate
  if ($LASTEXITCODE -ne 0) { throw 'npm run migrate failed.' }
  Write-Ok 'Migrations applied'

  npm run ensure-schema
  if ($LASTEXITCODE -ne 0) { throw 'npm run ensure-schema failed.' }
  Write-Ok 'Schema ensure passed'
} finally {
  Pop-Location
}

$webapp = Join-Path $backendDir 'webapp'
if (Test-Path -LiteralPath (Join-Path $webapp 'index.html')) {
  Write-Ok 'backend\webapp present - browser /app will work'
} else {
  Write-Warn2 'backend\webapp\index.html missing - /app would be blank.'
  Write-Info  'Run from the repo root: npm run build:webapp'
}

# ---------------------------------------------------------------- done
Write-Host ''
Write-Host '=== Data move complete ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Start the native backend and check health:' -ForegroundColor Cyan
Write-Host ("  cd `"{0}`"" -f $backendDir)
Write-Host '  npm start'
Write-Host '  Invoke-RestMethod http://127.0.0.1:3000/api/health'
Write-Host ''
Write-Host 'Then verify in the app: engine PostgreSQL, a known day of invoices,' -ForegroundColor Cyan
Write-Host 'and take one backup from Settings -> Database backup.'
Write-Host ''
Write-Host 'Still to do, deliberately not automated:' -ForegroundColor Yellow
Write-Host '  1. Register the backend as a Windows service, or it stays down after a reboot'
Write-Host '     (docker compose restart:unless-stopped was doing that until now).'
Write-Host '  2. Only once everything is verified:  docker compose down'
Write-Host '     Keep the kwanza_pgdata volume and the dump for a few weeks as rollback.'
if ($Port -ne 5432) {
  Write-Host ("  3. The native server is on port {0}, not the usual 5432, because Docker held" -f $Port)
  Write-Host '     that port. Moving it back later means editing postgresql.conf, restarting'
  Write-Host '     the service, and updating DATABASE_URL in database.env.'
}
Write-Host ''
Write-Host ("Rollback until you run docker compose down:  docker compose up -d") -ForegroundColor Yellow
Write-Host ("Dump kept at: {0}" -f $dumpFile)
