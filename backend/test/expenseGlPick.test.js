const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { expenseAccountRejection } = require('../src/lib/expenseGlPick');

describe('expense GL account pick', () => {
  it('accepts an 8-digit cost account and rejects a group', () => {
    assert.equal(expenseAccountRejection({
      code: '75200001',
      is_header: false,
      is_active: true,
      account_type: 'expense',
    }), '');
    assert.match(expenseAccountRejection({
      code: '752',
      is_header: true,
      is_active: true,
      account_type: 'expense',
    }), /group/i);
    assert.match(expenseAccountRejection({
      code: '32100001',
      is_header: false,
      is_active: true,
      account_type: 'liability',
    }), /cost account/i);
  });
});
