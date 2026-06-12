# AGT Compliance Matrix — NEXOR ERP

Maps the **12-phase AGT certification checklist** to NEXOR implementation.  
Updated for schema **42** (June 2026).

**Legend:** ✅ Done · ⚠️ Partial · ❌ Not yet · 🔒 Blocked on AGT (needs sandbox/cert)

| Phase | Requirement (summary) | NEXOR location | Status | Notes |
|-------|----------------------|----------------|--------|-------|
| **1** | Core fiscal documents (FT, FS, FR, NC, ND, GT, proforma) | POS, Faturação, Documentos Fiscais | ✅ | FS via `sales.invoice_type`; sequences FS/FR/FT per branch |
| **1** | Unique numbering, date/time, user, NIF, IVA, totals | Transaction engine, `document_sequences` | ✅ | |
| **1** | Proforma → invoice conversion | Faturação / proformas | ✅ | |
| **2** | Issued documents immutable | `sales.fiscal_status`, PATCH lock | ✅ | Due date only editable on FT |
| **2** | Corrections via NC/ND only | Documentos Fiscais | ✅ | |
| **2** | Void/cancel with audit + stock | `POST /api/agt/void`, void dialog | ✅ | Simulate AGT void |
| **3** | System audit log | `audit_log`, Diários → Auditoria | ✅ | login, print, agt_transmit, saft_export, void, … |
| **3** | User, timestamp, workstation | `fiscalAudit`, audit API | ✅ | |
| **4** | Role-based permissions | `rolePermissions`, UI gates | ✅ | admin / manager / cashier / viewer |
| **4** | Authenticated actions | JWT auth, session log | ✅ | Phase 10 |
| **5** | Hash chain per document | `fiscal_signatures`, `saft_hash` | ✅ | |
| **5** | RSA-SHA256 (PKCS#12) | Settings → Signing | ⚠️ | Works with test cert; production cert from AGT pending |
| **6** | Real-time AGT validation (CUCE) | Settings → AGT, Send to AGT | ⚠️ | **Simulate ON** — live API 🔒 |
| **6** | Transmission log + retry | AGT transmissions card, worker | ✅ | NC/ND auto-queue, reconcile |
| **6** | QR code on documents | Receipt, invoice print, `agtQRCode` | ✅ | |
| **7** | SAF-T AO export (JSON + XML) | Export SAF-T dialog | ✅ | Unified generator |
| **7** | XSD schema validation | `POST /api/saft/validate`, bundled XSD | ✅ | Structural + optional xmllint |
| **7** | Monthly / annual submission files | Period picker on export | ✅ | |
| **8** | Stock moves on sale / NC restore | Transaction engine, NC flag | ✅ | |
| **8** | Journal entries (IVA, revenue, COGS) | `transactionEngine.js` | ✅ | |
| **9** | Multi-branch | Branches, per-branch sequences | ✅ | |
| **9** | Branch-scoped inventory | Inventory grid, stock_movements | ✅ | |
| **10** | JWT + secrets at rest | `nexorSecrets`, Settings → Security | ✅ | |
| **10** | Session log, failed login audit | `user_sessions`, audit | ✅ | |
| **10** | Backup / restore protected | `/api/backup` + permissions | ✅ | |
| **11** | IVA monthly report | Gestão Fiscal → IVA | ✅ | Live DB |
| **11** | Fiscal documents report (FT/FR/FS/NC/ND/GT) | Gestão Fiscal | ✅ | PDF export |
| **11** | AGT transmissions report | Gestão Fiscal → AGT tab | ✅ | |
| **12** | Demo script + evidence pack | `scripts/agt-certification/` | ✅ | This pack |
| **12** | Certification readiness API | `/api/certification/status` | ✅ | Settings UI |
| **12** | AGT submission (live) | — | 🔒 | After AGT approves software + sandbox |

---

## Build phases completed (implementation order)

| Build phase | Checklist coverage |
|-------------|-------------------|
| Phase 1 — Fiscal foundation | 1, 2, 8 (partial) |
| Phase 2 — RSA + hash | 5 |
| Phase 3 — AGT transmission | 6 (simulate) |
| Phase 4 — Unified SAF-T | 7 |
| Phase 5 — Audit + permissions | 3, 4 |
| Track A — Fiscal reports | 11 |
| Track B — Void/cancel | 2 |
| Track C — AGT worker | 6 |
| Phase 10 — Security | 10 |
| FS simplified invoice | 1 |
| SAF-T XSD validation | 7 |
| Phase 12 — Cert pack | 12 |

---

## Known gaps before live AGT

1. **Real AGT API** — sandbox/production credentials and `AGT_SIMULATE=false`
2. **Production PKCS#12** — from AGT certification process
3. **Company NIF + software validation number** — real values in company settings
4. **FS in SAF-T XML** — exported as **FR** (XSD has no FS enum; AGT-aligned)
5. **Full XSD via xmllint** — optional on Windows; structural validator used by default
