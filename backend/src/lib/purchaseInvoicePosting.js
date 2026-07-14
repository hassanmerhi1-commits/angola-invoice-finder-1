/**
 * Reliable purchase-invoice posting: stock + payable first, journal last.
 * Each phase uses a SAVEPOINT so a payable/journal SQL error cannot abort
 * the transaction and silently roll back stock that already posted.
 */
const { fromRow } = require('../purchaseInvoiceMappers');
const {
  recordStockMovement,
  applyPurchaseSupplierToProducts,
  createOpenItem,
  syncSupplierBalanceFromOpenItems,
  auditLog,
} = require('../transactionEngine');
const { createJournalEntry } = require('../accounting');
const { ensurePurchaseInvoicePayable } = require('../supplierBalanceRepair');
const { normalizeSqlDate } = require('./dateSql');
const { resolveBranchFilterId, resolveBranchRow } = require('./branchIdMatch');
const db = require('../db');

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
    `SELECT id FROM journal_entries WHERE reference_id = $1 LIMIT 1`,
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

/**
 * Post stock, payable, then journal (best-effort). Returns detailed status for UI.
 */
async function postPurchaseInvoiceAccountingPhased(client, invInput) {
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

  if (!result.stockMovementIds.length) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.productId || Number(line.totalQty || line.quantity || 0) <= 0) continue;
      const stockSp = await withSavepoint(client, `pi_stock_${i}`, async () =>
        recordStockMovement(client, {
          productId: line.productId,
          warehouseId,
          movementType: 'IN',
          quantity: Number(line.totalQty || line.quantity || 0),
          unitCost: Number(line.unitPrice || 0),
          referenceType: 'purchase_invoice',
          referenceId: inv.id,
          referenceNumber: inv.invoiceNumber,
          notes: `Fatura de Compra ${inv.invoiceNumber} — ${inv.supplierName || ''}`.trim(),
          createdBy: inv.createdBy || inv.created_by || null,
        }),
      );
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

  const journalLines = Array.isArray(inv.journalLines) ? inv.journalLines : [];
  if (journalLines.length === 0 && !result.journalEntryId && Number(inv.total || 0) > 0) {
    result.warnings.push('Journal: invoice has no journal lines — nothing posted to chart of accounts');
  }
  if (journalLines.length > 0 && !result.journalEntryId) {
    const journalSp = await withSavepoint(client, 'pi_journal', async () => {
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
      return entry.id;
    });
    if (journalSp.ok && journalSp.value) {
      result.journalEntryId = journalSp.value;
    } else {
      result.warnings.push(`Journal: ${journalSp.error?.message || String(journalSp.error)}`);
    }
  }

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

  // Re-read from DB so callers never trust in-memory IDs that might not have committed.
  const confirmed = await queryPostingStatus(client, inv.id);
  result.stockMovementIds = confirmed.stockMovementIds;
  result.openItemId = confirmed.openItemId;
  result.journalEntryId = confirmed.journalEntryId;
  result.success = result.stockMovementIds.length > 0 && !!result.openItemId;

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
  postPurchaseInvoiceAccountingPhased,
  withSavepoint,
};
