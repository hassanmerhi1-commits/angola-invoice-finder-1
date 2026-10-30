/**
 * Purchase-invoice posting: stock, payable, and journal are one accounting unit.
 *
 * Contract: required stock + AP + GL either all persist or none do. They run
 * inside a single SAVEPOINT (`pi_accounting`) so a journal failure rolls back
 * stock and AP without a nested COMMIT. The invoice header (outer transaction)
 * is left to the caller. success=false and errors[] are returned; the function
 * does not throw on a posting failure.
 *
 * Optional supplier-product / filial repairs stay outside that savepoint.
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
     END
     WHERE id = $1`,
    [id],
  );

  // Best-effort touch of updated_at when the column exists (Postgres / newer SQLite).
  try {
    await client.query(
      `UPDATE journal_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
  } catch (err) {
    if (!/no such column:\s*updated_at/i.test(String(err?.message || ''))) {
      throw err;
    }
  }

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

/**
 * The 321 code can arrive from the client, so it may point at a completely
 * different supplier's ledger. Re-resolve it from the invoice's own supplier and
 * override any code whose account name belongs to somebody else.
 */
async function alignSupplierJournalAccount(client, journalLines, inv, warnings = []) {
  const { alignEntityJournalAccounts } = require('./entityJournalGuard');
  await alignEntityJournalAccounts(
    client,
    journalLines,
    {
      entityType: 'supplier',
      entityId: String(inv.supplierId || inv.supplier_id || '').trim(),
      entityName: String(inv.supplierName || inv.supplier_name || '').trim(),
    },
    warnings,
  );
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

function truthyReceiptFlag(value) {
  return value === true || value === 1 || value === '1';
}

function requestedExplicitNewReceipt(inv, opts = {}) {
  return truthyReceiptFlag(inv?.allowNewReceipt)
    || truthyReceiptFlag(inv?.forceNewReceipt)
    || truthyReceiptFlag(inv?.allow_new_receipt)
    || truthyReceiptFlag(opts?.allowNewReceipt)
    || truthyReceiptFlag(opts?.forceNewReceipt);
}

/** Server-side gate: a client boolean alone is never enough. */
function canHonorExplicitNewReceipt(inv, lines = [], opts = {}) {
  if (!requestedExplicitNewReceipt(inv, opts)) {
    return { ok: false, reason: 'not_requested' };
  }
  if (opts.canAuthorizeNewReceipt !== true) {
    return { ok: false, reason: 'not_authorized' };
  }
  const supplierId = String(inv?.supplierId || inv?.supplier_id || '').trim();
  if (!supplierId) return { ok: false, reason: 'no_supplier' };
  const warehouseId = String(inv?.warehouseId || inv?.branchId || inv?.branch_id || '').trim();
  if (!warehouseId) return { ok: false, reason: 'no_branch' };
  if (invoiceProductIds(lines).length === 0) return { ok: false, reason: 'no_products' };
  const hasQty = (lines || []).some((l) => Number(l.totalQty || l.quantity || 0) > 0);
  if (!hasQty) return { ok: false, reason: 'no_qty' };
  return { ok: true };
}

function invoiceProductIds(lines) {
  return [...new Set((lines || []).map((l) => String(l.productId || l.product_id || '').trim()).filter(Boolean))];
}

function branchKeysEqual(a, b) {
  const left = String(a || '').replace(/-/g, '').toLowerCase();
  const right = String(b || '').replace(/-/g, '').toLowerCase();
  return Boolean(left && right && left === right);
}

async function purchaseOrderHasReceiveStock(client, orderId) {
  const mov = await client.query(
    `SELECT id FROM stock_movements
     WHERE reference_type = 'purchase'
       AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [orderId],
  );
  return mov.rows.length > 0;
}

async function purchaseOrderHasPurchaseJournal(client, orderId) {
  const je = await client.query(
    `SELECT id FROM journal_entries
     WHERE reference_type = 'purchase'
       AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [orderId],
  );
  return je.rows.length > 0;
}

async function purchaseOrderAlreadyInvoiced(client, orderNumber, currentInvoiceId) {
  const no = String(orderNumber || '').trim();
  if (!no) return false;
  const linked = await client.query(
    `SELECT id FROM purchase_invoices
     WHERE LOWER(TRIM(COALESCE(order_no, ''))) = LOWER($1)
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'voided', 'draft')
       AND CAST(id AS TEXT) <> CAST($2 AS TEXT)
     LIMIT 1`,
    [no, String(currentInvoiceId || '')],
  );
  return linked.rows.length > 0;
}

async function linkReceivedOrder(client, po) {
  const hasJournal = await purchaseOrderHasPurchaseJournal(client, po.id);
  return {
    skipStock: true,
    skipPurchaseJournal: hasJournal,
    poId: po.id,
    warning:
      `Stock/GL já lançados na recepção da OC ${po.order_number}. FC cria apenas conta a pagar (sem novo stock).`,
  };
}

async function findCandidateReceivedOrders(client, inv, lines) {
  const supplierId = String(inv.supplierId || inv.supplier_id || '').trim();
  if (!supplierId) return [];
  const productIds = invoiceProductIds(lines);
  if (productIds.length === 0) return [];
  const warehouseId = String(inv.warehouseId || inv.branchId || inv.branch_id || '').trim();

  const pos = await client.query(
    `SELECT id, order_number, supplier_id, branch_id, status
     FROM purchase_orders
     WHERE CAST(supplier_id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'voided', 'draft')
     ORDER BY created_at ASC`,
    [supplierId],
  );

  const candidates = [];
  for (const po of pos.rows || []) {
    if (warehouseId && po.branch_id && !branchKeysEqual(po.branch_id, warehouseId)) {
      continue;
    }
    if (await purchaseOrderAlreadyInvoiced(client, po.order_number, inv.id)) {
      continue;
    }
    if (!(await purchaseOrderHasReceiveStock(client, po.id))) {
      continue;
    }
    const items = await client.query(
      `SELECT product_id FROM purchase_order_items WHERE order_id = $1`,
      [po.id],
    );
    const overlap = (items.rows || []).some((row) => (
      productIds.includes(String(row.product_id || '').trim())
    ));
    if (!overlap) continue;
    candidates.push(po);
  }
  return candidates;
}

/**
 * Decide whether this FC should add stock / a purchase journal.
 * Exact order_no is preferred. If it is blank or unknown, an uninvoiced
 * received PO for the same supplier + product is linked instead of posting
 * a second receipt. Ambiguous matches are rejected unless allowNewReceipt.
 */
async function resolveLinkedPurchaseOrderStock(client, inv, lines = [], opts = {}) {
  const orderNo = String(inv.orderNo || inv.order_no || '').trim();
  if (orderNo) {
    const poRes = await client.query(
      `SELECT id, order_number, status FROM purchase_orders
       WHERE LOWER(TRIM(COALESCE(order_number, ''))) = LOWER($1)
       LIMIT 1`,
      [orderNo],
    );
    const po = poRes.rows[0];
    if (po) {
      if (!(await purchaseOrderHasReceiveStock(client, po.id))) {
        return { skipStock: false, skipPurchaseJournal: false, warning: null, poId: po.id };
      }
      return linkReceivedOrder(client, po);
    }
  }

  const candidates = await findCandidateReceivedOrders(client, inv, lines);
  const honor = canHonorExplicitNewReceipt(inv, lines, opts);
  if (honor.ok && candidates.length >= 1) {
    return {
      skipStock: false,
      skipPurchaseJournal: false,
      warning: 'Nova entrada de stock pedida explicitamente (allowNewReceipt).',
    };
  }

  if (candidates.length === 0) {
    return { skipStock: false, skipPurchaseJournal: false, warning: null };
  }
  if (candidates.length === 1) {
    const linked = await linkReceivedOrder(client, candidates[0]);
    linked.warning =
      `Stock/GL já lançados na recepção da OC ${candidates[0].order_number} `
      + '(associada por fornecedor/produto). FC cria apenas conta a pagar.';
    return linked;
  }

  const numbers = candidates.map((po) => po.order_number).filter(Boolean).join(', ');
  return {
    skipStock: true,
    skipPurchaseJournal: true,
    error:
      `Várias OC já recebidas para este fornecedor/produto (${numbers}). `
      + 'Indique o número da OC na fatura ou confirme allowNewReceipt para uma nova entrada.',
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

  if (inv.id) {
    await client.query(
      'SELECT id FROM purchase_invoices WHERE CAST(id AS TEXT) = CAST($1 AS TEXT) FOR UPDATE',
      [inv.id],
    );
  }

  const existing = await queryPostingStatus(client, inv.id);
  result.stockMovementIds = [...existing.stockMovementIds];
  result.openItemId = existing.openItemId;
  result.journalEntryId = existing.journalEntryId;

  const linkedPo = await resolveLinkedPurchaseOrderStock(client, inv, lines, opts);
  if (linkedPo.warning) result.warnings.push(linkedPo.warning);
  if (linkedPo.error) {
    result.errors.push(linkedPo.error);
    result.success = false;
    return result;
  }

  const accountingSp = await withSavepoint(client, 'pi_accounting', async () => {
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
        const resolvedId = movement.product_id || line.productId;
        if (unitCost > 0) {
          await applyWeightedAverageCostAfterIn(client, resolvedId, qty, unitCost);
        }
        // Fill the product master IVA from the purchase line when the product is still on the
        // legacy 5% default (0/7/14 typed on the invoice), never the other way round.
        const lineIva = Number(line.ivaRate ?? line.taxRate ?? line.iva_rate);
        if (resolvedId && Number.isFinite(lineIva) && lineIva >= 0) {
          try {
            const {
              taxCodeForRate,
              shouldPreserveExistingTaxRate,
              isAllowedVatRate,
            } = require('../taxDefaults');
            if (isAllowedVatRate(lineIva)) {
              const curRes = await client.query(
                `SELECT tax_rate, vat_override FROM products WHERE id = $1`,
                [resolvedId],
              );
              const cur = curRes.rows?.[0];
              // No acknowledgement flags here: a purchase line may FILL a missing / legacy 5%
              // default, but it must never overwrite an IVA someone deliberately set on the
              // product (that is what made rates change by themselves after a purchase).
              if (cur && !shouldPreserveExistingTaxRate(cur, lineIva)) {
                await client.query(
                  `UPDATE products SET tax_rate = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                  [lineIva, resolvedId],
                );
                try {
                  await client.query(
                    `UPDATE products SET tax_code = $1 WHERE id = $2`,
                    [taxCodeForRate(lineIva), resolvedId],
                  );
                } catch (_) { /* tax_code optional */ }
                // Do NOT set vat_override here. A purchase line is not the user saying "this
                // branch keeps its own IVA forever" — auto-locking every non-default rate made
                // later HQ IVA changes silently skip the row, so branches stayed on the old
                // rate with no way to fix them from the product form.
              }
            }
          } catch (taxErr) {
            result.warnings.push(
              `IVA sync ${line.productCode || resolvedId}: ${taxErr?.message || String(taxErr)}`,
            );
          }
        }
        return movement;
      });
      if (stockSp.ok && stockSp.value?.id) {
        result.stockMovementIds.push(stockSp.value.id);
      } else {
        throw new Error(
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
      throw new Error(`Payable: ${payableSp.error?.message || String(payableSp.error)}`);
    }
  }

  // Server-authoritative journal: ignore FE journalLines (tamper / drift risk).
  let journalLines = [];
  const landing = landingCostsFromInvoice(inv);

  if (linkedPo.skipPurchaseJournal) {
    result.warnings.push(
      'Journal de mercadorias já lançado na OC — FC não duplica diário (AP open item apenas).',
    );
    try {
      const { remapJournalParentSupplierLines } = require('./repairParentEntityCoa');
      const supplierId = String(inv.supplierId || inv.supplier_id || '').trim();
      const supplierName = String(inv.supplierName || inv.supplier_name || '').trim();
      const moved = await remapJournalParentSupplierLines(
        client,
        linkedPo.poId,
        'purchase',
        supplierId || null,
        supplierName,
      );
      if (moved > 0) {
        result.warnings.push(`Journal OC: ${moved} linha(s) 321 movidas para a conta do fornecedor.`);
      }
    } catch (remapErr) {
      result.warnings.push(`Journal OC remap: ${remapErr.message}`);
    }
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
      throw new Error(`Journal auto-build failed: ${autoErr.message}`);
    }
  }

  if (journalLines.length === 0 && landing > 0 && !linkedPo.skipPurchaseJournal) {
    throw new Error('Journal: freight entered but invoice has no journal lines');
  } else if (journalLines.length === 0 && !result.journalEntryId && Number(inv.total || 0) > 0 && !linkedPo.skipPurchaseJournal) {
    throw new Error('Journal: invoice has no journal lines — nothing posted to chart of accounts');
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
        await alignSupplierJournalAccount(client, journalLines, inv, result.warnings);
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
        throw new Error(`Journal: ${journalSp.error?.message || String(journalSp.error)}`);
      }
    }
  }

  const journalRequired = landing > 0 || journalLines.length > 0;
  if (journalRequired && !result.journalEntryId && !linkedPo.skipPurchaseJournal) {
    throw new Error('Journal posting failed');
  }
  return { journalRequired };
  });

  if (!accountingSp.ok) {
    result.errors.push(accountingSp.error?.message || String(accountingSp.error));
    result.stockMovementIds = [];
    result.openItemId = null;
    result.journalEntryId = null;
    result.success = false;
    const rolledBack = await queryPostingStatus(client, inv.id);
    result.stockMovementIds = rolledBack.stockMovementIds;
    result.openItemId = rolledBack.openItemId;
    result.journalEntryId = rolledBack.journalEntryId;
    result.success = false;
    return result;
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

  const confirmed = await queryPostingStatus(client, inv.id);
  result.stockMovementIds = confirmed.stockMovementIds;
  result.openItemId = confirmed.openItemId;
  result.journalEntryId = confirmed.journalEntryId || result.journalEntryId;
  const journalRequired = Boolean(accountingSp.value?.journalRequired);
  if (journalRequired && !result.journalEntryId && !linkedPo.skipPurchaseJournal) {
    result.success = false;
  } else if (linkedPo.skipStock) {
    result.success = Boolean(result.openItemId);
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

/**
 * Purchases dated today were journaled as yesterday: the DATE came back as
 * local midnight and was saved with UTC fields. Move those journals onto the
 * invoice day. A real backdate (journal day equals the invoice day) is left.
 */
async function repairShiftedPurchaseJournalDates(db) {
  if (!db || db.engine !== 'postgres') return { updated: 0 };
  const headers = await db.query(`
    UPDATE journal_entries je
    SET entry_date = pi.date::date
    FROM purchase_invoices pi
    WHERE je.reference_type = 'purchase_invoice'
      AND CAST(je.reference_id AS TEXT) = CAST(pi.id AS TEXT)
      AND pi.date IS NOT NULL
      AND je.entry_date IS NOT NULL
      AND je.entry_date::date = (pi.date::date - 1)
    RETURNING je.id
  `);
  const updated = headers.rows?.length || 0;
  if (updated > 0) {
    try {
      await db.query(`
        UPDATE journal_entry_lines jel
        SET entry_date = je.entry_date
        FROM journal_entries je
        WHERE jel.journal_entry_id = je.id
          AND je.reference_type = 'purchase_invoice'
          AND jel.entry_date IS NOT NULL
          AND je.entry_date IS NOT NULL
          AND jel.entry_date::date = (je.entry_date::date - 1)
      `);
    } catch (lineErr) {
      if (!/entry_date|42703/i.test(String(lineErr.message || lineErr))) throw lineErr;
    }
  }
  return { updated };
}

module.exports = {
  normalizePurchaseLines,
  purchaseInvoiceHasStockLines,
  resolveWarehouseForInvoice,
  queryPostingStatus,
  reverseJournalEntry,
  postPurchaseInvoiceAccountingPhased,
  repairShiftedPurchaseJournalDates,
  resolveLinkedPurchaseOrderStock,
  requestedExplicitNewReceipt,
  canHonorExplicitNewReceipt,
  withSavepoint,
};
