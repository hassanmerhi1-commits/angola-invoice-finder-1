/**
 * AGT Phase 12 — certification readiness across checklist phases 1–12.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const {
  EXPECTED_SCHEMA_VERSION,
  readAppVersion,
  buildDeploymentStatus,
} = require('./deploymentStatus');
const { getSecurityStatus } = require('./securityStatus');
const { getAgtConfig } = require('../agt/agtConfig');
const { getSigningStatus } = require('../agt/fiscalSigning');
const { getCompanySettings } = require('../agt/companySettings');
const { resolveXsdPath } = require('../saft/saftXsdValidate');

const PLACEHOLDER_NIFS = new Set(['5000000000', '0000000000', '']);

async function tableHasColumn(table, column) {
  try {
    if (db.engine === 'postgres') {
      const res = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           AND table_name = $1 AND column_name = $2 LIMIT 1`,
        [table, column],
      );
      return res.rows.length > 0;
    }
    const res = await db.query(
      `SELECT 1 FROM pragma_table_info('${table.replace(/'/g, "''")}') WHERE name = ? LIMIT 1`,
      [column],
    ).catch(() => ({ rows: [] }));
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

function levelFromOk(ok, warnOnly = false) {
  if (ok) return 'ok';
  return warnOnly ? 'warn' : 'blocker';
}

async function getCertificationStatus() {
  const [
    deployment,
    security,
    agtConfig,
    signing,
    company,
  ] = await Promise.all([
    buildDeploymentStatus(db),
    getSecurityStatus(),
    getAgtConfig(),
    getSigningStatus(),
    getCompanySettings(),
  ]);
  const schema = deployment.schema || { stored: null, expected: EXPECTED_SCHEMA_VERSION };
  const schemaOk = schema.stored != null && schema.stored >= EXPECTED_SCHEMA_VERSION;
  const xsdPath = resolveXsdPath();
  const xsdOk = fs.existsSync(xsdPath);
  const fsColumnOk = await tableHasColumn('sales', 'invoice_type');
  const userSessionsOk = await tableHasColumn('user_sessions', 'id');

  const nifDigits = String(company.nif || agtConfig.companyNif || '').replace(/\D/g, '');
  const nifOk = nifDigits.length >= 9 && !PLACEHOLDER_NIFS.has(nifDigits);
  const softwareCert = String(
    company.agtCertificateNumber || agtConfig.softwareCertificateNumber || '',
  ).trim();
  const softwareCertOk = /^\d+\/AGT\/\d{4}$/.test(softwareCert);

  const signingRsa = signing.mode === 'rsa';
  const agtSimulate = agtConfig.simulate;
  const agtLiveReady = !agtSimulate && agtConfig.hasApiKey && Boolean(agtConfig.apiUrl);
  /** Product build can ship with simulate ON — live AGT is a separate go-live step. */
  const agtDeferred = agtSimulate;

  const phases = [
    {
      id: 'phase_1',
      phase: 1,
      title: 'Core fiscal documents',
      status: fsColumnOk ? 'ok' : 'warn',
      message: fsColumnOk
        ? 'FT, FR, FS, NC, ND supported (invoice_type on sales)'
        : 'FS invoice type column missing — run migration 042',
    },
    {
      id: 'phase_2',
      phase: 2,
      title: 'Immutable records & void',
      status: 'ok',
      message: 'Fiscal lock, NC/ND corrections, void with audit',
    },
    {
      id: 'phase_3',
      phase: 3,
      title: 'Audit log',
      status: 'ok',
      message: 'Fiscal audit log with user, timestamp, workstation',
    },
    {
      id: 'phase_4',
      phase: 4,
      title: 'Permissions',
      status: userSessionsOk ? 'ok' : 'warn',
      message: userSessionsOk
        ? 'Role-based access and JWT sessions'
        : 'Session table missing — run migration 041',
    },
    {
      id: 'phase_5',
      phase: 5,
      title: 'Electronic signature',
      status: signingRsa || agtDeferred ? 'ok' : 'warn',
      message: signingRsa
        ? `RSA-SHA256 active (${signing.activeKeyAlias || signing.activeKeyId})`
        : agtDeferred
          ? 'Hash-only mode — OK for product build; PKCS#12 required only for AGT live'
          : 'Hash-only mode — upload PKCS#12 for full compliance',
    },
    {
      id: 'phase_6',
      phase: 6,
      title: 'AGT e-invoicing',
      status: agtDeferred ? 'ok' : (agtLiveReady ? 'ok' : 'blocker'),
      message: agtDeferred
        ? 'Simulate ON — fiscal flow complete; live AGT deferred until certification'
        : agtLiveReady
          ? 'Live AGT configured (simulate off, API key set)'
          : 'Simulate OFF but API URL/key missing',
    },
    {
      id: 'phase_7',
      phase: 7,
      title: 'SAF-T export & XSD',
      status: xsdOk ? 'ok' : 'warn',
      message: xsdOk
        ? 'SAF-T AO 1.01_01 XSD bundled; validate via Export SAF-T'
        : 'XSD file not found on disk',
    },
    {
      id: 'phase_8',
      phase: 8,
      title: 'Stock & accounting',
      status: 'ok',
      message: 'Stock movements and journal entries on sales / NC',
    },
    {
      id: 'phase_9',
      phase: 9,
      title: 'Multi-branch',
      status: 'ok',
      message: 'Per-branch sequences and scoped inventory',
    },
    {
      id: 'phase_10',
      phase: 10,
      title: 'Security',
      status: security.ok ? (security.attention ? 'warn' : 'ok') : 'blocker',
      message: security.ok
        ? security.attention
          ? 'Security baseline OK — review warnings in Security card'
          : 'JWT, secrets, backups, session log'
        : 'Critical security items — see Security & compliance',
    },
    {
      id: 'phase_11',
      phase: 11,
      title: 'Fiscal reports',
      status: 'ok',
      message: 'IVA, document summary, AGT transmissions (Gestão Fiscal)',
    },
    {
      id: 'phase_12',
      phase: 12,
      title: 'Certification pack',
      status: schemaOk ? 'ok' : 'warn',
      message: schemaOk
        ? 'Demo script and evidence guide in scripts/agt-certification/'
        : `Schema ${schema.stored ?? '?'} — expected ${EXPECTED_SCHEMA_VERSION}`,
    },
  ];

  const checks = [
    {
      id: 'schema_version',
      ok: schemaOk,
      level: levelFromOk(schemaOk, true),
      message: schemaOk
        ? `Database schema ${schema.stored} (expected ≥ ${EXPECTED_SCHEMA_VERSION})`
        : `Schema ${schema.stored ?? 'unknown'} — migrate to ${EXPECTED_SCHEMA_VERSION}`,
    },
    {
      id: 'company_nif',
      ok: nifOk,
      level: levelFromOk(nifOk, true),
      message: nifOk
        ? `Company NIF configured (${nifDigits})`
        : 'Set real company NIF in Settings (not placeholder)',
    },
    {
      id: 'software_validation_number',
      ok: softwareCertOk,
      level: levelFromOk(softwareCertOk, true),
      message: softwareCertOk
        ? `Software validation number: ${softwareCert}`
        : 'AGT software validation number (NNN/AGT/YYYY) not set',
    },
    {
      id: 'agt_simulate',
      ok: agtSimulate,
      level: 'info',
      message: agtSimulate
        ? 'AGT simulate ON — recommended for internal certification demo'
        : 'AGT simulate OFF — live transmission mode',
    },
    {
      id: 'saft_xsd',
      ok: xsdOk,
      level: levelFromOk(xsdOk, true),
      message: xsdOk ? `XSD present: ${path.basename(xsdPath)}` : 'SAF-T XSD missing',
    },
    {
      id: 'fs_invoice_type',
      ok: fsColumnOk,
      level: levelFromOk(fsColumnOk, true),
      message: fsColumnOk ? 'Simplified invoice (FS) schema ready' : 'sales.invoice_type missing',
    },
    {
      id: 'signing_rsa',
      ok: signingRsa,
      level: levelFromOk(signingRsa, true),
      message: signingRsa ? 'PKCS#12 signing active' : 'Upload signing certificate for RSA mode',
    },
    {
      id: 'security_baseline',
      ok: security.ok && !security.checks.some((c) => c.level === 'critical' && !c.ok),
      level: security.ok ? 'ok' : 'blocker',
      message: security.ok ? 'Security Phase 10 checks passed' : 'Fix critical security items',
    },
  ];

  const blockerCount = [
    ...phases.filter((p) => p.status === 'blocker'),
    ...checks.filter((c) => c.level === 'blocker' && !c.ok),
  ].length;

  const warnCount = phases.filter((p) => p.status === 'warn').length
    + checks.filter((c) => (c.level === 'warn' && !c.ok)).length;

  const readyForInternalReview = blockerCount === 0 && schemaOk;
  const readyForProductRelease = readyForInternalReview && agtDeferred;
  const readyForAgtSubmission = readyForInternalReview && nifOk && softwareCertOk && signingRsa && agtLiveReady;

  return {
    ok: blockerCount === 0,
    readyForInternalReview,
    readyForProductRelease,
    readyForAgtSubmission,
    agtDeferred,
    appVersion: readAppVersion(),
    schemaVersion: schema.stored,
    schemaVersionExpected: EXPECTED_SCHEMA_VERSION,
    agt: {
      simulate: agtSimulate,
      environment: agtConfig.environment,
      hasApiKey: agtConfig.hasApiKey,
    },
    company: {
      nif: nifDigits || null,
      nifConfigured: nifOk,
      softwareValidationNumber: softwareCert || null,
    },
    signing: {
      mode: signing.mode,
      activeKeyAlias: signing.activeKeyAlias,
    },
    phases,
    checks,
    blockers: blockerCount,
    warnings: warnCount,
    documentationPath: 'scripts/agt-certification/',
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { getCertificationStatus };
