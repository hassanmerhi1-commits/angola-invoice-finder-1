# NEXOR ERP — PostgreSQL server setup

Use PostgreSQL on the **server PC** only. Client PCs keep `C:\NEXOR ERP\IP` with the server LAN address (no database file, no `database.env`).

## Architecture

| PC | `IP` file | `database.env` | Data |
|----|-----------|----------------|------|
| Server | `postgres` or legacy `.db` path (ignored when `database.env` is set) | **Required** — `DATABASE_URL` | PostgreSQL |
| Client | `192.168.x.x` (server IP) | none | HTTP API only |

The embedded Express backend reads `C:\NEXOR ERP\database.env` and sets `DATABASE_URL` / `DB_ENGINE=postgres`. SQLite `erp.db` is not used on the server when that file is present.

## 1. Install PostgreSQL

**Option A — Docker (dev / small sites)**

```powershell
cd C:\path\to\angola-invoice-finder-1
docker compose up -d postgres
```

Default database: `kwanza_erp`, user `postgres`, password from `docker-compose.yml` (`POSTGRES_PASSWORD`).

**Option B — Native PostgreSQL 16** on Windows — create database `kwanza_erp` and a strong password.

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
- Manual: `docker exec kwanza-postgres pg_dump -U postgres -d kwanza_erp > backup.sql`

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
