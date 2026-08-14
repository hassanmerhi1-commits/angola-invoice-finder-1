/**
 * One-click AGT certification demo profile for internal review (simulate ON + demo NIF + test PKCS#12).
 */
const fs = require('fs');
const { saveCompanySettings } = require('../agt/companySettings');
const { saveAgtConfig } = require('../agt/agtConfig');
const {
  importCertificate,
  findCertificateByAlias,
  activateCertificate,
  replaceCertificateMaterial,
  generateDemoPkcs12,
} = require('../agt/certificateStore');
const { getSigningStatus } = require('../agt/fiscalSigning');
const { getCertificationStatus } = require('./certificationStatus');

const DEMO_NIF = '5000123456';
const DEMO_VALIDATION_NUMBER = '396/AGT/2023';
const DEMO_COMPANY_NAME = 'NEXOR ERP Demo Lda';
const DEMO_CERT_ALIAS = 'NEXOR Demo (test)';
const DEMO_CERT_PASSPHRASE = 'nexor-demo';

function mapCertificateRow(row) {
  return {
    id: row.id,
    alias: row.key_alias,
    keyType: row.key_type,
    subjectCn: row.subject_cn,
    validFrom: row.valid_from instanceof Date ? row.valid_from.toISOString() : row.valid_from,
    validUntil: row.valid_until instanceof Date ? row.valid_until.toISOString() : row.valid_until,
  };
}

async function ensureDemoCertificate() {
  const existing = await findCertificateByAlias(DEMO_CERT_ALIAS);
  if (existing) {
    const pfxOk = existing.pfx_storage_path && fs.existsSync(existing.pfx_storage_path);
    if (pfxOk) {
      await activateCertificate(existing.id);
      return { ...mapCertificateRow(existing), reused: true };
    }
  }

  const pfxBuffer = generateDemoPkcs12({
    commonName: `NEXOR Demo NIF ${DEMO_NIF}`,
    passphrase: DEMO_CERT_PASSPHRASE,
  });

  if (existing) {
    // Row exists (often already used on invoices) but the .pfx is missing —
    // typical after a Docker path change. Replace material in place; never DELETE.
    const replaced = await replaceCertificateMaterial(existing.id, {
      pfxBuffer,
      passphrase: DEMO_CERT_PASSPHRASE,
      certificateNumber: DEMO_VALIDATION_NUMBER,
      alias: DEMO_CERT_ALIAS,
    });
    await activateCertificate(existing.id);
    return { ...replaced, reused: false };
  }

  const imported = await importCertificate({
    alias: DEMO_CERT_ALIAS,
    pfxBase64: pfxBuffer.toString('base64'),
    passphrase: DEMO_CERT_PASSPHRASE,
    certificateNumber: DEMO_VALIDATION_NUMBER,
  });
  await activateCertificate(imported.id);
  return { ...imported, reused: false };
}

async function applyCertificationDemoProfile(options = {}) {
  const generateTestCertificate = options.generateTestCertificate !== false;
  const steps = [];

  const company = await saveCompanySettings({
    name: DEMO_COMPANY_NAME,
    tradeName: DEMO_COMPANY_NAME,
    nif: DEMO_NIF,
    agtCertificateNumber: DEMO_VALIDATION_NUMBER,
    city: 'Luanda',
    province: 'Luanda',
    country: 'Angola',
  });
  steps.push({
    id: 'company',
    ok: true,
    message: `Company NIF ${DEMO_NIF} and validation ${DEMO_VALIDATION_NUMBER}`,
  });

  await saveAgtConfig({
    environment: 'sandbox',
    companyNif: DEMO_NIF,
    softwareCertificateNumber: DEMO_VALIDATION_NUMBER,
    simulate: true,
    autoTransmit: true,
  });
  steps.push({
    id: 'agt_simulate',
    ok: true,
    message: 'AGT simulate ON (sandbox) — safe for internal demo',
  });

  let certificate = null;
  const signingBefore = await getSigningStatus();

  if (generateTestCertificate && signingBefore.mode !== 'rsa') {
    certificate = await ensureDemoCertificate();
    steps.push({
      id: 'signing',
      ok: true,
      message: certificate.reused
        ? `Existing test PKCS#12 reactivated (${DEMO_CERT_ALIAS})`
        : `Test PKCS#12 imported and activated (${DEMO_CERT_ALIAS})`,
    });
  } else if (signingBefore.mode === 'rsa') {
    steps.push({
      id: 'signing',
      ok: true,
      message: `RSA signing already active (${signingBefore.activeKeyAlias || 'certificate'})`,
    });
  } else {
    steps.push({
      id: 'signing',
      ok: false,
      message: 'Test certificate generation skipped',
    });
  }

  const certification = await getCertificationStatus();

  return {
    ok: steps.every((s) => s.ok),
    demo: {
      nif: DEMO_NIF,
      softwareValidationNumber: DEMO_VALIDATION_NUMBER,
      companyName: DEMO_COMPANY_NAME,
      agtSimulate: true,
      testCertificateAlias: DEMO_CERT_ALIAS,
      testCertificatePassphrase: DEMO_CERT_PASSPHRASE,
      demoScriptPath: 'scripts/agt-certification/demo-test-script.md',
    },
    steps,
    certificate,
    certification,
  };
}

module.exports = {
  DEMO_NIF,
  DEMO_VALIDATION_NUMBER,
  DEMO_COMPANY_NAME,
  DEMO_CERT_ALIAS,
  DEMO_CERT_PASSPHRASE,
  applyCertificationDemoProfile,
};
