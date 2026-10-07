/**
 * Company settings persistence (partial saves from settings cards).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('companySettings', { concurrency: 1 }, () => {
  let harness;
  let companySettings;

  before(() => {
    harness = createSqliteHarness();
    companySettings = require(path.join(BACKEND_SRC, 'agt', 'companySettings'));
  });

  after(() => {
    harness?.dispose();
  });

  it('partial save keeps NIF, name and AGT certificate', async () => {
    await companySettings.saveCompanySettings({
      name: 'AFRIBEST LDA',
      nif: '5417000000',
      address: 'Rua 1, Luanda',
      agtCertificateNumber: '123/AGT/2026',
    });

    const saved = await companySettings.saveCompanySettings({ finalConsumerDocType: 'TV' });
    assert.equal(saved.nif, '5417000000');
    assert.equal(saved.name, 'AFRIBEST LDA');
    assert.equal(saved.address, 'Rua 1, Luanda');
    assert.equal(saved.agtCertificateNumber, '123/AGT/2026');
    assert.equal(saved.finalConsumerDocType, 'TV');

    const reloaded = await companySettings.getCompanySettings();
    assert.equal(reloaded.nif, '5417000000');
    assert.equal(await companySettings.getFinalConsumerDocType(), 'TV');

    await companySettings.saveCompanySettings({ posDefaultPriceLevel: 3 });
    const afterPos = await companySettings.getCompanySettings();
    assert.equal(afterPos.nif, '5417000000');
    assert.equal(afterPos.posDefaultPriceLevel, 3);
    assert.equal(afterPos.finalConsumerDocType, 'TV');
  });

  it('invalid finalConsumerDocType falls back to FS', async () => {
    const saved = await companySettings.saveCompanySettings({ finalConsumerDocType: 'XX' });
    assert.equal(saved.finalConsumerDocType, 'FS');
  });
});
