/**
 * Reliable purchase-invoice posting: stock + payable first, journal last.
 * Each phase uses a SAVEPOINT so a payable/journal SQL error cannot abort
 * the transaction and silently roll back stock that already posted.
 */
const { fromRow } = require('../purchaseInvoiceMappers');
const {
  recordStockMovement,
  applyPurchaseSupplierToProducts,
  applyWeightedAverageCostAfterIn,
  createOpenItem,
  syncSupplierBalanceFromOpenItems,
  auditLog,
} = require('../transactionEngine');
const { createJournalEntry } = require('../accounting');
const { ensurePurchaseInvoicePayable } = require('../supplierBalanceRepair');
const { normalizeSqlDate } = require('./dateSql');
const { resolveBranchFilterId, resolveBranchRow } = require('./branchIdMatch');
const {
  landingCostsFromInvoice,
  resolveFreightTreasuryGl,
  applyFreightTreasuryToJournalLines,
  syncFreightCaixaRegister,
  roundMoney,
} = require('./freightTreasury');
const db = require('../db');

function normalizeJournalLineForSig(line) {
  return {
    c: String(line.accountCode || line.account_code || '').trim(),
    d: roundMoney(Number(line.debit || 0)),
    cr: roundMoney(Number(line.credit || 0)),
  };
}

function journalSignature(lines) {
  return JSON.stringify(
    (lines || [])
      .map(normalizeJournalLineForSig)
      .sort((a, b) => `${a.c}:${a.d}:${a.cr}`.localeCompare(`${b.c}:${b.d}:${b.cr}`)),
  );
}

/** Allocate landing costs into per-product landed unit cost (unitPrice + freight share). */
function buildLandedUnitCosts(lines, totalLandingCosts) {
  const stockLines = (lines || []).filter(
    (l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0,
  );
  const allocations = new Map();
  if (stockLines.length === 0) return allocations;

  const normalized = stockLines.map((line) => {
    const qty = Number(line.totalQty || line.quantity || 0);
    const unitCost = roundMoney(line.unitPrice || 0);
    const lineTotal = roundMoney(Number(line.total || 0) > 0 ? line.total : unitCost * qty);
    return { line, qty, unitCost, lineTotal };
  });

  if (!(totalLandingCosts > 0)) {
    for (const entry of normalized) {
      allocations.set(entry.line.productId, entry.unitCost);
    }
    return allocations;
  }

  const totalProducts = roundMoney(
    normalized.reduce((sum, entry) => sum + entry.lineTotal, 0),
  );
  if (totalProducts <= 0) {
    for (const entry of normalized) {
      allocations.set(entry.line.productId, entry.unitCost);
    }
    return allocations;
  }

  let allocatedFreight = 0;
  normalized.forEach((entry, index) => {
    const isLast = index === normalized.length - 1;
    const freightShare = isLast
      ? roundMoney(totalLandingCosts - allocatedFreight)
      : roundMoney((entry.lineTotal / totalProducts) * totalLandingCosts);
    allocatedFreight = roundMoney(allocatedFreight + freightShare);
    const freightPerUnit = entry.qty > 0 ? roundMoney(freightShare / entry.qty) : 0;
    allocations.set(entry.line.productId, roundMoney(entry.unitCost + freightPerUnit));
  });
  return allocations;
}

async function loadPostedJournalSignature(client, journalEntryId) {
  const res = await client.query(
    `SELECT coa.code, jel.debit_amount, jel.credit_amount
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE jel.journal_entry_id = $1`,
    [journalEntryId],
  );
  const lines = (res.rows || []).map((r) => ({
    accountCode: r.code,
    debit: r.debit_amount,
    credit: r.credit_amount,
  }));
  return journalSignature(lines);
}

/**
 * Audit-safe reverse: post a balancing opposite journal and mark the original [REVERSED].
 * Does not hard-delete the original entry (fiscal/audit trail).
 */
async function reverseJournalEntry(client, journalEntryId, opts = {}) {
  const id = String(journalEntryId || '').trim();
  if (!id) return null;

  const entryRes = await client.query('SELECT * FROM journal_entries WHERE id = $1 LIMIT 1', [id]);
  const entry = entryRes.rows[0];
  if (!entry) return null;
  if (String(entry.description || '').includes('[REVERSED]')) {
    return { alreadyReversed: true, id };
  }
  if (String(entry.reference_type || '') === 'journal_reversal') {
    throw new Error('Cannot reverse a reversal journal entry');
  }

  const linesResult = await client.query(
    `SELECT jel.debit_amount, jel.credit_amount, coa.code AS account_code
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE jel.journal_entry_id = $1`,
    [id],
  );
  const reverseLines = (linesResult.rows || [])
    .filter((l) => (Number(l.debit_amount) || 0) > 0 || (Number(l.credit_amount) || 0) > 0)
    .map((l) => ({
      accountCode: l.account_code,
      description: `Reversão ${entry.entry_number || id}`,
      debit: Number(l.credit_amount) || 0,
      credit: Number(l.debit_amount) || 0,
    }));
  if (reverseLines.length === 0) {
    throw new Error('Journal entry has no lines to reverse');
  }

  const { createJournalEntry } = require('../accounting');
  const reverseEntry = await createJournalEntry(client, {
    description: `Reversão: ${entry.description || entry.entry_number || id}`,
    referenceType: 'journal_reversal',
    referenceId: id,
    branchId: entry.branch_id || opts.branchId || null,
    createdBy: opts.createdBy || entry.created_by || null,
    entryDate: opts.entryDate || entry.entry_date || new Date().toISOString().slice(0, 10),
    lines: reverseLines,
  });

  await client.query(
    `UPDATE journal_entries
     SET description = CASE
       WHEN COALESCE(description, '') LIKE '%[REVERSED]%' THEN description
       ELSE trim(COALESCE(description, '') || ' [REVERSED]')
     END,
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id],
  );

  return reverseEntry;
}

function normalizePurchaseLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    ...line,
    productId: String(line.productId || line.product_id || '').trim(),
    productCode: line.productCode || line.product_code || '',
    description: line.description || '',
    totalQty: Number(line.totalQty ?? line.total_qty ?? line.quantity ?? 0),
    quantity: Number(line.quantity ?? line.totalQty ?? line.total_qty ?? 0),
    unitPrice: Number(line.unitPrice ?? line.unit_price ?? 0),
    price1: line.price1 ?? line.price_1,
    total: Number(line.total ?? 0),
  }));
}

function purchaseInvoiceHasStockLines(lines) {
  return normalizePurchaseLines(lines).some(
    (l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0,
  );
}

async function resolveWarehouseForInvoice(client, inv) {
  const raw = String(inv.warehouseId || inv.branchId || inv.branch_id || '').trim();
  if (!raw) return null;
  const row = await resolveBranchRow(client, raw);
  if (row?.id) return String(row.id);
  const { resolveWarehouseId } = require('../transactionEngine');
  const viaEngine = await resolveWarehouseId(client, raw);
  if (viaEngine) return viaEngine;
  return resolveBranchFilterId(client, raw);
}

async function queryPostingStatus(client, invoiceId) {
  const stock = await client.query(
    `SELECT id FROM stock_movements
     WHERE reference_id = $1
       AND reference_type IN ('purchase_invoice', 'purchase')
     ORDER BY created_at`,
    [invoiceId],
  );
  const openItem = await client.query(
    `SELECT id FROM open_items
     WHERE document_id = $1 AND entity_type = 'supplier'
     LIMIT 1`,
    [invoiceId],
  );
  const journal = await client.query(
    `SELECT id FROM journal_entries
     WHERE reference_id = $1
       AND COALESCE(reference_type, '') <> 'journal_reversal'
       AND COALESCE(description, '') NOT LIKE '%[REVERSED]%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [invoiceId],
  );
  return {
    stockMovementIds: stock.rows.map((r) => r.id),
    openItemId: openItem.rows[0]?.id || null,
    journalEntryId: journal.rows[0]?.id || null,
  };
}

/**
 * Run work inside a SAVEPOINT so SQL errors do not abort the outer transaction.
 * Critical on PostgreSQL: one failed INSERT aborts the whole txn until ROLLBACK.
 */
async function withSavepoint(client, name, work) {
  const sp = String(name || 'sp').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const value = await work();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, value };
  } catch (err) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (rollbackErr) {
      throw err;
    }
    return { ok: false, error: err };
  }
}

async function ensureSupplierJournalAccounts(client, journalLines, inv) {
  const supplierLines = (journalLines || []).filter((line) =>
    /^321\d+$/i.test(String(line.accountCode || line.account_code || '').trim()),
  );
  if (!supplierLines.length) return;

  const parent = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '321' AND is_active = true LIMIT 1`,
  );
  if (!parent.rows[0]) {
    throw new Error('Conta 321 não encontrada para lançar fornecedor');
  }
  const parentId = parent.rows[0].id;
  const { randomUUID } = require('crypto');

  for (const line of supplierLines) {
    const code = String(line.accountCode || line.account_code || '').trim();
    const existing = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [code],
    );
    if (existing.rows[0]) continue;
    const supplierName =
      String(line.accountName || line.account_name || '').trim()
      || String(inv.supplierName || inv.supplier_name || '').trim()
      || `Fornecedor ${code}`;
    const supplierNif = String(inv.supplierNif || inv.supplier_nif || '').trim();
    await client.query(
      `INSERT INTO chart_of_accounts
       (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
       VALUES ($1, $2, $3, $4, 'liability', 'credit', $5, 3, false, true, 0, 0)
       ON CONFLICT (code) DO NOTHING`,
      [randomUUID(), code, supplierName, supplierNif ? `NIF: ${supplierNif}` : '', parentId],
    );
  }
}

async function resolveLinkedPurchaseOrderStock(client, inv) {
  const orderNo = String(inv.orderNo || inv.order_no || '').trim();
  if (!orderNo) return { skipStock: false, skipPurchaseJournal: false, warning: null };
  const poRes = await client.query(
    `SELECT id, order_number, status FROM purchase_orders
     WHERE LOWER(TRIM(COALESCE(order_number, ''))) = LOWER($1)
     LIMIT 1`,
    [orderNo],
  );
  const po = poRes.rows[0];
  if (!po) return { skipStock: false, skipPurchaseJournal: false, warning: null };

  const mov = await client.query(
    `SELECT id FROM stock_movements
     WHERE reference_type = 'purchase'
       AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [po.id],
  );
  if (!mov.rows.length) {
    return { skipStock: false, skipPurchaseJournal: false, warning: null, poId: po.id };
  }

  const je = await client.query(
    `SELECT id FROM journal_entries
     WHERE reference_type = 'purchase'
       AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [po.id],
  );

  return {
    skipStock: true,
    skipPurchaseJournal: je.rows.length > 0,
    poId: po.id,
    warning:
      `Stock/GL já lançados na recepção da OC ${po.order_number}. FC cria apenas conta a pagar (sem novo stock).`,
  };
}

/**
 * Post stock, payable, then journal. Returns detailed status for UI.
 * @param {object} [opts]
 * @param {{ landingCosts?: number, caixaId?: string|null, paymentSource?: string }} [opts.priorFreightState]
 */
async function postPurchaseInvoiceAccountingPhased(client, invInput, opts = {}) {
  const inv = invInput?.invoiceNumber != null ? invInput : fromRow(invInput);
  const result = {
    success: false,
    stockMovementIds: [],
    openItemId: null,
    journalEntryId: null,
    errors: [],
    warnings: [],
  };

  const status = String(inv.status || 'confirmed').toLowerCase();
  if (['cancelled', 'voided', 'draft'].includes(status)) {
    result.warnings.push('Invoice status skips accounting');
    return result;
  }

  const lines = normalizePurchaseLines(inv.lines);
  if (!purchaseInvoiceHasStockLines(lines)) {
    result.errors.push('No product lines with quantity — stock not posted');
    return result;
  }

  const warehouseId = await resolveWarehouseForInvoice(client, inv);
  if (!warehouseId) {
    result.errors.push(
      `Invalid warehouse/branch: ${inv.warehouseId || inv.branchId || '(empty)'}`,
    );
    return result;
  }

  const existing = await queryPostingStatus(client, inv.id);
  result.stockMovementIds = [...existing.stockMovementIds];
  result.openItemId = existing.openItemId;
  result.journalEntryId = existing.journalEntryId;

  const linkedPo = await resolveLinkedPurchaseOrderStock(client, inv);
  if (linkedPo.warning) result.warnings.push(linkedPo.warning);

  if (!result.stockMovementIds.length && !linkedPo.skipStock) {
    const landing = landingCostsFromInvoice(inv);
    const landedByProduct = buildLandedUnitCosts(lines, landing);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.productId || Number(line.totalQty || line.quantity || 0) <= 0) continue;
      const qty = Number(line.totalQty || line.quantity || 0);
      const unitCost = Number(
        landedByProduct.get(line.productId) ?? line.unitPrice ?? 0,
      );
      const stockSp = await withSavepoint(client, `pi_stock_${i}`, async () => {
        const movement = await recordStockMovement(client, {
          productId: line.productId,
          warehouseId,
          movementType: 'IN',
          quantity: qty,
          unitCost,
          referenceType: 'purchase_invoice',
          referenceId: inv.id,
          referenceNumber: inv.invoiceNumber,
          notes: `Fatura de Compra ${inv.invoiceNumber} — ${inv.supplierName || ''}`.trim(),
          createdBy: inv.createdBy || inv.created_by || null,
        });
        if (unitCost > 0) {
          const resolvedId = movement.product_id || line.productId;
          await applyWeightedAverageCostAfterIn(client, resolvedId, qty, unitCost);
        }
        return movement;
      });
      if (stockSp.ok && stockSp.value?.id) {
        result.stockMovementIds.push(stockSp.value.id);
      } else {
        result.errors.push(
          `Stock ${line.productCode || line.productId}: ${stockSp.error?.message || String(stockSp.error)}`,
        );
      }
    }
  }

  if (!result.openItemId) {
    const payableSp = await withSavepoint(client, 'pi_payable', async () => {
      const repaired = await ensurePurchaseInvoicePayable(client, inv);
      if (repaired?.openItemId) return repaired.openItemId;

      if (!(inv.supplierId || inv.supplier_id)) {
        throw new Error(
          `invoice has no supplier_id (supplier "${inv.supplierName || inv.supplier_name || '?'}" not linked)`,
        );
      }

      const supplierId = String(inv.supplierId || inv.supplier_id).trim();
      const docDate = normalizeSqlDate(inv.date, { allowNull: false });
      const dueDate = normalizeSqlDate(inv.paymentDate || inv.payment_date);
      const oi = await createOpenItem(client, {
        entityType: 'supplier',
        entityId: supplierId,
        documentType: 'invoice',
        documentId: String(inv.id),
        documentNumber: String(inv.invoiceNumber || inv.id),
        documentDate: docDate,
        dueDate,
        originalAmount: Number(inv.total || 0),
        isDebit: true,
        branchId: warehouseId,
        currency: inv.currency === 'KZ' ? 'AOA' : (inv.currency || 'AOA'),
      });
      await syncSupplierBalanceFromOpenItems(client, supplierId);
      return oi.id;
    });

    if (payableSp.ok && payableSp.value) {
      result.openItemId = payableSp.value;
    } else {
      result.errors.push(`Payable: ${payableSp.error?.message || String(payableSp.error)}`);
    }
  }

  // Server-authoritative journal: ignore FE journalLines (tamper / drift risk).
  let journalLines = [];
  const landing = landingCostsFromInvoice(inv);

  if (linkedPo.skipPurchaseJournal) {
    result.warnings.push(
      'Journal de mercadorias já lançado na OC — FC não duplica diário (AP open item apenas).',
    );
  } else if (!result.journalEntryId && Number(inv.total || 0) > 0) {
    try {
      const { resolveEntityAccountCode } = require('./entityCoaAccounts');
      const supplierId = String(inv.supplierId || inv.supplier_id || '').trim();
      const supplierName = String(inv.supplierName || inv.supplier_name || '').trim();
      const supplierCode = await resolveEntityAccountCode(
        client,
        'supplier',
        supplierId || null,
        supplierName,
      );
      const totalAmt = roundMoney(Number(inv.total || 0));
      const taxAmt = roundMoney(Number(inv.taxAmount ?? inv.tax_amount ?? 0));
      const goodsAmt = roundMoney(Math.max(0, totalAmt - taxAmt));
      if (goodsAmt > 0) {
        journalLines.push({
          accountCode: '212',
          debit: goodsAmt,
          credit: 0,
          description: `Mercadorias ${inv.invoiceNumber || ''}`.trim(),
        });
      }
      if (taxAmt > 0) {
        journalLines.push({
          accountCode: '3451',
          debit: taxAmt,
          credit: 0,
          description: `IVA dedutível ${inv.invoiceNumber || ''}`.trim(),
        });
      }
      journalLines.push({
        accountCode: supplierCode,
        debit: 0,
        credit: totalAmt,
        description: supplierName || 'Fornecedor',
      });
      result.warnings.push('Journal: built server-side from invoice totals');
    } catch (autoErr) {
      result.warnings.push(`Journal auto-build failed: ${autoErr.message}`);
    }
  }

  if (journalLines.length === 0 && landing > 0 && !linkedPo.skipPurchaseJournal) {
    result.errors.push('Journal: freight entered but invoice has no journal lines');
  } else if (journalLines.length === 0 && !result.journalEntryId && Number(inv.total || 0) > 0 && !linkedPo.skipPurchaseJournal) {
    result.warnings.push('Journal: invoice has no journal lines — nothing posted to chart of accounts');
  } else if (journalLines.length > 0) {
    const treasury = await resolveFreightTreasuryGl(client, inv);
    journalLines = applyFreightTreasuryToJournalLines(journalLines, treasury);

    const expectedSig = journalSignature(journalLines);
    let needsReplace = false;
    if (result.journalEntryId) {
      const postedSig = await loadPostedJournalSignature(client, result.journalEntryId);
      needsReplace = postedSig !== expectedSig;
    }

    const shouldPostJournal = !result.journalEntryId || needsReplace;
    if (shouldPostJournal) {
      const priorFreight = opts.priorFreightState || {
        landingCosts: 0,
        caixaId: null,
        paymentSource: 'caixa',
      };
      const journalSp = await withSavepoint(client, 'pi_journal', async () => {
        if (needsReplace && result.journalEntryId) {
          await reverseJournalEntry(client, result.journalEntryId);
          result.journalEntryId = null;
        }
        await ensureSupplierJournalAccounts(client, journalLines, inv);
        const entry = await createJournalEntry(client, {
          description: `Fatura de Compra ${inv.invoiceNumber} — ${inv.supplierName || ''}`.trim(),
          referenceType: 'purchase_invoice',
          referenceId: inv.id,
          branchId: warehouseId,
          createdBy: inv.createdBy || inv.created_by || null,
          entryDate: normalizeSqlDate(inv.date, { allowNull: false }),
          lines: journalLines.map((l) => ({
            accountCode: l.accountCode || l.account_code,
            description: l.note || l.description || inv.invoiceNumber,
            debit: Number(l.debit || 0),
            credit: Number(l.credit || 0),
          })),
        });
        await syncFreightCaixaRegister(client, inv, priorFreight);
        return entry.id;
      });
      if (journalSp.ok && journalSp.value) {
        result.journalEntryId = journalSp.value;
      } else {
        result.errors.push(`Journal: ${journalSp.error?.message || String(journalSp.error)}`);
      }
    }
  }

  const journalRequired = landing > 0 || journalLines.length > 0;

  if (result.stockMovementIds.length > 0) {
    const linkSp = await withSavepoint(client, 'pi_supplier_link', async () => {
      const productIds = lines.map((l) => l.productId).filter(Boolean);
      const skuKeys = lines.map((l) => l.productCode).filter(Boolean);
      if (inv.supplierId || inv.supplier_id) {
        await applyPurchaseSupplierToProducts(client, {
          supplierId: inv.supplierId || inv.supplier_id,
          supplierName: inv.supplierName || inv.supplier_name,
          productIds,
          skuKeys,
        });
      }
    });
    if (!linkSp.ok) {
      result.warnings.push(`Supplier-product link: ${linkSp.error?.message || String(linkSp.error)}`);
    }

    const filialSp = await withSavepoint(client, 'pi_filial_stock', async () => {
      const { ensureFilialProductsForWarehouse } = require('./filialStockRepair');
      await ensureFilialProductsForWarehouse(warehouseId, client);
    });
    if (!filialSp.ok) {
      result.warnings.push(`Filial stock repair: ${filialSp.error?.message || String(filialSp.error)}`);
    }
  }

  const confirmed = await queryPostingStatus(client, inv.id);
  result.stockMovementIds = confirmed.stockMovementIds;
  result.openItemId = confirmed.openItemId;
  result.journalEntryId = confirmed.journalEntryId || result.journalEntryId;
  if (journalRequired && !result.journalEntryId) {
    result.success = false;
  } else {
    result.success = result.stockMovementIds.length > 0 && !!result.openItemId;
  }

  try {
    await auditLog(client, {
      tableName: 'purchase_invoices',
      recordId: String(inv.id),
      action: 'post',
      userId: inv.createdBy || inv.created_by || null,
      branchId: warehouseId,
      newValues: {
        invoiceNumber: inv.invoiceNumber || inv.invoice_number,
        supplierName: inv.supplierName || inv.supplier_name,
        total: Number(inv.total || 0),
        stockMovements: result.stockMovementIds.length,
        openItemId: result.openItemId,
        journalEntryId: result.journalEntryId,
        success: result.success,
      },
      description: `FC ${inv.invoiceNumber || inv.invoice_number || inv.id} posted — stock=${result.stockMovementIds.length} payable=${result.openItemId ? 'ok' : 'no'} journal=${result.journalEntryId ? 'ok' : 'no'}`,
    });
  } catch (auditErr) {
    console.warn('[PURCHASE POST] audit skipped:', auditErr.message);
  }

  return result;
}

module.exports = {
  normalizePurchaseLines,
  purchaseInvoiceHasStockLines,
  resolveWarehouseForInvoice,
  queryPostingStatus,
  reverseJournalEntry,
  postPurchaseInvoiceAccountingPhased,
  withSavepoint,
};
