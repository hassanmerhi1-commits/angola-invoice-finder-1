const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('accountStatement', { concurrency: 1 }, () => {
  let harness;
  let accountStatement;

  before(() => {
    harness = createSqliteHarness();
    accountStatement = require(path.join(BACKEND_SRC, 'lib/accountStatement'));
  });

  after(() => {
    harness?.dispose();
  });

  it('lists only parties with real documents and ignores dummy NIFs', async () => {
    const walkInId = randomUUID();
    const delightId = randomUUID();
    const otherDummyId = randomUUID();
    const supplierId = randomUUID();
    const saleId = randomUUID();
    const purchaseId = randomUUID();
    const openItemId = randomUUID();

    await harness.db.query(
      `INSERT INTO clients (id, name, nif, current_balance, is_active, created_at, updated_at)
       VALUES
         ($1, 'Consumidor Final', '111111111', 0, 1, datetime('now'), datetime('now')),
         ($2, 'MOTORIZADA DELIGHT', '111111111', 249480, 1, datetime('now'), datetime('now')),
         ($3, 'Final Test', '111111111', 0, 1, datetime('now'), datetime('now'))`,
      [walkInId, delightId, otherDummyId],
    );

    await harness.db.query(
      `INSERT INTO sales (id, invoice_number, customer_name, customer_nif, client_id, total, amount_paid,
                          payment_method, status, created_at, subtotal, tax_amount)
       VALUES ($1, 'FT-DELIGHT-1', 'MOTORIZADA DELIGHT', '111111111', $2, 249480, 0, 'credit', 'completed',
               '2026-03-15T10:00:00', 249480, 0)`,
      [saleId, delightId],
    );

    await harness.db.query(
      `INSERT INTO open_items (id, entity_type, entity_id, document_type, document_id, document_number,
                               document_date, original_amount, remaining_amount, is_debit, status, created_at)
       VALUES ($1, 'customer', $2, 'sale', $3, 'FT-DELIGHT-1', '2026-03-15', 249480, 249480, 1, 'open', datetime('now'))`,
      [openItemId, delightId, saleId],
    );

    await harness.db.query(
      `INSERT INTO suppliers (id, name, nif, is_active, balance, created_at, updated_at)
       VALUES ($1, 'BASEL ANGOLA', '5417003210008', 1, 0, datetime('now'), datetime('now'))`,
      [supplierId],
    );

    await harness.db.query(
      `INSERT INTO purchase_invoices (id, invoice_number, supplier_id, supplier_name, supplier_nif, date, total, status, created_at)
       VALUES ($1, 'FC-1', $2, 'BASEL ANGOLA', '5417003210008', '2026-04-01', 15000, 'confirmed', '2026-04-01T09:00:00')`,
      [purchaseId, supplierId],
    );

    const customers = await accountStatement.listStatementParties(harness.db, 'customer');
    const names = customers.map((row) => row.name);
    assert.ok(names.includes('MOTORIZADA DELIGHT'), 'named customer with invoices must appear');
    assert.equal(names.includes('Consumidor Final'), false, 'walk-in dummy NIF with no own docs must hide');
    assert.equal(names.includes('Final Test'), false, 'placeholder test client must hide');

    const statement = await accountStatement.loadAccountStatement(harness.db, 'customer', delightId);
    assert.ok(statement.sales.length >= 1, 'Delight invoices must load even with dummy NIF');
    assert.equal(statement.sales[0].invoice_number, 'FT-DELIGHT-1');
    assert.ok(statement.openItems.length >= 1, 'Delight open items must load');

    const suppliers = await accountStatement.listStatementParties(harness.db, 'supplier');
    assert.equal(suppliers.length, 1);
    assert.equal(suppliers[0].name, 'BASEL ANGOLA');

    const supplierStatement = await accountStatement.loadAccountStatement(harness.db, 'supplier', supplierId);
    assert.equal(supplierStatement.purchases.length, 1);
    assert.equal(supplierStatement.purchases[0].invoice_number, 'FC-1');
  });

  it('matches a supplier invoice by name when supplier_id is empty', async () => {
    const supplierId = randomUUID();
    await harness.db.query(
      `INSERT INTO suppliers (id, name, nif, is_active, balance, created_at, updated_at)
       VALUES ($1, 'NESTLE SOYO', '5000999888', 1, 0, datetime('now'), datetime('now'))`,
      [supplierId],
    );
    await harness.db.query(
      `INSERT INTO purchase_invoices (id, invoice_number, supplier_id, supplier_name, supplier_nif, date, total, status, created_at)
       VALUES ($1, 'FC-NAME-1', '', 'NESTLE SOYO', '5000999888', '2026-05-01', 8000, 'confirmed', '2026-05-01T09:00:00')`,
      [randomUUID()],
    );

    const suppliers = await accountStatement.listStatementParties(harness.db, 'supplier');
    assert.ok(suppliers.some((row) => row.name === 'NESTLE SOYO'));

    const statement = await accountStatement.loadAccountStatement(harness.db, 'supplier', supplierId);
    assert.equal(statement.purchases.some((row) => row.invoice_number === 'FC-NAME-1'), true);
  });
});
