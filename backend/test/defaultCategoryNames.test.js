const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFAULT_CATEGORY_NAMES } = require('../src/lib/defaultCategoryNames');

test('default categories match the live list and the product picker', () => {
  assert.equal(DEFAULT_CATEGORY_NAMES.length, 30);
  const keys = DEFAULT_CATEGORY_NAMES.map((name) => name.trim().toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(DEFAULT_CATEGORY_NAMES.every((name) => name === name.trim() && name.length > 0));

  const picker = fs.readFileSync(
    path.join(__dirname, '../../src/lib/inventoryFoodCategories.ts'),
    'utf8',
  );
  for (const name of DEFAULT_CATEGORY_NAMES) {
    assert.ok(picker.includes(`'${name}'`), name);
  }

  const seed = fs.readFileSync(
    path.join(__dirname, '../src/migrations/009_seed_data.sql'),
    'utf8',
  );
  for (const name of DEFAULT_CATEGORY_NAMES) {
    assert.ok(seed.includes(`'${name}'`), name);
  }
});
