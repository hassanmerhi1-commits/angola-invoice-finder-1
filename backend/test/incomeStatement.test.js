const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const incomeStatementSrc = fs.readFileSync(
  path.join(__dirname, '../../src/lib/reports/incomeStatement.ts'),
  'utf8',
);

test('P&L maps Angola PGC class 6 proveitos / class 7 custos (not inverted SNC 6/7)', () => {
  assert.match(incomeStatementSrc, /salesOfGoods = sumByPrefix\(rows, \['61'\]\)/);
  assert.match(incomeStatementSrc, /cogs = sumByPrefix\(rows, \['71'\]\)/);
  assert.match(incomeStatementSrc, /services = sumByPrefix\(rows, \['62'\]\)/);
  assert.match(incomeStatementSrc, /personnel = sumByPrefix\(rows, \['72'\]\)/);
  assert.match(incomeStatementSrc, /externalSupplies = sumByPrefix\(rows, \['75'\]\)/);
  assert.match(incomeStatementSrc, /depreciation = sumByPrefix\(rows, \['73'\]\)/);
  assert.match(incomeStatementSrc, /financialIncome = sumByPrefix\(rows, \['66', '67'\]\)/);
  assert.match(incomeStatementSrc, /financialExpenses = sumByPrefix\(rows, \['76', '77'\]\)/);
  assert.match(incomeStatementSrc, /incomeTax = sumByPrefix\(rows, \['87'\]\)/);
  assert.doesNotMatch(incomeStatementSrc, /salesOfGoods = sumByPrefix\(rows, \['71'\]\)/);
  assert.doesNotMatch(incomeStatementSrc, /cogs = sumByPrefix\(rows, \['61'\]\)/);
});

function periodMovement(row) {
  const debits = Number(row.total_debits || 0);
  const credits = Number(row.total_credits || 0);
  const nature = String(row.account_nature || '').toLowerCase();
  if (nature === 'credit') return credits - debits;
  return debits - credits;
}

function sumByPrefix(rows, prefixes) {
  return rows.reduce((sum, row) => {
    const code = String(row.code || '').trim();
    if (!code) return sum;
    if (prefixes.some((p) => code === p || code.startsWith(p))) {
      return sum + periodMovement(row);
    }
    return sum;
  }, 0);
}

test('posted 613 sales and 711 CMV produce positive gross profit', () => {
  const rows = [
    { code: '613', account_nature: 'credit', total_credits: 10000, total_debits: 0 },
    { code: '711', account_nature: 'debit', total_debits: 4000, total_credits: 0 },
    { code: '752', account_nature: 'debit', total_debits: 500, total_credits: 0 },
  ];
  const sales = sumByPrefix(rows, ['61']);
  const cogs = sumByPrefix(rows, ['71']);
  const fse = sumByPrefix(rows, ['75']);
  assert.equal(sales, 10000);
  assert.equal(cogs, 4000);
  assert.equal(fse, 500);
  assert.equal(sales - cogs - fse, 5500);
  assert.equal(sumByPrefix(rows, ['71']) !== sales, true);
});
