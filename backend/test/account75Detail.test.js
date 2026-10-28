/**
 * Account 75 detail must be the approved 8-digit tree, not a flat extra under 75.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { account75DetailRows } = require(path.join(__dirname, '../src/lib/ensureAccount75Detail'));

describe('account 75 detail', () => {
  const rows = account75DetailRows();
  const byCode = new Map(rows.map((row) => [row.code, row]));

  it('keeps 752 and 753 as groups and adds the approved children', () => {
    assert.equal(byCode.get('752').is_header, true);
    assert.equal(byCode.get('753').is_header, true);
    assert.equal(byCode.get('75200001').name, 'Água');
    assert.equal(byCode.get('75200001').parent_code, '752');
    assert.equal(byCode.get('7521').parent_code, '752');
    assert.equal(byCode.get('7521').is_header, true);
    assert.equal(byCode.get('75210001').parent_code, '7521');
    assert.equal(byCode.get('75210002').name, 'Nacional');
    assert.equal(byCode.get('75310002').name, 'IVA');
    assert.equal(byCode.get('75310002').parent_code, '7531');
    assert.equal(byCode.get('75320003').parent_code, '7532');
    assert.equal(rows.filter((row) => row.code !== '752' && row.code !== '753').length, 35);
  });
});
