# NEXOR ERP — AGT Certification Pack (Phase 12)

Documentation and scripts to prepare **internal certification review** and the **AGT software approval** submission.

**Target schema:** 42  
**AGT mode for testing:** Simulate ON (no sandbox required for this pack)  
**Reference checklist:** `NEXOR_ERP_AGT_Certification_Checklist.pdf`

---

## Contents

| File | Purpose |
|------|---------|
| [compliance-matrix.md](./compliance-matrix.md) | Maps AGT checklist phases 1–12 to NEXOR features and current status |
| [demo-test-script.md](./demo-test-script.md) | Step-by-step demo script for AGT reviewers (UI walkthrough) |
| [submission-checklist.md](./submission-checklist.md) | Documents, credentials, and evidence to gather before applying to AGT |
| [evidence-guide.md](./evidence-guide.md) | Screenshots, exports, and logs to attach to the submission |
| [run-readiness-check.mjs](./run-readiness-check.mjs) | Automated API checks (health, security, SAF-T XSD) |

Legacy smoke test (phases 1–5 only): [../packaged-smoke-test-phases-1-5.md](../packaged-smoke-test-phases-1-5.md)

---

## Quick start

### 1. Sync backend to installed app

```powershell
cd c:\Users\user\source\repos\angola-invoice-finder-1
.\scripts\sync-nexor-backend.ps1   # if you use the install sync script
# Restart NEXOR ERP
```

### 2. Run automated readiness check

```powershell
$env:NEXOR_API_URL = "http://127.0.0.1:3000"
$env:NEXOR_ADMIN_EMAIL = "admin@kwanzaerp.ao"
$env:NEXOR_ADMIN_PASSWORD = "your-password"
node scripts/agt-certification/run-readiness-check.mjs
```

### 3. In-app checklist

**Settings → AGT certification readiness** (admin) — live status from `/api/certification/status`.

### 4. Manual demo

Follow [demo-test-script.md](./demo-test-script.md) and capture evidence per [evidence-guide.md](./evidence-guide.md).

---

## Before applying to AGT (real sandbox)

- [ ] Real company NIF (not `5000000000`)
- [ ] Software validation number `NNN/AGT/YYYY` from AGT
- [ ] PKCS#12 signing certificate (production)
- [ ] AGT sandbox API credentials
- [ ] Set **Simulate OFF** only after internal pack passes
- [ ] Complete [submission-checklist.md](./submission-checklist.md)

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Technical lead | | | |
| QA / tester | | | |
| Company representative | | | |
