const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureBranchCaixaAccount } = require('../src/lib/branchCaixaAccounts');

test('ensureBranchCaixaAccount does not reconnect a checked-out pg client', async () => {
  let connectCalls = 0;
  const client = {
    engine: 'postgres',
    connect: async () => {
      connectCalls += 1;
      throw new Error('Client has already been connected. You cannot reuse a client.');
    },
    release() {},
    async query() {
      return { rows: [] };
    },
  };

  const result = await ensureBranchCaixaAccount(client, 'branch-1', 'Loja Nova');
  assert.equal(connectCalls, 0);
  assert.equal(result.branchId, 'branch-1');
  assert.equal(result.branchName, 'Loja Nova');
});
