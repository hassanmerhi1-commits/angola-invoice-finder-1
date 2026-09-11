const test = require('node:test');
const assert = require('node:assert/strict');
const { selectExpenseApprovers } = require('../src/lib/expenseApprovers');

const SOYO = 'b-soyo';
const LUANDA = 'b-luanda';

const users = [
  { id: 'admin-1', role: 'admin', branch_id: LUANDA },
  { id: 'manager-soyo', role: 'manager', branch_id: SOYO },
  { id: 'manager-luanda', role: 'manager', branch_id: LUANDA },
  { id: 'manager-hq', role: 'manager', branch_id: null },
  { id: 'cashier-soyo', role: 'cashier', branch_id: SOYO },
  { id: 'viewer-soyo', role: 'viewer', branch_id: SOYO },
];

function idsFor(branchId, list = users) {
  return selectExpenseApprovers(list, branchId).map((u) => u.id).sort();
}

test('only the spending branch is asked to approve, plus admins and head office', () => {
  assert.deepEqual(idsFor(SOYO), ['admin-1', 'manager-hq', 'manager-soyo']);
});

test('a manager from another filial is not notified', () => {
  assert.ok(!idsFor(SOYO).includes('manager-luanda'));
});

test('cashiers and viewers never approve', () => {
  const all = idsFor(SOYO).concat(idsFor(LUANDA));
  assert.ok(!all.includes('cashier-soyo'));
  assert.ok(!all.includes('viewer-soyo'));
});

test('a cashier granted expense_approve is notified for their own branch', () => {
  const elevated = [
    ...users,
    {
      id: 'cashier-approver',
      role: 'cashier',
      branch_id: SOYO,
      permissions: JSON.stringify({ granted: ['expense_approve'], revoked: [] }),
    },
  ];
  assert.ok(idsFor(SOYO, elevated).includes('cashier-approver'));
  assert.ok(!idsFor(LUANDA, elevated).includes('cashier-approver'));
});

test('a manager with expense_approve revoked stops receiving requests', () => {
  const revoked = [
    {
      id: 'manager-soyo',
      role: 'manager',
      branch_id: SOYO,
      permissions: { granted: [], revoked: ['expense_approve'] },
    },
  ];
  assert.deepEqual(idsFor(SOYO, revoked), []);
});

test('inactive users are skipped', () => {
  const inactive = [{ id: 'manager-soyo', role: 'manager', branch_id: SOYO, is_active: 0 }];
  assert.deepEqual(idsFor(SOYO, inactive), []);
  const inactiveBool = [{ id: 'manager-soyo', role: 'manager', branch_id: SOYO, is_active: false }];
  assert.deepEqual(idsFor(SOYO, inactiveBool), []);
});

test('branch ids match across dashed and dashless forms', () => {
  const dashed = [{ id: 'manager-x', role: 'manager', branch_id: '1b4e-28ba-2fa1' }];
  assert.deepEqual(idsFor('1B4E28BA2FA1', dashed), ['manager-x']);
});

test('an expense with no branch falls back to every approver', () => {
  assert.deepEqual(idsFor(''), ['admin-1', 'manager-hq', 'manager-luanda', 'manager-soyo']);
});
