const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickNextTopLevelCaixaCode,
  pickNextExtraCaixaCode,
  isBranchCaixaLeafCode,
  defaultBranchCaixaName,
  compactSequentialCaixaCodes,
} = require('../src/lib/branchCaixaAccounts');

test('cash leaves are 8-digit under 45, same as 32100001', () => {
  assert.equal(pickNextTopLevelCaixaCode(['45']), '45000001');
  assert.equal(pickNextTopLevelCaixaCode(['45', '451']), '45000001');
  assert.equal(pickNextTopLevelCaixaCode(['45', '45000001']), '45000002');
});

test('category headers 451/452 do not consume leaf numbers', () => {
  assert.equal(pickNextTopLevelCaixaCode(['45', '451', '452', '45000001']), '45000002');
});

test('extra caixa uses the same 8-digit sequence', () => {
  assert.equal(pickNextExtraCaixaCode('451', ['45', '451', '45000001']), '45000002');
});

test('any 45x except 45 is a cash leaf code', () => {
  assert.equal(isBranchCaixaLeafCode('45'), false);
  assert.equal(isBranchCaixaLeafCode('451'), true);
  assert.equal(isBranchCaixaLeafCode('45000001'), true);
});

test('default names number extras from 2', () => {
  assert.equal(defaultBranchCaixaName('Benfica'), 'Caixa - Benfica');
  assert.equal(defaultBranchCaixaName('Benfica', 1), 'Caixa - Benfica (2)');
});

test('compactSequentialCaixaCodes no longer remaps 4511 category trees', async () => {
  const result = await compactSequentialCaixaCodes({});
  assert.equal(result.compacted, 0);
});
