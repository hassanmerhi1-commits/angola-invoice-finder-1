# NEXOR ERP — Packaged smoke test (Phases 1–5)

Quick end-to-end check on the **installed** app (not `npm run dev`).

**Scope:** Fiscal foundation → signing → AGT → SAF-T → audit & permissions  
**Target schema:** 37  
**Suggested build:** `npm run electron:build` then install the `.exe`

---

## 0. Before you start

| Item | Value |
|------|--------|
| DB (standalone install) | `C:\NEXOR ERP\data\erp.db` |
| Admin login | `admin@kwanzaerp.ao` / `changeme` |
| Cashier login | `caixa1@kwanzaerp.ao` / `caixa1` |
| AGT mode for test | **Simulate ON** (Settings → AGT) |

**Optional:** Note product stock qty before NC test (Inventory) so you can confirm restore.

**Tester:** _______________  
**Build version:** _______________  
**Date:** _______________  
**Machine:** _______________

---

## 1. Install & startup

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 1.1 | Install fresh build (or upgrade over existing) | ☐ | ☐ | |
| 1.2 | App opens without crash | ☐ | ☐ | |
| 1.3 | Backend status healthy (no persistent “backend offline”) | ☐ | ☐ | |
| 1.4 | Login as **admin** succeeds | ☐ | ☐ | |
| 1.5 | Settings loads; no blank/crash on fiscal cards | ☐ | ☐ | |

**Fail here → stop.** Fix backend/DB before continuing.

---

## 2. Phase 1 — Fiscal foundation

### 2A. Sales invoice (immutable)

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 2.1 | **Faturação → Faturas** → New **Fatura de Venda** | ☐ | ☐ | |
| 2.2 | Add ≥1 product line, customer, confirm/save as **issued** | ☐ | ☐ | Record #: ________ |
| 2.3 | Re-open same invoice → **cannot** edit lines/qty/prices | ☐ | ☐ | Due date-only edit OK |
| 2.4 | **Print** works (PDF/preview, no error toast) | ☐ | ☐ | |

### 2B. Credit note (NC)

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 2.5 | From invoice or **Documentos Fiscais → Notas de Crédito** → New NC | ☐ | ☐ | |
| 2.6 | **Restore stock = Yes** visible and selected at top of create dialog | ☐ | ☐ | |
| 2.7 | Issue NC against invoice from 2.2 | ☐ | ☐ | NC #: ________ |
| 2.8 | Detail opens after create; NC is **read-only** | ☐ | ☐ | |
| 2.9 | If product tracked: stock **increased** after NC (Inventory) | ☐ | ☐ | Qty before/after: ___ / ___ |
| 2.10 | Repeat with **Restore stock = No** on a second NC (partial OK) → stock **unchanged** | ☐ | ☐ | |

### 2C. Debit note & transport (smoke only)

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 2.11 | Create **Nota de Débito** (any reason) → issues without error | ☐ | ☐ | |
| 2.12 | Create **Guia de Transporte** → issues without error | ☐ | ☐ | |

### 2D. Cross-navigation

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 2.13 | **Faturas → Nota Crédito** tab lists fiscal NCs from API | ☐ | ☐ | |
| 2.14 | Double-click NC row → opens **Documentos Fiscais** with NC detail | ☐ | ☐ | |

---

## 3. Phase 2 — RSA signing & hash chain

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 3.1 | **Settings → Signing** card visible | ☐ | ☐ | |
| 3.2 | Generate/import test certificate (or use existing) → saves OK | ☐ | ☐ | |
| 3.3 | Open issued **invoice** from §2 → **SAFT hash** present in detail/status | ☐ | ☐ | |
| 3.4 | Open **NC** from §2 → **SAFT hash** present | ☐ | ☐ | |
| 3.5 | Restart app → hashes still on same documents | ☐ | ☐ | |

---

## 4. Phase 3 — AGT transmission (simulated)

**Prerequisite:** Settings → AGT → **Simulate = ON** → Save.

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 4.1 | Open issued **invoice** (§2.2) | ☐ | ☐ | |
| 4.2 | **Send to AGT** visible in toolbar / bottom bar / context menu | ☐ | ☐ | |
| 4.3 | Click Send → success toast; status → **validated** (or pending→validated) | ☐ | ☐ | |
| 4.4 | **CUCE / agt code** shown on document | ☐ | ☐ | Code: ________ |
| 4.5 | Send again → skipped or already validated (no duplicate break) | ☐ | ☐ | |
| 4.6 | Open **NC** detail → **Send to AGT** in sticky top bar | ☐ | ☐ | |
| 4.7 | Send NC → validated + CUCE | ☐ | ☐ | |
| 4.8 | **Settings → AGT transmissions** list shows both transmissions | ☐ | ☐ | |
| 4.9 | Restart app → AGT status & CUCE still on invoice and NC | ☐ | ☐ | |

---

## 5. Phase 4 — Unified SAF-T export

**Prerequisite:** Company NIF set (Settings / Documentos Fiscais → Dados empresa) — not placeholder `5000000000`.

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 5.1 | **Documentos Fiscais → Exportar SAF-T** (or SAF-T dialog) opens | ☐ | ☐ | |
| 5.2 | **Preview** shows counts (sales, NC, payments, etc.) | ☐ | ☐ | |
| 5.3 | Generate **JSON** for period including test invoice + NC | ☐ | ☐ | |
| 5.4 | Export/download **XML** for same period | ☐ | ☐ | |
| 5.5 | Open JSON/XML — header has company NIF; invoice + NC appear in source docs | ☐ | ☐ | |
| 5.6 | No 500 error / empty file | ☐ | ☐ | |

---

## 6. Phase 5 — Audit trail & permissions

### 6A. Audit log (as admin)

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 6.1 | **Diários → Auditoria** tab loads (or **Relatórios → Auditoria** in menu bar) | ☐ | ☐ | No sidebar in desktop UI |
| 6.2 | **No demo/fake** seed rows only — real events from this session | ☐ | ☐ | |
| 6.3 | **Login** event after admin login | ☐ | ☐ | |
| 6.4 | **issue** event for NC (table fiscal / credit_notes) | ☐ | ☐ | |
| 6.5 | **print** event for invoice | ☐ | ☐ | |
| 6.6 | **agt_transmit** for invoice and/or NC | ☐ | ☐ | |
| 6.7 | **saft_export** after SAF-T generate/export | ☐ | ☐ | |
| 6.8 | Refresh → entries persist | ☐ | ☐ | |
| 6.9 | Export audit JSON → download works | ☐ | ☐ | |

### 6B. Permissions — cashier

Log out → login **caixa1@kwanzaerp.ao** / `caixa1`

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 6.10 | **Send to AGT** hidden on invoices | ☐ | ☐ | |
| 6.11 | **New Credit Note** / NC create hidden or blocked | ☐ | ☐ | |
| 6.12 | **Export SAF-T** hidden | ☐ | ☐ | |
| 6.13 | **Diários → Auditoria** / **Relatórios → Auditoria** hidden or permission denied | ☐ | ☐ | |
| 6.14 | Can still **view** invoices and **print** (if role allows) | ☐ | ☐ | |

### 6C. Permissions — manager (if you have one)

Create or assign a user with role **manager**, or temporarily change caixa1 role in Users.

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 6.15 | Manager can **Send to AGT** | ☐ | ☐ | |
| 6.16 | Manager can **create NC** | ☐ | ☐ | |
| 6.17 | Manager can **export SAF-T** | ☐ | ☐ | |
| 6.18 | Manager can open **Auditoria** (Diários tab or Relatórios menu) | ☐ | ☐ | |

---

## 7. Restart & persistence (final)

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| 7.1 | Close app completely → reopen | ☐ | ☐ | |
| 7.2 | Invoice still immutable; AGT validated; CUCE present | ☐ | ☐ | |
| 7.3 | NC detail + restore stock flag correct | ☐ | ☐ | |
| 7.4 | Audit Trail still shows session events | ☐ | ☐ | |
| 7.5 | Schema/deployment OK (no migration error on startup) | ☐ | ☐ | |

---

## Sign-off

| Result | |
|--------|--|
| **PASS** (all critical rows) | Critical = §1, §2.1–2.9, §4.1–4.7, §5.3–5.5, §6.1–6.7, §6.10–6.13, §7 |
| **FAIL** | List blocking IDs: _________________________________ |

**Blocking failures** — investigate first:
- Backend won't start / schema &lt; 37
- Issued invoice still fully editable
- NC create fails or restore stock ignored
- AGT send fails with simulate ON
- SAF-T export 403/500 or missing documents
- Audit Trail empty after full session (admin)
- Cashier can send AGT or export SAF-T (permission leak)

---

## Build command (reference)

```powershell
cd c:\Users\user\source\repos\angola-invoice-finder-1
npm run electron:build
```

Installer output: `dist/` (Windows `.exe`).

---

## Quick troubleshooting

| Symptom | Check |
|---------|--------|
| AGT button missing on invoice | Invoice must be **confirmed/issued**, not draft |
| AGT button missing on NC | Open **Documentos Fiscais** detail, not old invoice-only dialog |
| SAF-T 403 | Logged-in user needs `saft_export` (admin/manager) |
| Audit empty | Login as admin; perform actions **after** Phase 5 build; refresh Audit Trail |
| Stock not restored | NC issued with **Restore stock = Yes** and product has `product_id` on line |
| better-sqlite3 in dev shell | Ignore for dev CLI; packaged Electron uses its own Node |
