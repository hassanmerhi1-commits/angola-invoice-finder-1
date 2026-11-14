const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanCategoryName, categoryNameKey } = require('../src/lib/categoryNames');

test('cleanCategoryName collapses spaces', () => {
  assert.equal(cleanCategoryName('  Soft   drinks  '), 'Soft drinks');
  assert.equal(cleanCategoryName(''), '');
  assert.equal(cleanCategoryName(null), '');
});

test('categoryNameKey ignores case and spacing', () => {
  assert.equal(categoryNameKey('Bebidas'), categoryNameKey('  bebidas '));
  assert.notEqual(categoryNameKey('Bebidas'), categoryNameKey('Sumos'));
});
