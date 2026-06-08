# NEXOR ERP — Sync Architecture Gap Analysis

**Target:** Offline-first distributed ERP with real-time tax reporting  
**Status:** Phase A (single-site / LAN thin client) is production; Phase B0 foundations **implemented** (2026-06-02)  
**Last updated:** 2026-06-02

This document maps your [ERP Synchronization Architecture Specification](#target-spec-summary) to the current NEXOR codebase and defines a phased build plan.

---

## Target spec summary

| Layer | Role |
|-------|------|
| **ERP Client** | SQLite, save-first, never block sales on network |
| **AGT** | Mandatory queue + immediate background submit |
| **City Server** | PostgreSQL hub, ingest from clients, regional ops |
| **HQ Server** | PostgreSQL master, ingest from cities only |

**Core rules:** Outbox pattern, UUID everywhere, separate workers (AGT / City / HQ), staged retry, full audit trail, HTTPS + JWT.

---

## Executive summary

| Area | Spec | Today | Gap |
|------|------|-------|-----|
| Client local DB | SQLite on every shop PC | Thin client — HTTP to server, no shop DB | **Large** |
| Save-before-sync | Local commit → outbox → workers | Online sales hit server API directly | **Large** |
| Client outbox | `SyncOutbox` table (AGT, CITY, HQ) | `sync-pending.json` (sales only, offline only) | **Large** |
| AGT on client | Immediate worker after local save | Server-side `agtWorker` (~5s poll) | **Medium** |
| City ingest | Secure API, all branch events | `client-ingest` — **sales only** | **Medium** |
| City → HQ | Full replication | Sales, payments, purchases, stock, journals mirror | **Small** |
| Topology | 4 explicit layers | 3 roles exist (`shop_client`, `city_server`, `main_server`) | **Small** |
| UUID / idempotency | Global IDs + ack | UUIDs + `client_request_id` on sales | **Small** |
| Audit | Per sync event | `audit_log`, `audit_logs`, `agt_transmissions` (partial) | **Medium** |
| Security | JWT all tiers | API key / Bearer on city↔HQ ingest only | **Medium** |
| Master data down | City → client catalog | Not automated | **Large** |

**Recommendation:** Adopt this spec as **Phase B**. Keep Phase A (one PostgreSQL server + LAN clients) running at live sites while Phase B is rolled out branch-by-branch.

---

## Current architecture (Phase A)

```
Shop PC (client mode)
  IP file → city/server LAN IP
  HTTP API only (no local PostgreSQL/SQLite for transactions)
  On network failure: sync-pending.json → POST /api/sync/client-ingest (sales)

City / site server
  PostgreSQL (or legacy SQLite)
  processSale → enqueueSaleCreated → sync_events (destinations: main, agt)
  agtWorker (5s) + replicator (4s city→main)

HQ (main_server)
  POST /api/sync/ingest (mirror sales/payments)
```

**Key files today:**

| Concern | Location |
|---------|----------|
| Installation roles | `backend/src/sync/installation.js`, migration `019_org_hierarchy.sql` |
| Server outbox | `backend/src/sync/outbox.js`, table `sync_events` |
| City→HQ worker | `backend/src/jobs/replicator.js` |
| AGT worker | `backend/src/jobs/agtWorker.js`, `backend/src/agt/connector.js` |
| Client offline queue | `electron/syncOutbox.cjs` → `C:\NEXOR ERP\sync-pending.json` |
| Client flush loop | `electron/main.cjs` (`startSyncOutboxWorker`, 8s) |
| City ingest | `backend/src/routes/syncIngest.js` |
| Setup wizard | `src/pages/Setup.tsx` |
| Manual USB/JSON sync | `src/pages/DataSync.tsx`, `src/hooks/useERP.ts` (`useDataSync`) |
| Sale idempotency | `backend/src/transactionEngine.js` (`client_request_id`) |

---

## Section-by-section gap matrix

### 1. ERP Client (POS / Desktop)

| Requirement | Current state | Gap | Priority |
|-------------|---------------|-----|----------|
| Local SQLite per client | Client mode sets `sqlitePath: null`; no embedded DB for shops (`electron/main.cjs`) | No local transactional store | P0 |
| Store sales, invoices, products, customers, stock, queues, AGT status | Server DB holds truth; client caches via API | Client cannot complete sale offline with stock/accounting | P0 |
| Save locally before any external call | `api.sales.create` posts to server first; queue only on network error (`src/lib/api/client.ts`) | Inverted order vs spec | P0 |
| Return success immediately after local save | Offline path returns synthetic `pendingSync` invoice | Online path waits on server round-trip | P1 |
| Background workers on client | Only JSON flush worker in Electron main | No AGT/City workers on client | P0 |

**Migration note:** Server already runs embedded Express + SQLite/Postgres. Client mode must gain a **local SQLite slice** (subset schema) + local transaction engine or a slim `processSaleLocal` path.

---

### 2. Transaction processing (sale completed)

| Step (spec) | Current state | Gap |
|-------------|---------------|-----|
| 1. Save transaction locally | Server `processSale` when online | Client-local save missing |
| 2. Create AGT submission record | `agt_transmissions` on **server** after sale | Not on client DB |
| 3. Create City sync record | `enqueueSaleCreated` on server; client JSON file on failure | No unified client outbox rows |
| 4. Return success immediately | Partial (offline queue only) | Online checkout blocks on server |
| 5. Background sync | Server workers + client JSON flush | Client workers missing |

**Existing strength:** `processSale` uses UUIDs, idempotent `client_request_id`, stock + journals atomically (`backend/src/transactionEngine.js`).

---

### 3. AGT real-time submission

| Requirement | Current state | Gap |
|-------------|---------------|-----|
| Queue immediately after local save | `signSaleInvoice` on create + `enqueueSaleCreated` with `agt` destination | Runs on server, not client |
| Statuses: Pending → Submitting → Submitted → Failed → Retrying | `agt_status` on `sales`; `agt_transmissions.agt_status` | No `Submitting` / `Retrying` enum on client |
| Store reference, timestamp, errors, retry count | `agt_transmissions` has most fields | Client-side table missing |
| Real AGT API | `AGT_API_URL` + `AGT_SIMULATE` (`backend/src/agt/connector.js`) | Defaults to **simulation** |
| Immediate submit | Poll every **5s** (`agtWorker`) | Not “immediate”; acceptable if local save is instant |

**Suggested split (spec refinement):**

- **Client:** local sign (SAF-T hash chain) + outbox row `Destination=AGT`
- **City:** AGT relay if client failed + reconciliation dashboard

---

### 4. Outbox pattern

| Spec (`SyncOutbox`) | Current state | Gap |
|---------------------|---------------|-----|
| Table on **client** with Destination AGT / CITY / HQ | `sync-pending.json` (file) | Not a DB table; not durable under crash mid-write |
| Table on **server** | `sync_events` with `destinations` JSON array `['main','agt']` | Multi-destination per row vs one row per destination |
| Status: Pending / Processing / Completed / Failed | `pending`, `sent`, `failed`, `dead` | No `Processing`; `sent` ≈ Completed |
| Fields: EventType, EntityType, EntityId, PayloadJson, RetryCount, ProcessedAt | Partial match on `sync_events` | Missing `EntityType`; client table missing entirely |
| Never delete before ack | Failed events retry; `dead` after 12 attempts | Archive/audit move not defined |

**Files to evolve:**

- New migration: `026_client_sync_outbox.sql` (client SQLite schema)
- Refactor: `backend/src/sync/outbox.js` → one row per destination (align with spec)
- Replace: `electron/syncOutbox.cjs` → SQLite-backed outbox module

---

### 5. Background sync workers

| Worker (spec) | Current state | Interval | Retry (spec) |
|---------------|---------------|----------|----------------|
| AGT | `backend/src/jobs/agtWorker.js` | 5s | Exponential cap in `markSyncEventFailed` (not 1m→1h ladder) |
| City | `electron/main.cjs` flush → `client-ingest` | 8s | Per-file attempt counter |
| HQ | `backend/src/jobs/replicator.js` | 4s | Same as outbox failed handler |

| Gap | Action |
|-----|--------|
| No client AGT worker | Add `electron/agtSyncWorker.cjs` |
| No client City worker (unified) | Rename/extend flush worker to read SQLite outbox |
| No HQ worker on client | HQ is city-only in spec ✓ (client should not target HQ) |
| Retry ladder 1m / 5m / 15m / 30m / 1h | Implement `next_retry_at` scheduler shared module |

---

### 6. City Server (PostgreSQL)

| Responsibility | Current state | Gap |
|----------------|---------------|-----|
| Receive client data | `POST /api/sync/client-ingest` | Sales only; no auth on this route |
| Aggregate city-wide data | Single DB per city server ✓ | — |
| Regional reports | Dashboard, daily reports (local) | No cross-branch city rollup UI |
| Forward to HQ | `replicator` + `enqueueSaleCreated` | Payments yes; purchases/inventory/transfers no |
| Secure APIs | `authenticateSyncIngest` on `/ingest` only | `client-ingest` is **open** |

---

### 7. HQ Server

| Requirement | Current state | Gap |
|-------------|---------------|-----|
| Ingest from cities only | `/api/sync/ingest` with API key | ✓ |
| Never connect to clients | Architecture respects this | ✓ |
| Master DB + consolidation | Mirror insert (no full engine replay) | Stock/GL may diverge from city |
| `register-main` | `backend/src/routes/installations.js` | Setup UI does not expose main registration |

---

### 8. Conflict prevention (UUID)

| Entity | Current state |
|--------|---------------|
| Sales, items, movements | `crypto.randomUUID()` in transaction engine ✓ |
| `client_request_id` | Unique index on sales (migration 019) ✓ |
| Incremental business numbers | Invoice numbers still sequential per branch (`document_sequences`) — **OK** (not used as sync PK) |

**Gap:** Master data (products, customers) edited on multiple clients needs **version** or **HQ-wins** policy (not in spec or code).

---

### 9. Audit logging

| Spec | Current state | Gap |
|------|---------------|-----|
| Log every sync event (source, destination, payload id, status, error) | `sync_events.last_error`; `agt_transmissions`; `audit_logs` (AGT/tamper) | No dedicated `sync_audit_log` table |
| No transaction disappears | Idempotency + outbox retry | Dead letter after 12 attempts needs ops alert |

**Action:** Add `sync_audit_log` (append-only) + Settings dashboard widget.

---

### 10. Offline mode

| Spec | Current state | Gap |
|------|---------------|-----|
| Sales continue | Only if sale API fails → JSON queue | Cannot sell if server down (no local stock DB) |
| Data in SQLite | N/A on client | **Critical** |
| AGT + City queued | City queue partial | AGT not queued on client |
| Auto sync on reconnect | 8s flush loop ✓ | Extend to SQLite outbox + ordering |

**Existing:** Offline **login** cache (`src/lib/offlineAuth.ts`), `SyncPendingBadge` UI.

---

### 11. Security

| Spec | Current state | Gap |
|------|---------------|-----|
| HTTPS/TLS | LAN HTTP today | TLS termination (reverse proxy or built-in) for production |
| JWT client ↔ city | Session JWT for UI auth; sync uses API key | Branch-scoped sync JWT not implemented |
| JWT city ↔ HQ | Bearer API key (`syncAuth.js`) | Works; not JWT but acceptable for S2S |
| Client ↔ AGT | Not implemented on client | AGT credentials must not live on every PC unless required |

---

## Phased implementation plan

### Phase B0 — Foundations ✅ (implemented 2026-06-02)

**Goal:** Schema and modules without changing default install behaviour.

| # | Deliverable | Status | Files |
|---|-------------|--------|-------|
| B0.1 | Document env vars for topology | ✅ | `DEPLOYMENT.md`, `database.env.example`, `sync.env.example` |
| B0.2 | `sync_audit_log` table + writer helper | ✅ | `026_sync_audit.sql`, `backend/src/sync/auditLog.js` |
| B0.3 | One-row-per-destination outbox (server) | ✅ | `027_sync_outbox_destination.sql`, `backend/src/sync/outbox.js` |
| B0.4 | Shared retry scheduler (1m→1h ladder) | ✅ | `backend/src/sync/retryPolicy.js` |
| B0.5 | Secure `client-ingest` (API key) | ✅ | `syncAuth.js`, `syncIngest.js`, `electron/syncOutbox.cjs` |
| B0.6 | Ops endpoints: pending/dead per branch | ✅ | `GET /api/sync/status`, `GET /api/sync/status/summary` |

**Exit criteria:** Run migration 026–027 on city server; set `NEXOR_CLIENT_SYNC_API_KEY`; verify audit rows in `sync_audit_log`.

**Deploy:** `.\scripts\sync-nexor-backend.ps1` + restart NEXOR ERP; schema version **27**.

---

### Phase B1 — Fat client SQLite ✅ (implemented 2026-06-02)

**Goal:** Shop PC can complete sales with city server offline.

| # | Deliverable | Details |
|---|-------------|---------|
| B1.1 | Client SQLite schema (subset) | Tables: `sales`, `sale_items`, `sync_outbox`, `agt_submissions`, `products_cache`, `stock_snapshot` |
| B1.2 | Local sale pipeline | New `backend/src/localSaleEngine.js` or flag on `processSale` for `mode=client_local` |
| B1.3 | POS save-first | Change `api.sales.create` to write local DB first, then enqueue outbox |
| B1.4 | Electron: start embedded SQLite on client mode | `electron/main.cjs`, `electron/clientDb.cjs` |
| B1.5 | Replace `sync-pending.json` | Migrate to `sync_outbox` table; one-time import of pending JSON |
| B1.6 | City sync worker (client) | Read `Destination=CITY_SERVER`, POST signed payload to ingest |
| B1.7 | UI: pending sync badge + failed queue admin | Extend `SyncPendingBadge`, Settings card |

**Exit criteria:** Pull network cable at shop → sale completes → row in local SQLite + 2 outbox rows → on reconnect city DB matches.

---

### Phase B2 — AGT on client ✅ (implemented 2026-06-02)

**Goal:** Near real-time fiscal submit from shop when internet available.

| # | Deliverable | Status | Files |
|---|-------------|--------|-------|
| B2.1 | `agt_submissions` on client SQLite | ✅ | `electron/clientDb.cjs` |
| B2.2 | Local sign before AGT submit | ✅ | `localSaleEngine.js` (`signSaleLocally`) |
| B2.3 | Client AGT worker | ✅ | `agtSyncWorker.cjs`, `clientAgtSubmit.js` |
| B2.4 | City AGT reconciliation | ✅ | `syncIngest.js` passthrough; `agtWorker.js` skip if validated |
| B2.5 | Configure `AGT_API_URL` | ✅ | `agtEnv.js`, `sync.env.example`, `DEPLOYMENT.md` |

**Exit criteria:** Sale → AGT `submitted` within ~5s (simulated if no URL); city ingest receives `agtStatus`/`agtCode` from client.

---

### Phase B3 — City hub completeness ✅ (implemented 2026-06-02)

**Goal:** City server is the operational source of truth for the municipality.

| # | Deliverable | Status | Notes |
|---|-------------|--------|-------|
| B3.1 | Extend `client-ingest` | ✅ | `sale.created`, `payment.created`, `stock_movement` |
| B3.2 | Idempotent ingest | ✅ | `client_ingest_log` + handlers |
| B3.3 | Master data pull API | ✅ | `GET /api/sync/master-data` + client pull worker |
| B3.4 | Conflict policy | ✅ | Products/clients use `version`; city wins on pull |
| B3.5 | Sync health UI | ✅ | Settings → **Sync & replication** (`/api/sync/overview`) |

**B3+ events ✅:** `caixa.close`, `purchase_invoice.created` on client-ingest + shop outbox enqueue.

**Single laptop:** Use **Settings → Sync & replication** to monitor the server outbox; shop ingest APIs are ready for future branch PCs.

---

### Phase B4 — HQ consolidation ✅ (implemented)

**Goal:** HQ reporting without direct client access.

| # | Deliverable | Details |
|---|-------------|---------|
| B4.1 | HQ ingest for inventory + purchases + GL (read models) | `hqIngestMirror.js`: `purchase_invoice.created`, `stock_movement`, `journal.posted` |
| B4.2 | Financial consolidation reports | `GET /api/sync/consolidation`, Settings sync card |
| B4.3 | Setup: register-main + city `mainApiUrl` wizard | `Setup.tsx` HQ/city role, `register-main` / `register-city` |
| B4.4 | Dead letter queue admin at HQ | `GET/POST /api/sync/dead-letter/*`, replay + resolve in Settings |

**Exit criteria:** Soyo city server → Luanda HQ: sales, payments, purchases visible in HQ dashboard within 1 minute on LAN/VPN.

---

### Phase B5 — Hardening (ongoing)

| Item | Details |
|------|---------|
| TLS | nginx or Caddy on city/HQ |
| Branch-scoped JWT | `sub=branch_id`, short-lived sync tokens |
| Ordering | Per-branch sequence in outbox processing |
| Compression | Large payload batching for end-of-day catch-up |
| Monitoring | `GET /api/deployment/status` + sync metrics |
| Load test | 50 clients × 500 sales/day |

---

## Configuration checklist (target topology)

### Shop client PC

```env
NEXOR_INSTALLATION_ROLE=shop_client
NEXOR_CITY_API_URL=https://192.168.10.1:3000
NEXOR_BRANCH_ID=<uuid>
# Optional: AGT_API_URL if submitting from client
```

`C:\NEXOR ERP\IP` → city server IP (unchanged)  
Local DB: `C:\NEXOR ERP\data\client.db` (new in Phase B1)

### City server

```env
NEXOR_INSTALLATION_ROLE=city_server
NEXOR_MAIN_API_URL=https://hq.example.com:3000
NEXOR_SYNC_API_KEY=<shared-with-hq>
DATABASE_URL=postgres://...
DB_ENGINE=postgres
AGT_API_URL=<real-agt-endpoint>
AGT_SIMULATE=false
```

Run: `POST /api/installations/register-city` with province, municipio, mainApiUrl

### HQ server

```env
NEXOR_INSTALLATION_ROLE=main_server
NEXOR_SYNC_API_KEY=<issue-to-each-city>
DATABASE_URL=postgres://...
```

Run: `POST /api/installations/register-main`

---

## Decisions required before Phase B1

| # | Question | Options |
|---|----------|---------|
| D1 | AGT submit from **client** or **city only**? | Client (spec) vs city relay (simpler credentials) |
| D2 | Client SQLite: **full schema** or **sale slice**? | Slice faster; full enables offline purchases |
| D3 | Stock when offline | Allow sell on cached qty vs hard block |
| D4 | Invoice numbering offline | Pre-allocated blocks from city vs local prefix `OFF-` until sync |
| D5 | Phase A sites | Upgrade in place vs new installs only |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Dual write (local + server) bugs | Feature flag `NEXOR_OFFLINE_FIRST=true` per branch |
| Schema drift client vs city | Versioned payload + migration runner on client DB |
| AGT duplicate submit | Idempotency key = `sale.id` on AGT API |
| Large outbox backlog | Batch ingest endpoint + priority queue (AGT before HQ) |
| Operators cannot see failed sync | Settings sync health + email alert (future) |

---

## Quick reference: spec → code mapping

| Spec concept | Nearest existing code | Phase to complete |
|--------------|----------------------|-------------------|
| SyncOutbox (client) | `electron/syncOutbox.cjs` | B1 |
| SyncOutbox (server) | `backend/src/sync/outbox.js` | B0 |
| AGT worker | `backend/src/jobs/agtWorker.js` | B2 (+ client) |
| City worker | `electron/main.cjs` `startSyncOutboxWorker` | B1 |
| HQ worker | `backend/src/jobs/replicator.js` | B3–B4 |
| City ingest | `backend/src/routes/syncIngest.js` `client-ingest` | B1, B3 |
| HQ ingest | `backend/src/routes/syncIngest.js` `ingest` | B4 |
| Installation roles | `backend/src/sync/installation.js` | B4 (UI) |
| UUID sales | `backend/src/transactionEngine.js` | ✓ Done |
| Audit | `audit_logs`, `agt_transmissions` | B0, B5 |
| Manual fallback | `src/pages/DataSync.tsx` | Keep as disaster recovery |

---

## Related documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Phase A single-site model  
- [POSTGRESQL.md](./POSTGRESQL.md) — Server PostgreSQL + thin clients  
- [backend/src/migrations/019_org_hierarchy.sql](./backend/src/migrations/019_org_hierarchy.sql) — Cities, installations, sync_events  

---

## Next action

Start **Phase B0** with migration `026_sync_audit.sql` and securing `client-ingest`. When ready to implement B1, open a tracking issue per deliverable (B1.1–B1.7) and enable `NEXOR_OFFLINE_FIRST` on a single pilot branch before wider rollout.
