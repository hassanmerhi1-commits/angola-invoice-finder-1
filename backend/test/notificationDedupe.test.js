const test = require('node:test');
const assert = require('node:assert/strict');
const {
  overdueDedupeKey,
  overdueIdentityFromDedupe,
  periodDedupeKey,
  agtDedupeKey,
} = require('../src/lib/notificationDedupe');

test('an overdue invoice keeps one key, with or without the old day suffix', () => {
  assert.equal(overdueDedupeKey('cust-1', 'FT 14'), 'overdue_ar:cust-1:FT 14');
  assert.equal(overdueIdentityFromDedupe('overdue_ar:cust-1:FT 14'), 'cust-1:FT 14');
  assert.equal(overdueIdentityFromDedupe('overdue_ar:cust-1:FT 14:2026-11-12'), 'cust-1:FT 14');
  assert.equal(
    overdueIdentityFromDedupe('overdue_ar:cust-1:FT 14:2026-11-12'),
    overdueIdentityFromDedupe(overdueDedupeKey('cust-1', 'FT 14')),
  );
});

test('period and AGT keys are not dated', () => {
  assert.equal(periodDedupeKey('p1'), 'period_close:p1');
  assert.equal(agtDedupeKey('sale', 'sale-1'), 'agt_fail:sale:sale-1');
});
