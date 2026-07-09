// Purchase invoices (Fatura de Compra) — canonical header/lines store
const express = require('express');
const db = require('../db');
const { toRow, fromRow } = require('../purchaseInvoiceMappers');
const { requirePermission } = require('../middleware/requirePermission');
const { buildPurchaseInvoiceBranchFilter } = require('../lib/branchIdMatch');

const UPSERT_SQL = `
  INSERT INTO purchase_invoices (
    id, invoice_number, supplier_account_code, supplier_name, supplier_id,
    supplier_nif, supplier_phone, supplier_balance, ref, supplier_invoice_no,
    contact, department, ref2, date, payment_date, project, currency,
    warehouse_id, warehouse_name, price_type, address,
    purchase_account_code, iva_account_code, transaction_type, currency_rate,
    tax_rate_2, order_no, surcharge_percent, change_price, is_pending, extra_note,
    freight_cost, freight_other_costs, freight_source_account, freight_source_name,
    lines_json, journal_lines_json, subtotal, iva_total, total, status,
    purchase_returns_status, purchase_returns_closed_at,
    branch_id, branch_name, created_by, created_by_name, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
    $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
    $40,$41,$42,$43,$44,$45,$46,$47,$48,$49
  )
  ON CONFLICT(id) DO UPDATE SET
    invoice_number = excluded.invoice_number,
    supplier_account_code = excluded.supplier_account_code,
    supplier_name = excluded.supplier_name,
    supplier_id = excluded.supplier_id,
    supplier_nif = excluded.supplier_nif,
    supplier_phone = excluded.supplier_phone,
    supplier_balance = excluded.supplier_balance,
    ref = excluded.ref,
    supplier_invoice_no = excluded.supplier_invoice_no,
    contact = excluded.contact,
    department = excluded.department,
    ref2 = excluded.ref2,
    date = excluded.date,
    payment_date = excluded.payment_date,
    project = excluded.project,
    currency = excluded.currency,
    warehouse_id = excluded.warehouse_id,
    warehouse_name = excluded.warehouse_name,
    price_type = excluded.price_type,
    address = excluded.address,
    purchase_account_code = excluded.purchase_account_code,
    iva_account_code = excluded.iva_account_code,
    transaction_type = excluded.transaction_type,
    currency_rate = excluded.currency_rate,
    tax_rate_2 = excluded.tax_rate_2,
    order_no = excluded.order_no,
    surcharge_percent = excluded.surcharge_percent,
    change_price = excluded.change_price,
    is_pending = excluded.is_pending,
    extra_note = excluded.extra_note,
    freight_cost = excluded.freight_cost,
    freight_other_costs = excluded.freight_other_costs,
    freight_source_account = excluded.freight_source_account,
    freight_source_name = excluded.freight_source_name,
    lines_json = excluded.lines_json,
    journal_lines_json = excluded.journal_lines_json,
    subtotal = excluded.subtotal,
    iva_total = excluded.iva_total,
    total = excluded.total,
    status = excluded.status,
    purchase_returns_status = excluded.purchase_returns_status,
    purchase_returns_closed_at = excluded.purchase_returns_closed_at,
    branch_id = excluded.branch_id,
    branch_name = excluded.branch_name,
    created_by = excluded.created_by,
    created_by_name = excluded.created_by_name,
    updated_at = excluded.updated_at
`;

async function findDuplicateSupplierInvoice(supplierId, supplierInvoiceNo, excludeId) {
  const no = String(supplierInvoiceNo || '').trim();
  const sid = String(supplierId || '').trim();
  if (!no || !sid) return null;

  const params = [sid, no.toLowerCase()];
  let sql = `
    SELECT id, invoice_number, supplier_invoice_no
    FROM purchase_invoices
    WHERE TRIM(COALESCE(supplier_id, '')) = TRIM($1)
      AND LOWER(TRIM(COALESCE(supplier_invoice_no, ''))) = $2`;
  if (excludeId) {
    sql += ' AND id != $3';
    params.push(String(excludeId));
  }
  sql += ' LIMIT 1';

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolvePurchaseInvoiceLandingCosts(inv) {
  const explicit =
    roundMoney(Number(inv.freightCost ?? inv.freight_cost ?? 0))
    + roundMoney(Number(inv.freightOtherCosts ?? inv.freight_other_costs ?? 0));
  if (explicit > 0) return explicit;

  const journal = Array.isArray(inv.journalLines) ? inv.journalLines : [];
  const fromJournal = journal
    .filter((line) => String(line.accountCode || line.account_code || '').trim() === '752')
    .reduce((sum, line) => sum + Number(line.debit || 0), 0);
  return roundMoney(fromJournal);
}

/** Allocate total landing costs across invoice lines (proportional to line value). */
function buildPurchaseInvoiceFreightAllocations(lines, totalLandingCosts) {
  const stockLines = (lines || []).filter(
    (l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0,
  );
  if (stockLines.length === 0 || totalLandingCosts <= 0) {
    return new Map();
  }

  const normalized = stockLines.map((line) => {
    const qty = Number(line.totalQty || line.quantity || 0);
    const unitCost = roundMoney(line.unitPrice || 0);
    const lineTotal = roundMoney(Number(line.total || 0) > 0 ? line.total : unitCost * qty);
    return { line, qty, unitCost, lineTotal };
  });

  const totalProducts = roundMoney(
    normalized.reduce((sum, entry) => sum + entry.lineTotal, 0),
  );
  if (totalProducts <= 0) return new Map();

  const allocations = new Map();
  let allocatedFreight = 0;

  normalized.forEach((entry, index) => {
    const isLast = index === normalized.length - 1;
    const freightShare = isLast
      ? roundMoney(totalLandingCosts - allocatedFreight)
      : roundMoney((entry.lineTotal / totalProducts) * totalLandingCosts);
    allocatedFreight = roundMoney(allocatedFreight + freightShare);
    const freightPerUnit = entry.qty > 0 ? roundMoney(freightShare / entry.qty) : 0;
    allocations.set(
      entry.line.productId,
      roundMoney(entry.unitCost + freightPerUnit),
    );
  });

  return allocations;
}

function rowParams(r) {
  return [
    r.id, r.invoice_number, r.supplier_account_code, r.supplier_name, r.supplier_id,
    r.supplier_nif, r.supplier_phone, r.supplier_balance, r.ref, r.supplier_invoice_no,
    r.contact, r.department, r.ref2, r.date, r.payment_date, r.project, r.currency,
    r.warehouse_id, r.warehouse_name, r.price_type, r.address,
    r.purchase_account_code, r.iva_account_code, r.transaction_type, r.currency_rate,
    r.tax_rate_2, r.order_no, r.surcharge_percent, r.change_price, r.is_pending, r.extra_note,
    r.freight_cost, r.freight_other_costs, r.freight_source_account, r.freight_source_name,
    r.lines_json, r.journal_lines_json, r.subtotal, r.iva_total, r.total, r.status,
    r.purchase_returns_status, r.purchase_returns_closed_at,
    r.branch_id, r.branch_name, r.created_by, r.created_by_name, r.created_at, r.updated_at,
  ];
}

module.exports = function purchaseInvoicesRoutes(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { branchId, status } = req.query;
      let query = 'SELECT * FROM purchase_invoices WHERE 1=1';
      const params = [];
      let idx = 1;
      if (branchId) {
        const branchFilter = await buildPurchaseInvoiceBranchFilter(db, branchId, idx);
        if (branchFilter.sql) {
          query += branchFilter.sql;
          params.push(...branchFilter.params);
          idx += branchFilter.params.length;
        }
      }
      if (status) {
        query += ` AND status = $${idx++}`;
        params.push(status);
      }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      res.json((result.rows || []).map(fromRow));
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: 'Failed to list purchase invoices' });
    }
  });

  router.get('/check-duplicate', async (req, res) => {
    try {
      const { supplierId, supplierInvoiceNo, excludeId } = req.query;
      const dup = await findDuplicateSupplierInvoice(supplierId, supplierInvoiceNo, excludeId);
      res.json({
        duplicate: !!dup,
        existingId: dup?.id || null,
        existingInvoiceNumber: dup?.invoice_number || null,
      });
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: error.message || 'Failed to check duplicate' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.json(fromRow(result.rows[0]));
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: 'Failed to fetch purchase invoice' });
    }
  });

  async function postPurchaseAccountingIfNeeded(client, inv) {
    const status = String(inv.status || 'confirmed').toLowerCase();
    if (['cancelled', 'voided', 'draft'].includes(status)) return null;
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const hasStockLines = lines.some(
      (l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0,
    );
    if (!hasStockLines) return null;

    const stockCheck = await client.query(
      `SELECT id FROM stock_movements
       WHERE reference_id = $1
         AND reference_type IN ('purchase_invoice', 'purchase')
       LIMIT 1`,
      [inv.id],
    );
    if (stockCheck.rows.length > 0) return null;

    const { processTransactionBody } = require('../transactionProcessor');
    const txResult = await processTransactionBody(client, buildPurchaseInvoiceTransactionBody(inv));

    const warehouseId = inv.warehouseId || inv.branchId;
    if (warehouseId && txResult?.stockMovementIds?.length > 0) {
      try {
        const { ensureFilialProductsForWarehouse } = require('../lib/filialStockRepair');
        await ensureFilialProductsForWarehouse(warehouseId, client);
      } catch (filialErr) {
        console.warn('[PURCHASE INVOICES] filial stock repair:', filialErr.message);
      }
    }

    return txResult;
  }

  router.post('/', requirePermission('purchase_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const row = toRow(req.body);
      if (!row.id) return res.status(400).json({ error: 'id is required' });
      if (!row.invoice_number) return res.status(400).json({ error: 'invoiceNumber is required' });
      const dup = await findDuplicateSupplierInvoice(row.supplier_id, row.supplier_invoice_no, row.id);
      if (dup) {
        return res.status(409).json({
          error: 'Já existe uma fatura de compra com este número de fatura do fornecedor para o mesmo fornecedor.',
          code: 'DUPLICATE_SUPPLIER_INVOICE_NO',
          existingId: dup.id,
          existingInvoiceNumber: dup.invoice_number,
        });
      }

      const skipAccounting = req.body?.skipAccounting === true || req.body?.metadataOnly === true;

      await client.query('BEGIN');
      await client.query(UPSERT_SQL, rowParams(row));
      const saved = await client.query('SELECT * FROM purchase_invoices WHERE id = $1', [row.id]);
      const inv = fromRow(saved.rows[0]);

      let txResult = null;
      if (!skipAccounting) {
        txResult = await postPurchaseAccountingIfNeeded(client, inv);
      }

      await client.query('COMMIT');

      await broadcastTable?.('purchase_invoices');
      if (txResult?.stockMovementIds?.length) {
        await broadcastTable?.('products');
      }
      if (txResult?.journalEntryId) {
        await broadcastTable?.('journal_entries');
      }

      const payload = fromRow(saved.rows[0]);
      if (txResult) {
        payload.accounting = {
          success: true,
          stockMovementIds: txResult.stockMovementIds || [],
          openItemId: txResult.openItemId || null,
          journalEntryId: txResult.journalEntryId || null,
        };
      }
      res.status(201).json(payload);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[PURCHASE INVOICES]', error);
      const msg = String(error?.message || '');
      if (/unique|duplicate/i.test(msg)) {
        return res.status(409).json({
          error: /supplier_invoice/i.test(msg)
            ? 'Já existe uma fatura de compra com este número de fatura do fornecedor para o mesmo fornecedor.'
            : 'Já existe uma fatura de compra com este número nesta filial.',
        });
      }
      res.status(500).json({ error: msg || 'Failed to save purchase invoice' });
    } finally {
      client.release();
    }
  });

  /** Repair invoices saved without stock/payables (orphan headers). */
  router.post('/backfill-accounting', requirePermission('admin_settings'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const limit = Math.min(Number(req.body?.limit) || 100, 500);
      const missing = await client.query(
        `SELECT pi.id
         FROM purchase_invoices pi
         LEFT JOIN stock_movements sm
           ON sm.reference_id = pi.id
          AND sm.reference_type IN ('purchase_invoice', 'purchase')
         WHERE COALESCE(pi.status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
           AND sm.id IS NULL
         ORDER BY pi.created_at DESC
         LIMIT $1`,
        [limit],
      );

      let posted = 0;
      let failed = 0;
      const errors = [];

      for (const row of missing.rows || []) {
        try {
          await client.query('BEGIN');
          const saved = await client.query('SELECT * FROM purchase_invoices WHERE id = $1', [row.id]);
          if (!saved.rows[0]) {
            await client.query('ROLLBACK');
            continue;
          }
          const inv = fromRow(saved.rows[0]);
          const txResult = await postPurchaseAccountingIfNeeded(client, inv);
          await client.query('COMMIT');
          if (txResult?.stockMovementIds?.length) posted += 1;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
          failed += 1;
          errors.push({ id: row.id, error: err.message });
        }
      }

      if (posted > 0) {
        await broadcastTable?.('products');
        await broadcastTable?.('journal_entries');
        await broadcastTable?.('purchase_invoices');
      }

      res.json({ posted, failed, errors: errors.slice(0, 20) });
    } catch (error) {
      console.error('[PURCHASE INVOICES] backfill-accounting:', error);
      res.status(500).json({ error: error.message || 'Backfill failed' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', requirePermission('purchase_create'), async (req, res) => {
    try {
      const row = toRow({ ...req.body, id: req.params.id });
      const dup = await findDuplicateSupplierInvoice(row.supplier_id, row.supplier_invoice_no, row.id);
      if (dup) {
        return res.status(409).json({
          error: 'Já existe uma fatura de compra com este número de fatura do fornecedor para o mesmo fornecedor.',
          code: 'DUPLICATE_SUPPLIER_INVOICE_NO',
          existingId: dup.id,
          existingInvoiceNumber: dup.invoice_number,
        });
      }
      await db.query(UPSERT_SQL, rowParams(row));
      await broadcastTable?.('purchase_invoices');
      const saved = await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [row.id]);
      res.json(fromRow(saved.rows[0]));
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: error.message || 'Failed to update purchase invoice' });
    }
  });

  function buildPurchaseInvoiceTransactionBody(inv) {
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const warehouseId = inv.warehouseId || inv.branchId;
    const totalLandingCosts = resolvePurchaseInvoiceLandingCosts(inv);
    const landedUnitCosts = buildPurchaseInvoiceFreightAllocations(lines, totalLandingCosts);

    const stockEntries = lines
      .filter((l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0)
      .map((l) => {
        const landed = landedUnitCosts.get(l.productId) ?? roundMoney(l.unitPrice || 0);
        return {
          productId: l.productId,
          productName: l.description || '',
          productSku: l.productCode || '',
          quantity: Number(l.totalQty || l.quantity || 0),
          unitCost: landed,
          direction: 'IN',
          warehouseId,
        };
      });

    const priceUpdates = lines
      .filter((l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0)
      .map((l) => {
        const landed = landedUnitCosts.get(l.productId) ?? roundMoney(l.unitPrice || 0);
        const selling = Number(l.price1 || 0);
        const row = {
          productId: l.productId,
          newUnitCost: landed,
          quantityReceived: Number(l.totalQty || l.quantity || 0),
          updateAvgCost: true,
        };
        if (inv.changePrice && selling > 0) row.sellingPrice = selling;
        return row;
      });

    const journalLines = (inv.journalLines || []).map((l) => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      note: l.note,
    }));

    return {
      transactionType: 'purchase_invoice',
      documentId: inv.id,
      documentNumber: inv.invoiceNumber,
      branchId: inv.branchId || warehouseId,
      branchName: inv.branchName || inv.warehouseName,
      userId: inv.createdBy || 'system',
      userName: inv.createdByName || '',
      date: inv.date,
      currency: inv.currency || 'KZ',
      description: `Fatura de Compra ${inv.invoiceNumber} — ${inv.supplierName}`,
      amount: Number(inv.total || 0),
      linkedPurchaseOrderNumber: inv.orderNo || undefined,
      changePrice: !!inv.changePrice,
      stockEntries,
      priceUpdates,
      journalLines,
      openItem: {
        entityType: 'supplier',
        entityId: inv.supplierId,
        entityName: inv.supplierName,
        documentType: 'invoice',
        originalAmount: Number(inv.total || 0),
        isDebit: true,
        dueDate: inv.paymentDate,
        currency: inv.currency === 'KZ' ? 'AOA' : inv.currency,
      },
      entityBalanceUpdate: {
        entityType: 'supplier',
        entityId: inv.supplierId,
        entityName: inv.supplierName,
        entityNif: inv.supplierNif,
        amount: Number(inv.total || 0),
      },
    };
  }

  /** Re-post stock / payables when header was saved but transaction engine failed earlier. */
  router.post('/:id/repost-accounting', requirePermission('admin_settings'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const saved = await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [req.params.id]);
      if (!saved.rows[0]) return res.status(404).json({ error: 'Not found' });
      const inv = fromRow(saved.rows[0]);

      const stockCheck = await client.query(
        `SELECT id FROM stock_movements
         WHERE reference_id = $1
           AND reference_type IN ('purchase_invoice', 'purchase')
         LIMIT 1`,
        [inv.id],
      );
      const openCheck = await client.query(
        `SELECT id FROM open_items WHERE document_id = $1 LIMIT 1`,
        [inv.id],
      );

      const needsStock = stockCheck.rows.length === 0;
      const needsPayable = openCheck.rows.length === 0;
      if (!needsStock && !needsPayable) {
        return res.json({
          success: true,
          skipped: true,
          stockMovementIds: stockCheck.rows.map((r) => r.id),
          openItemId: openCheck.rows[0]?.id || null,
        });
      }

      let txResult = null;
      if (needsStock) {
        await client.query('BEGIN');
        const { processTransactionBody } = require('../transactionProcessor');
        txResult = await processTransactionBody(client, buildPurchaseInvoiceTransactionBody(inv));
        await client.query('COMMIT');
      }

      let backfill = { created: 0, skipped: 0 };
      if (needsPayable || !txResult?.openItemId) {
        const { backfillMissingSupplierOpenItems } = require('../supplierBalanceRepair');
        backfill = await backfillMissingSupplierOpenItems();
      }

      const openAfter = await client.query(
        `SELECT id FROM open_items WHERE document_id = $1 LIMIT 1`,
        [inv.id],
      );

      const warehouseId = inv.warehouseId || inv.branchId;
      if (warehouseId && (needsStock || txResult?.stockMovementIds?.length > 0)) {
        try {
          const { ensureFilialProductsForWarehouse } = require('../lib/filialStockRepair');
          await ensureFilialProductsForWarehouse(warehouseId, client);
        } catch (filialErr) {
          console.warn('[PURCHASE INVOICES] filial stock repair:', filialErr.message);
        }
      }

      await broadcastTable?.('products');
      await broadcastTable?.('purchase_invoices');
      if (broadcastTable && (txResult?.journalEntryId || backfill.created > 0)) {
        await broadcastTable('journal_entries');
      }

      res.json({
        success: true,
        repostedStock: needsStock,
        backfill,
        stockMovementIds: txResult?.stockMovementIds || [],
        openItemId: txResult?.openItemId || openAfter.rows[0]?.id || null,
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[PURCHASE INVOICES] repost-accounting:', error);
      res.status(500).json({ error: error.message || 'Failed to repost accounting' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await db.query('DELETE FROM purchase_invoices WHERE id = $1', [req.params.id]);
      await broadcastTable?.('purchase_invoices');
      res.json({ success: true });
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: 'Failed to delete purchase invoice' });
    }
  });

  return router;
};
