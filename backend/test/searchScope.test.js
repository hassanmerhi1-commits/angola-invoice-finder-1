const test = require('node:test');
const assert = require('node:assert/strict');
const { scopedSql } = require('../src/lib/searchScopedSql');

test('search branch filter wraps OR terms so AND cannot bind only the last clause', () => {
  const sqls = [
    `SELECT id FROM sales WHERE invoice_number ILIKE $1 OR customer_name ILIKE $1 ORDER BY created_at DESC LIMIT $2`,
  ];
  const out = scopedSql(sqls, 'branch-1', 'AND branch_id = $4');
  assert.match(
    out[0],
    /WHERE \(invoice_number ILIKE \$1 OR customer_name ILIKE \$1\) AND branch_id = \$4 ORDER BY/,
  );
});

test('search leaves SQL alone when HQ is unscoped', () => {
  const sqls = ['SELECT id FROM sales WHERE x = 1 ORDER BY id'];
  assert.equal(scopedSql(sqls, null, 'AND branch_id = $4')[0], sqls[0]);
});
