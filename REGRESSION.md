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

## Selling price / IVA — one number per product (no display blending)

The recurring "price outside is different from inside", "price differs per branch" and "IVA went
back to 5%" reports all came from the same shape of bug, so the rule is absolute:

- **A list row must show exactly what `GET /products/:id` returns for that row's id.** Whenever
  duplicate rows for one SKU are collapsed (`mergeGridSkuRow`, `mergeConsolidatedSkuRow`,
  `dedupeProductsBySku`, the consolidated grid merge, client `mergeProductRows` /
  `applyCanonicalSkuAggregates`, the Electron HQ fallback merge), money and IVA come from the row
  that is kept — use `mergeDisplayFields` / fill-if-blank. **Never** `MAX(price)`, `MAX(cost)` or
  "prefer the non-default tax_rate" across rows: that shows a number no product row actually has,
  and it changes with whichever duplicates a given branch query returned.
- Only **one** fallback fills a blank (`0`) Price 1: `enrichRowsWithSellingPrices`. It runs on the
  grid, the branch lists **and** `GET /products/:id`, so all three agree. Grid SQL must not invent
  its own sibling-MAX fallback, and `ProductDetailDialog` must not re-guess a price once the API
  row has loaded.
- `getPriceForLevel` (POS/sales) must fall back to the next **populated** tier (not back to the same
  empty level) when the requested level is 0, so a tier-only-priced product never rings up at 0 Kz.
- Price/IVA are company-wide: HQ saves cascade to every same-SKU row. A branch only keeps its own
  value through an explicit `price_override` / `vat_override`, set **only** by a deliberate save in
  the product form. Purchases, stock entries, imports and upserts must never set those flags — that
  silently opted rows out of every later HQ change, which is what left branches stuck on 5%.
  A deliberate HQ IVA edit (`forceVatChange`) overrides existing `vat_override` locks and clears
  them, so HQ always has the last word.
- A purchase line may **fill** a legacy-default 5% IVA on the product master, never overwrite a rate
  someone chose (`shouldPreserveExistingTaxRate` with no acknowledgement flags).
- `filialStockRepair`'s backfill selects rows missing *price OR cost OR last_cost* — every field it
  assigns must guard itself (`WHEN COALESCE(field,0) > 0 THEN field ELSE …`). It used to overwrite a
  real branch price with the highest sibling price whenever only the cost was missing.
- Cloning a product into another branch (transfer receive / stock IN) must copy `price2..price4`
  and `tax_rate`, not just Price 1.
- Migration `073_normalize_sku_price_vat.sql` converged the historical divergence onto the HQ/master
  row. Bump `CACHE_PREFIX` in `inventoryGrid.ts` whenever pricing display rules change, or clients
  keep painting caches built under the old rules.

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
