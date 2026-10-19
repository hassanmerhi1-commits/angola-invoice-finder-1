/**
 * Regression tests for three high-risk audit findings.
 * Isolated temp SQLite only — pin env before any application module loads.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, seedSupplierAndProduct, BACKEND_SRC } = require('./helpers/sqliteHarness');
const { journalFilteredSumSql, journalThroughEndJoinSql } = require(path.join(BACKEND_SRC, 'lib/journalPeriodSums'));

const QTY = 10;
const UNIT_COST = 100;
const GOODS = QTY * UNIT_COST; // 1000
const TAX = 0;
const TOTAL = GOODS + TAX; // 1000

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

function assertIsolatedSqlite(harness) {
  assert.equal(process.env.DB_ENGINE, 'sqlite');
  assert.equal(process.env.DATABASE_URL, '');
  assert.ok(harness.testDbPath.includes(require('os').tmpdir()) || /nexor-erp-test-/i.test(harness.testDbPath));
  assert.notEqual(path.resolve(harness.testDbPath).toLowerCase(), path.resolve('C:\\nexor\\erp.db').toLowerCase());
  assert.equal(harness.db.engine, 'sqlite');
}

async function insertPurchaseInvoice(client, fields) {
  const id = fields.id || randomUUID();
  await client.query(
    `INSERT INTO purchase_invoices (
       id, invoice_number, supplier_id, supplier_name, date, order_no,
       warehouse_id, branch_id, branch_name, lines_json,
       subtotal, iva_total, total, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'confirmed',$14)`,
    [
      id,
      fields.invoiceNumber,
      fields.supplierId,
      fields.supplierName,
      fields.date,
      fields.orderNo || '',
      fields.branchId,
      fields.branchId,
      'Main Branch',
      JSON.stringify(fields.lines),
      fields.subtotal,
      fields.taxAmount || 0,
      fields.total,
      fields.createdBy,
    ],
  );
  return {
    id,
    invoiceNumber: fields.invoiceNumber,
    supplierId: fields.supplierId,
    supplierName: fields.supplierName,
    date: fields.date,
    orderNo: fields.orderNo || '',
    warehouseId: fields.branchId,
    branchId: fields.branchId,
    lines: fields.lines,
    subtotal: fields.subtotal,
    taxAmount: fields.taxAmount || 0,
    total: fields.total,
    status: 'confirmed',
    createdBy: fields.createdBy,
  };
}

async function snapshot(client, productId, branchId, documentIds = []) {
  const stock = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS qty
     FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, branchId],
  );
  const movements = await client.query(
    `SELECT reference_type, reference_id, movement_type, quantity, unit_cost
     FROM stock_movements WHERE product_id = $1 ORDER BY created_at, id`,
    [productId],
  );
  const journals = await client.query(
    `SELECT reference_type, reference_id, total_debit, total_credit
     FROM journal_entries ORDER BY entry_date, entry_number`,
  );
  const ids = (documentIds || []).map((id) => String(id));
  const scopedJournals = ids.length
    ? journals.rows.filter((j) => ids.includes(String(j.reference_id)))
    : journals.rows;
  const debit212 = await client.query(
    `SELECT COALESCE(SUM(jel.debit_amount), 0) AS amount
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE TRIM(coa.code) = '212'
       ${ids.length ? `AND CAST(je.reference_id AS TEXT) IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})` : ''}`,
    ids,
  );
  const openItems = await client.query(
    `SELECT document_type, document_id, original_amount, remaining_amount, status, is_debit
     FROM open_items
     ${ids.length ? `WHERE CAST(document_id AS TEXT) IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})` : ''}`,
    ids,
  );
  return {
    stockQty: Number(stock.rows[0].qty),
    movements: movements.rows,
    journals: scopedJournals,
    debit212: Number(debit212.rows[0].amount),
    openItems: openItems.rows,
    purchaseJournals: scopedJournals.filter((j) => j.reference_type === 'purchase'),
    invoiceJournals: scopedJournals.filter((j) => j.reference_type === 'purchase_invoice'),
    purchaseIns: movements.rows.filter((m) => m.reference_type === 'purchase' && m.movement_type === 'IN'),
    invoiceIns: movements.rows.filter((m) => m.reference_type === 'purchase_invoice' && m.movement_type === 'IN'),
  };
}

async function queryTrialBalance(client, startDate, endDate) {
  const sums = journalFilteredSumSql({ periodAlias: 'je', closeAlias: 'je_close' });
  const closeJoin = journalThroughEndJoinSql({ alias: 'je_close', endDateParam: '$2' });
  const result = await client.query(
    `
      SELECT
        coa.id,
        coa.code,
        coa.name,
        coa.account_type,
        coa.account_nature,
        coa.opening_balance,
        ${sums.totalDebits},
        ${sums.totalCredits},
        ${sums.closingBalance}
      FROM chart_of_accounts coa
      LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
      LEFT JOIN journal_entries je
        ON je.id = jel.journal_entry_id AND je.is_posted = true
        AND je.entry_date BETWEEN $1 AND $2
      ${closeJoin}
      WHERE coa.is_active = true
      GROUP BY coa.id
      ORDER BY coa.code
    `,
    [startDate, endDate],
  );
  return result.rows;
}

describe('erp audit high-risk posting', { concurrency: 1 }, () => {
  let harness;
  let engine;
  let postPurchaseInvoiceAccountingPhased;
  let createJournalEntry;

  before(() => {
    harness = createSqliteHarness();
    assertIsolatedSqlite(harness);
    engine = require(path.join(BACKEND_SRC, 'transactionEngine'));
    ({ postPurchaseInvoiceAccountingPhased } = require(path.join(BACKEND_SRC, 'lib/purchaseInvoicePosting')));
    ({ createJournalEntry } = require(path.join(BACKEND_SRC, 'accounting')));
  });

  after(() => {
    harness?.dispose();
  });

  async function receivePurchaseOrder(client, seed) {
    const order = await engine.createPurchaseOrder(client, {
      supplierId: seed.supplierId,
      branchId: seed.branchId,
      createdBy: seed.userId,
      items: [{
        productId: seed.productId,
        productName: 'Audit Widget',
        sku: 'AUD-1',
        quantity: QTY,
        unitCost: UNIT_COST,
        taxRate: 0,
        subtotal: GOODS,
      }],
    });
    await engine.processPurchaseReceive(
      client,
      order.id,
      { [seed.productId]: QTY },
      seed.userId,
    );
    return order;
  }

  it('matching PO number then FC must not duplicate stock or purchase journals', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const supplierName = supplier.rows[0].name;
      const order = await receivePurchaseOrder(client, seed);
      const afterPo = await snapshot(client, seed.productId, seed.branchId, [order.id]);

      assert.equal(afterPo.stockQty, QTY, 'PO receive stock');
      assert.equal(afterPo.purchaseIns.length, 1);
      assert.equal(afterPo.invoiceIns.length, 0);
      assert.equal(afterPo.purchaseJournals.length, 1);
      assert.equal(afterPo.invoiceJournals.length, 0);
      assert.equal(afterPo.debit212, GOODS);
      assert.equal(afterPo.openItems.length, 0, 'PO receive must not create AP');

      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-MATCH-1',
        supplierId: seed.supplierId,
        supplierName,
        date: '2026-03-15',
        orderNo: order.order_number,
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      const afterFc = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);

      assert.equal(afterFc.stockQty, QTY, 'matching FC must not add stock');
      assert.equal(afterFc.purchaseIns.length, 1);
      assert.equal(afterFc.invoiceIns.length, 0);
      assert.equal(afterFc.purchaseJournals.length, 1);
      assert.equal(afterFc.invoiceJournals.length, 0, 'matching FC must not post a second purchase journal');
      assert.equal(afterFc.debit212, GOODS);
      assert.equal(afterFc.openItems.length, 1, 'FC creates the AP open item');
      assert.equal(Number(afterFc.openItems[0].original_amount), TOTAL);
      assert.ok(posted.openItemId);
      assert.ok(
        (posted.warnings || []).some((w) => /já lançad/i.test(w)),
        'expected skip warning when OC already posted',
      );
    });
  });

  it('mismatched order number after PO receive must not silently duplicate stock or GL', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);

      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-MISMATCH-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-16',
        orderNo: `${order.order_number}-WRONG`,
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      await postPurchaseInvoiceAccountingPhased(client, inv);
      const after = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);

      // Independent expected: same physical receipt, one stock IN, one Dr 212.
      assert.equal(after.stockQty, QTY, 'mismatched order_no must not add a second IN');
      assert.equal(after.purchaseIns.length + after.invoiceIns.length, 1, 'one stock IN only');
      assert.equal(after.debit212, GOODS, 'one purchase debit to 212 only');
      assert.equal(
        after.purchaseJournals.length + after.invoiceJournals.length,
        1,
        'one purchase journal only',
      );
    });
  });

  it('missing order number after PO receive must not silently duplicate stock or GL', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);

      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-MISSING-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-17',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      await postPurchaseInvoiceAccountingPhased(client, inv);
      const after = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);

      assert.equal(after.stockQty, QTY, 'blank order_no must not add a second IN');
      assert.equal(after.purchaseIns.length + after.invoiceIns.length, 1);
      assert.equal(after.debit212, GOODS);
      assert.equal(after.purchaseJournals.length + after.invoiceJournals.length, 1);
    });
  });

  it('standalone FC (no PO) still posts stock, AP and one journal', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-SOLO-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-18',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      const after = await snapshot(client, seed.productId, seed.branchId, [inv.id]);

      assert.equal(after.stockQty, QTY);
      assert.equal(after.invoiceIns.length, 1);
      assert.equal(after.invoiceJournals.length, 1);
      assert.equal(after.debit212, GOODS);
      assert.equal(after.openItems.length, 1);
      assert.ok(posted.journalEntryId);
      assert.ok(posted.openItemId);
      assert.equal(posted.success, true);
    });
  });

  it('accounting SAVEPOINT: journal failure rolls back stock, AP and GL together', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      await client.query(`UPDATE chart_of_accounts SET is_active = 0 WHERE code = '212'`);

      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-SP-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-19',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: 5,
          totalQty: 5,
          unitPrice: 20,
          total: 100,
        }],
        subtotal: 100,
        taxAmount: 0,
        total: 100,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      await client.query(`UPDATE chart_of_accounts SET is_active = 1 WHERE code = '212'`);

      const after = await snapshot(client, seed.productId, seed.branchId, [inv.id]);

      // Contract: pi_accounting savepoint rolls stock + AP + journal back together.
      // The invoice header (inserted by the caller) remains; no nested COMMIT.
      assert.equal(after.stockQty, 0, 'stock IN rolled back with the journal');
      assert.equal(after.openItems.length, 0, 'AP open item rolled back with the journal');
      assert.equal(after.invoiceJournals.length, 0, 'no purchase-invoice journal');
      assert.equal(posted.journalEntryId, null);
      assert.equal(posted.success, false);
      assert.ok((posted.errors || []).some((e) => /journal|conta/i.test(e)));
    });
  });

  it('integrity: journal failure must not leave stock/AP without a matching journal', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      await client.query(`UPDATE chart_of_accounts SET is_active = 0 WHERE code = '212'`);

      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-SP-2',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-20',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: 5,
          totalQty: 5,
          unitPrice: 20,
          total: 100,
        }],
        subtotal: 100,
        taxAmount: 0,
        total: 100,
      });
      await postPurchaseInvoiceAccountingPhased(client, inv);
      await client.query(`UPDATE chart_of_accounts SET is_active = 1 WHERE code = '212'`);

      const after = await snapshot(client, seed.productId, seed.branchId, [inv.id]);
      const stockPosted = after.stockQty > 0;
      const apPosted = after.openItems.length > 0;
      const journalPosted = after.invoiceJournals.length > 0;

      assert.equal(
        stockPosted,
        journalPosted,
        'stock IN and purchase-invoice journal must exist together or not at all',
      );
      assert.equal(
        apPosted,
        journalPosted,
        'AP open item and purchase-invoice journal must exist together or not at all',
      );
    });
  });

  async function resetSalesAccount(client) {
    await client.query(`UPDATE chart_of_accounts SET opening_balance = 100, current_balance = 0 WHERE code = '613'`);
    await client.query(`UPDATE chart_of_accounts SET opening_balance = 0, current_balance = 0 WHERE code = '451'`);
    await client.query(
      `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (
         SELECT id FROM journal_entries WHERE reference_type = 'adjustment'
       )`,
    );
    await client.query(`DELETE FROM journal_entries WHERE reference_type = 'adjustment'`);
  }

  it('date-filtered TB: opening 100 + period movement 50 → period P&L 50, closing 150', async () => {
    await harness.withClient(async (client) => {
      await resetSalesAccount(client);
      await createJournalEntry(client, {
        description: 'March sale (period movement 50)',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-03-15',
        lines: [
          { accountCode: '451', debit: 50, credit: 0 },
          { accountCode: '613', debit: 0, credit: 50 },
        ],
      });

      const rows = await queryTrialBalance(client, '2026-03-01', '2026-03-31');
      const sales = rows.find((r) => String(r.code) === '613');
      assert.ok(sales);
      assert.equal(Number(sales.opening_balance), 100);
      assert.equal(Number(sales.total_credits), 50, 'period credits only');
      assert.equal(Number(sales.total_debits), 0);
      assert.equal(periodMovement(sales), 50);

      // Independent expected closing when opening is the true brought-forward
      // and the only journals in/before the period are this +50.
      assert.equal(Number(sales.closing_balance), 150);

      const salesOfGoods = sumByPrefix(rows, ['61']);
      assert.equal(salesOfGoods, 50, 'P&L must use period movement, not opening+movement');
      assert.notEqual(salesOfGoods, 150);
    });
  });

  it('date-filtered TB must include prior-period movement in closing / brought-forward', async () => {
    await harness.withClient(async (client) => {
      await resetSalesAccount(client);
      await createJournalEntry(client, {
        description: 'January sale (prior period 80)',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-01-15',
        lines: [
          { accountCode: '451', debit: 80, credit: 0 },
          { accountCode: '613', debit: 0, credit: 80 },
        ],
      });
      await createJournalEntry(client, {
        description: 'March sale (period 50)',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-03-15',
        lines: [
          { accountCode: '451', debit: 50, credit: 0 },
          { accountCode: '613', debit: 0, credit: 50 },
        ],
      });

      const rows = await queryTrialBalance(client, '2026-03-01', '2026-03-31');
      const sales = rows.find((r) => String(r.code) === '613');
      assert.ok(sales);

      // Independent expected:
      //   opening stored on CoA: 100
      //   prior-period journals: +80
      //   period movement: +50
      //   period P&L (613): 50
      //   closing at 31 Mar: 100 + 80 + 50 = 230
      assert.equal(periodMovement(sales), 50);
      assert.equal(sumByPrefix(rows, ['61']), 50, 'March P&L sales remain 50');
      assert.equal(
        Number(sales.closing_balance),
        230,
        'period TB closing must be opening + all journals through period end (100+80+50)',
      );
    });
  });

  it('explicit allowNewReceipt posts a second receipt after an uninvoiced PO', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-NEW-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-21',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv, {
        allowNewReceipt: true,
        canAuthorizeNewReceipt: true,
      });
      const after = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);

      assert.equal(after.stockQty, QTY * 2);
      assert.equal(after.purchaseIns.length, 1);
      assert.equal(after.invoiceIns.length, 1);
      assert.equal(after.debit212, GOODS * 2);
      assert.equal(posted.success, true);
    });
  });

  it('two uninvoiced PO receipts without order_no are rejected (no silent second IN)', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const first = await receivePurchaseOrder(client, seed);
      const second = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-AMBIG-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-22',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      const after = await snapshot(client, seed.productId, seed.branchId, [first.id, second.id, inv.id]);

      assert.equal(after.stockQty, QTY * 2);
      assert.equal(after.invoiceIns.length, 0);
      assert.equal(after.invoiceJournals.length, 0);
      assert.equal(posted.success, false);
      assert.ok((posted.errors || []).some((e) => /várias oc/i.test(e)));
    });
  });

  it('partial FC against a received PO adds AP only and does not add stock', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);
      const partial = GOODS / 2;
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-PART-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-23',
        orderNo: order.order_number,
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY / 2,
          totalQty: QTY / 2,
          unitPrice: UNIT_COST,
          total: partial,
        }],
        subtotal: partial,
        taxAmount: 0,
        total: partial,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      const after = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);

      assert.equal(after.stockQty, QTY);
      assert.equal(after.invoiceIns.length, 0);
      assert.equal(after.debit212, GOODS);
      assert.equal(after.openItems.length, 1);
      assert.equal(Number(after.openItems[0].original_amount), partial);
      assert.ok(posted.openItemId);
    });
  });

  it('date-filtered TB: debit-normal account closing uses opening + all journals through D', async () => {
    await harness.withClient(async (client) => {
      await client.query(`UPDATE chart_of_accounts SET opening_balance = 100, current_balance = 0 WHERE code = '451'`);
      await client.query(`UPDATE chart_of_accounts SET opening_balance = 0, current_balance = 0 WHERE code = '613'`);
      await client.query(
        `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (
           SELECT id FROM journal_entries WHERE reference_type = 'adjustment'
         )`,
      );
      await client.query(`DELETE FROM journal_entries WHERE reference_type = 'adjustment'`);

      await createJournalEntry(client, {
        description: 'Jan cash in 80',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-01-15',
        lines: [
          { accountCode: '451', debit: 80, credit: 0 },
          { accountCode: '613', debit: 0, credit: 80 },
        ],
      });
      await createJournalEntry(client, {
        description: 'Mar cash in 50',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-03-15',
        lines: [
          { accountCode: '451', debit: 50, credit: 0 },
          { accountCode: '613', debit: 0, credit: 50 },
        ],
      });

      const march = await queryTrialBalance(client, '2026-03-01', '2026-03-31');
      const cash = march.find((r) => String(r.code) === '451');
      assert.ok(cash);
      assert.equal(String(cash.account_nature).toLowerCase(), 'debit');
      assert.equal(Number(cash.total_debits), 50);
      assert.equal(periodMovement(cash), 50);
      assert.equal(Number(cash.closing_balance), 230);

      const january = await queryTrialBalance(client, '2026-01-01', '2026-01-31');
      const janCash = january.find((r) => String(r.code) === '451');
      assert.equal(Number(janCash.total_debits), 80);
      assert.equal(Number(janCash.closing_balance), 180);

      const onBoundary = await queryTrialBalance(client, '2026-03-15', '2026-03-15');
      const dayCash = onBoundary.find((r) => String(r.code) === '451');
      assert.equal(Number(dayCash.total_debits), 50);
      assert.equal(Number(dayCash.closing_balance), 230);
    });
  });

  it('exact order_no match ignores allowNewReceipt (no second IN)', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-EXACT-FLAG-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-24',
        orderNo: order.order_number,
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv, {
        allowNewReceipt: true,
        canAuthorizeNewReceipt: true,
      });
      const after = await snapshot(client, seed.productId, seed.branchId, [order.id, inv.id]);
      assert.equal(after.stockQty, QTY);
      assert.equal(after.invoiceIns.length, 0);
      assert.equal(after.openItems.length, 1);
      assert.equal(posted.success, true);
    });
  });

  it('two uninvoiced POs + authorized allowNewReceipt post one extra IN', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const first = await receivePurchaseOrder(client, seed);
      const second = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-AMBIG-FLAG-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-25',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv, {
        allowNewReceipt: true,
        canAuthorizeNewReceipt: true,
      });
      const after = await snapshot(client, seed.productId, seed.branchId, [first.id, second.id, inv.id]);
      assert.equal(after.stockQty, QTY * 3);
      assert.equal(after.invoiceIns.length, 1);
      assert.equal(posted.success, true);
    });
  });

  it('allowNewReceipt without purchase_receive authorization is ignored', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const first = await receivePurchaseOrder(client, seed);
      const second = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-NOAUTH-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-26',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      inv.allowNewReceipt = true;
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv, {
        allowNewReceipt: true,
      });
      const after = await snapshot(client, seed.productId, seed.branchId, [first.id, second.id, inv.id]);
      assert.equal(after.stockQty, QTY * 2);
      assert.equal(after.invoiceIns.length, 0);
      assert.equal(posted.success, false);
      assert.ok((posted.errors || []).some((e) => /várias oc/i.test(e)));
    });
  });

  it('received PO on another branch is not a candidate for this FC', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      await client.query(
        `INSERT INTO branches (id, name, code, is_main, is_active)
         VALUES ('branch-other', 'Other Branch', 'OTHER', 0, 1)`,
      );
      const other = { ...seed, branchId: 'branch-other' };
      const otherOrder = await receivePurchaseOrder(client, other);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-BRANCH-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-27',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const posted = await postPurchaseInvoiceAccountingPhased(client, inv);
      const otherPoStock = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS qty
         FROM stock_movements
         WHERE reference_type = 'purchase'
           AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)`,
        [otherOrder.id],
      );
      const main = await snapshot(client, seed.productId, seed.branchId, [otherOrder.id, inv.id]);
      assert.equal(Number(otherPoStock.rows[0].qty), QTY, 'other branch keeps its PO receive');
      assert.equal(main.invoiceIns.length, 1, 'this branch posts a standalone FC');
      assert.equal(main.stockQty, QTY);
      assert.equal(posted.success, true);
    });
  });

  it('retry after a successful FC does not double stock or AP', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-RETRY-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-03-28',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: [{
          productId: seed.productId,
          quantity: QTY,
          totalQty: QTY,
          unitPrice: UNIT_COST,
          total: GOODS,
        }],
        subtotal: GOODS,
        taxAmount: TAX,
        total: TOTAL,
      });
      const first = await postPurchaseInvoiceAccountingPhased(client, inv);
      const second = await postPurchaseInvoiceAccountingPhased(client, inv, {
        allowNewReceipt: true,
        canAuthorizeNewReceipt: true,
      });
      const after = await snapshot(client, seed.productId, seed.branchId, [inv.id]);
      assert.equal(first.success, true);
      assert.equal(second.success, true);
      assert.equal(after.stockQty, QTY);
      assert.equal(after.invoiceIns.length, 1);
      assert.equal(after.openItems.length, 1);
    });
  });

  it('canHonorExplicitNewReceipt requires authorization and invoice facts', () => {
    const { canHonorExplicitNewReceipt } = require(path.join(BACKEND_SRC, 'lib/purchaseInvoicePosting'));
    const inv = {
      allowNewReceipt: true,
      supplierId: 'sup-1',
      warehouseId: 'branch-main',
    };
    const lines = [{ productId: 'p1', totalQty: 2 }];
    assert.equal(canHonorExplicitNewReceipt(inv, lines, { canAuthorizeNewReceipt: true }).ok, true);
    assert.equal(canHonorExplicitNewReceipt(inv, lines, {}).reason, 'not_authorized');
    assert.equal(canHonorExplicitNewReceipt({ ...inv, allowNewReceipt: false }, lines, { canAuthorizeNewReceipt: true }).reason, 'not_requested');
    assert.equal(canHonorExplicitNewReceipt({ ...inv, supplierId: '' }, lines, { canAuthorizeNewReceipt: true }).reason, 'no_supplier');
  });

  it('fromRow/toRow persist allowNewReceipt', () => {
    const { fromRow, toRow } = require(path.join(BACKEND_SRC, 'purchaseInvoiceMappers'));
    const row = toRow({
      id: 'inv-map-1',
      invoiceNumber: 'FC-MAP-1',
      supplierName: 'Mapper',
      date: '2026-03-29',
      allowNewReceipt: true,
      lines: [],
    });
    assert.equal(row.allow_new_receipt, 1);
    const back = fromRow(row);
    assert.equal(back.allowNewReceipt, true);
    assert.equal(fromRow(toRow({ ...back, allowNewReceipt: false })).allowNewReceipt, false);
  });
});
