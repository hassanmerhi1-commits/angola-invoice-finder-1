# AGT Software Approval — Submission Checklist

Use this list when applying to **AGT** for software certification (Angola e-invoicing / fiscal compliance).

---

## Company & software identity

- [ ] Legal company name and NIF (registered with AGT)
- [ ] Software name: **NEXOR ERP**
- [ ] Software version / build number (from Settings → About or package version)
- [ ] **Software validation number** `NNN/AGT/YYYY` (issued by AGT after approval — update in company settings once received)
- [ ] Developer / vendor contact (name, email, phone)
- [ ] Installation type: on-premise / multi-branch (describe deployment)

---

## Technical documentation (attach or reference)

- [ ] [compliance-matrix.md](./compliance-matrix.md) — signed internal review
- [ ] [demo-test-script.md](./demo-test-script.md) — executed with pass/fail notes
- [ ] Database schema version (expect **42** or higher)
- [ ] List of supported document types: FT, FR, FS, NC, ND, GT, Proforma
- [ ] SAF-T AO version: **1.01_01** (XSD bundled in app)
- [ ] Description of hash chain + RSA signing flow
- [ ] Description of AGT transmission workflow (including simulate vs live)

---

## Evidence files (see evidence-guide.md)

- [ ] Sample FT PDF / receipt with QR code
- [ ] Sample FS receipt (amount ≤ 100,000 AOA)
- [ ] Sample NC linked to original FT
- [ ] SAF-T XML export for one month (validation report: 0 errors)
- [ ] Audit log export (sample period)
- [ ] AGT transmission log screenshot (simulate OK)
- [ ] Security settings screenshot (JWT, sessions, backup permissions)
- [ ] Fiscal reports PDF (IVA + document summary)

---

## Certificates & credentials (live phase only)

- [ ] PKCS#12 signing certificate (password stored securely)
- [ ] AGT sandbox API key / client credentials
- [ ] AGT production credentials (after sandbox sign-off)
- [ ] Test NIFs provided by AGT for sandbox (if applicable)

---

## Environment verification

- [ ] PostgreSQL database name and backup procedure documented
- [ ] `JWT_SECRET` and `NEXOR_SECRET_KEY` set (not defaults) in production
- [ ] AGT simulate **OFF** only in controlled test environment with sandbox
- [ ] Readiness script output saved: `node scripts/agt-certification/run-readiness-check.mjs`

---

## Internal sign-off (before sending to AGT)

- [ ] All items in demo-test-script marked PASS
- [ ] No blocker items on `/api/certification/status`
- [ ] Technical lead approval
- [ ] Company representative approval

---

## Post-submission

- [ ] Track AGT ticket / reference number
- [ ] Address AGT feedback and re-run demo script
- [ ] Update software validation number in app after approval
- [ ] Plan production cutover (simulate off, real cert, monitoring)
