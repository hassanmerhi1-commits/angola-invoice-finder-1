# NEXOR — regression locks (do not reopen)

These rules stop the Tailscale “same bug again” loop. Prefer changing product behaviour over violating them.

## CoA list (`GET /chart-of-accounts`)

- Return **stored** `current_balance` by default.
- Parent 321/311 repair and balance recompute run in **background only** (`setImmediate`).
- Live journal join only when `?liveBalances=1` (Chart of Accounts refresh / recompute UI).

## Account ledger (double-click)

- Resolve account IDs first, then `jel.account_id = ANY(uuid[])` (use index).
- Default date window: last **90 days** (client + server for control accounts). Full history via **All dates**.

## Save buttons (Adjust In, purchase, etc.)

- Primary POST success → toast / close dialog immediately.
- Inventory grid reload, invoice list reload, CoA full list: **fire-and-forget**, never block Save.
- After Adjust In / Out / count: prefer **patching local inventory rows** from `productUpdates` (or optimistic deltas). Do **not** await `reloadInventoryList` + stock-movements on Save.
- Product create/edit: patch inventory grid row; **do not** await full inventory-grid reload after success.
- Purchase Save: upsert invoice into local list immediately; defer full list reconcile (~4s). SEDE all-branch list capped (~120 rows).
- CoA / Journals: do not `force` full CoA download on every journal create/reverse; soft refetch only.
- Electron LAN (`httpJson`): short-lived keep-alive (~4s); on hang-up retry once with `Connection: close` (do not triple-retry in `apiFetch`).
- Invoices list: paint cache immediately, always background-revalidate (SWR) — do not hard-skip network when cache is “fresh”.
- Do **not** call `chartOfAccounts.list()` to resolve one supplier leaf — use `POST /chart-of-accounts/ensure-supplier`.
- Await `repostAccounting` only when the create/update response shows stock/payable/journal post failed; otherwise background + toast on failure.

## Selling price tiers (price1..price4)

- Price 1 is authoritative; **never** blend it with price2/3/4 or a sibling branch's price when it is genuinely non-zero (grid SQL, POS level picker, and `ProductDetailDialog` must agree on this).
- When Price 1 is blank (`0`) — a product priced only via tiers — **every** surface must apply the *same* zero-fill fallback (own price2 → best sibling price for the SKU), or the grid and the detail dialog will show different numbers for the same product. `ProductDetailDialog`'s `effectiveProduct` must run this fallback even after the fresh `GET /products/:id` row loads, not only before it.
- `getPriceForLevel` (POS/sales) must fall back to the next **populated** tier (not back to the same empty level) when the requested level is 0, so a tier-only-priced product never rings up at 0 Kz.

## Inventory branch scope (Sede = company totals)

- In Inventory there is **no** separate "All branches" picker row. Picking **Sede / HQ** (`isConsolidatedBranchScope`: `is_main`, code `MAIN`/`SEDE*`, or name containing "sede") **is** the company-wide consolidated stock view. Do not add a second All-branches option alongside Sede.
- `useInventoryGrid` must never leave the previous branch's rows painted when switching to a cold Sede/consolidated (or other) scope — that looked like "Sede shows only other branch products" or empty after a failed fetch. Paint only this scope's warm cache, else clear and load.
- Electron LAN clients: `network:httpJson` must **not** return both parsed `json` and the full raw `text` for large OK responses (inventory-grid HQ). Doubling multi‑MB payloads over IPC made the app show empty Sede while the browser (direct fetch) still loaded. Keep raw text only when JSON parse fails.
- Consolidated inventory-grid needs a long client timeout (≥120s). On failure, fall back to merging warm filial grid caches so Sede is not blank after visiting another branch.
- `ensureTreasuryRegistersFromCoa` (caixa.js) must not unconditionally overwrite `branches.is_main` on every sync/startup based on a non-deterministic `name ILIKE '%sede%'` tiebreak when multiple branches match — only assign `is_main` when no branch already has it, and break ties deterministically (oldest branch first). Flapping `is_main` cascades into branch-switch permissions and which branch counts as Sede.

## Auth / deploy

- City `.env` should still set a stable `JWT_SECRET` (compose passes it through) for belt-and-suspenders safety. As of the `nexor_data` volume + `NEXOR_INSTALL_DIR=/app/data` fix, an auto-generated `jwt.secret`/`master.key` now persists across `docker compose up -d --build` recreates too — previously they lived under the Windows-only default `C:\NEXOR ERP` inside the Linux container, which doesn't exist there and isn't mounted, so every redeploy silently minted a new secret and logged out every shop with "Invalid or expired token". If this ever recurs, check that the `nexor_data` volume exists (`docker volume ls`) and wasn't removed with `docker compose down -v`.
- `docker-compose.yml` mounts `./backend/package.json` so `/api/health` `appVersion` matches `git pull`.
- After pull: `docker compose up -d --force-recreate backend` then `npm run build:webapp`.

## POS caixa close → reopen

- `closeSession` must **await** city `POST …/close` before clearing UI / unlocking open-register.
- Close must seal **all** open sessions for the branch (local id often ≠ city UUID / old `session_*` ids).
- Intentional open from the drawer dialog must send `forceNew: true` and must **not** reclaim a leftover local/remote open shift (that ignored the new opening cash).
- After a successful EOD close, persist a last-closed watermark and **do not** backdate `openedAt` to earlier same-day sales (`recoveredShiftOpenedAt`). That recovery is only for crash/update reopen without closing.
- Refresh must not replace a newer local open session with an older remote leftover.
- Chart of Accounts cash (45x) still holds cash until bank deposit — that is not the same as the POS shift drawer.

## Smoke after city deploy

1. `GET /api/health` → `appVersion` equals released tag (e.g. `1.1.109`).
2. Open Chart of Accounts → list paints in a few seconds (no 12s hang).
3. Double-click a leaf → movements within a few seconds (90-day window).
4. Adjust In Save → toast without waiting for full inventory reload.
5. New purchase Save → toast without waiting for full invoice list / full CoA download.
6. Close register with counted cash → open again → opening amount is only the new drawer count (not yesterday’s total).
