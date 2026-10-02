const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dateRangeSql } = require('../src/lib/dateRangeFilter');

test('postgres bounds are Luanda midnights, inclusive start and exclusive end', () => {
  const params = ['branch-1'];
  const sql = dateRangeSql({ engine: 'postgres' }, 'created_at', params, '2026-09-30', '2026-09-30');

  assert.equal(
    sql,
    " AND created_at >= ($2::date AT TIME ZONE 'Africa/Luanda')"
      + " AND created_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Africa/Luanda')",
  );
  // Numbering continues after the params the caller already pushed.
  assert.deepEqual(params, ['branch-1', '2026-09-30', '2026-09-30']);
});

test('postgres ignores a time or junk pasted onto the date', () => {
  const params = [];
  dateRangeSql({ engine: 'postgres' }, 'issued_at', params, '2026-07-01T23:59:59Z', ' 2026-08-31 ');
  assert.deepEqual(params, ['2026-07-01', '2026-08-31']);
});

test('sqlite keeps the legacy string and date() comparisons', () => {
  const params = [];
  const sql = dateRangeSql({ engine: 'sqlite' }, 'created_at', params, '2026-09-30', '2026-09-30');

  assert.equal(
    sql,
    ' AND created_at >= $1 AND date(created_at) <= date($2)',
  );
  assert.deepEqual(params, ['2026-09-30T00:00:00', '2026-09-30']);
});

test('no dates means no filter and no params', () => {
  const params = ['keep-me'];
  const sql = dateRangeSql({ engine: 'postgres' }, 'created_at', params, '', undefined);
  assert.equal(sql, '');
  assert.deepEqual(params, ['keep-me']);
});

test('only one bound is applied when the other is missing', () => {
  const params = [];
  const sql = dateRangeSql({ engine: 'postgres' }, 'created_at', params, '2026-09-01', '');
  assert.match(sql, /created_at >= /);
  assert.doesNotMatch(sql, /INTERVAL/);
  assert.deepEqual(params, ['2026-09-01']);
});
