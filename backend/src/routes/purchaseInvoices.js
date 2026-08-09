// Purchase invoices (Fatura de Compra) — canonical header/lines store
const express = require('express');
const db = require('../db');
const { toRow, fromRow } = require('../purchaseInvoiceMappers');
const { requirePermission } = require('../middleware/requirePermission');
const { buildPurchaseInvoiceBranchFilter } = require('../lib/branchIdMatch');
const { auditErpSafe } = require('../lib/erpAudit');
const { parseListPagination } = require('../lib/listPagination');

const UPSERT_SQL = `
  INSERT INTO purchase_invoices (
    id, invoice_number, supplier_account_code, supplier_name, supplier_id,
    supplier_nif, supplier_phone, supplier_balance, ref, supplier_invoice_no,
    contact, department, ref2, date, payment_date, project, currency,
    warehouse_id, warehouse_name, price_type, address,
    purchase_account_code, iva_account_code, transaction_type, currency_rate,
    tax_rate_2, order_no, surcharge_percent, change_price, is_pending, extra_note,
    freight_cost, freight_other_costs, freight_source_account, freight_source_name,
    freight_payment_source, freight_caixa_id, freight_bank_account_id,
    lines_json, journal_lines_json, subtotal, iva_total, total, status,
    purchase_returns_status, purchase_returns_closed_at,
    branch_id, branch_name, created_by, created_by_name, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
    $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
    $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52
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
    freight_payment_source = excluded.freight_payment_source,
    freight_caixa_id = excluded.freight_caixa_id,
    freight_bank_account_id = excluded.freight_bank_account_id,
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

function normalizePurchaseLines(lines) {
  const { normalizePurchaseLines: norm } = require('../lib/purchaseInvoicePosting');
  return norm(lines);
}

function purchaseInvoiceHasStockLines(lines) {
  const { purchaseInvoiceHasStockLines: hasStock } = require('../lib/purchaseInvoicePosting');
  return hasStock(lines);
}

function priorFreightStateFromRow(row) {
  if (!row) return { landingCosts: 0, caixaId: null, paymentSource: 'caixa' };
  const { roundMoney } = require('../lib/freightTreasury');
  return {
    landingCosts: roundMoney(Number(row.freight_cost || 0) + Number(row.freight_other_costs || 0)),
    caixaId: String(row.freight_caixa_id || '').trim() || null,
    paymentSource: String(row.freight_payment_source || 'caixa').toLowerCase(),
  };
}

function shouldBroadcastFreightCaixas(rowOrInv, priorFreightState, txResult) {
  if (!txResult?.journalEntryId) return false;
  const pick = (snake, camel) => rowOrInv?.[snake] ?? rowOrInv?.[camel];
  const src = String(pick('freight_payment_source', 'freightPaymentSource') || 'caixa').toLowerCase();
  const caixaId = String(pick('freight_caixa_id', 'freightCaixaId') || '').trim();
  if (src === 'caixa' && caixaId) return true;
  if (priorFreightState?.caixaId && (priorFreightState?.landingCosts || 0) > 0) return true;
  return false;
}

async function broadcastFreightCaixasIfNeeded(broadcastTable, rowOrInv, priorFreightState, txResult) {
  if (!shouldBroadcastFreightCaixas(rowOrInv, priorFreightState, txResult)) return;
  try { await broadcastTable('caixas'); } catch (_) { /* non-fatal */ }
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
    r.freight_payment_source, r.freight_caixa_id, r.freight_bank_account_id,
    r.lines_json, r.journal_lines_json, r.subtotal, r.iva_total, r.total, r.status,
    r.purchase_returns_status, r.purchase_returns_closed_at,
    r.branch_id, r.branch_name, r.created_by, r.created_by_name, r.created_at, r.updated_at,
  ];
}

module.exports = function purchaseInvoicesRoutes(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { branchId, status, dateFrom, dateTo } = req.query;
      const { limit, offset } = parseListPagination(req, { defaultLimit: 100, maxLimit: 500 });
      // List payload omits heavy JSON blobs so LAN clients do not time out / hang.
      let query = `SELECT id, invoice_number, supplier_account_code, supplier_name, supplier_id,
        supplier_nif, supplier_phone, supplier_balance, ref, supplier_invoice_no,
        contact, department, ref2, date, payment_date, project, currency,
        warehouse_id, warehouse_name, price_type, address,
        purchase_account_code, iva_account_code, transaction_type, currency_rate,
        tax_rate_2, order_no, surcharge_percent, change_price, is_pending, extra_note,
        freight_cost, freight_other_costs, freight_source_account, freight_source_name,
        freight_payment_source, freight_caixa_id, freight_bank_account_id,
        NULL AS lines_json, NULL AS journal_lines_json,
        subtotal, iva_total, total, status,
        purchase_returns_status, purchase_returns_closed_at,
        branch_id, branch_name, created_by, created_by_name, created_at, updated_at
        FROM purchase_invoices WHERE 1=1`;
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
      // Prefer document date; fall back to created_at when date is empty.
      const dayExpr = db.engine === 'postgres'
        ? `COALESCE(NULLIF(TRIM(date::text), ''), to_char(created_at::date, 'YYYY-MM-DD'))`
        : `COALESCE(NULLIF(TRIM(CAST(date AS TEXT)), ''), substr(CAST(created_at AS TEXT), 1, 10))`;
      if (dateFrom) {
        query += ` AND (${dayExpr}) >= $${idx++}`;
        params.push(String(dateFrom).slice(0, 10));
      }
      if (dateTo) {
        query += ` AND (${dayExpr}) <= $${idx++}`;
        params.push(String(dateTo).slice(0, 10));
      }
      query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(limit, offset);
      const result = await db.query(query, params);
      res.json({
        items: (result.rows || []).map(fromRow),
        limit,
        offset,
        hasMore: (result.rows || []).length === limit,
      });
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

  router.get('/:id/posting-status', async (req, res) => {
    try {
      const saved = await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [req.params.id]);
      if (!saved.rows[0]) return res.status(404).json({ error: 'Not found' });
      const inv = fromRow(saved.rows[0]);
      const client = await db.pool.connect();
      try {
        const { queryPostingStatus, purchaseInvoiceHasStockLines } = require('../lib/purchaseInvoicePosting');
        const status = await queryPostingStatus(client, inv.id);
        res.json({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          warehouseId: inv.warehouseId,
          branchId: inv.branchId,
          hasStockLines: purchaseInvoiceHasStockLines(inv.lines),
          ...status,
          ok: status.stockMovementIds.length > 0 && !!status.openItemId,
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[PURCHASE INVOICES] posting-status:', error);
      res.status(500).json({ error: error.message || 'Failed to read posting status' });
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

  async function postPurchaseAccountingIfNeeded(client, inv, opts = {}) {
    const { postPurchaseInvoiceAccountingPhased } = require('../lib/purchaseInvoicePosting');
    return postPurchaseInvoiceAccountingPhased(client, inv, opts);
  }

  router.post('/resolve-freight-treasury', requirePermission('purchase_create'), async (req, res) => {
    try {
      const { resolveFreightTreasuryGl } = require('../lib/freightTreasury');
      const client = await db.pool.connect();
      try {
        const treasury = await resolveFreightTreasuryGl(client, req.body || {});
        res.json({ data: treasury });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[PURCHASE INVOICES] resolve-freight-treasury:', error);
      res.status(500).json({ error: error.message || 'Failed to resolve freight treasury' });
    }
  });

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

      const { resolveBranchRow } = require('../lib/branchIdMatch');
      const warehouseRaw = String(row.warehouse_id || row.branch_id || '').trim();
      if (!warehouseRaw) {
        return res.status(400).json({ error: 'warehouseId / branchId é obrigatório para fatura de compra' });
      }
      const branchRow = await resolveBranchRow(db, warehouseRaw);
      if (!branchRow?.id) {
        return res.status(400).json({
          error: `Filial inválida para fatura de compra: ${warehouseRaw}`,
          code: 'INVALID_PURCHASE_BRANCH',
        });
      }
      row.warehouse_id = String(branchRow.id);
      row.branch_id = String(branchRow.id);
      if (!row.warehouse_name) row.warehouse_name = branchRow.name || '';
      if (!row.branch_name) row.branch_name = branchRow.name || '';

      try {
        const lines = JSON.parse(row.lines_json || '[]');
        if (Array.isArray(lines) && lines.length > 0) {
          row.lines_json = JSON.stringify(
            lines.map((line) => ({
              ...line,
              warehouseId: String(branchRow.id),
              warehouse_id: String(branchRow.id),
              warehouseName: line.warehouseName || line.warehouse_name || branchRow.name || '',
              warehouse_name: line.warehouseName || line.warehouse_name || branchRow.name || '',
            })),
          );
        }
      } catch {
        /* keep original lines_json */
      }

      await client.query('BEGIN');
      const priorSaved = await client.query(
        'SELECT freight_cost, freight_other_costs, freight_payment_source, freight_caixa_id FROM purchase_invoices WHERE id = $1',
        [row.id],
      );
      const priorFreightState = priorFreightStateFromRow(priorSaved.rows[0]);
      await client.query(UPSERT_SQL, rowParams(row));
      await client.query('COMMIT');

      const saved = await client.query('SELECT * FROM purchase_invoices WHERE id = $1', [row.id]);
      const inv = fromRow(saved.rows[0]);
      console.log(
        `[PURCHASE INVOICES] Saved ${row.invoice_number} id=${row.id} branch=${row.branch_id} warehouse=${row.warehouse_id}`,
      );

      let txResult = null;
      let accountingError = null;
      if (!skipAccounting) {
        try {
          await client.query('BEGIN');
          txResult = await postPurchaseAccountingIfNeeded(client, inv, { priorFreightState });
          await client.query('COMMIT');
        } catch (accErr) {
          try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
          accountingError = accErr.message || String(accErr);
          console.error('[PURCHASE INVOICES] accounting post failed:', accErr);
        }
      }

      await broadcastTable?.('purchase_invoices');
      if (txResult?.stockMovementIds?.length) {
        try {
          require('../lib/inventoryGridServerCache').invalidateInventoryGridResultCache();
        } catch (_) { /* ignore */ }
        await broadcastTable?.('products');
      }
      if (txResult?.journalEntryId) {
        await broadcastTable?.('journal_entries');
      }
      if (txResult?.openItemId) {
        await broadcastTable?.('suppliers');
      }
      await broadcastFreightCaixasIfNeeded(broadcastTable, row, priorFreightState, txResult);

      const payload = fromRow(saved.rows[0]);
      const hasStock = (txResult?.stockMovementIds?.length ?? 0) > 0;
      const hasPayable = !!txResult?.openItemId;
      const detailErrors = [
        ...(txResult?.errors || []),
        ...(accountingError ? [accountingError] : []),
      ].filter(Boolean);
      const hasJournal = !!txResult?.journalEntryId;
      // Align with purchaseInvoicePosting: journal required when freight OR journal lines exist.
      const landingCosts = Number(row.freight_cost || 0) + Number(row.freight_other_costs || 0);
      const journalLinesCount = Array.isArray(inv?.journalLines)
        ? inv.journalLines.length
        : (Array.isArray(inv?.journal_lines) ? inv.journal_lines.length : 0);
      const journalRequired = landingCosts > 0 || journalLinesCount > 0;
      const postingOk = txResult
        ? !!txResult.success
        : (!accountingError && hasStock && hasPayable && (!journalRequired || hasJournal));
      if (txResult || accountingError || !skipAccounting) {
        payload.accounting = {
          success: !accountingError && postingOk,
          stockMovementIds: txResult?.stockMovementIds || [],
          openItemId: txResult?.openItemId || null,
          journalEntryId: txResult?.journalEntryId || null,
          errors: detailErrors,
          warnings: txResult?.warnings || [],
          error: detailErrors[0]
            || (journalRequired && !hasJournal
              ? 'Purchase journal was not posted — check caixa/bank and chart of accounts.'
              : null)
            || (!hasStock || !hasPayable
              ? 'Stock or supplier payable was not posted.'
              : null)
            || (!postingOk ? 'Purchase accounting did not complete successfully.' : null),
        };
      }
      auditErpSafe(req, {
        table: 'purchase_invoices',
        id: row.id,
        action: skipAccounting ? 'create' : 'create_and_post',
        branchId: row.branch_id,
        description: `FC ${row.invoice_number} — ${row.supplier_name || ''} (${Number(row.total) || 0} AOA)${skipAccounting ? ' [header only]' : ''}`,
        newValues: {
          invoiceNumber: row.invoice_number,
          supplierName: row.supplier_name,
          total: row.total,
          accounting: payload.accounting || null,
        },
      });
      setImmediate(() => {
        try {
          const { enqueueWebhookEvent } = require('../lib/webhooks');
          enqueueWebhookEvent('purchase_invoice.created', {
            id: row.id,
            invoiceNumber: row.invoice_number,
            total: row.total,
            branchId: row.branch_id,
            supplierName: row.supplier_name,
            posted: !skipAccounting,
          }).catch((e) => console.warn('[WEBHOOKS] purchase_invoice.created:', e.message));
        } catch (e) {
          console.warn('[WEBHOOKS] purchase_invoice.created:', e.message);
        }
      });
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
    const lines = normalizePurchaseLines(inv.lines);
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
  router.post('/:id/repost-accounting', requirePermission('purchase_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const saved = await db.query('SELECT * FROM purchase_invoices WHERE id = $1', [req.params.id]);
      if (!saved.rows[0]) return res.status(404).json({ error: 'Not found' });
      const inv = fromRow(saved.rows[0]);

      let txResult = null;
      try {
        await client.query('BEGIN');
        txResult = await postPurchaseAccountingIfNeeded(client, inv);
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      }

      await broadcastTable?.('products');
      await broadcastTable?.('purchase_invoices');
      if (txResult?.journalEntryId) await broadcastTable?.('journal_entries');
      if (txResult?.openItemId) await broadcastTable?.('suppliers');
      await broadcastFreightCaixasIfNeeded(broadcastTable, inv, null, txResult);

      res.json({
        success: !!txResult?.success,
        stockMovementIds: txResult?.stockMovementIds || [],
        openItemId: txResult?.openItemId || null,
        journalEntryId: txResult?.journalEntryId || null,
        errors: txResult?.errors || [],
        warnings: txResult?.warnings || [],
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      console.error('[PURCHASE INVOICES] repost-accounting:', error);
      res.status(500).json({ error: error.message || 'Failed to repost accounting' });
    } finally {
      client.release();
    }
  });

  router.delete('/:id', requirePermission('admin_settings'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      const id = req.params.id;
      const saved = await client.query('SELECT id, invoice_number, status FROM purchase_invoices WHERE id = $1', [id]);
      if (!saved.rows[0]) {
        return res.status(404).json({ error: 'Purchase invoice not found' });
      }

      const { queryPostingStatus } = require('../lib/purchaseInvoicePosting');
      const posting = await queryPostingStatus(client, id);
      const hasSideEffects =
        (posting.stockMovementIds && posting.stockMovementIds.length > 0)
        || !!posting.openItemId
        || !!posting.journalEntryId;

      if (hasSideEffects) {
        return res.status(409).json({
          error: 'Cannot delete a posted purchase invoice',
          hint: 'Use supplier return / cancel flow, or repost-accounting tools. Hard delete would orphan stock, payables, and journals.',
          posting: {
            stockMovements: posting.stockMovementIds?.length || 0,
            openItem: !!posting.openItemId,
            journal: !!posting.journalEntryId,
          },
        });
      }

      const status = String(saved.rows[0].status || '').toLowerCase();
      if (status && !['draft', 'cancelled', 'voided', 'pending'].includes(status)) {
        return res.status(409).json({
          error: `Cannot delete purchase invoice in status "${saved.rows[0].status}"`,
          hint: 'Only draft/pending invoices without postings may be deleted.',
        });
      }

      await client.query('DELETE FROM purchase_invoices WHERE id = $1', [id]);
      await broadcastTable?.('purchase_invoices');
      auditErpSafe(req, {
        table: 'purchase_invoices',
        id,
        action: 'delete',
        description: `Fatura de compra eliminada (sem lançamentos): ${saved.rows[0].invoice_number || id}`,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[PURCHASE INVOICES]', error);
      res.status(500).json({ error: 'Failed to delete purchase invoice' });
    } finally {
      client.release();
    }
  });

  return router;
};
