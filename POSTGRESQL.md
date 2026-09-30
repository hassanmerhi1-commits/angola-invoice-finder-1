# NEXOR ERP — PostgreSQL server setup

Use PostgreSQL on the **server PC** only. Client PCs keep `C:\NEXOR ERP\IP` with the server LAN address (no database file, no `database.env`).

## Architecture

| PC | `IP` file | `database.env` | Data |
|----|-----------|----------------|------|
| Server | `postgres` or legacy `.db` path (ignored when `database.env` is set) | **Required** — `DATABASE_URL` | PostgreSQL |
| Client | `192.168.x.x` (server IP) | none | HTTP API only |

The embedded Express backend reads `C:\NEXOR ERP\database.env` and sets `DATABASE_URL` / `DB_ENGINE=postgres`. SQLite `erp.db` is not used on the server when that file is present.

## 1. Install PostgreSQL

**Option A — Native PostgreSQL 16** on Windows (production). Match the major version used by
`docker-compose.yml` (`postgres:16`) and by the backend image (`postgresql-client-16`). Create
database `kwanza_erp` and a strong password. Leave it listening on `127.0.0.1` — clients only ever
talk to port 3000, never to the database.

**Option B — Docker (dev / small sites)**

```powershell
cd C:\path\to\angola-invoice-finder-1
docker compose up -d postgres
```

Default database: `kwanza_erp`, user `postgres`, password from `docker-compose.yml` (`POSTGRES_PASSWORD`).

### Already running in Docker and want to move off it

`scripts\move-to-native-postgres.ps1` does the cutover on the server PC: dumps from the container,
copies `jwt.secret` / `master.key` / AGT certs out of the `nexor_data` volume, restores into the
native server, compares row counts per table, writes `database.env`, then runs the migrations.

It runs in **two phases**, because the container publishes host port 5432 and the PostgreSQL
installer wants that same port — they cannot both hold it. So export the data *before* installing
PostgreSQL:

```powershell
# A. Docker still running, PostgreSQL not installed yet.
.\scripts\move-to-native-postgres.ps1 -DumpOnly

# B. Free the port, keeping the data volume.
docker compose down

# C. Install PostgreSQL 16 on port 5432, then finish.
.\scripts\move-to-native-postgres.ps1 -Password 'NewStrongPassword' -ResumeFromRestore
```

If you already installed PostgreSQL and it landed on **5433** because 5432 was taken, you can run
it in one shot with `-Port 5433` instead — but then move it back to 5432 later, or leave
`DATABASE_URL` pointing at 5433.

**Shortening the downtime.** Tills are offline from phase A until the native backend answers on
port 3000, and the PostgreSQL install sits inside that window. Two things can be done beforehand,
with the app still running, because neither touches the database and no recent release changed the
backend dependencies:

```powershell
# Download the PostgreSQL 16 Windows installer to the server, do not run it yet.
# Then install the backend deps that the native process will need:
cd "C:\Users\user\Documents\GitHub\angola-invoice-finder\backend"
npm ci --omit=dev
```

Then add `-SkipNpmInstall` to the phase C command, or the script's `npm ci` will delete
`node_modules` and download everything again:

```powershell
.\scripts\move-to-native-postgres.ps1 -Password 'NewStrongPassword' -ResumeFromRestore -SkipNpmInstall
```

Pre-running `npm ci` on the host is safe while Docker serves traffic: the compose file bind-mounts
`backend/src`, `backend/scripts` and `backend/package.json`, but **not** `node_modules`, so the
container never sees it.

Nothing is deleted — phase A only stops `nexor-backend`. Rollback is `docker compose up -d` until
you run `docker compose down`, and even that keeps `kwanza_pgdata`. Removing the containers, once
you have verified the data, stays a deliberate manual step.

### Keeping the API up after a reboot

`npm start` dies with its console, so once the data is moved, register the service. This replaces
Docker's `restart: unless-stopped`:

```powershell
# As Administrator.
.\scripts\install-backend-service.ps1
```

It downloads NSSM if needed, points the service at `node backend\src\server.js`, sets auto-start
and restart-on-crash, writes logs to `C:\NEXOR ERP\logs`, opens inbound TCP 3000 in Windows
Firewall (Docker was publishing the port and doing this for you), then waits for
`/api/health` and reports the engine. `-Remove` undoes it.

The database password is not copied into the service environment — `server.js` reads
`database.env` itself before connecting.

**One behaviour change to remember.** `docker-entrypoint.sh` ran the migrations on every container
start; the service does not. After each `git pull` on the server:

```powershell
cd backend
npm run migrate
npm run ensure-schema
nssm restart NexorBackend
```

**Do not skip the secrets.** They live in the Docker volume, not in git and not in the database.
Without `jwt.secret` every till gets "Invalid or expired token"; without `master.key` the encrypted
AGT key and PKCS#12 passphrase cannot be decrypted.

## 2. Apply schema (empty database)

```powershell
cd backend
$env:DATABASE_URL = "postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/kwanza_erp"
$env:DB_ENGINE = "postgres"
npm run migrate
```

This runs all SQL migrations (through **025**, incl. proformas). Confirm in logs that migrations completed.

**Easier on the server PC (PowerShell):**

```powershell
cd C:\Users\user\source\repos\angola-invoice-finder-1
.\scripts\run-migrate.ps1
```

The script reads `C:\NEXOR ERP\database.env`, can start Docker Postgres, and runs `npm run migrate`.

## 3. Copy live data from SQLite (one-time)

1. **Backup** `C:\NEXOR ERP\data\erp.db` (Settings → Database backup or file copy).
2. Stop NEXOR on the server.
3. Run:

```powershell
cd backend
$env:SQLITE_PATH = "C:\NEXOR ERP\data\erp.db"
$env:DATABASE_URL = "postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/kwanza_erp"
# Optional dry run:
# $env:MIGRATE_DRY_RUN = "true"
node scripts/migrate-sqlite-to-postgres.js
```

The script remaps TEXT ids to UUIDs and imports core tables including **purchase_invoices**, **open_items**, **payments**, **clearings**, and **stock_movements** (required for Pagamentos, checklist dues, and AP reports).

Rows that cannot be linked (missing supplier/client/document) are skipped and logged.

## 4. Enable PostgreSQL in NEXOR

1. Copy `database.env.example` → `C:\NEXOR ERP\database.env`.
2. Set `DATABASE_URL` (and `DB_ENGINE=postgres`).
3. Set `C:\NEXOR ERP\IP` to a single line: `postgres` (or leave a `.db` path — **`database.env` wins**).
4. Install the **same app version** on server and clients; restart the server app.

## 5. Verify

- **Settings → Database & deployment**: engine PostgreSQL, schema version **28**.
- `GET http://127.0.0.1:<port>/api/deployment/status` — no SQLite duplicate warnings.
- Pagamentos → Itens em aberto, checklist due payments, Contas a pagar report.
- Create a backup (`.sql` when on PostgreSQL).

## Backups

- UI: Settings → Database backup. If `pg_dump` is not installed on Windows, the server automatically uses `docker exec kwanza-postgres pg_dump` when the Docker container is running.
- Manual (Docker): `docker exec kwanza-postgres pg_dump -U postgres -d kwanza_erp > backup.sql`
- **Native install:** that Docker fallback is gone, so `pg_dump.exe` must be reachable. Either put
  `C:\Program Files\PostgreSQL\16\bin` on the system PATH, or set `PG_DUMP_PATH` in `database.env`
  (the move script writes it for you). Test one backup from the UI on day one.

## Rollback to SQLite

1. Stop NEXOR and remove or rename `C:\NEXOR ERP\database.env`.
2. Set `IP` to `C:\NEXOR ERP\data\erp.db`.
3. Restart from your **pre-migration** `.db` backup if Postgres was written after cutover.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “HTTP service not running” | Postgres running? `database.env` URL correct? Docker port 5432? |
| Empty payables / checklist | Re-run migrate script; run **Repair supplier payables** in AP report after cutover |
| Schema mismatch | `cd backend && npm run migrate` with `DATABASE_URL` set |
| Clients cannot connect | Server firewall; `IP` on clients = server IP only |

## What is not migrated automatically

Purchase orders, stock transfers, chart-of-accounts detail, and some auxiliary tables may still live only in SQLite until added to `migrate-sqlite-to-postgres.js`. For a full historical archive, keep the `.db` backup even after PostgreSQL cutover.
