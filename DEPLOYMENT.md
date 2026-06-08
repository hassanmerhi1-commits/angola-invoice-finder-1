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
   - Schema version = expected (currently **28**)
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

## Phase B sync topology (multi-city)

Full target architecture: **[SYNC-ARCHITECTURE-GAP.md](./SYNC-ARCHITECTURE-GAP.md)**.

### Roles

| PC | `NEXOR_INSTALLATION_ROLE` | Database |
|----|---------------------------|----------|
| Shop client | `shop_client` | Phase B1: local SQLite (not yet default) |
| City server | `city_server` | PostgreSQL |
| HQ | `main_server` | PostgreSQL |

### Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXOR_CLIENT_SYNC_API_KEY` | City `database.env` + shop `sync.env` | Secures `POST /api/sync/client-ingest` |
| `NEXOR_SYNC_API_KEY` | HQ + city | City → HQ `POST /api/sync/ingest` |
| `NEXOR_MAIN_API_URL` | City server | HQ base URL for replicator |
| `NEXOR_CITY_API_URL` | Shop client (optional) | Override city API for offline flush |
| `AGT_API_URL` / `AGT_API_KEY` | City server | Real AGT transmission (`AGT_SIMULATE=false`) |

Copy **[sync.env.example](./sync.env.example)** → `C:\NEXOR ERP\sync.env` on shop PCs.

### After backend upgrade (Phase B0+)

1. Run migrations on PostgreSQL server (schema **27**):

   ```powershell
   cd backend
   .\scripts\run-migrate.ps1
   ```

2. Generate a shared key (PowerShell):

   ```powershell
   -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
   ```

3. Set `NEXOR_CLIENT_SYNC_API_KEY` on city server and all shop clients.

4. Restart NEXOR ERP on server and clients.

5. Verify:

   - `GET /api/sync/status` (HQ/city API key) — pending/dead counts, per-branch breakdown  
   - `GET /api/sync/status/summary` (client sync key) — lighter ops view  
   - `sync_audit_log` table — append-only sync trail  

### Phase B1 — offline-first shop client

Enable on **shop PCs only** (not city server):

1. Copy `sync.env.example` → `C:\NEXOR ERP\sync.env`
2. Set `NEXOR_OFFLINE_FIRST=true` and the same `NEXOR_CLIENT_SYNC_API_KEY` as the city server
3. Re-run **Setup → Client** (or set `localStorage` `nexor_offline_first=true` via Setup wizard)
4. Local database: `C:\NEXOR ERP\data\client.db`
5. POS saves to SQLite first; background worker uploads to city server every ~8s

Settings → **Local sync queue** shows pending uploads and **Sync now**.

### Phase B2 — AGT from shop client

When `NEXOR_OFFLINE_FIRST=true`, a background **AGT worker** on the shop PC:

1. Signs the invoice locally (SAF-T hash)
2. Submits to AGT within ~5 seconds (or retries with backoff)
3. Updates the city sync payload so the city server does not double-submit

Add to `C:\NEXOR ERP\sync.env` on shop PCs (and real URLs on production):

```env
AGT_API_URL=https://your-agt-endpoint
AGT_API_KEY=your_key
AGT_SIMULATE=false
```

Without `AGT_API_URL`, AGT responses are **simulated** (for testing only).

### Phase B3 — on your laptop (no branch PCs yet)

1. Run migration **28** (`.\scripts\run-migrate.ps1` or `node backend/src/migrations/run.js`).
2. Deploy backend: `.\scripts\sync-nexor-backend.ps1` and restart NEXOR ERP.
3. Open **Settings → Sync & replication** — shows city/HQ outbox (pending AGT, pending main).
4. Shop ingest API accepts: `sale.created`, `payment.created`, `stock_movement` (ready when branch PCs exist).
5. `GET /api/sync/master-data?branchId=...` — products/clients pull for future shop clients.

### Deploy script

Sync updated backend to production:

```powershell
.\scripts\sync-nexor-backend.ps1
```

Then restart `C:\NEXOR ERP\Start NEXOR ERP.bat`.
