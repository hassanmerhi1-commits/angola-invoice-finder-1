const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveListBranchId, resolveWriteBranchId, applyWriteBranchOverride } = require('../src/middleware/branchScope');

const FILIAL = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

const lockedToFilial = { forceBranchId: FILIAL, branchId: FILIAL, canUseConsolidated: false };
const headOffice = { forceBranchId: null, branchId: OTHER, canUseConsolidated: true, isHeadOffice: true };

test('a branch-locked user cannot write into another branch', () => {
  assert.equal(resolveWriteBranchId(lockedToFilial, OTHER), FILIAL);
  assert.equal(resolveWriteBranchId(lockedToFilial, FILIAL), FILIAL);
  assert.equal(resolveWriteBranchId(lockedToFilial, undefined), FILIAL);
});

test('head office writes land on the branch it asked for', () => {
  assert.equal(resolveWriteBranchId(headOffice, OTHER), OTHER);
  assert.equal(resolveWriteBranchId(headOffice, FILIAL), FILIAL);
});

test('a write branch is never invented when none is known', () => {
  assert.equal(resolveWriteBranchId(headOffice, undefined), null);
  assert.equal(resolveWriteBranchId(undefined, undefined), null);
  assert.equal(resolveWriteBranchId(headOffice, 'all'), null);
});

test('a branch-locked user only reads their own branch', () => {
  assert.equal(resolveListBranchId({ branchScope: lockedToFilial }, OTHER), FILIAL);
  assert.equal(resolveListBranchId({ branchScope: lockedToFilial }, undefined), FILIAL);
  assert.equal(resolveListBranchId({ branchScope: lockedToFilial }, 'all'), FILIAL);
});

test('head office reads every branch unless it picks one', () => {
  assert.equal(resolveListBranchId({ branchScope: headOffice }, undefined), null);
  assert.equal(resolveListBranchId({ branchScope: headOffice }, 'all'), null);
  assert.equal(resolveListBranchId({ branchScope: headOffice }, FILIAL), FILIAL);
});

test('applyWriteBranchOverride corrects a forged branch on a locked user', () => {
  const body = { branchId: OTHER };
  const used = applyWriteBranchOverride({ branchScope: lockedToFilial, user: { id: 'u1' } }, body, ['branchId'], 'TEST');
  assert.equal(used, FILIAL);
  assert.equal(body.branchId, FILIAL);
});

test('applyWriteBranchOverride fills a missing warehouse id for a locked user', () => {
  const body = {};
  applyWriteBranchOverride({ branchScope: lockedToFilial }, body, ['warehouseId', 'warehouse_id'], 'TEST');
  assert.equal(body.warehouseId, FILIAL);
  assert.equal(body.warehouse_id, FILIAL);
});

test('applyWriteBranchOverride leaves head office writes alone', () => {
  const body = { branchId: OTHER };
  const used = applyWriteBranchOverride({ branchScope: headOffice }, body, ['branchId'], 'TEST');
  assert.equal(used, OTHER);
  assert.equal(body.branchId, OTHER);
});

test('applyWriteBranchOverride does not invent a branch for head office', () => {
  const body = {};
  const used = applyWriteBranchOverride({ branchScope: headOffice }, body, ['branchId'], 'TEST');
  assert.equal(used, null);
  assert.equal(body.branchId, undefined);
});
