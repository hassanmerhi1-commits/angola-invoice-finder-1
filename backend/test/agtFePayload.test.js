const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  taxCodeForIvaRate,
  agtDocumentType,
  formatDocumentNo,
  customerTaxId,
  buildRegistarFacturaPayload,
  FINAL_CONSUMER_TAX_ID,
  SCHEMA_VERSION,
  PRODUCT_ID,
} = require('../src/agt/fePayload');
const { signJws, decodeJwsPayload } = require('../src/agt/jwsSign');
const { resolveApiUrl, isPlaceholderUrl, HML_BASE } = require('../src/agt/connector');

function testKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs1', format: 'pem' });
}

test('IVA rates map to AGT taxCode', () => {
  assert.equal(taxCodeForIvaRate(14), 'NOR');
  assert.equal(taxCodeForIvaRate(7), 'INT');
  assert.equal(taxCodeForIvaRate(5), 'RED');
  assert.equal(taxCodeForIvaRate(0), 'ISE');
});

test('FS is sent to AGT as FR', () => {
  assert.equal(agtDocumentType('FS', 'sale'), 'FR');
  assert.equal(agtDocumentType('FR', 'sale'), 'FR');
  assert.equal(agtDocumentType('FT', 'sale'), 'FT');
  assert.equal(agtDocumentType('FT', 'credit_note'), 'NC');
});

test('documentNo is type + space + series', () => {
  assert.equal(formatDocumentNo('FR', 'LUANDA/2026/0001'), 'FR LUANDA/2026/0001');
  assert.equal(formatDocumentNo('FR', 'FR LUANDA/2026/0001'), 'FR LUANDA/2026/0001');
  assert.equal(formatDocumentNo('FR', 'FS LUANDA/1'), 'FR LUANDA/1');
});

test('unidentified customer uses AGT 999999999', () => {
  assert.equal(customerTaxId(''), FINAL_CONSUMER_TAX_ID);
  assert.equal(customerTaxId('999999990'), FINAL_CONSUMER_TAX_ID);
  assert.equal(customerTaxId('5000123456'), '5000123456');
});

test('placeholder AGT URLs are replaced by homologation host', () => {
  assert.equal(isPlaceholderUrl('https://sandbox.agt.gov.ao/api/v1/documents'), true);
  const url = resolveApiUrl({ environment: 'sandbox', apiUrl: '' });
  assert.equal(url, `${HML_BASE}/registarFactura`);
});

test('JWS RS256 payload round-trips with JOSE typ', () => {
  const pem = testKeyPem();
  const payload = { productId: 'NEXOR ERP', productVersion: '1.0.0' };
  const token = signJws(payload, pem);
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const header = JSON.parse(
    Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  );
  assert.equal(header.typ, 'JOSE');
  assert.equal(header.alg, 'RS256');
  assert.deepEqual(decodeJwsPayload(token), payload);
});

test('registarFactura payload matches AGT schema 1.2', () => {
  const pem = testKeyPem();
  const payload = buildRegistarFacturaPayload({
    config: {
      companyNif: '5000413178',
      softwareCertificateNumber: 'C_TEST',
    },
    entityKind: 'sale',
    meta: { numberCol: 'invoice_number', dateCol: 'created_at', docType: 'FR' },
    doc: {
      invoice_number: 'LUANDA/2026/0008',
      invoice_type: 'FS',
      created_at: '2026-08-13T12:00:00.000Z',
      customer_nif: '',
      customer_name: '',
      subtotal: 1000,
      tax_amount: 140,
      total: 1140,
    },
    items: [{
      sku: 'SKU1',
      productName: 'Arroz',
      quantity: 2,
      unitPrice: 500,
      taxRate: 14,
      taxAmount: 140,
      subtotal: 1000,
    }],
    privateKeyPem: pem,
  });

  assert.equal(payload.schemaVersion, SCHEMA_VERSION);
  assert.equal(payload.taxRegistrationNumber, '5000413178');
  assert.equal(payload.numberOfEntries, 1);
  assert.equal(payload.softwareInfo.softwareInfoDetail.productId, PRODUCT_ID);
  assert.ok(payload.softwareInfo.jwsSoftwareSignature.split('.').length === 3);
  const doc = payload.documents[0];
  assert.equal(doc.documentType, 'FR');
  assert.equal(doc.documentNo, 'FR LUANDA/2026/0008');
  assert.equal(doc.customerTaxID, FINAL_CONSUMER_TAX_ID);
  assert.equal(doc.lines[0].creditAmount, 1000);
  assert.equal(doc.lines[0].taxes[0].taxCode, 'NOR');
  assert.equal(doc.documentTotals.grossTotal, 1140);
  assert.ok(!Object.prototype.hasOwnProperty.call(doc.lines[0], 'debitAmount'));
});
