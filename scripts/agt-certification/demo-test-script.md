# AGT Certification Demo Test Script

Extended walkthrough for **schema 42**. Run on the **packaged NEXOR ERP** install with backend synced.

**Prerequisites:** Admin user, at least one branch, products with stock, AGT **Simulate ON**.

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| App version | |
| Schema version | |
| DB | kwanza_erp |

---

## 0. Environment

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 0.1 | Open app; confirm backend health (no red banner) | Connected | ☐ |
| 0.2 | Settings → Security | JWT configured, sessions visible | ☐ |
| 0.3 | Settings → AGT certification readiness | Phases listed; note blockers | ☐ |
| 0.4 | `GET /api/health` or readiness script | `schema_version` ≥ 42 | ☐ |

---

## 1. Core documents (Phase 1)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 1.1 | POS: sale ≤ 100,000 AOA **inc. VAT**, **cash/card**, **NIF left empty** | Document type **FS** (badge + `FS-…` number) | ☐ |
| 1.2 | POS: sale > 100,000 AOA, same (final consumer, cash/card) | **FR** (paid at till above FS limit) | ☐ |
| 1.2b | POS: sale > 100,000 AOA, **transfer** payment, NIF empty | **FT** (invoice, payment not at issue) | ☐ |
| 1.3 | Open issued FT | Immutable fields locked | ☐ |
| 1.4 | Create proforma → convert to FT | New FT number, audit entry | ☐ |
| 1.5 | Issue NC against FT | Stock restored if applicable | ☐ |
| 1.6 | Print receipt / invoice | QR code visible | ☐ |

---

## 2. Immutability & void (Phase 2)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 2.1 | Try edit issued FT line items | Blocked or read-only | ☐ |
| 2.2 | Void a recent simulate-transmitted doc | Void dialog, AGT void simulate OK | ☐ |
| 2.3 | Diários → Auditoria | `void`, `agt_transmit` events | ☐ |

---

## 3. Audit & permissions (Phases 3–4)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 3.1 | Login as cashier | No backup / user admin | ☐ |
| 3.2 | Login as admin | Full settings access | ☐ |
| 3.3 | Failed login (wrong password) | `login_failed` in audit (optional) | ☐ |
| 3.4 | Logout | Session ended via API | ☐ |

---

## 4. Signing (Phase 5)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 4.1 | Settings → Signing | Certificate status shown | ☐ |
| 4.2 | New sale | Hash/signature stored (detail view or API) | ☐ |

---

## 5. AGT transmission (Phase 6 — simulate)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 5.1 | Settings → AGT: Simulate ON | Enabled | ☐ |
| 5.2 | Complete sale; Send to AGT | Status success / simulated | ☐ |
| 5.3 | Gestão Fiscal → AGT transmissions | Row with CUCE/simulate ref | ☐ |
| 5.4 | Issue NC | Auto-queued transmission | ☐ |

---

## 6. SAF-T (Phase 7)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 6.1 | Export SAF-T (current month) JSON + XML | Files download | ☐ |
| 6.2 | Validate in dialog or `POST /api/saft/validate` | `ok: true`, 0 errors | ☐ |
| 6.3 | Check XML header fields | Company NIF, period, SoftwareValidationNumber | ☐ |

---

## 7. Stock & accounting (Phase 8)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 7.1 | Sale reduces stock | Inventory quantity ↓ | ☐ |
| 7.2 | NC restores stock | Quantity ↑ | ☐ |

---

## 8. Multi-branch (Phase 9)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 8.1 | Switch branch in UI | Data scoped to branch | ☐ |
| 8.2 | FT numbers differ per branch sequence | Correct prefix/series | ☐ |

---

## 9. Security (Phase 10)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 9.1 | `/api/security/status` as admin | jwtConfigured, secrets ok | ☐ |
| 9.2 | Backup without token | 401 | ☐ |
| 9.3 | Backup as admin | Success | ☐ |

---

## 10. Fiscal reports (Phase 11)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 10.1 | Gestão Fiscal → IVA report | Totals match period | ☐ |
| 10.2 | Document summary (FT/FR/FS/NC/ND) | Counts match sales | ☐ |
| 10.3 | Export PDF | File opens | ☐ |

---

## 11. Certification pack (Phase 12)

| Step | Action | Expected | Pass |
|------|--------|----------|------|
| 11.1 | Run `run-readiness-check.mjs` | All automated checks pass | ☐ |
| 11.2 | Attach evidence per evidence-guide.md | Folder complete | ☐ |

---

## Summary

| Section | Pass | Fail | N/A |
|---------|------|------|-----|
| 0–11 | | | |

**Blockers for live AGT:** _______________________________

**Tester signature:** _______________ **Date:** ___________
