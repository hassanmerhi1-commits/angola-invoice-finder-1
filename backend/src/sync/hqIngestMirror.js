/**
 * Phase B4 — HQ read-model mirrors for city → main replication.
 */
const crypto = require('crypto');
const db = require('../db');
const { findAccountByCode } = require('../accounting');

async function hqIngestLogExists() {
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'hq_ingest_log' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'hq_ingest_log' LIMIT 1`
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function findHqIngestReceipt(idempotencyKey) {
  if (!(await hqIngestLogExists())) return null;
  const r = await db.query(
    `SELECT event_type, entity_id, branch_id FROM hq_ingest_log WHERE idempotency_key = $1 LIMIT 1`,
    [idempotencyKey]
  );
  return r.rows[0] || null;
}

async function writeHqIngestReceipt(idempotencyKey, eventType, entityId, branchId) {
  if (!(await hqIngestLogExists())) return;
  await db.query(
    `INSERT INTO hq_ingest_log (idempotency_key, event_type, entity_id, branch_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [idempotencyKey, eventType, entityId || null, branchId || null]
  );
}

function parseJsonColumn(val, fallback = []) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

async function mirrorPurchaseInvoiceEvent(payload, idempotencyKey) {
  const purchase = payload?.purchase || payload?.purchaseInvoice;
  if (!purchase?.id) return { skipped: true, reason: 'no purchase' };

  const receipt = idempotencyKey ? await findHqIngestReceipt(idempotencyKey) : null;
  if (receipt?.entity_id) {
    return { skipped: true, reason: 'duplicate', id: receipt.entity_id };
  }

  const dup = await db.query(`SELECT id FROM purchase_invoices WHERE id = $1 LIMIT 1`, [purchase.id]);
  if (dup.rows.length > 0) {
    if (idempotencyKey) {
      await writeHqIngestReceipt(
        idempotencyKey,
        'purchase_invoice.created',
        purchase.id,
        purchase.branch_id || purchase.branchId
      );
    }
    return { skipped: true, reason: 'duplicate', id: purchase.id };
  }

  const linesJson = JSON.stringify(parseJsonColumn(purchase.lines_json ?? purchase.lines, []));
  const journalJson = JSON.stringify(parseJsonColumn(purchase.journal_lines_json ?? purchase.journalLines, []));

  await db.query(
    `INSERT INTO purchase_invoices (
      id, invoice_number, supplier_account_code, supplier_name, supplier_id,
      supplier_nif, supplier_phone, supplier_balance, ref, supplier_invoice_no,
      contact, department, ref2, date, payment_date, project, currency,
      warehouse_id, warehouse_name, price_type, address,
      purchase_account_code, iva_account_code, transaction_type, currency_rate,
      tax_rate_2, order_no, surcharge_percent, change_price, is_pending, extra_note,
      lines_json, journal_lines_json, subtotal, iva_total, total, status,
      purchase_returns_status, purchase_returns_closed_at,
      branch_id, branch_name, created_by, created_by_name, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
      $40,$41,$42,$43,$44,$45
    )`,
    [
      purchase.id,
      purchase.invoice_number || purchase.invoiceNumber,
      purchase.supplier_account_code || purchase.supplierAccountCode || '',
      purchase.supplier_name || purchase.supplierName || '',
      purchase.supplier_id || purchase.supplierId || '',
      purchase.supplier_nif || purchase.supplierNif || '',
      purchase.supplier_phone || purchase.supplierPhone || '',
      Number(purchase.supplier_balance ?? purchase.supplierBalance ?? 0),
      purchase.ref || '',
      purchase.supplier_invoice_no || purchase.supplierInvoiceNo || '',
      purchase.contact || '',
      purchase.department || '',
      purchase.ref2 || '',
      purchase.date,
      purchase.payment_date || purchase.paymentDate || null,
      purchase.project || '',
      purchase.currency || 'KZ',
      purchase.warehouse_id || purchase.warehouseId || purchase.branch_id || purchase.branchId || '',
      purchase.warehouse_name || purchase.warehouseName || purchase.branch_name || purchase.branchName || '',
      purchase.price_type || purchase.priceType || 'last_price',
      purchase.address || '',
      purchase.purchase_account_code || purchase.purchaseAccountCode || '212',
      purchase.iva_account_code || purchase.ivaAccountCode || '3451',
      purchase.transaction_type || purchase.transactionType || 'ALL',
      Number(purchase.currency_rate ?? purchase.currencyRate ?? 1),
      Number(purchase.tax_rate_2 ?? purchase.taxRate2 ?? 0),
      purchase.order_no || purchase.orderNo || '',
      Number(purchase.surcharge_percent ?? purchase.surchargePercent ?? 0),
      !!(purchase.change_price ?? purchase.changePrice),
      !!(purchase.is_pending ?? purchase.isPending),
      purchase.extra_note || purchase.extraNote || '',
      linesJson,
      journalJson,
      Number(purchase.subtotal ?? 0),
      Number(purchase.iva_total ?? purchase.ivaTotal ?? 0),
      Number(purchase.total ?? 0),
      purchase.status || 'confirmed',
      purchase.purchase_returns_status || purchase.purchaseReturnsStatus || 'none',
      purchase.purchase_returns_closed_at || purchase.purchaseReturnsClosedAt || null,
      purchase.branch_id || purchase.branchId || '',
      purchase.branch_name || purchase.branchName || '',
      purchase.created_by || purchase.createdBy || '',
      purchase.created_by_name || purchase.createdByName || '',
      purchase.created_at || purchase.createdAt || new Date().toISOString(),
      purchase.updated_at || purchase.updatedAt || new Date().toISOString(),
    ]
  );

  const movements = payload?.stockMovements || payload?.stock_movements || [];
  let mirroredMovements = 0;
  for (const m of movements) {
    const r = await mirrorStockMovementRow(m);
    if (r.mirrored) mirroredMovements += 1;
  }

  if (idempotencyKey) {
    await writeHqIngestReceipt(
      idempotencyKey,
      'purchase_invoice.created',
      purchase.id,
      purchase.branch_id || purchase.branchId
    );
  }

  return { mirrored: true, id: purchase.id, stockMovements: mirroredMovements };
}

async function mirrorStockMovementRow(movement) {
  if (!movement?.id && !movement?.product_id && !movement?.productId) {
    return { skipped: true, reason: 'no movement' };
  }

  const id = movement.id || crypto.randomUUID();
  const dup = await db.query(`SELECT id FROM stock_movements WHERE id = $1 LIMIT 1`, [id]);
  if (dup.rows.length > 0) return { skipped: true, reason: 'duplicate', id };

  const productId = movement.product_id || movement.productId;
  if (!productId) return { skipped: true, reason: 'no product' };

  await db.query(
    `INSERT INTO stock_movements (
      id, product_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, reference_number, notes, created_by, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      productId,
      movement.warehouse_id || movement.warehouseId || null,
      movement.movement_type || movement.movementType,
      movement.quantity,
      Number(movement.unit_cost ?? movement.unitCost ?? 0),
      movement.reference_type || movement.referenceType || 'sync',
      movement.reference_id || movement.referenceId || null,
      movement.reference_number || movement.referenceNumber || '',
      movement.notes || '',
      movement.created_by || movement.createdBy || null,
      movement.created_at || movement.createdAt || new Date().toISOString(),
    ]
  );
  return { mirrored: true, id };
}

async function mirrorStockMovementEvent(payload, idempotencyKey) {
  const receipt = idempotencyKey ? await findHqIngestReceipt(idempotencyKey) : null;
  if (receipt?.entity_id) {
    return { skipped: true, reason: 'duplicate', id: receipt.entity_id };
  }

  const movement = payload?.movement || payload?.movementData || payload;
  const result = await mirrorStockMovementRow(movement);
  if (result.mirrored && idempotencyKey) {
    await writeHqIngestReceipt(
      idempotencyKey,
      'stock_movement',
      result.id,
      movement.branch_id || movement.branchId || movement.warehouse_id || movement.warehouseId
    );
  }
  return result;
}

async function resolveMirrorEntryNumber(entryNumber, branchId, entryId) {
  const base = String(entryNumber || 'JE').trim() || 'JE';
  const exists = await db.query(
    `SELECT id FROM journal_entries WHERE entry_number = $1 LIMIT 1`,
    [base]
  );
  if (!exists.rows.length) return base;

  const suffix = String(branchId || entryId || 'branch').replace(/-/g, '').slice(0, 8) || 'br';
  const alt = `${base}@${suffix}`;
  const existsAlt = await db.query(
    `SELECT id FROM journal_entries WHERE entry_number = $1 LIMIT 1`,
    [alt]
  );
  if (!existsAlt.rows.length) return alt;
  return `${base}@${suffix}-${String(entryId || crypto.randomUUID()).slice(0, 6)}`;
}

async function mirrorJournalPostedEvent(payload, idempotencyKey) {
  const entry = payload?.entry;
  const lines = payload?.lines || [];
  if (!entry?.id) return { skipped: true, reason: 'no entry' };

  const receipt = idempotencyKey ? await findHqIngestReceipt(idempotencyKey) : null;
  if (receipt?.entity_id) {
    return { skipped: true, reason: 'duplicate', id: receipt.entity_id };
  }

  const dup = await db.query(`SELECT id FROM journal_entries WHERE id = $1 LIMIT 1`, [entry.id]);
  if (dup.rows.length > 0) {
    if (idempotencyKey) {
      await writeHqIngestReceipt(
        idempotencyKey,
        'journal.posted',
        entry.id,
        entry.branch_id
      );
    }
    return { skipped: true, reason: 'duplicate', id: entry.id };
  }

  const entryNumber = await resolveMirrorEntryNumber(
    entry.entry_number,
    entry.branch_id,
    entry.id
  );

  await db.query(
    `INSERT INTO journal_entries (
      id, entry_number, entry_date, description, reference_type, reference_id,
      total_debit, total_credit, is_posted, posted_at, branch_id, created_by,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      entry.id,
      entryNumber,
      entry.entry_date,
      entry.description || '',
      entry.reference_type || null,
      entry.reference_id || null,
      Number(entry.total_debit || 0),
      Number(entry.total_credit || 0),
      entry.is_posted !== false,
      entry.posted_at || entry.created_at || new Date().toISOString(),
      entry.branch_id || null,
      entry.created_by || null,
      entry.created_at || new Date().toISOString(),
      entry.updated_at || entry.created_at || new Date().toISOString(),
    ]
  );

  let mirroredLines = 0;
  let skippedLines = 0;
  for (const line of lines) {
    const code = line.account_code || line.accountCode;
    if (!code) {
      skippedLines += 1;
      continue;
    }

    const account = await findAccountByCode(db, code);
    if (!account) {
      skippedLines += 1;
      continue;
    }

    const lineId = line.id || crypto.randomUUID();
    const lineDup = await db.query(`SELECT 1 FROM journal_entry_lines WHERE id = $1 LIMIT 1`, [lineId]);
    if (lineDup.rows.length) continue;

    const debit = Number(line.debit_amount ?? line.debit ?? 0);
    const credit = Number(line.credit_amount ?? line.credit ?? 0);
    if (debit === 0 && credit === 0) continue;

    await db.query(
      `INSERT INTO journal_entry_lines
       (id, journal_entry_id, account_id, description, debit_amount, credit_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        lineId,
        entry.id,
        account.id,
        line.description || entry.description || '',
        debit,
        credit,
      ]
    );
    mirroredLines += 1;
  }

  if (idempotencyKey) {
    await writeHqIngestReceipt(
      idempotencyKey,
      'journal.posted',
      entry.id,
      entry.branch_id
    );
  }

  return {
    mirrored: true,
    id: entry.id,
    entryNumber,
    lines: mirroredLines,
    skippedLines,
  };
}

async function applyHqIngestEvent(event) {
  const { event_type: type, payload, idempotency_key: idem } = event;
  switch (type) {
    case 'purchase_invoice.created':
      return mirrorPurchaseInvoiceEvent(payload, idem);
    case 'stock_movement':
      return mirrorStockMovementEvent(payload, idem);
    case 'journal.posted':
      return mirrorJournalPostedEvent(payload, idem);
    default:
      return { skipped: true, reason: 'unknown type' };
  }
}

module.exports = {
  applyHqIngestEvent,
  findHqIngestReceipt,
  mirrorPurchaseInvoiceEvent,
  mirrorStockMovementEvent,
  mirrorJournalPostedEvent,
};
