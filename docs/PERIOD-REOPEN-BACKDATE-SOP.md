# Period reopen & backdate — SOP for accountants

## Purpose
Control corrections after a period is closed so the general ledger and fiscal documents stay auditable.

## Who may act
| Action | Permission | Typical role |
|--------|------------|--------------|
| Post with date **before today** | `backdate_post` | admin, manager |
| Edit / reverse documents dated before today | `edit_historical` | admin, manager |
| Reopen a closed accounting period | admin / period APIs | admin |

Cashiers and viewers must **not** have `backdate_post` or `edit_historical`.

## Backdating a journal or adjustment
1. Confirm the business reason (omitted invoice, bank fee, stock correction).
2. Ensure the target **period is open** (Accounting → Periods).
3. Post with the correct historical `entryDate`.
4. Keep supporting paper (supplier invoice / bank slip) as an **attachment** on the expense or purchase invoice.
5. Do **not** rewrite issued FT/FS — use credit/debit notes.

## Reopening a period
1. Only when SAF-T / AGT for that month is not yet submitted, or with explicit finance approval.
2. Reopen via Accounting Periods UI/API.
3. Post corrections.
4. Re-close the period the same day.
5. Re-export SAF-T if the month was already exported and numbers changed.
6. Record who approved the reopen in the audit trail / ticket.

## AGT impact
- Issued fiscal documents are immutable; corrections use NC/ND.
- Simulated AGT codes are **forbidden in production** unless `AGT_SIMULATE=true` is set deliberately for a sandbox.

## Restore / disaster
Target RTO: under 1 hour — stop clients → restore latest backup (Admin → Backup) → restart backend → verify `/api/health` schema.
