const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('buildPurchaseReceiveGlLines', { concurrency: 1 }, () => {
  let harness;
  let buildPurchaseReceiveGlLines;

  before(() => {
    harness = createSqliteHarness();
    ({ buildPurchaseReceiveGlLines } = require(path.join(BACKEND_SRC, 'transactionEngine')));
  });

  after(() => {
    harness?.dispose();
  });

  it('capitalizes freight into 212 and does not expense 752', () => {
    const lines = buildPurchaseReceiveGlLines({
      subtotal: 1000,
      taxAmount: 140,
      totalLandingCosts: 50,
      supplierAccountCode: '32100001',
      orderNumber: 'PO-1',
      supplierName: 'Fornecedor X',
    });
    const byCode = Object.fromEntries(lines.map((l) => [l.accountCode, l]));
    assert.equal(byCode['212'].debit, 1050);
    assert.equal(byCode['3451'].debit, 140);
    assert.equal(byCode['32100001'].credit, 1190);
    assert.equal(lines.some((l) => l.accountCode === '752'), false);
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    assert.equal(debit, credit);
  });

  it('without freight still balances goods + IVA vs supplier', () => {
    const lines = buildPurchaseReceiveGlLines({
      subtotal: 200,
      taxAmount: 28,
      totalLandingCosts: 0,
      supplierAccountCode: '32100002',
      orderNumber: 'PO-2',
      supplierName: 'Y',
    });
    assert.equal(lines.find((l) => l.accountCode === '212').debit, 200);
    assert.equal(lines.find((l) => l.accountCode === '32100002').credit, 228);
  });
});
