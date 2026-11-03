const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildCoaTemplate, parseCoaTemplate } = require(path.join(__dirname, '../src/lib/coaTemplate'));

describe('chart of accounts template', () => {
  it('keeps structure and drops balances', () => {
    const file = buildCoaTemplate([
      {
        code: '31',
        name: 'Clientes',
        account_type: 'asset',
        account_nature: 'debit',
        level: 1,
        is_header: true,
        parent_code: null,
        current_balance: 1500,
        opening_balance: 900,
      },
      {
        code: '311',
        name: 'Clientes c/c',
        account_type: 'asset',
        account_nature: 'debit',
        level: 2,
        is_header: true,
        parent_code: '31',
        display_tab: 'clientes',
      },
    ]);
    assert.equal(file.kind, 'nexor-coa-template');
    assert.equal(file.accounts.length, 2);
    assert.equal(file.accounts[0].code, '31');
    assert.equal(file.accounts[1].parent_code, '31');
    assert.equal(file.accounts[1].display_tab, 'clientes');
    assert.equal('current_balance' in file.accounts[0], false);
    assert.equal('opening_balance' in file.accounts[0], false);
  });

  it('rejects a file that is not a chart template', () => {
    assert.throws(() => parseCoaTemplate({ kind: 'backup', accounts: [] }), /not a NEXOR chart template/);
    assert.throws(() => parseCoaTemplate([{ code: '11' }]), /not a NEXOR chart template/);
  });

  it('drops an account that names itself as parent', () => {
    const accounts = parseCoaTemplate({
      schema: 1,
      kind: 'nexor-coa-template',
      accounts: [
        {
          code: '11',
          name: 'Imobilizado',
          account_type: 'asset',
          account_nature: 'debit',
          level: 1,
          is_header: true,
          parent_code: '11',
        },
      ],
    });
    assert.equal(accounts.length, 0);
  });
});
