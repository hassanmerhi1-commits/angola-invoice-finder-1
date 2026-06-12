# Evidence Guide — AGT Submission Folder

Create a folder: `agt-submission-YYYY-MM-DD/` with the structure below.

---

## Recommended folder layout

```
agt-submission-2026-06-02/
├── 01-company/
│   ├── company-settings-screenshot.png
│   └── nif-registration.pdf          (your company doc)
├── 02-documents/
│   ├── sample-FT-receipt.pdf
│   ├── sample-FS-receipt.pdf
│   ├── sample-NC.pdf
│   └── qr-code-closeup.png
├── 03-saft/
│   ├── SAFT_2026-06.xml
│   ├── SAFT_2026-06.json
│   └── saft-validation-result.json
├── 04-agt/
│   ├── agt-settings-simulate-on.png
│   ├── transmission-log-screenshot.png
│   └── void-audit-snippet.png
├── 05-audit-security/
│   ├── audit-log-export.csv
│   ├── security-status.json
│   └── sessions-screenshot.png
├── 06-reports/
│   ├── iva-report.pdf
│   └── fiscal-documents-report.pdf
├── 07-readiness/
│   ├── readiness-check-output.txt
│   ├── certification-status.json
│   └── compliance-matrix-signed.pdf
└── README.txt                        (index of files)
```

---

## Capture instructions

### Documents (02-documents)

1. **FT:** POS or Faturação sale > 100k AOA → print/save PDF.
2. **FS:** Sale ≤ 100k AOA → note FS badge on receipt.
3. **NC:** Credit note for a prior FT → show link to original number.
4. **QR:** Crop from receipt showing QR + document type + number.

### SAF-T (03-saft)

1. Gestão Fiscal → Export SAF-T → select month with sales.
2. Export XML + JSON.
3. Run validation in dialog; save JSON response or screenshot showing `ok: true`.
4. Optional CLI:
   ```powershell
   curl -X POST http://127.0.0.1:3000/api/saft/validate -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"period\":\"2026-06\"}"
   ```

### AGT (04-agt)

1. Settings → AGT: screenshot showing **Simulate ON** and endpoint config.
2. Gestão Fiscal → AGT tab: filter last 30 days.
3. After void test: audit log filtered by `void`.

### Audit & security (05-audit-security)

1. Diários → Auditoria → export CSV for demo period.
2. `GET /api/security/status` (save JSON) — redact secrets if sharing externally.
3. Settings → Security → active sessions screenshot.

### Reports (06-reports)

1. IVA monthly for demo month → PDF.
2. Fiscal documents summary → PDF.

### Readiness (07-readiness)

1. Run:
   ```powershell
   node scripts/agt-certification/run-readiness-check.mjs > readiness-check-output.txt
   ```
2. Save `GET /api/certification/status` response as JSON.
3. Export [compliance-matrix.md](./compliance-matrix.md) to PDF with sign-off.

---

## Redaction rules

- Do **not** include: `JWT_SECRET`, `NEXOR_SECRET_KEY`, API keys, certificate passwords, full PKCS#12 files.
- OK to include: public cert metadata, simulate transmission IDs, anonymized customer NIFs if needed.

---

## Minimum viable pack (if time-constrained)

1. One FT + one FS receipt PDF  
2. One SAF-T XML + validation OK  
3. AGT transmission log screenshot (simulate)  
4. Readiness script output  
5. Signed compliance matrix  
