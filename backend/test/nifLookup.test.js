const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRemoteBody, normalizeNif } = require('../src/agt/nifLookup');

test('reads the registered name from a flat JSON answer', () => {
  const parsed = parseRemoteBody(JSON.stringify({ nif: '5000000000', nome: 'EMPRESA TESTE, LDA', morada: 'LUANDA' }));
  assert.equal(parsed.name, 'EMPRESA TESTE, LDA');
  assert.equal(parsed.address, 'LUANDA');
});

test('reads the name from a nested JSON answer and prefers a top-level nome', () => {
  const parsed = parseRemoteBody(JSON.stringify({
    success: true,
    data: { contribuinte: { denominacaoSocial: 'NESTED, SA', estado: 'Activo' } },
  }));
  assert.equal(parsed.name, 'NESTED, SA');
  assert.equal(parsed.taxpayerStatus, 'Activo');
});

test('reads the name from a SOAP/XML answer', () => {
  const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="x"><soap:Body>
    <ns2:obterInfoContribuinteResponse><InfoContribuinteTipo>
      <ns2:nome>JOSÉ &amp; FILHOS</ns2:nome><morada>VIANA</morada>
    </InfoContribuinteTipo></ns2:obterInfoContribuinteResponse></soap:Body></soap:Envelope>`;
  const parsed = parseRemoteBody(xml);
  assert.equal(parsed.name, 'JOSÉ & FILHOS');
  assert.equal(parsed.address, 'VIANA');
});

test('an answer without a name reads as not found', () => {
  assert.equal(parseRemoteBody(JSON.stringify({ success: false, message: 'NIF não encontrado' })).name, '');
  assert.equal(parseRemoteBody('').name, '');
});

test('NIF input is normalised before lookup', () => {
  assert.equal(normalizeNif(' 500 212-5560 '), '5002125560');
  assert.equal(normalizeNif('006887386be049'), '006887386BE049');
});
