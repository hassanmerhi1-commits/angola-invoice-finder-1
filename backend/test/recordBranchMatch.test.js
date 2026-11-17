const test = require('node:test');
const assert = require('node:assert/strict');
const { recordBranchMatchSql } = require('../src/lib/branchIdMatch');

test('credit note branch filter matches id, dashless key, and branch name only', () => {
  const resolved = '11111111-2222-3333-4444-555555555555';
  const { sql, params } = recordBranchMatchSql(
    { engine: 'postgres' },
    resolved,
    'Soyo 05',
    1,
  );
  assert.match(sql, /branch_id::text = \$1/);
  assert.doesNotMatch(sql, /original_invoice_id/);
  assert.match(sql, /branch_name/);
  assert.deepEqual(params, [
    resolved,
    '11111111222233334444555555555555',
    'soyo 05',
  ]);
});
