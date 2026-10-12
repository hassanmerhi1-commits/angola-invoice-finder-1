/**
 * AGT Facturação Electrónica spec conformance (portaldoparceiro.minfin.gov.ao/doc-agt/faturacao-electronica/1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  buildRegistarFacturaPayload,
  buildObterEstadoPayload,
  ceilCent,
  SCHEMA_VERSION,
} = require('../src/agt/fePayload');
const { decodeJwsPayload } = require('../src/agt/jwsSign');
const { interpretStatusResponse } = require('../src/agt/connector');
const { loadSoftwarePrivateKey, clearSoftwareKeyCache } = require('../src/agt/softwareKey');

function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey,
  };
}

function verifyJws(token, publicKey) {
  const [h, p, s] = token.split('.');
  const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, sig);
}

const config = { companyNif: '5000413178', softwareCertificateNumber: 'C_TEST' };
const saleMeta = { numberCol: 'invoice_number', dateCol: 'created_at', docType: 'FT' };
const noteMeta = { numberCol: 'document_number', dateCol: 'issued_at', docType: 'NC' };

test('schema version is 2.0', () => {
  assert.equal(SCHEMA_VERSION, '2.0');
});

test('taxContribution rounds up to the next cêntimo', () => {
  assert.equal(ceilCent(23.144), 23.15);
  assert.equal(ceilCent(0.001844), 0.01);
  assert.equal(ceilCent(5.9999999), 6);
  assert.equal(ceilCent(70), 70);
  assert.equal(ceilCent(0), 0);
});

test('lines carry operationType, pre-discount price and settlementAmount; totals follow the lines', () => {
  const taxpayer = keyPair();
  const payload = buildRegistarFacturaPayload({
    config,
    entityKind: 'sale',
    meta: saleMeta,
    doc: {
      invoice_number: 'FT-SOY-2026-00001',
      invoice_type: 'FT',
      created_at: '2026-10-12T09:00:00.000Z',
      customer_nif: '5000123456',
      customer_name: 'Cliente Lda',
      subtotal: 1065.31,
      tax_amount: 149.14,
      total: 1214.45,
    },
    items: [
      { sku: 'A1', productName: 'Arroz', quantity: 2, unitPrice: 500, taxRate: 14, subtotal: 900 },
      { sku: 'B2', productName: 'Óleo', quantity: 1, unitPrice: 165.31, taxRate: 14, subtotal: 165.31 },
    ],
    privateKeyPem: taxpayer.privatePem,
  });
  const [discounted, plain] = payload.documents[0].lines;

  assert.equal(discounted.operationType, 'TB');
  assert.equal(discounted.unitPriceBase, 500);
  assert.equal(discounted.unitPrice, 450);
  assert.equal(discounted.settlementAmount, 100);
  assert.equal(discounted.creditAmount, 900);
  assert.equal(discounted.taxes[0].taxContribution, 126);

  assert.equal(plain.settlementAmount, 0);
  assert.equal(plain.unitPriceBase, plain.unitPrice);
  assert.equal(plain.taxes[0].taxContribution, 23.15); // 165.31 × 14% = 23.1434

  const totals = payload.documents[0].documentTotals;
  assert.equal(totals.netTotal, 1065.31);
  assert.equal(totals.taxPayable, 149.15);
  assert.equal(totals.grossTotal, 1214.46);
  const signed = decodeJwsPayload(payload.documents[0].jwsDocumentSignature);
  assert.deepEqual(signed.documentTotals, totals);
});

test('credit note lines reference the original invoice (E13) and use debitAmount', () => {
  const taxpayer = keyPair();
  const payload = buildRegistarFacturaPayload({
    config,
    entityKind: 'credit_note',
    meta: noteMeta,
    doc: {
      document_number: 'NC-SOY-2026-00003',
      issued_at: '2026-10-12T10:00:00.000Z',
      original_invoice_number: 'FR-SOY-2026-00041',
      original_invoice_type: 'FR',
      reason: 'return',
      reason_description: 'Devolução de mercadoria',
      customer_nif: '',
      subtotal: 100,
      tax_amount: 14,
      total: 114,
    },
    items: [{ sku: 'A1', productName: 'Arroz', quantity: 1, unitPrice: 100, taxRate: 14, subtotal: 100 }],
    privateKeyPem: taxpayer.privatePem,
  });
  const doc = payload.documents[0];
  assert.equal(doc.documentType, 'NC');
  assert.equal(doc.documentNo, 'NC NC-SOY-2026-00003');
  const line = doc.lines[0];
  assert.deepEqual(line.referenceInfo, { reference: 'FR FR-SOY-2026-00041', reason: 'Devolução de mercadoria' });
  assert.equal(line.debitAmount, 100);
  assert.ok(!Object.prototype.hasOwnProperty.call(line, 'creditAmount'));
});

test('FS original invoices are referenced as FR', () => {
  const taxpayer = keyPair();
  const payload = buildRegistarFacturaPayload({
    config,
    entityKind: 'credit_note',
    meta: noteMeta,
    doc: {
      document_number: 'NC-1',
      issued_at: '2026-10-12T10:00:00.000Z',
      original_invoice_number: 'FS-SOY-2026-00002',
      original_invoice_type: 'FS',
      subtotal: 10,
      tax_amount: 1.4,
      total: 11.4,
    },
    items: [{ sku: 'A1', quantity: 1, unitPrice: 10, taxRate: 14, subtotal: 10 }],
    privateKeyPem: taxpayer.privatePem,
  });
  assert.equal(payload.documents[0].lines[0].referenceInfo.reference, 'FR FS-SOY-2026-00002');
});

test('debit note lines are services (SG)', () => {
  const taxpayer = keyPair();
  const payload = buildRegistarFacturaPayload({
    config,
    entityKind: 'debit_note',
    meta: { numberCol: 'document_number', dateCol: 'issued_at', docType: 'ND' },
    doc: { document_number: 'ND-1', issued_at: '2026-10-12T10:00:00.000Z', subtotal: 50, tax_amount: 7, total: 57 },
    items: [{ description: 'Juros', quantity: 1, unitPrice: 50, taxRate: 14, subtotal: 50 }],
    privateKeyPem: taxpayer.privatePem,
  });
  assert.equal(payload.documents[0].lines[0].operationType, 'SG');
  assert.equal(payload.documents[0].lines[0].referenceInfo, undefined);
});

test('software signature uses the producer key; document signature uses the taxpayer key', () => {
  const taxpayer = keyPair();
  const producer = keyPair();
  const payload = buildRegistarFacturaPayload({
    config,
    entityKind: 'sale',
    meta: saleMeta,
    doc: { invoice_number: 'FT-1', created_at: '2026-10-12T09:00:00.000Z', subtotal: 10, tax_amount: 1.4, total: 11.4 },
    items: [{ sku: 'A1', quantity: 1, unitPrice: 10, taxRate: 14, subtotal: 10 }],
    privateKeyPem: taxpayer.privatePem,
    softwarePrivateKeyPem: producer.privatePem,
  });
  assert.equal(verifyJws(payload.softwareInfo.jwsSoftwareSignature, producer.publicKey), true);
  assert.equal(verifyJws(payload.softwareInfo.jwsSoftwareSignature, taxpayer.publicKey), false);
  assert.equal(verifyJws(payload.documents[0].jwsDocumentSignature, taxpayer.publicKey), true);
});

test('obterEstado request is fully formed and jwsSignature covers NIF + requestID', () => {
  const taxpayer = keyPair();
  const producer = keyPair();
  const payload = buildObterEstadoPayload({
    config,
    requestId: '202500000000118',
    privateKeyPem: taxpayer.privatePem,
    softwarePrivateKeyPem: producer.privatePem,
  });
  assert.equal(payload.schemaVersion, '2.0');
  assert.match(payload.submissionUUID, /^[0-9a-f-]{36}$/);
  assert.match(payload.submissionTimeStamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(payload.requestID, '202500000000118');
  assert.deepEqual(decodeJwsPayload(payload.jwsSignature), {
    taxRegistrationNumber: '5000413178',
    requestID: '202500000000118',
  });
  assert.equal(verifyJws(payload.jwsSignature, taxpayer.publicKey), true);
  assert.equal(verifyJws(payload.softwareInfo.jwsSoftwareSignature, producer.publicKey), true);
});

test('obterEstado: V is validated, I is invalid with AGT errors', () => {
  const valid = interpretStatusResponse({
    requestID: '1',
    resultCode: 0,
    documentStatusList: [{ documentNo: 'FT FT-1', documentStatus: 'V' }],
  }, 'FT FT-1');
  assert.equal(valid.agtStatus, 'validated');
  assert.ok(valid.validatedAt);

  const invalid = interpretStatusResponse({
    requestID: '2',
    resultCode: '1',
    documentStatusList: [
      { documentNo: 'FT FT-1', documentStatus: 'V' },
      { documentNo: 'FT FT-2', documentStatus: 'I', errorList: [{ errorCode: 'E22', errorDescription: 'Total de impostos' }] },
    ],
  }, 'FT FT-2');
  assert.equal(invalid.agtStatus, 'invalid');
  assert.deepEqual(invalid.errors, [{ code: 'E22', description: 'Total de impostos' }]);
});

test('obterEstado: processing / premature / cancelled', () => {
  assert.equal(interpretStatusResponse({ resultCode: 8 }, 'FT 1').agtStatus, 'submitted');
  assert.equal(interpretStatusResponse({ resultCode: 8 }, 'FT 1').retryLater, true);
  assert.equal(interpretStatusResponse({ resultCode: '7' }, 'FT 1').retryLater, true);
  assert.equal(interpretStatusResponse({ resultCode: 9 }, 'FT 1').agtStatus, 'invalid');
  assert.equal(interpretStatusResponse({ resultCode: 2, documentStatusList: [] }, 'FT 1').agtStatus, 'invalid');
});

test('software key loads from AGT_SOFTWARE_PRIVATE_KEY and rejects weak keys', () => {
  const previous = process.env.AGT_SOFTWARE_PRIVATE_KEY;
  try {
    const producer = keyPair();
    process.env.AGT_SOFTWARE_PRIVATE_KEY = producer.privatePem.replace(/\n/g, '\\n');
    clearSoftwareKeyCache();
    const loaded = loadSoftwarePrivateKey();
    assert.equal(loaded.source, 'env:AGT_SOFTWARE_PRIVATE_KEY');
    assert.equal(loaded.pem.trim(), producer.privatePem.trim());

    const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' });
    process.env.AGT_SOFTWARE_PRIVATE_KEY = weak;
    clearSoftwareKeyCache();
    const fallback = loadSoftwarePrivateKey();
    assert.ok(!fallback || fallback.source !== 'env:AGT_SOFTWARE_PRIVATE_KEY');
  } finally {
    if (previous === undefined) delete process.env.AGT_SOFTWARE_PRIVATE_KEY;
    else process.env.AGT_SOFTWARE_PRIVATE_KEY = previous;
    clearSoftwareKeyCache();
  }
});
