/**
 * Soyo and Luanda goods purchases need a postable leaf under the city group.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { purchaseGoodsRows, purchaseReturnRows } = require(path.join(__dirname, '../src/lib/ensurePurchaseGoodsLeaves'));

describe('purchase goods leaves', () => {
  const rows = purchaseGoodsRows();
  const byCode = new Map(rows.map((row) => [row.code, row]));

  it('keeps the city groups and adds one postable account under each', () => {
    assert.equal(byCode.get('2122').is_header, true);
    assert.equal(byCode.get('2122').parent_code, '212');
    assert.equal(byCode.get('21220001').is_header, false);
    assert.equal(byCode.get('21220001').name, 'MERCADORIAS GERAL SOYO');
    assert.equal(byCode.get('21220001').parent_code, '2122');
    assert.equal(byCode.get('21220001').account_type, 'expense');
    assert.equal(byCode.get('2121').is_header, true);
    assert.equal(byCode.get('21210001').is_header, false);
    assert.equal(byCode.get('21210001').parent_code, '2121');
    assert.equal(rows.length, 4);
  });
});

describe('purchase return leaves', () => {
  const rows = purchaseReturnRows();
  const byCode = new Map(rows.map((row) => [row.code, row]));

  it('keeps the return groups and adds one postable account for each city', () => {
    assert.equal(byCode.get('217').is_header, true);
    assert.equal(byCode.get('2172').is_header, true);
    assert.equal(byCode.get('2172').parent_code, '217');
    assert.equal(byCode.get('21720001').is_header, false);
    assert.equal(byCode.get('21720001').name, 'DEVOLUCOES DE COMPRAS - SOYO');
    assert.equal(byCode.get('21720001').parent_code, '2172');
    assert.equal(byCode.get('21710001').parent_code, '2171');
    assert.equal(byCode.get('21710001').is_header, false);
  });
});
