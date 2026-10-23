const test = require('node:test');
const assert = require('node:assert/strict');

const {
  moveEntityLeafToParent,
  nextCompactChildCode,
  nextEntityAccountCode,
  isCashCategoryParent,
  isCompactCategoryParent,
} = require('../src/lib/entityCoaAccounts');

function mockClient(rowsByMatch) {
  const updates = [];
  return {
    updates,
    query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ');
      updates.push({ sql: normalized, params });
      let rows = [];
      if (!(normalized.startsWith('UPDATE') || normalized.startsWith('INSERT'))) {
        for (const [needle, value] of Object.entries(rowsByMatch)) {
          if (normalized.includes(needle)) {
            rows = typeof value === 'function' ? value(params) : value;
            break;
          }
        }
      }
      const result = { rows, rowCount: rows.length || 1 };
      return Object.assign(Promise.resolve(result), result);
    },
  };
}

test('nextCompactChildCode fills the first free child', () => {
  assert.equal(nextCompactChildCode('45', ['45', '451', '452']), '453');
  assert.equal(nextCompactChildCode('458', ['45', '458']), '4581');
  assert.equal(nextCompactChildCode('451', ['451', '4511']), '4512');
});

test('cash 4511 is a category parent and children are 45110001', () => {
  assert.equal(isCashCategoryParent('45'), true);
  assert.equal(isCashCategoryParent('4511'), true);
  assert.equal(isCashCategoryParent('45110001'), false);
  assert.equal(nextEntityAccountCode('4511', ['45', '4511'], ['4511']), '45110001');
});

test('banks and expenses nest the same way as suppliers', () => {
  assert.equal(isCompactCategoryParent('43'), true);
  assert.equal(isCompactCategoryParent('4311'), true);
  assert.equal(isCompactCategoryParent('43110001'), false);
  assert.equal(isCompactCategoryParent('7111'), true);
  assert.equal(nextEntityAccountCode('4311', ['43', '4311'], ['4311']), '43110001');
  assert.equal(nextEntityAccountCode('7111', ['71', '7111'], ['7111']), '71110001');
  assert.equal(nextCompactChildCode('43', ['43', '431']), '432');
  assert.equal(nextCompactChildCode('71', ['71', '711']), '712');
});

test('moveEntityLeafToParent recodes a cash leaf under a cash category', async () => {
  const client = mockClient({
    'WHERE id = $1 LIMIT 1': (params) => {
      if (params[0] === 'leaf-1') {
        return [{ id: 'leaf-1', code: '452', name: 'Caixa extra', parent_id: 'id-45', is_header: 0 }];
      }
      if (params[0] === 'id-458') {
        return [{ parent_id: 'id-45' }];
      }
      if (params[0] === 'id-45') {
        return [{ parent_id: null }];
      }
      return [];
    },
    'WHERE code = $1 AND is_active IS NOT FALSE': [{ id: 'id-458', code: '458', level: 2 }],
    'SELECT code FROM chart_of_accounts': [{ code: '45' }, { code: '451' }, { code: '452' }, { code: '458' }],
    'WHERE parent_id = $1 AND is_header IS NOT TRUE': [],
  });

  const moved = await moveEntityLeafToParent(client, {
    accountId: 'leaf-1',
    parentCode: '458',
  });

  assert.equal(moved.moved, true);
  assert.equal(moved.oldCode, '452');
  assert.equal(moved.newCode, '45800001');
  assert.ok(client.updates.some((q) => q.sql.includes('SET parent_id') && q.params[1] === '45800001'));
});

test('moveEntityLeafToParent refuses a supplier parent for a cash leaf only when it is a supplier leaf', async () => {
  const client = mockClient({
    'WHERE id = $1 LIMIT 1': [{ id: 'leaf-s', code: '32100001', name: 'Fuel', parent_id: 'id-321', is_header: 0 }],
  });

  await assert.rejects(
    () => moveEntityLeafToParent(client, { accountId: 'leaf-s', parentCode: '45' }),
    /not a supplier category/,
  );
});
