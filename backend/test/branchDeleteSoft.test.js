const test = require('node:test');
const assert = require('node:assert/strict');
const {
  branchesListSql,
  deactivateBranchSql,
  deactivateBranchWarehousesSql,
} = require('../src/lib/sqlDialect');

test('postgres branch list hides deactivated filiais', () => {
  const sql = branchesListSql({ engine: 'postgres' });
  assert.match(sql, /is_active IS NOT FALSE/);
});

test('postgres branch delete writes is_active false, not a hard delete', () => {
  const sql = deactivateBranchSql({ engine: 'postgres' });
  assert.match(sql, /is_active = false/);
  assert.doesNotMatch(sql, /DELETE FROM branches/i);
});

test('sqlite branch delete still uses the integer flag', () => {
  const sql = deactivateBranchSql({ engine: 'sqlite' });
  assert.match(sql, /is_active = 0/);
});

test('deactivated filial also hides its warehouses', () => {
  assert.match(deactivateBranchWarehousesSql({ engine: 'postgres' }), /is_active = false/);
  assert.match(deactivateBranchWarehousesSql({ engine: 'sqlite' }), /is_active = 0/);
});
