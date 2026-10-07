const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveListBranchId, resolveWriteBranchId } = require('../src/middleware/branchScope');

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
