# Accounting audit report — NEXOR ERP 1.3.8

**Date:** 2026-10-09  
**Scope:** Code + disposable SQLite test fixtures. The live server database `kwanza_erp` (PostgreSQL 18 on the till/server PC) was **not** opened, reset, or rewritten.

## Architecture (how the books are kept)

Double-entry journals are created only through `createJournalEntry` (`backend/src/accounting.js`): debit must equal credit within 0.01, closed periods are blocked, and operational posts to parent **311/321** are refused.

| Flow | Module | Typical journal |
|------|--------|-----------------|
| Sale | `transactionEngine.processSale` | Dr caixa/bank/311 leaf, Cr **613** + **3452**; separate CMV Dr **711** Cr **261** |
| Purchase invoice (FC) | `purchaseInvoicePosting.js` | Dr **212** + **3451**, Cr supplier **321xxxx** |
| PO receive | `processPurchaseReceive` | Stock IN at landed cost; GL Dr **212** (goods + freight) + **3451**, Cr **321xxxx** |
| Payment | `processPayment` | Open item + clearing + Dr/Cr 45x or 43x vs 311/321 leaf |
| Expense | `caixaGlPosting.js` / expenses route | Dr **722/752/758**, Cr branch caixa or bank |
| Credit note / void | `fiscalDocumentEngine.js` / `voidFiscalInvoice.js` | Reverse 613/3452; restore stock + reverse CMV |

Chart of accounts is **Angola PGC (class 6 = proveitos, class 7 = custos)**. Posted sales use **613**; CMV uses **711**.

Reports:

- Trial balance / balance sheet: `GET /chart-of-accounts/reports/*`
- P&L: `src/lib/reports/incomeStatement.ts` from trial-balance rows
- AR/AP: `open_items` + `clearings` (subledger), repaired on read by `supplierBalanceRepair` / `customerBalanceRepair`

---

## Bugs found

| ID | Severity | Problem | Evidence |
|----|----------|---------|----------|
| B1 | **Critical** | P&L used SNC 2009 prefixes (sales = **71**, COGS = **61**). This chart posts the opposite. Sales looked like CMV; CMV looked like sales. FSE (**75**), personnel (**72**), tax (**87**) were also wrong. | `incomeStatement.ts` vs `pgcChartOfAccounts.js` (`61` VENDAS, `71` CUSTO DAS EXISTÊNCIAS, `87` IMPOSTOS SOBRE OS LUCROS) |
| B2 | **Critical** | Trial balance, balance sheet, and account balance date filters did not filter line amounts. `LEFT JOIN journal_entries … AND date` left `SUM(jel.debit_amount)` counting **all** lines. Period P&L/TB/BS could show lifetime activity. | `chartOfAccounts.js` trial-balance, `accountBalancesAsOf`, `/:id/balance` |
| B3 | High | Sale CMV journal omitted `branchId`. Branch-filtered TB/P&L understated cost of sales. | `processSale` CMV `createJournalEntry` vs revenue JE |
| B4 | High | Fiscal void restored stock at **unitCost 0**, so a later WAC from movements diluted average cost. Credit notes already restored at `avg_cost`. | `voidFiscalInvoice.js` |
| B5 | High | PO receive capitalized freight into stock WAC **and** debited expense **752**. Freight hit P&L twice (752 now, 711 later). Local Electron path already put freight into **212** only. | `processPurchaseReceive` vs `src/lib/storage.ts` |
| B6 | Medium | Credit sale did `clients.current_balance += total` instead of recomputing from open items, so AR subledger and credit-limit could drift. | `processSale` vs `syncClientBalanceFromOpenItems` |
| B7 | Medium | Journal lines were not rounded to 2 decimals before the balance check (float noise). | `createJournalEntry` |
| B8 | Medium | Payment GL always used **today**, ignoring a document date on the payload. | `processPayment` |

### Not treated as a silent code bug (policy)

| ID | Topic | Notes |
|----|--------|-------|
| P1 | **212 vs 261** | Purchases debit **212** (Compras); sale CMV credits **261** (Existências). Classic PGC periodic purchases vs perpetual CMV. Stock quantity is in `stock_movements`; GL **261** will not match inventory value unless period-end inventory variation is posted. |
| P2 | FC freight vs caixa | FC journal is built from invoice `total` (no **752** line). `syncFreightCaixaRegister` can still reduce operational caixa when `freight_cost` is set. Confirm whether freight is inside `total` and whether caixa should move. |
| P3 | `chart_of_accounts.current_balance` | Incremented on post; list GET uses stored balance unless `?liveBalances=1`. Drift until recompute. |
| P4 | Ledger default window | `coaLedgerQuery.js` defaults to 7–30 days if dates omitted. |

---

## Bugs fixed

1. **B1** — `src/lib/reports/incomeStatement.ts` now maps PGC-AO: 61 vendas, 62 serviços, 71 CMV, 72 pessoal, 73 amortizações, 75 FSE, 66/67 proveitos financeiros, 76/77 custos financeiros, 87 imposto.  
2. **B2** — `backend/src/lib/journalPeriodSums.js`: sums only lines whose `journal_entries` row matched posted + date (+ branch). Wired into TB, BS, and account balance.  
3. **B3** — CMV journal now passes `branchId`.  
4. **B4** — `restoreStockAtCurrentCost` restores at current `avg_cost`/`cost` and updates WAC; void uses it.  
5. **B5** — `buildPurchaseReceiveGlLines` puts freight in **212**, not **752**.  
6. **B6** — credit sale calls `syncClientBalanceFromOpenItems`.  
7. **B7** — journal lines rounded to 2 decimals before insert.  
8. **B8** — payment uses `paymentDate` / `date` / `entryDate` when present, on both the open item and the journal.

No production rows were migrated. Existing journals on the server keep old CMV branch/freight/**752** until reversed or manually adjusted.

---

## Tests

### Backend (`npm test`) — **93 passed, 0 failed**

New regression tests:

| File | What it proves |
|------|----------------|
| `backend/test/incomeStatement.test.js` | P&L source uses 61/71/87, not inverted 71/61 |
| `backend/test/trialBalanceDateFilter.test.js` | January TB excludes March posts; period D = C |
| `backend/test/purchaseReceiveGl.test.js` | Freight in 212, journal balances, no 752 |
| `backend/test/restoreStockCost.test.js` | Void restore IN is not zero-cost |

Existing coverage still green: `saleJournalAmounts`, `transactionEngine` (stock + supplier payment clear), `accountStatement`, VAT/FS/TV, backup, branch scope.

### Playwright (ephemeral SQLite, port 39081) — **6 passed, 0 failed**

- `e2e/deep/chart-of-accounts-journal.spec.ts` — balanced manual journal  
- `e2e/deep/money-paths.spec.ts` — card/transfer/credit sale, backdate deny, journal reverse  
- `e2e/deep/payment-supplier-balance.spec.ts` — FC then supplier payment clears AP  

These do **not** hit live `kwanza_erp`.

---

## Reconciliation results (fixture DB)

On the disposable TB fixture (Jan 100 + Mar 50 on **613/451**):

- January credits on 613 = **100** (not 150)  
- March = **50**, Q1 = **150**  
- Period total debit = period total credit  

P&L fixture (613 credit 10 000, 711 debit 4 000, 752 debit 500):

- Sales **10 000**, CMV **4 000**, FSE **500**, gross after FSE **5 500**  

Supplier payment engine test: open item remaining ≤ 0.01 and status `cleared`.

---

## Remaining issues

1. **P1** — Confirm with the accountant whether period-end should transfer **212 → 261** (or debit **261** on purchase). Until then, GL inventory **261** will not equal stock valuation.  
2. **P2** — FC freight vs caixa GL vs invoice `total` needs a posted example from a real FC.  
3. Historical CMV journals still have null `branchId`; PO journals that already posted **752** are not auto-reversed.  
4. SQLite e2e log: `bulk COA recompute failed, using row loop` and missing `bank_accounts` on the ephemeral schema — card/transfer sales fall back to **431**.  
5. Pre-existing `branchScope` unit test still opens `C:\nexor\erp.db` if that file exists (not this audit’s fixture). Do not use that path as a throwaway DB.  
6. No automated test yet posts a full `processSale` journal set (613/3452/45x + 711/261) through the engine — amounts are covered by `saleJournalAmounts` + TB/P&L unit tests.

---

## Accounting policies requiring confirmation

1. **Inventory method:** mixed periodic purchases (**212**) + perpetual CMV (**711/261**). Is a month-end inventory variation (class 64 / 21→26) required for AGT / the accountant?  
2. **Freight on purchases:** capitalized into unit cost (this fix) vs expensed **752** when paid from caixa on the FC.  
3. **P&L layout:** extraordinary **68/69** and **78/79** are currently folded into “other income / other expenses” so they are not dropped from net result. Split a separate extraordinary section if the accountant wants a statutory face.  
4. **Income tax:** mapped to class **87**. Confirm no one posts IRC to **81** (resultados transitados).

---

## What was not done

- No `git commit` / tag / installer publish  
- No writes to live PostgreSQL `kwanza_erp`  
- No bulk reverse of historical unbalanced reports; refresh Relatórios after this build is on the server to see the P&L and date-window fixes
