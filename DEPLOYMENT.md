# NEXOR ERP — Deployment standard (Phase A)

Use this checklist on **every PC** (head office, Soyo, server).

## One database per site

| Role | Canonical path |
|------|----------------|
| Server / standalone | `C:\NEXOR ERP\data\erp.db` |
| Config pointer | `C:\NEXOR ERP\IP` (must contain the full path to the `.db` file) |

On startup the app:

1. Picks the **largest valid** `erp.db` if legacy copies exist (`C:\nexor\erp.db`, `%AppData%\NEXOR ERP\erp.db`, etc.).
2. **Writes that path back** to the IP file so the next restart uses the same file.

## Release on all machines

1. Build installer: `build-installer.bat` (or your CI artefact).
2. Install the **same version** on server and all clients.
3. **Do not** rely on Hot Update alone when the backend changed — rebuild ships new API routes and SQLite columns.
4. After install, open **Settings → Database & deployment** and confirm:
   - App version matches your release tag (e.g. `1.0.46`)
   - Schema version = expected (currently **23**)
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

## PostgreSQL (optional)

If `DATABASE_URL` is set, the app uses PostgreSQL instead of SQLite. Run `cd backend && node src/migrations/run.js` on the server. Phase A duplicate-file rules apply to SQLite installs only.
