const test = require('node:test');
const assert = require('node:assert/strict');
const { sqlDateOnly } = require('../src/lib/sqlDateOnly');

test('local-midnight Date keeps the calendar day, not the UTC day', () => {
  const localMidnight = new Date(2026, 9, 28, 0, 0, 0, 0);
  assert.equal(sqlDateOnly(localMidnight), '2026-10-28');
});

test('JSON from Angola local midnight rolls forward to the stored day', () => {
  assert.equal(sqlDateOnly('2026-10-27T23:00:00.000Z'), '2026-10-28');
  assert.equal(sqlDateOnly('2026-10-27T22:00:00.000Z'), '2026-10-28');
});

test('plain dates and real timestamps are not shifted', () => {
  assert.equal(sqlDateOnly('2026-10-28'), '2026-10-28');
  assert.equal(sqlDateOnly('2026-10-28T14:23:00.000Z'), '2026-10-28');
  assert.equal(sqlDateOnly(''), '');
  assert.equal(sqlDateOnly(null), '');
});
