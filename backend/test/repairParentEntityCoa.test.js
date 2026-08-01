/**
 * Unit tests for parent 321/311 → leaf COA repair helpers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isLeafCode } = require('../src/lib/repairParentEntityCoa');

describe('repairParentEntityCoa helpers', () => {
  it('isLeafCode accepts 8-digit supplier/client leaves', () => {
    assert.equal(isLeafCode('32100007', '321'), true);
    assert.equal(isLeafCode('31100001', '311'), true);
    assert.equal(isLeafCode('321', '321'), false);
    assert.equal(isLeafCode('311', '311'), false);
    assert.equal(isLeafCode('32', '321'), false);
    assert.equal(isLeafCode('', '321'), false);
    assert.equal(isLeafCode(null, '321'), false);
  });
});
