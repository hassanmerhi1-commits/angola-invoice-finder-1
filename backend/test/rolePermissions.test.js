const test = require('node:test');
const assert = require('node:assert/strict');
const { userHasPermission } = require('../src/lib/rolePermissions');

const none = { granted: [], revoked: [] };

test('backdate and historical edit are admin-only unless granted', () => {
  assert.equal(userHasPermission('admin', none, 'backdate_post'), true);
  assert.equal(userHasPermission('admin', none, 'edit_historical'), true);
  assert.equal(userHasPermission('manager', none, 'backdate_post'), false);
  assert.equal(userHasPermission('manager', none, 'edit_historical'), false);
  assert.equal(userHasPermission('cashier', none, 'backdate_post'), false);
  assert.equal(userHasPermission('cashier', none, 'edit_historical'), false);
});

test('a manager can receive backdate as a per-user grant', () => {
  const granted = { granted: ['backdate_post', 'edit_historical'], revoked: [] };
  assert.equal(userHasPermission('manager', granted, 'backdate_post'), true);
  assert.equal(userHasPermission('manager', granted, 'edit_historical'), true);
});
