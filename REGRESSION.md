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
- Do **not** call `chartOfAccounts.list()` to resolve one supplier leaf — use `POST /chart-of-accounts/ensure-supplier`.
- Await `repostAccounting` only when the create/update response shows stock/payable/journal post failed; otherwise background + toast on failure.

## Auth / deploy

- City `.env` must set a stable `JWT_SECRET` (compose passes it through). Empty secret → new secret every recreate → “Invalid or expired token”.
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
