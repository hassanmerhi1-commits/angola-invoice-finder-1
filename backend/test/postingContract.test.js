const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNTS,
  journalTotals,
  standaloneStockNeedsJournal,
  buildPaymentJournalLines,
  buildStockAdjustmentJournalLines,
} = require('../src/lib/postingContract');
const { cashCloseVariance, CASH_SHORT_ACCOUNT, CASH_OVER_ACCOUNT } = require('../src/lib/caixaCloseVariance');

function assertBalanced(lines) {
  const totals = journalTotals(lines);
  assert.equal(totals.balanced, true, `unbalanced D=${totals.debit} C=${totals.credit}`);
}

test('a short drawer credits cash and debits the loss for the same amount', () => {
  const row = cashCloseVariance(10000, 2000);
  assert.equal(row.kind, 'short');
  assert.equal(row.amount, 8000);
  assert.equal(row.accountCode, CASH_SHORT_ACCOUNT);
  assert.equal(row.direction, 'out');
});

test('extra drawer cash debits cash and credits income', () => {
  const row = cashCloseVariance(2000, 2500);
  assert.equal(row.kind, 'over');
  assert.equal(row.amount, 500);
  assert.equal(row.accountCode, CASH_OVER_ACCOUNT);
  assert.equal(row.direction, 'in');
});

test('a stock count out takes the goods off 212 and books the loss', () => {
  const lines = buildStockAdjustmentJournalLines('OUT', 'correction', 1500, 'AJ-1');
  assertBalanced(lines);
  assert.equal(lines[0].accountCode, ACCOUNTS.INVENTORY_SHRINKAGE);
  assert.equal(lines[0].debit, 1500);
  assert.equal(lines[1].accountCode, ACCOUNTS.PURCHASES_MERCHANDISE);
  assert.equal(lines[1].credit, 1500);
});

test('a stock count in puts the goods on 212', () => {
  const lines = buildStockAdjustmentJournalLines('IN', 'correction', 800, 'AJ-2');
  assertBalanced(lines);
  assert.equal(lines[0].accountCode, ACCOUNTS.PURCHASES_MERCHANDISE);
  assert.equal(lines[0].debit, 800);
  assert.equal(lines[1].accountCode, ACCOUNTS.OTHER_INCOME);
  assert.equal(lines[1].credit, 800);
});

test('a sale or a purchase does not write a second stock journal', () => {
  assert.equal(standaloneStockNeedsJournal('sale'), false);
  assert.equal(standaloneStockNeedsJournal('purchase'), false);
  assert.equal(standaloneStockNeedsJournal('supplier_return'), true);
  assert.equal(standaloneStockNeedsJournal('correction'), true);
});

test('a customer receipt debits cash and credits the customer', () => {
  const lines = buildPaymentJournalLines({
    paymentType: 'receipt',
    amount: 4000,
    cashAccountCode: '45121002',
    entityAccountCode: '31100001',
    paymentNumber: 'REC-1',
    entityName: 'Cliente',
  });
  assertBalanced(lines);
  assert.equal(lines[0].accountCode, '45121002');
  assert.equal(lines[0].debit, 4000);
  assert.equal(lines[1].credit, 4000);
});

test('a supplier payment debits the supplier and credits cash', () => {
  const lines = buildPaymentJournalLines({
    paymentType: 'payment',
    amount: 900,
    cashAccountCode: '451',
    entityAccountCode: '32100001',
    paymentNumber: 'PAG-1',
    entityName: 'Fornecedor',
  });
  assertBalanced(lines);
  assert.equal(lines[0].accountCode, '32100001');
  assert.equal(lines[0].debit, 900);
  assert.equal(lines[1].accountCode, '451');
  assert.equal(lines[1].credit, 900);
});
