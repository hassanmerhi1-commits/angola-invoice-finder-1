const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLiveRegistarFacturaPayload,
  formatAgtRequestPayloadForPortal,
} = require('../src/agt/agtRequestPayload');

test('live schema 1.2 payload is not marked simulated', () => {
  const formatted = formatAgtRequestPayloadForPortal({
    schemaVersion: '1.2',
    taxRegistrationNumber: '5000413178',
    documents: [{ documentType: 'TV', documentNo: 'TV SEDE/2026/00001' }],
  });
  assert.equal(formatted.simulated, false);
  assert.equal(formatted.documentType, 'TV');
  assert.equal(formatted.documentNo, 'TV SEDE/2026/00001');
  assert.match(formatted.json, /"schemaVersion":"1.2"/);
});

test('simulate stub is marked simulated', () => {
  const formatted = formatAgtRequestPayloadForPortal({
    documentType: 'FR',
    documentNumber: 'FR-SEDE-2026-00001',
    environment: 'sandbox',
  });
  assert.equal(formatted.simulated, true);
  assert.equal(formatted.documentType, 'FR');
  assert.equal(isLiveRegistarFacturaPayload({ documentType: 'FR' }), false);
});

test('invalid payload throws', () => {
  assert.throws(() => formatAgtRequestPayloadForPortal(''), /em falta ou inválido/);
  assert.throws(() => formatAgtRequestPayloadForPortal('not-json'), /em falta ou inválido/);
});
