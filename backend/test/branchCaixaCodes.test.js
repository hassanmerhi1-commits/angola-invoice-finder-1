const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickNextTopLevelCaixaCode,
  pickNextExtraCaixaCode,
  isBranchCaixaLeafCode,
  defaultBranchCaixaName,
} = require('../src/lib/branchCaixaAccounts');

test('cash boxes fill 451, 452, 453 in order', () => {
  assert.equal(pickNextTopLevelCaixaCode(['45']), '451');
  assert.equal(pickNextTopLevelCaixaCode(['45', '451']), '452');
  assert.equal(pickNextTopLevelCaixaCode(['45', '451', '452']), '453');
});

test('fills gaps instead of jumping to 4510', () => {
  assert.equal(pickNextTopLevelCaixaCode(['45', '451', '454', '455']), '452');
  assert.equal(pickNextTopLevelCaixaCode(['451', '453']), '452');
});

test('only after 451–459 are taken does 4510 appear', () => {
  const used = ['45', '451', '452', '453', '454', '455', '456', '457', '458', '459'];
  assert.equal(pickNextTopLevelCaixaCode(used), '4510');
  assert.equal(pickNextTopLevelCaixaCode([...used, '4510']), '4511');
});

test('extra caixa uses the same sequence, not 4541', () => {
  assert.equal(pickNextExtraCaixaCode('454', ['45', '451', '454']), '452');
});

test('any 45x except 45 is a cash leaf', () => {
  assert.equal(isBranchCaixaLeafCode('45'), false);
  assert.equal(isBranchCaixaLeafCode('451'), true);
  assert.equal(isBranchCaixaLeafCode('454'), true);
  assert.equal(isBranchCaixaLeafCode('4510'), true);
});

test('default names number extras from 2', () => {
  assert.equal(defaultBranchCaixaName('Benfica'), 'Caixa - Benfica');
  assert.equal(defaultBranchCaixaName('Benfica', 1), 'Caixa - Benfica (2)');
});
