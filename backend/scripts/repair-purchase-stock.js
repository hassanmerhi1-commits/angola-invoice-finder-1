/**
 * Backfill stock/accounting for purchase invoices saved without stock_movements.
 * Usage: node scripts/repair-purchase-stock.js [invoice_number]
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:yel3an7azi@127.0.0.1:5432/kwanza_erp';
process.env.DB_ENGINE = 'postgres';

const db = require('../src/db');
const { recordStockMovement, applyPurchaseSupplierToProducts } = require('../src/transactionEngine');
const { createJournalEntry } = require('../src/accounting');
const { createOpenItem } = require('../src/transactionEngine');

function parseJsonColumn(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

async function invoiceNeedsRepair(invoice) {
  const mov = await db.query(
    `SELECT 1 FROM stock_movements
     WHERE reference_type = 'purchase_invoice'
       AND reference_number = $1
     LIMIT 1`,
    [invoice.invoice_number],
  );
  return mov.rows.length === 0;
}

async function repairInvoice(client, invoice) {
  const lines = parseJsonColumn(invoice.lines_json, []);
  const journalLines = parseJsonColumn(invoice.journal_lines_json, []);
  const warehouseId = String(invoice.warehouse_id || invoice.branch_id || '').trim();
  if (!warehouseId) throw new Error(`Missing warehouse for ${invoice.invoice_number}`);

  for (const line of lines) {
    const productId = line.productId || line.product_id;
    const qty = Number(line.totalQty ?? line.quantity ?? 0);
    const unitCost = Number(line.unitPrice ?? line.unit_price ?? 0);
    if (!productId || qty <= 0) continue;
    await recordStockMovement(client, {
      productId,
      warehouseId,
      movementType: 'IN',
      quantity: qty,
      unitCost,
      referenceType: 'purchase_invoice',
      referenceId: invoice.id,
      referenceNumber: invoice.invoice_number,
    });
  }

  if (journalLines.length > 0) {
    const existingJe = await client.query(
      'SELECT id FROM journal_entries WHERE reference_id = $1 LIMIT 1',
      [invoice.id],
    );
    if (existingJe.rows.length === 0) {
      await createJournalEntry(client, {
        description: `Fatura de compra ${invoice.invoice_number}`,
        referenceType: 'purchase_invoice',
        referenceId: invoice.id,
        branchId: warehouseId,
        entryDate: invoice.date,
        lines: journalLines.map((l) => ({
          accountCode: l.accountCode || l.account_code,
          description: l.note || l.description || invoice.invoice_number,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
      });
    }
  }

  const existingOi = await client.query(
    'SELECT id FROM open_items WHERE document_id = $1 LIMIT 1',
    [invoice.id],
  );
  const lines = parseJsonColumn(invoice.lines_json, []);
  const productIds = lines.map((l) => l.productId || l.product_id).filter(Boolean);
  const skuKeys = lines.map((l) => l.productCode || l.product_code || '').filter(Boolean);
  if (invoice.supplier_id || invoice.supplier_name) {
    await applyPurchaseSupplierToProducts(client, {
      supplierId: invoice.supplier_id,
      supplierName: invoice.supplier_name,
      productIds,
      skuKeys,
    });
  }

  if (existingOi.rows.length === 0 && invoice.supplier_id) {
    await createOpenItem(client, {
      entityType: 'supplier',
      entityId: invoice.supplier_id,
      documentType: 'invoice',
      documentId: invoice.id,
      documentNumber: invoice.invoice_number,
      documentDate: invoice.date,
      dueDate: invoice.payment_date || invoice.date,
      originalAmount: Number(invoice.total || 0),
      isDebit: true,
      branchId: warehouseId,
      currency: invoice.currency === 'KZ' ? 'AOA' : (invoice.currency || 'AOA'),
    });
  }
}

async function main() {
  const filter = process.argv[2];
  let sql = 'SELECT * FROM purchase_invoices ORDER BY created_at DESC';
  const params = [];
  if (filter) {
    sql = 'SELECT * FROM purchase_invoices WHERE invoice_number = $1';
    params.push(filter);
  }
  const result = await db.query(sql, params);
  let repaired = 0;
  for (const row of result.rows || []) {
    if (!(await invoiceNeedsRepair(row))) {
      console.log(`SKIP ${row.invoice_number} (stock already recorded)`);
      continue;
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await repairInvoice(client, row);
      await client.query('COMMIT');
      console.log(`OK ${row.invoice_number}`);
      repaired += 1;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`FAIL ${row.invoice_number}:`, e.message);
    } finally {
      client.release();
    }
  }
  console.log(`Repaired ${repaired} invoice(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
