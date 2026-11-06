const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickPostedRevenueCode,
  pickPostedSettlementCode,
  requireLeafAccount,
  resolveBranchSalesAccountCode,
  resolveRevenueAccountForDocument,
} = require('../src/lib/branchPostingAccounts');

test('credit note revenue follows the original sale, not VAT', () => {
  const code = pickPostedRevenueCode([
    { code: '3452', credit_amount: 14, debit_amount: 0 },
    { code: '61310001', credit_amount: 100, debit_amount: 0 },
    { code: '45110002', credit_amount: 0, debit_amount: 114 },
  ]);
  assert.equal(code, '61310001');
});

test('settlement is the cash or customer debit, not the cost account', () => {
  const code = pickPostedSettlementCode([
    { code: '711', credit_amount: 0, debit_amount: 40 },
    { code: '261', credit_amount: 40, debit_amount: 0 },
    { code: '45121001', credit_amount: 0, debit_amount: 114 },
    { code: '61320001', credit_amount: 100, debit_amount: 0 },
  ]);
  assert.equal(code, '45121001');
});

test('a group account is refused', async () => {
  const db = {
    async query() {
      return { rows: [{ code: '613', account_type: 'revenue', is_header: 1, is_active: 1 }] };
    },
  };
  await assert.rejects(
    () => requireLeafAccount(db, '613', 'revenue'),
    /grupo/,
  );
});

test('an empty sales link keeps 613', async () => {
  const client = {
    async query(sql) {
      if (String(sql).includes('sales_account_code')) return { rows: [{ code: '' }] };
      return { rows: [] };
    },
  };
  assert.equal(await resolveBranchSalesAccountCode(client, 'branch-main'), '613');
});

test('a city sales account is used for a new sale', async () => {
  const client = {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('sales_account_code')) return { rows: [{ code: '61310001' }] };
      if (text.includes('FROM chart_of_accounts') && params[0] === '61310001') {
        return { rows: [{ code: '61310001', account_type: 'revenue', is_header: 0, is_active: 1 }] };
      }
      if (text.includes("reference_type = 'sale'")) return { rows: [] };
      return { rows: [] };
    },
  };
  assert.equal(await resolveBranchSalesAccountCode(client, 'luanda'), '61310001');
  assert.equal(
    await resolveRevenueAccountForDocument(client, { branchId: 'luanda' }),
    '61310001',
  );
});

test('a later credit note uses the account stored on the original sale', async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("reference_type = 'sale'")) {
        return {
          rows: [
            { code: '613', credit_amount: 50, debit_amount: 0 },
            { code: '3452', credit_amount: 7, debit_amount: 0 },
          ],
        };
      }
      if (text.includes('sales_account_code')) return { rows: [{ code: '61310001' }] };
      return { rows: [] };
    },
  };
  assert.equal(
    await resolveRevenueAccountForDocument(client, { saleId: 'sale-1', branchId: 'luanda' }),
    '613',
  );
});
