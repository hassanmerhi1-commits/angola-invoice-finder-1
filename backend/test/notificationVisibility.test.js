const test = require('node:test');
const assert = require('node:assert/strict');
const {
  visibleNotificationTypes,
  isRestrictedToOwnNotifications,
} = require('../src/lib/notificationVisibility');

const cashier = { id: 'u-cashier', role: 'cashier' };
const manager = { id: 'u-manager', role: 'manager' };
const admin = { id: 'u-admin', role: 'admin' };

test('a cashier only ever sees the answer to their own expense', () => {
  assert.deepEqual(visibleNotificationTypes(cashier), ['approval_result']);
});

test('managers and admins are unrestricted', () => {
  assert.equal(visibleNotificationTypes(manager), null);
  assert.equal(visibleNotificationTypes(admin), null);
  assert.equal(isRestrictedToOwnNotifications(manager), false);
  assert.equal(isRestrictedToOwnNotifications(admin), false);
});

test('a cashier never sees operational broadcasts', () => {
  const types = visibleNotificationTypes(cashier);
  for (const hidden of ['low_stock', 'overdue_ar', 'period_close', 'agt_failure', 'system']) {
    assert.ok(!types.includes(hidden), `${hidden} must stay hidden`);
  }
  assert.equal(isRestrictedToOwnNotifications(cashier), true);
});

test('a cashier granted approval rights also gets the requests to act on', () => {
  const elevated = {
    id: 'u-cashier-approver',
    role: 'cashier',
    permissionOverrides: { granted: ['expense_approve'], revoked: [] },
  };
  assert.deepEqual(visibleNotificationTypes(elevated), ['approval_result', 'approval_pending']);
  // Still restricted: they read their own rows, not the management broadcasts.
  assert.equal(isRestrictedToOwnNotifications(elevated), true);
});

test('role matching ignores case and padding', () => {
  assert.deepEqual(visibleNotificationTypes({ id: 'x', role: ' Cashier ' }), ['approval_result']);
});

test('an unknown or missing role is treated as unrestricted, as before', () => {
  assert.equal(visibleNotificationTypes({ id: 'x', role: 'viewer' }), null);
  assert.equal(visibleNotificationTypes({ id: 'x' }), null);
});
