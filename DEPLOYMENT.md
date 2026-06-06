# NEXOR ERP — Deployment standard (Phase A)

Use this checklist on **every PC** (head office, Soyo, server).

## One database per site

### PostgreSQL (recommended for server)

| Role | Config |
|------|--------|
| Server | `C:\NEXOR ERP\database.env` with `DATABASE_URL` + `DB_ENGINE=postgres` |
| Server marker | `C:\NEXOR ERP\IP` → `postgres` (or any path; `database.env` overrides) |
| Clients | `C:\NEXOR ERP\IP` → server LAN IP only (no `database.env`) |

Full steps: **[POSTGRESQL.md](./POSTGRESQL.md)**.

### SQLite (legacy / rollback)

| Role | Canonical path |
|------|----------------|
| Server / standalone | `C:\NEXOR ERP\data\erp.db` |
| Config pointer | `C:\NEXOR ERP\IP` (full path to the `.db` file) |

On startup (SQLite only):

1. Picks the **largest valid** `erp.db` if legacy copies exist (`C:\nexor\erp.db`, `%AppData%\NEXOR ERP\erp.db`, etc.).
2. **Writes that path back** to the IP file so the next restart uses the same file.

## Release on all machines

1. Build installer: `build-installer.bat` (or your CI artefact).
2. Install the **same version** on server and all clients.
3. **Do not** rely on Hot Update alone when the backend changed — rebuild ships new API routes and SQLite columns.
4. After install, open **Settings → Database & deployment** and confirm:
   - App version matches your release tag (e.g. `1.0.46`)
   - Schema version = expected (currently **24**)
   - **Active database** path is `C:\NEXOR ERP\data\erp.db` (or your chosen single path)
   - No duplicate-database warnings (or resolve them — see below)
   - Latest backup is recent

## Backups

- Create a backup from **Settings → Database backup** before upgrades and before deleting old `.db` files.
- Default folder: `%AppData%\NEXOR ERP\backups`

## If you see “other database files”

1. Note sizes in **Settings → Database & deployment**.
2. Confirm which file has current stock/sales (usually the **active** path shown).
3. **Backup** the active file.
4. Rename old copies to `.db.archived-YYYYMMDD` (do not delete until verified).

## Health API (IT / monitoring)

- `GET /api/health?lite=1` — ping + app version + db path  
- `GET /api/deployment/status` — full Phase A report (schema, duplicates, backups)

## PostgreSQL

Server cutover is configured via `C:\NEXOR ERP\database.env`, not the client `IP` file. See **[POSTGRESQL.md](./POSTGRESQL.md)**. Phase A duplicate-database warnings apply to SQLite installs only.
