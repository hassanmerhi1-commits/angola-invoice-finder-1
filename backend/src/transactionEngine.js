/**
 * CENTRAL TRANSACTION ENGINE — Single Source of Truth
 * 
 * ALL business operations flow through this engine.
 * NO direct DB writes outside this file for financial/stock operations.
 * 
 * Rules enforced:
 *   1. Single source of truth (all writes here)
 *   2. UUID for all primary keys (crypto.randomUUID)
 *   3. BEGIN/COMMIT/ROLLBACK on every operation
 *   4. Strict stock validation (no negatives, FOR UPDATE locks)
 *   5. Centralized document numbering (document_sequences + FOR UPDATE)
 *   6. Every financial tx creates balanced journal entries
 *   7. Relational integrity (sale → items → stock → accounting → audit)
 *   8. Explicit errors (no silent failures)
 *   9. No duplication — this is the ONLY execution layer
 *  10. Validation before any DB operation
 */
const db = require('./db');
const { createJournalEntry, generateSequenceNumber, findAccountByCode } = require('./accounting');
const { randomUUID } = require('crypto');

// ==================== HELPERS ====================

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeUuid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isUuid(trimmed) ? trimmed : null;
}

function sanitizeBranchId(value) {
  const uuid = normalizeUuid(value);
  return uuid || null;
}

async function resolveWarehouseId(client, value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;

  const uuid = normalizeUuid(trimmed);
  if (uuid) return uuid;

  // The embedded SQLite database uses stable text ids such as "branch-main".
  // PostgreSQL migrations use UUID columns, so keep non-UUID ids SQLite-only.
  if (db.engine !== 'sqlite') return null;

  const branchResult = await client.query(
    'SELECT id FROM branches WHERE id = $1 AND COALESCE(is_active, 1) != 0 LIMIT 1',
    [trimmed]
  );
  return branchResult.rows[0]?.id || null;
}

function requireParam(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Parâmetro obrigatório em falta: ${name}`);
  }
  return value;
}

function requirePositive(value, name) {
  const n = Number(value);
  if (isNaN(n) || n < 0) {
    throw new Error(`${name} deve ser um número positivo (recebido: ${value})`);
  }
  return n;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildPurchaseReceiveCostPlan(items, receivedQuantities, totalLandingCosts) {
  const normalizedItems = items.map((item) => {
    const receivedQty = requirePositive(receivedQuantities?.[item.product_id] ?? item.quantity, `receivedQty:${item.product_id}`);
    const unitCost = roundMoney(item.unit_cost || 0);
    const lineTotal = roundMoney(unitCost * receivedQty);

    return {
      item,
      receivedQty,
      unitCost,
      lineTotal,
      freightShare: 0,
      newUnitCost: unitCost,
    };
  });

  const receivedItems = normalizedItems.filter((entry) => entry.receivedQty > 0);
  const totalProducts = roundMoney(receivedItems.reduce((sum, entry) => sum + entry.lineTotal, 0));
  const normalizedLandingCosts = roundMoney(totalLandingCosts || 0);

  if (totalProducts <= 0 || normalizedLandingCosts <= 0 || receivedItems.length === 0) {
    return normalizedItems;
  }

  let allocatedFreight = 0;
  receivedItems.forEach((entry, index) => {
    const isLast = index === receivedItems.length - 1;
    const freightShare = isLast
      ? roundMoney(normalizedLandingCosts - allocatedFreight)
      : roundMoney((entry.lineTotal / totalProducts) * normalizedLandingCosts);

    allocatedFreight = roundMoney(allocatedFreight + freightShare);
    entry.freightShare = freightShare;
    entry.newUnitCost = roundMoney((entry.lineTotal + freightShare) / entry.receivedQty);
  });

  return normalizedItems;
}

// ==================== AUDIT LOGGING ====================

async function auditLog(client, params) {
  const { tableName, recordId, action, userId, userName, branchId, oldValues, newValues, description } = params;
  try {
    await client.query(
      `INSERT INTO audit_log (id, table_name, record_id, action, user_id, user_name, branch_id, old_values, new_values, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), tableName, recordId, action, userId, userName, branchId,
       oldValues ? JSON.stringify(oldValues) : null,
       newValues ? JSON.stringify(newValues) : null,
       description]
    );
  } catch (e) {
    console.warn('[AUDIT] Log skipped:', e.message);
  }
}

// ==================== ENTITY ACCOUNT LOOKUP ====================

async function getEntityAccountCode(client, entityType, entityId, entityName) {
  const prefix = entityType === 'supplier' ? '3.2.' : '3.1.';
  const fallback = entityType === 'supplier' ? '3.2.1' : '3.1.1';

  if (!entityId && !entityName) return fallback;

  try {
    if (entityName) {
      const byName = await client.query(
        `SELECT code FROM chart_of_accounts 
         WHERE code LIKE $1 AND level = 3 AND is_header = false AND is_active = true AND name = $2 LIMIT 1`,
        [prefix + '%', entityName]
      );
      if (byName.rows.length > 0) return byName.rows[0].code;
    }
    if (entityId) {
      const byNif = await client.query(
        `SELECT code FROM chart_of_accounts 
         WHERE code LIKE $1 AND level = 3 AND is_header = false AND is_active = true 
           AND description LIKE '%' || $2 || '%' LIMIT 1`,
        [prefix + '%', entityId]
      );
      if (byNif.rows.length > 0) return byNif.rows[0].code;
    }
  } catch (e) {
    console.warn(`[TX ENGINE] Entity account lookup failed:`, e.message);
  }
  return fallback;
}

const INVENTORY_MERCHANDISE_ACCOUNT = '2.1.1';
const INVENTORY_STOCK_ACCOUNT = '2.2';

async function ensureFreightExpenseAccount(client) {
  const existing = await findAccountByCode(client, '6.2.6');
  if (existing) return existing.code;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '6.2' AND is_active = true LIMIT 1`
  );

  if (parentResult.rows.length === 0) {
    throw new Error('Conta 6.2 não encontrada para lançar frete');
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, '6.2.6', 'Transporte sobre Compras', 'expense', 'debit', $2, 3, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), parentResult.rows[0].id]
  );

  return '6.2.6';
}

async function ensureInventoryShrinkageAccount(client) {
  const existing = await findAccountByCode(client, '6.6.1');
  if (existing) return existing.code;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '6' AND is_active = true LIMIT 1`
  );
  if (parentResult.rows.length === 0) {
    return '6.1';
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, '6.6.1', 'Perdas e Quebras de Inventário', 'expense', 'debit', $2, 3, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), parentResult.rows[0].id]
  );

  return '6.6.1';
}

async function applyWeightedAverageCostAfterIn(client, productId, quantityIn, unitCostIn) {
  const qty = requirePositive(quantityIn, 'quantityIn');
  const unit = Math.max(0, parseFloat(unitCostIn) || 0);

  const prodResult = await client.query(
    'SELECT stock, cost FROM products WHERE id = $1 FOR UPDATE',
    [productId]
  );
  if (prodResult.rows.length === 0) return;

  const currentStock = parseFloat(prodResult.rows[0].stock) || 0;
  const oldCost = parseFloat(prodResult.rows[0].cost) || 0;
  const prevStock = Math.max(0, currentStock - qty);
  const newCost =
    currentStock > 0 ? (prevStock * oldCost + qty * unit) / currentStock : unit;

  const nextAvg = Number(newCost.toFixed(4));
  const nextLast = Number(unit.toFixed(4));

  await client.query(
    `UPDATE products
     SET cost = $1, last_cost = $2, avg_cost = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [nextAvg, nextLast, productId]
  );
}

function normalizeStockAdjustmentReferenceType(direction, referenceType) {
  const ref = String(referenceType || '').trim().toLowerCase();
  if (direction === 'IN') {
    if (['purchase', 'transfer', 'transfer_in', 'initial', 'correction', 'adjustment'].includes(ref)) {
      return ref === 'transfer_in' ? 'transfer' : ref;
    }
    return 'adjustment';
  }
  if (['damage', 'expired', 'loss', 'internal_use', 'sample', 'donation', 'adjustment'].includes(ref)) {
    return ref === 'expired' || ref === 'damaged' || ref === 'loss' ? 'damage' : ref;
  }
  return 'adjustment';
}

function buildStockAdjustmentJournalLines(direction, referenceType, totalValue, docLabel) {
  const amount = Math.round((parseFloat(totalValue) || 0) * 100) / 100;
  if (amount <= 0) return [];

  const ref = String(referenceType || '').toLowerCase();

  if (direction === 'IN') {
    let creditAccount = '7.4';
    let creditDesc = 'Contrapartida entrada inventário';

    if (ref === 'initial') {
      creditAccount = '5.3';
      creditDesc = 'Existências iniciais';
    } else if (ref === 'purchase') {
      creditAccount = '3.2.1';
      creditDesc = 'Fornecedores (entrada directa — preferir FC)';
    } else if (ref === 'transfer' || ref === 'transfer_in') {
      return [
        {
          accountCode: INVENTORY_STOCK_ACCOUNT,
          description: `Entrada ${docLabel}`,
          debit: amount,
          credit: 0,
        },
        {
          accountCode: INVENTORY_STOCK_ACCOUNT,
          description: `Saída interna ${docLabel}`,
          debit: 0,
          credit: amount,
        },
      ];
    } else if (ref === 'correction') {
      creditDesc = 'Correção inventário';
    }

    return [
      {
        accountCode: INVENTORY_MERCHANDISE_ACCOUNT,
        description: `Entrada mercadorias ${docLabel}`,
        debit: amount,
        credit: 0,
      },
      {
        accountCode: creditAccount,
        description: creditDesc,
        debit: 0,
        credit: amount,
      },
    ];
  }

  const shrinkageAccount = '6.6.1';
  let expenseDesc = 'Saída inventário';
  if (ref === 'damage' || ref === 'expired' || ref === 'loss') {
    expenseDesc = 'Perdas / avarias inventário';
  } else if (ref === 'internal_use') {
    expenseDesc = 'Uso interno';
  } else if (ref === 'sample') {
    expenseDesc = 'Amostras';
  } else if (ref === 'donation') {
    expenseDesc = 'Donativos';
  }

  return [
    {
      accountCode: shrinkageAccount,
      description: `${expenseDesc} ${docLabel}`,
      debit: amount,
      credit: 0,
    },
    {
      accountCode: INVENTORY_MERCHANDISE_ACCOUNT,
      description: `Saída mercadorias ${docLabel}`,
      debit: 0,
      credit: amount,
    },
  ];
}

/**
 * Professional stock adjustment: movements + WAC (IN) + balanced journal in one transaction.
 * Does NOT move cash — use Payments / Purchase Invoice for supplier cash and AP.
 */
async function processStockAdjustment(client, data) {
  const {
    direction,
    warehouseId,
    referenceNumber,
    referenceType,
    entryDate,
    notes,
    createdBy,
    lines,
  } = data;

  const normalizedDirection = String(direction || '').trim().toUpperCase();
  if (normalizedDirection !== 'IN' && normalizedDirection !== 'OUT') {
    throw new Error('direction deve ser IN ou OUT');
  }

  requireParam(warehouseId, 'warehouseId');
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    throw new Error('Ajuste deve ter pelo menos uma linha');
  }

  const resolvedWarehouseId = await resolveWarehouseId(client, warehouseId);
  if (!resolvedWarehouseId) {
    throw new Error(`warehouseId inválido: ${warehouseId}`);
  }

  const docDate = entryDate || new Date().toISOString().split('T')[0];
  await validatePeriod(client, docDate);

  const movementRefType = normalizeStockAdjustmentReferenceType(
    normalizedDirection,
    referenceType
  );
  const documentId = randomUUID();
  const docNumber = String(referenceNumber || '').trim() || `AJ-${docDate.replace(/-/g, '')}`;
  const docLabel = docNumber;
  const createdByUuid = normalizeUuid(createdBy);

  if (normalizedDirection === 'OUT') {
    await ensureInventoryShrinkageAccount(client);
  }

  const movementIds = [];
  let totalValue = 0;

  for (const line of lines) {
    const qty = requirePositive(line.quantity, 'quantity');
    const unitCost = Math.max(0, parseFloat(line.unitCost ?? line.cost ?? 0) || 0);
    requireParam(line.productId, 'productId');

    const movement = await recordStockMovement(client, {
      productId: line.productId,
      warehouseId: resolvedWarehouseId,
      movementType: normalizedDirection,
      quantity: qty,
      unitCost,
      referenceType: movementRefType,
      referenceId: documentId,
      referenceNumber: docNumber,
      notes: notes || '',
      createdBy: createdByUuid,
    });

    movementIds.push(movement.id);
    const resolvedProductId = movement.product_id || line.productId;
    totalValue += qty * unitCost;

    if (normalizedDirection === 'IN' && unitCost > 0) {
      await applyWeightedAverageCostAfterIn(client, resolvedProductId, qty, unitCost);
    }
  }

  totalValue = Math.round(totalValue * 100) / 100;

  let journalEntryId = null;
  const journalLines = buildStockAdjustmentJournalLines(
    normalizedDirection,
    referenceType,
    totalValue,
    docLabel
  );

  if (journalLines.length > 0) {
    if (journalLines.some((l) => l.accountCode === '6.6.1')) {
      await ensureInventoryShrinkageAccount(client);
    }

    const entry = await createJournalEntry(client, {
      description:
        normalizedDirection === 'IN'
          ? `Entrada inventário ${docLabel}`
          : `Saída inventário ${docLabel}`,
      referenceType: 'adjustment',
      referenceId: documentId,
      branchId: resolvedWarehouseId,
      createdBy: createdByUuid,
      entryDate: docDate,
      lines: journalLines,
    });
    journalEntryId = entry.id;
  }

  await auditLog(client, {
    tableName: 'stock_movements',
    recordId: documentId,
    action: 'create',
    userId: createdByUuid,
    branchId: resolvedWarehouseId,
    newValues: {
      direction: normalizedDirection,
      referenceNumber: docNumber,
      referenceType: movementRefType,
      lines: lines.length,
      totalValue,
    },
    description:
      normalizedDirection === 'IN'
        ? `Entrada inventário ${docLabel} (${lines.length} linha(s))`
        : `Saída inventário ${docLabel} (${lines.length} linha(s))`,
  });

  console.log(
    `[TX ENGINE] Stock adjustment ${docNumber} ${normalizedDirection} ✓ ` +
      `lines=${lines.length} value=${totalValue} journal=${journalEntryId || 'n/a'}`
  );

  return {
    documentId,
    referenceNumber: docNumber,
    movementIds,
    journalEntryId,
    totalValue,
    direction: normalizedDirection,
  };
}

// ==================== PERIOD VALIDATION ====================

async function validatePeriod(client, date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  const result = await client.query(
    `SELECT status FROM accounting_periods WHERE year = $1 AND month = $2`,
    [year, month]
  );

  if (result.rows.length > 0 && result.rows[0].status !== 'open') {
    throw new Error(`Período contabilístico ${month}/${year} está ${result.rows[0].status}. Não é possível lançar.`);
  }
  return true;
}

async function resolveStockProductId(client, productIdOrCode, warehouseId) {
  if (isUuid(productIdOrCode)) return productIdOrCode;

  const code = String(productIdOrCode).trim();
  const lookup = await client.query(
    `SELECT id
     FROM products
     WHERE COALESCE(is_active, 1) != 0
       AND (
         LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
         OR TRIM(COALESCE(barcode, '')) = $2
       )
       AND (branch_id = $3 OR branch_id IS NULL)
     ORDER BY CASE WHEN branch_id = $3 THEN 0 WHEN branch_id IS NULL THEN 1 ELSE 2 END, created_at ASC
     LIMIT 1`,
    [code, code, warehouseId]
  );

  if (lookup.rows.length > 0) {
    return lookup.rows[0].id;
  }

  throw new Error(`Produto não encontrado para movimento de stock: ${productIdOrCode}`);
}

/**
 * Find or create a product row owned by `branchId` (required for filial stock).
 * Shared catalog rows (branch_id NULL) must be cloned — stock on the shared row does not show at filials.
 */
async function resolveOrCloneProductForBranch(client, src, branchId, options = {}) {
  const { reuseExistingBySku = false } = options;
  const toBranch = String(branchId || '').trim();
  if (!toBranch) throw new Error('branchId inválido para produto de destino');

  if (src.branch_id && String(src.branch_id) === toBranch) {
    return src.id;
  }

  const sku = src.sku != null ? String(src.sku).trim() : '';
  if (sku) {
    const destCheck = await client.query(
      `SELECT id, name FROM products
       WHERE COALESCE(is_active, 1) != 0 AND branch_id = $1 AND LOWER(TRIM(sku)) = LOWER($2)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [toBranch, sku]
    );
    if (destCheck.rows.length > 0) {
      const existing = destCheck.rows[0];
      if (String(existing.id) === String(src.id)) {
        return existing.id;
      }
      if (reuseExistingBySku) {
        return existing.id;
      }
      throw new Error(
        `Código "${sku}" já pertence a outro produto nesta filial (${existing.name || existing.id}). ` +
        `Seleccione o produto correcto ou use um código único — o stock não pode ser lançado no produto errado.`
      );
    }
  }

  const nameTrim = src.name != null ? String(src.name).trim() : '';
  if (nameTrim) {
    const byName = await client.query(
      `SELECT id, sku FROM products
       WHERE COALESCE(is_active, 1) != 0 AND branch_id = $1 AND LOWER(TRIM(name)) = LOWER($2)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [toBranch, nameTrim]
    );
    if (byName.rows.length > 0) {
      return byName.rows[0].id;
    }
  }

  const cloneId = randomUUID();
  const unitCost = parseFloat(src.cost) || 0;
  await client.query(
    `INSERT INTO products (
       id, name, sku, barcode, category, price, cost, first_cost, last_cost, avg_cost,
       stock, unit, tax_rate, branch_id, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $7, 0, $8, $9, $10, true)`,
    [
      cloneId,
      src.name,
      sku || src.sku || '',
      src.barcode || '',
      src.category || 'GERAL',
      parseFloat(src.price) || 0,
      unitCost,
      src.unit || 'UN',
      parseFloat(src.tax_rate) || require('./taxDefaults').DEFAULT_VAT_RATE,
      toBranch,
    ]
  );
  console.log(`[TX ENGINE] Cloned product ${sku || src.id} → branch ${toBranch} (${cloneId})`);
  return cloneId;
}

/** Resolve stock IN/OUT from entry payload + transaction context (sales NC = IN, supplier return = OUT). */
function resolveStockEntryDirection(entry, transactionType, openItem) {
  const raw = entry?.direction ?? entry?.type ?? entry?.movementType ?? entry?.movement_type ?? '';
  const normalized = String(raw).trim().toUpperCase();

  if (transactionType === 'credit_note' && openItem?.entityType === 'supplier') {
    return 'OUT';
  }
  if (transactionType === 'credit_note' && normalized === 'OUT') {
    return 'OUT';
  }
  if (transactionType === 'credit_note' && openItem?.entityType === 'customer') {
    return 'IN';
  }
  if (transactionType === 'purchase_invoice') {
    return 'IN';
  }

  if (normalized === 'IN' || normalized === 'OUT') {
    return normalized;
  }
  throw new Error(`Direção de stock inválida (use IN ou OUT): ${raw || '(vazio)'}`);
}

function normalizeStandaloneMovementType(body) {
  const ref = String(body.referenceType ?? body.reference_type ?? '').trim().toLowerCase();
  if (ref === 'supplier_return' || ref === 'purchase_return') {
    return 'OUT';
  }
  if (ref === 'sale_return' || ref === 'customer_return') {
    return 'IN';
  }

  const raw = body.movementType ?? body.movement_type ?? body.direction ?? body.type ?? '';
  const normalized = String(raw).trim().toUpperCase();
  if (normalized === 'IN' || normalized === 'OUT') {
    return normalized;
  }
  throw new Error(`Tipo de movimento inválido (use IN ou OUT): ${raw || '(vazio)'}`);
}

/** After movements, align products.stock with movement ledger for this SKU at this warehouse. */
async function reconcileSkuStockAtWarehouse(client, sku, warehouseId) {
  const skuTrim = String(sku || '').trim();
  const wh = String(warehouseId || '').trim();
  if (!skuTrim || !wh) return;

  const sumResult = await client.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN sm.movement_type = 'IN' THEN sm.quantity
         WHEN sm.movement_type = 'OUT' THEN -sm.quantity
         ELSE 0
       END
     ), 0) AS total
     FROM stock_movements sm
     INNER JOIN products pm ON pm.id = sm.product_id
     WHERE sm.warehouse_id = $1
       AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER($2)`,
    [wh, skuTrim]
  );
  const total = Math.max(0, parseFloat(sumResult.rows[0]?.total || 0));

  // Only filial-owned rows — do not copy branch stock onto shared catalog (branch_id NULL) duplicates.
  await client.query(
    `UPDATE products
     SET stock = $1, updated_at = CURRENT_TIMESTAMP
     WHERE COALESCE(is_active, 1) != 0
       AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($2)
       AND branch_id = $3`,
    [total, skuTrim, wh]
  );
}

async function resolveProductForWarehouse(client, productId, warehouseId) {
  const resolvedId = await resolveStockProductId(client, productId, warehouseId);
  const meta = await client.query(
    `SELECT id, branch_id, name, sku, barcode, category, price, cost, unit, tax_rate
     FROM products WHERE id = $1`,
    [resolvedId]
  );
  if (meta.rows.length === 0) {
    return resolvedId;
  }

  const src = meta.rows[0];
  const branchKey = String(warehouseId || '').trim();
  if (!branchKey) {
    return resolvedId;
  }

  if (src.branch_id && String(src.branch_id) === branchKey) {
    return resolvedId;
  }

  // Shared catalog or product from another branch → post stock on this warehouse's SKU row
  return resolveOrCloneProductForBranch(client, src, branchKey, { reuseExistingBySku: true });
}

// ==================== STOCK MOVEMENTS ====================

/**
 * Record a stock movement — the SINGLE source of truth for inventory.
 * Uses FOR UPDATE to lock the product row and prevent negative stock.
 */
async function recordStockMovement(client, params) {
  const {
    productId, warehouseId, movementType, quantity, unitCost,
    referenceType, referenceId, referenceNumber, notes, createdBy
  } = params;

  requireParam(productId, 'productId');
  requireParam(warehouseId, 'warehouseId');
  requireParam(movementType, 'movementType');
  const qty = requirePositive(quantity, 'quantity');
  const resolvedWarehouseId = await resolveWarehouseId(client, warehouseId);

  if (qty === 0) throw new Error('Quantidade deve ser maior que zero');
  if (!resolvedWarehouseId) throw new Error(`warehouseId inválido: ${warehouseId}`);

  let normalizedMovementType = String(movementType).trim().toUpperCase();
  const ref = String(referenceType || '').trim().toLowerCase();
  if (ref === 'supplier_return' || ref === 'purchase_return') {
    normalizedMovementType = 'OUT';
  } else if (ref === 'sale_return' || ref === 'customer_return') {
    normalizedMovementType = 'IN';
  } else if (normalizedMovementType !== 'IN' && normalizedMovementType !== 'OUT') {
    throw new Error(`Tipo de movimento inválido: ${movementType}`);
  }

  const resolvedProductId = await resolveProductForWarehouse(client, productId, resolvedWarehouseId);
  const referenceUuid = normalizeUuid(referenceId);
  const createdByUuid = normalizeUuid(createdBy);

  // Lock product row
  const productResult = await client.query(
    `SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE`,
    [resolvedProductId]
  );
  if (productResult.rows.length === 0) {
    throw new Error(`Produto não encontrado: ${productId}`);
  }

  const product = productResult.rows[0];

  if (normalizedMovementType === 'OUT') {
    const stockResult = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS movement_stock
       FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
      [resolvedProductId, resolvedWarehouseId]
    );
    let movementStock = parseFloat(stockResult.rows[0].movement_stock);

    const skuRow = await client.query('SELECT sku FROM products WHERE id = $1', [resolvedProductId]);
    const sku = skuRow.rows[0]?.sku != null ? String(skuRow.rows[0].sku).trim() : '';
    if (sku) {
      const skuStockResult = await client.query(
        `SELECT COALESCE(SUM(
           CASE WHEN sm.movement_type = 'IN' THEN sm.quantity ELSE -sm.quantity END
         ), 0) AS movement_stock
         FROM stock_movements sm
         INNER JOIN products pm ON pm.id = sm.product_id
         WHERE sm.warehouse_id = $1
           AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER($2)`,
        [resolvedWarehouseId, sku]
      );
      movementStock = Math.max(movementStock, parseFloat(skuStockResult.rows[0]?.movement_stock || 0));

      const legacyStockResult = await client.query(
        `SELECT COALESCE(SUM(stock), 0) AS legacy_stock
         FROM products
         WHERE is_active = true
           AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
           AND (branch_id = $2 OR branch_id IS NULL)`,
        [sku, resolvedWarehouseId]
      );
      const legacySkuStock = parseFloat(legacyStockResult.rows[0]?.legacy_stock || 0);
      const available = Math.max(movementStock, legacySkuStock, parseFloat(product.stock || 0));

      if (available + 0.0001 < qty) {
        throw new Error(`Stock insuficiente para ${product.name}. Disponível: ${available}, Solicitado: ${qty}`);
      }
    } else {
      const available = Math.max(movementStock, parseFloat(product.stock || 0));
      if (available + 0.0001 < qty) {
        throw new Error(`Stock insuficiente para ${product.name}. Disponível: ${available}, Solicitado: ${qty}`);
      }
    }
  }

  const movementId = randomUUID();
  await client.query(
    `INSERT INTO stock_movements 
     (id, product_id, warehouse_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, reference_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [movementId, resolvedProductId, resolvedWarehouseId, normalizedMovementType, qty, unitCost || 0,
     referenceType, referenceUuid, referenceNumber || '', notes || '', createdByUuid]
  );

  // Update denormalized products.stock on the movement row, then reconcile all SKU rows at this warehouse
  const stockChange = normalizedMovementType === 'IN' ? qty : -qty;
  await client.query(
    'UPDATE products SET stock = stock + $1 WHERE id = $2',
    [stockChange, resolvedProductId]
  );

  const skuForReconcile = await client.query('SELECT sku FROM products WHERE id = $1', [resolvedProductId]);
  const skuValue = skuForReconcile.rows[0]?.sku;
  if (skuValue) {
    await reconcileSkuStockAtWarehouse(client, skuValue, resolvedWarehouseId);
  }

  return { id: movementId, product_id: resolvedProductId, movement_type: normalizedMovementType, quantity: qty };
}

/**
 * Get current stock for a product at a warehouse
 */
async function getStock(productId, warehouseId) {
  const result = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS stock
     FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, warehouseId]
  );
  return parseFloat(result.rows[0]?.stock || 0);
}

// ==================== OPEN ITEMS ====================

async function createOpenItem(client, params) {
  const {
    entityType, entityId, documentType, documentId, documentNumber,
    documentDate, dueDate, originalAmount, isDebit, branchId, currency
  } = params;

  requireParam(entityType, 'entityType');
  requireParam(documentId, 'documentId');
  const amount = requirePositive(originalAmount, 'originalAmount');

  const existing = await client.query(
    'SELECT id FROM open_items WHERE document_id = $1 LIMIT 1',
    [documentId]
  );
  if (existing.rows.length > 0) {
    throw new Error(`Documento já registado: ${documentNumber || documentId}`);
  }

  const oiId = randomUUID();
  await client.query(
    `INSERT INTO open_items 
     (id, entity_type, entity_id, document_type, document_id, document_number,
      document_date, due_date, currency, original_amount, remaining_amount, is_debit, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)`,
    [oiId, entityType, entityId, documentType, documentId, documentNumber,
     documentDate, dueDate, currency || 'AOA', amount, isDebit, branchId]
  );

  return { id: oiId };
}

async function clearOpenItems(client, params) {
  const { paymentItemId, invoiceItemIds, amounts, clearedBy } = params;
  const clearings = [];

  for (let i = 0; i < invoiceItemIds.length; i++) {
    const invoiceItemId = invoiceItemIds[i];
    const amount = amounts[i];
    const clearingId = randomUUID();

    await client.query(
      `INSERT INTO clearings (id, debit_item_id, credit_item_id, amount, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [clearingId, invoiceItemId, paymentItemId, amount, clearedBy]
    );
    clearings.push({ id: clearingId });

    // Update both open items
    for (const itemId of [invoiceItemId, paymentItemId]) {
      await client.query(
        `UPDATE open_items SET 
         remaining_amount = remaining_amount - $1,
         status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
         cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = $2`,
        [amount, itemId]
      );
    }
  }
  return clearings;
}

/**
 * Apply a purchase return against the original invoice open item (supplier payable).
 * Avoids leaving the full invoice open while also posting a separate credit note.
 */
function isOpenItemDebitFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function resolveSupplierPayableDocumentIds(client, invoiceDocumentId, purchaseOrderNumber) {
  const ids = [];
  if (invoiceDocumentId) ids.push(String(invoiceDocumentId));

  const orderNumbers = new Set();
  const linkedNo = String(purchaseOrderNumber || '').trim();
  if (linkedNo) orderNumbers.add(linkedNo);

  try {
    const inv = await client.query(
      'SELECT order_no FROM purchase_invoices WHERE id = $1 LIMIT 1',
      [invoiceDocumentId]
    );
    const orderNo = String(inv.rows[0]?.order_no || '').trim();
    if (orderNo) orderNumbers.add(orderNo);
  } catch {
    /* purchase_invoices optional during bootstrap */
  }

  for (const orderNo of orderNumbers) {
    try {
      const po = await client.query(
        'SELECT id FROM purchase_orders WHERE order_number = $1 LIMIT 1',
        [orderNo]
      );
      if (po.rows[0]?.id) ids.push(String(po.rows[0].id));
    } catch {
      /* purchase_orders optional */
    }
  }

  return [...new Set(ids.filter(Boolean))];
}

/**
 * When a purchase invoice is confirmed after PO receipt, reuse the PO open item
 * instead of creating a duplicate payable.
 */
async function adoptPurchaseOrderOpenItemForInvoice(client, {
  entityId,
  invoiceDocumentId,
  invoiceDocumentNumber,
  invoiceDocumentDate,
  originalAmount,
  dueDate,
  currency,
  branchId,
  purchaseOrderNumber,
}) {
  if (!invoiceDocumentId) return null;

  const documentIds = await resolveSupplierPayableDocumentIds(
    client,
    invoiceDocumentId,
    purchaseOrderNumber,
  );
  const poIds = documentIds.filter((id) => id !== String(invoiceDocumentId));
  if (!poIds.length) return null;

  for (const poId of poIds) {
    let result = await client.query(
      `SELECT id, entity_id, remaining_amount, document_number
       FROM open_items
       WHERE entity_type = 'supplier'
         AND document_id = $1
         AND is_debit = 1
         AND status != 'cleared'
       ORDER BY created_at ASC
       LIMIT 1`,
      [poId]
    );

    if (!result.rows.length && entityId) {
      result = await client.query(
        `SELECT id, entity_id, remaining_amount, document_number
         FROM open_items
         WHERE entity_type = 'supplier'
           AND entity_id = $1
           AND document_id = $2
           AND is_debit = 1
           AND status != 'cleared'
         ORDER BY created_at ASC
         LIMIT 1`,
        [entityId, poId]
      );
    }

    if (!result.rows.length) continue;

    const row = result.rows[0];
    const amount = Number(originalAmount || row.remaining_amount || 0);
    await client.query(
      `UPDATE open_items SET
         document_id = $1,
         document_number = $2,
         document_date = $3,
         due_date = COALESCE($4, due_date),
         original_amount = $5,
         remaining_amount = $5,
         currency = COALESCE($6, currency),
         branch_id = COALESCE($7, branch_id)
       WHERE id = $8`,
      [
        invoiceDocumentId,
        invoiceDocumentNumber,
        invoiceDocumentDate,
        dueDate || null,
        amount,
        currency || 'AOA',
        branchId || null,
        row.id,
      ]
    );

    console.log(
      `[TX ENGINE] Adopted PO open item ${row.document_number} for purchase invoice ${invoiceDocumentNumber}`
    );
    return { id: row.id, entityId: row.entity_id || entityId };
  }

  return null;
}

async function syncSupplierBalanceFromOpenItems(client, supplierId) {
  if (!supplierId) return;
  await client.query(
    `UPDATE suppliers SET balance = COALESCE((
       SELECT SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END)
       FROM open_items
       WHERE entity_type = 'supplier' AND entity_id = $1
     ), 0)
     WHERE id = $1`,
    [supplierId]
  );
}

async function reduceSupplierInvoiceOpenItem(client, { entityId, invoiceDocumentId, amount }) {
  const reduction = Number(amount || 0);
  if (!invoiceDocumentId || reduction <= 0) return null;

  const documentIds = await resolveSupplierPayableDocumentIds(client, invoiceDocumentId);
  let remaining = reduction;
  let lastResult = null;

  for (const docId of documentIds) {
    if (remaining <= 0.001) break;

    let result = await client.query(
      `SELECT id, entity_id, remaining_amount, document_number
       FROM open_items
       WHERE entity_type = 'supplier'
         AND document_id = $1
         AND is_debit = 1
         AND status != 'cleared'
       ORDER BY created_at ASC
       LIMIT 1`,
      [docId]
    );

    if (!result.rows.length && entityId) {
      result = await client.query(
        `SELECT id, entity_id, remaining_amount, document_number
         FROM open_items
         WHERE entity_type = 'supplier'
           AND entity_id = $1
           AND document_id = $2
           AND is_debit = 1
           AND status != 'cleared'
         ORDER BY created_at ASC
         LIMIT 1`,
        [entityId, docId]
      );
    }

    if (!result.rows.length) continue;

    const row = result.rows[0];
    const applied = Math.min(remaining, Number(row.remaining_amount || 0));
    if (applied <= 0) continue;

    await client.query(
      `UPDATE open_items SET
         remaining_amount = remaining_amount - $1,
         status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
         cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
       WHERE id = $2`,
      [applied, row.id]
    );

    remaining -= applied;
    lastResult = {
      id: row.id,
      entityId: row.entity_id,
      applied: reduction - remaining,
      documentNumber: row.document_number,
    };

    console.log(
      `[TX ENGINE] Supplier return applied to open item ${row.document_number}: -${applied} (remaining was ${row.remaining_amount})`
    );
  }

  return lastResult;
}

// ==================== DOCUMENT LINKS ====================

async function linkDocuments(client, sourceType, sourceId, sourceNumber, targetType, targetId, targetNumber) {
  const linkId = randomUUID();
  await client.query(
    `INSERT INTO document_links (id, source_type, source_id, source_number, target_type, target_id, target_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [linkId, sourceType, sourceId, sourceNumber, targetType, targetId, targetNumber]
  );
  return linkId;
}

// ==================== PROCESS SALE ====================

async function processSale(client, saleData) {
  const {
    branchId, cashierId, cashierName, items,
    subtotal, taxAmount, discount, total,
    paymentMethod, amountPaid, change,
    customerNif, customerName, clientId,
    clientRequestId, idempotencyKey,
  } = saleData;
  const clientReqId = clientRequestId || idempotencyKey || null;

  // ── Validation ──
  requireParam(branchId, 'branchId');
  requireParam(cashierId, 'cashierId');
  if (!items || items.length === 0) throw new Error('Venda deve ter pelo menos um item');
  const totalAmount = requirePositive(total, 'total');

  let invoiceNumber = saleData.invoiceNumber || null;
  const today = new Date().toISOString().split('T')[0];

  // ── Step 0: Validate period ──
  await validatePeriod(client, today);

  // ── Step 1: Generate invoice number (locked sequence) ──
  if (!invoiceNumber) {
    invoiceNumber = await generateSequenceNumber(client, 'invoice', 'INV');
  } else {
    const dup = await client.query(
      'SELECT 1 FROM sales WHERE invoice_number = $1 LIMIT 1',
      [invoiceNumber]
    );
    if (dup.rows.length > 0) {
      invoiceNumber = await generateSequenceNumber(client, 'invoice', 'INV');
    }
  }

  // ── Step 2: Resolve product IDs + Validate stock BEFORE any writes (FOR UPDATE) ──
  const resolvedItems = [];
  for (const item of items) {
    let pid = isUuid(item.productId) ? item.productId : null;

    // Resolve non-UUID productIds (e.g. from imported products) by SKU/barcode
    if (!pid && (item.productId || item.sku)) {
      try {
        pid = await resolveStockProductId(client, item.productId || item.sku, branchId);
      } catch (e) {
        // Product not found — skip stock check but still record sale line
        pid = null;
      }
    }

    resolvedItems.push({ ...item, resolvedPid: pid });

    if (!pid) continue;

    const stockCheck = await client.query(
      `SELECT p.name, p.stock AS legacy_stock,
              COALESCE((SELECT SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END)
                        FROM stock_movements WHERE product_id = p.id AND warehouse_id = $2), 0) AS movement_stock
       FROM products p WHERE p.id = $1 FOR UPDATE`,
      [pid, branchId]
    );
    if (stockCheck.rows.length === 0) throw new Error(`Produto não encontrado: ${item.productName || pid}`);

    const row = stockCheck.rows[0];
    const available = Math.max(parseFloat(row.movement_stock), parseFloat(row.legacy_stock || 0));
    if (available + 0.0001 < Number(item.quantity)) {
      throw new Error(`Stock insuficiente para ${row.name}. Disponível: ${available}, Solicitado: ${item.quantity}`);
    }
  }

  if (clientReqId) {
    const dupClient = await client.query(
      `SELECT id FROM sales WHERE client_request_id = $1 LIMIT 1`,
      [clientReqId]
    );
    if (dupClient.rows.length > 0) {
      const existing = await client.query(`SELECT * FROM sales WHERE id = $1`, [dupClient.rows[0].id]);
      return {
        id: existing.rows[0].id,
        invoice_number: existing.rows[0].invoice_number,
        total: parseFloat(existing.rows[0].total),
        status: existing.rows[0].status,
        duplicate: true,
      };
    }
  }

  // ── Step 3a: Insert sale header ──
  const saleId = randomUUID();
  await client.query(
    `INSERT INTO sales (id, invoice_number, branch_id, cashier_id, cashier_name,
      subtotal, tax_amount, discount, total, payment_method, amount_paid, change,
      customer_nif, customer_name, status, client_request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'completed',$15)`,
    [saleId, invoiceNumber, branchId, cashierId, cashierName,
     subtotal, taxAmount, discount || 0, totalAmount,
     paymentMethod, amountPaid, change, customerNif, customerName, clientReqId]
  );

  // ── Step 3b: Insert sale_items + stock ──
  let totalCOGS = 0;
  for (const item of resolvedItems) {
    const pid = item.resolvedPid;
    const saleItemId = randomUUID();

    await client.query(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, sku, quantity,
        unit_price, discount, tax_rate, tax_amount, subtotal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [saleItemId, saleId, pid, item.productName, item.sku, item.quantity,
       item.unitPrice, item.discount || 0, item.taxRate, item.taxAmount, item.subtotal]
    );

    if (pid) {
      // Stock deduction via recordStockMovement (atomic, FOR UPDATE locked)
      await recordStockMovement(client, {
        productId: pid, warehouseId: branchId,
        movementType: 'OUT', quantity: item.quantity, unitCost: item.costAtSale || 0,
        referenceType: 'sale', referenceId: saleId,
        referenceNumber: invoiceNumber, createdBy: cashierId,
      });

      // COGS
      const costResult = await client.query('SELECT cost FROM products WHERE id = $1', [pid]);
      if (costResult.rows.length > 0) {
        totalCOGS += parseFloat(costResult.rows[0].cost) * item.quantity;
      }
    }
  }

  // ── Step 4: Journal entries (balanced) ──
  let cashAccountCode = '4.1.1';
  if (paymentMethod === 'cash') {
    const caixaResult = await client.query(
      `SELECT code FROM chart_of_accounts WHERE code LIKE '4.1.%' AND level = 3 AND is_header = false
       AND branch_id = $1 AND is_active = true LIMIT 1`, [branchId]
    );
    if (caixaResult.rows.length > 0) cashAccountCode = caixaResult.rows[0].code;
  } else {
    cashAccountCode = '4.2.1';
  }

  const revenueLines = [
    { accountCode: cashAccountCode, description: `Venda ${invoiceNumber}`, debit: parseFloat(total), credit: 0 },
    { accountCode: '7.1.1', description: `Receita ${invoiceNumber}`, debit: 0, credit: parseFloat(subtotal) },
  ];
  if (parseFloat(taxAmount) > 0) {
    revenueLines.push({ accountCode: '3.3.1', description: `IVA ${invoiceNumber}`, debit: 0, credit: parseFloat(taxAmount) });
  }

  await createJournalEntry(client, {
    description: `Venda ${invoiceNumber}`, referenceType: 'sale', referenceId: saleId,
    branchId, createdBy: cashierId, lines: revenueLines,
  });

  if (totalCOGS > 0) {
    await createJournalEntry(client, {
      description: `CMV - ${invoiceNumber}`, referenceType: 'sale', referenceId: saleId,
      branchId, createdBy: cashierId,
      lines: [
        { accountCode: '6.1', description: 'Custo Mercadorias Vendidas', debit: totalCOGS, credit: 0 },
        { accountCode: '2.2', description: 'Saída Mercadorias', debit: 0, credit: totalCOGS },
      ],
    });
  }

  // ── Step 5: Open item (credit sales) ──
  if (clientId && paymentMethod !== 'cash') {
    await createOpenItem(client, {
      entityType: 'customer', entityId: clientId, documentType: 'invoice',
      documentId: saleId, documentNumber: invoiceNumber, documentDate: today,
      dueDate: today, originalAmount: totalAmount, isDebit: true, branchId,
    });
  }

  // Tax summary (non-critical)
  try {
    await client.query(
      `INSERT INTO tax_summaries (id, document_type, document_id, tax_code, tax_rate, total_base, total_tax, direction, period_year, period_month)
       VALUES ($1,'sale',$2,'IVA14',14.00,$3,$4,'output',$5,$6)`,
      [randomUUID(), saleId, parseFloat(subtotal), parseFloat(taxAmount), new Date().getFullYear(), new Date().getMonth() + 1]
    );
  } catch (e) { console.warn('[TX] Tax summary skipped:', e.message); }

  // ── Step 6: Audit ──
  await auditLog(client, {
    tableName: 'sales', recordId: saleId, action: 'create',
    userId: cashierId, userName: cashierName, branchId,
    newValues: { invoiceNumber, total: totalAmount, paymentMethod, items: items.length },
    description: `Venda ${invoiceNumber} - ${totalAmount.toLocaleString()} AOA`,
  });

  console.log(`[TX ENGINE] Sale ${invoiceNumber} ✓`);
  return { id: saleId, invoice_number: invoiceNumber, total: totalAmount, status: 'completed' };
}

// ==================== CREATE PURCHASE ORDER ====================

async function createPurchaseOrder(client, data) {
  const {
    supplierId,
    branchId,
    items,
    createdBy,
    createdByName,
    notes,
    expectedDeliveryDate,
    freightCost,
    otherCosts,
    otherCostsDescription,
  } = data;

  requireParam(supplierId, 'supplierId');
  requireParam(branchId, 'branchId');
  if (!items || items.length === 0) throw new Error('Ordem de compra deve ter itens');

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  const supplierResult = await client.query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
  if (supplierResult.rows.length === 0) throw new Error('Fornecedor não encontrado');
  const supplierName = supplierResult.rows[0].name;

  const branchResult = await client.query('SELECT name FROM branches WHERE id = $1', [branchId]);
  const branchName = branchResult.rows[0]?.name || '';

  // Sequence-based number
  const orderNumber = await generateSequenceNumber(client, 'purchase_order', 'PO');

  const normalizedFreightCost = requirePositive(freightCost || 0, 'freightCost');
  const normalizedOtherCosts = requirePositive(otherCosts || 0, 'otherCosts');
  const subtotal = items.reduce((sum, item) => sum + (item.subtotal || item.quantity * item.unitCost), 0);
  const taxAmount = items.reduce((sum, item) => sum + ((item.subtotal || item.quantity * item.unitCost) * (item.taxRate || 0) / 100), 0);
  const total = subtotal + taxAmount + normalizedFreightCost + normalizedOtherCosts;

  const orderId = randomUUID();
  await client.query(
    `INSERT INTO purchase_orders (id, order_number, supplier_id, supplier_name, branch_id, branch_name,
      subtotal, tax_amount, total, created_by, notes, expected_delivery_date, freight_cost, other_costs,
      other_costs_description, freight_distributed, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,'pending')`,
    [orderId, orderNumber, supplierId, supplierName, branchId, branchName,
     subtotal, taxAmount, total, createdBy, notes, expectedDeliveryDate,
     normalizedFreightCost, normalizedOtherCosts, otherCostsDescription || null]
  );

  for (const item of items) {
    const itemId = randomUUID();
    await client.query(
      `INSERT INTO purchase_order_items (id, order_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, subtotal, freight_allocation, effective_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        itemId,
        orderId,
        item.productId,
        item.productName,
        item.sku,
        item.quantity,
        item.unitCost,
        item.taxRate || 0,
        item.subtotal || item.quantity * item.unitCost,
        item.freightAllocation || 0,
        item.effectiveCost || item.unitCost,
      ]
    );
  }

  // Auto-submit for approval
  try {
    const wfResult = await client.query(
      `SELECT * FROM approval_workflows WHERE document_type = 'purchase_order' AND is_active = true
       AND min_amount <= $1 AND (max_amount IS NULL OR max_amount >= $1) ORDER BY min_amount DESC LIMIT 1`,
      [total]
    );
    if (wfResult.rows.length > 0) {
      const workflow = wfResult.rows[0];
      const steps = typeof workflow.steps === 'string' ? JSON.parse(workflow.steps) : workflow.steps;
      await client.query(
        `INSERT INTO approval_requests (id, workflow_id, document_type, document_id, document_number, amount, total_steps,
          requested_by, requested_by_name, branch_id, notes)
         VALUES ($1,$2,'purchase_order',$3,$4,$5,$6,$7,$8,$9,'Auto-submetido')`,
        [randomUUID(), workflow.id, orderId, orderNumber, total, steps.length, createdBy, createdByName || '', branchId]
      );
      await client.query(`UPDATE purchase_orders SET status = 'awaiting_approval' WHERE id = $1`, [orderId]);
    }
  } catch (e) {
    console.warn('[TX] Approval skipped:', e.message);
  }

  await auditLog(client, {
    tableName: 'purchase_orders', recordId: orderId, action: 'create',
    userId: createdBy, userName: createdByName, branchId,
    newValues: { orderNumber, supplierName, total, items: items.length },
    description: `OC ${orderNumber} - ${supplierName} - ${total.toFixed(2)} AOA`,
  });

  console.log(`[TX ENGINE] PO ${orderNumber} created ✓`);
  return { id: orderId, order_number: orderNumber, status: 'pending', total, items };
}

// ==================== PROCESS PURCHASE RECEIVE ====================

async function processPurchaseReceive(client, orderId, receivedQuantities, receivedBy) {
  requireParam(orderId, 'orderId');
  requireParam(receivedBy, 'receivedBy');

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  const orderResult = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [orderId]);
  const order = orderResult.rows[0];
  if (!order) throw new Error(`Ordem de compra ${orderId} não encontrada`);

  const itemsResult = await client.query('SELECT * FROM purchase_order_items WHERE order_id = $1', [orderId]);

  // FREIGHT MUST NEVER stay separate from inventory — it MUST be capitalized into product cost
  const freightCost = parseFloat(order.freight_cost) || 0;
  const otherCosts = parseFloat(order.other_costs) || 0;
  const totalLandingCosts = freightCost + otherCosts;

  console.log(`[TX ENGINE] ═══ PURCHASE RECEIVE ${order.order_number} ═══`);
  console.log(`[TX ENGINE] freight_cost=${freightCost}, other_costs=${otherCosts}, totalLandingCosts=${totalLandingCosts}`);
  console.log(`[TX ENGINE] items count=${itemsResult.rows.length}, receivedQuantities=`, JSON.stringify(receivedQuantities));

  const receiveCostPlan = buildPurchaseReceiveCostPlan(itemsResult.rows, receivedQuantities, totalLandingCosts);

  for (const plan of receiveCostPlan) {
    const { item, receivedQty, freightShare, newUnitCost, unitCost } = plan;

    console.log(`[TX ENGINE] Item ${item.product_name || item.product_id}: origCost=${unitCost}, qty=${receivedQty}, freightShare=${freightShare}, newUnitCost=${newUnitCost}`);

    await client.query(
      'UPDATE purchase_order_items SET received_quantity = $1, freight_allocation = $2, effective_cost = $3 WHERE id = $4',
      [receivedQty, freightShare, newUnitCost, item.id]
    );

    if (receivedQty <= 0) {
      console.log(`[TX ENGINE] Skipping ${item.product_id} — zero qty`);
      continue;
    }

    const resolvedProductId = await resolveStockProductId(client, item.product_id || item.sku, order.branch_id);
    console.log(`[TX ENGINE] Resolved product: ${item.product_id} → ${resolvedProductId}`);

    const productResult = await client.query(
      `SELECT id, cost, name FROM products WHERE id = $1 FOR UPDATE`,
      [resolvedProductId]
    );

    if (productResult.rows.length === 0) {
      throw new Error(`Produto não encontrado para recepção: ${item.product_id || item.sku}`);
    }

    const oldCost = parseFloat(productResult.rows[0].cost) || 0;

    // UPDATE PRODUCT COST — freight is capitalized into unit cost
    await client.query(
      'UPDATE products SET cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newUnitCost, resolvedProductId]
    );
    console.log(`[TX ENGINE] ✅ Product ${productResult.rows[0].name} cost: ${oldCost} → ${newUnitCost}`);

    // STOCK MOVEMENT with landed cost (freight included)
    await recordStockMovement(client, {
      productId: resolvedProductId, warehouseId: order.branch_id,
      movementType: 'IN', quantity: receivedQty, unitCost: newUnitCost,
      referenceType: 'purchase', referenceId: orderId,
      referenceNumber: order.order_number, createdBy: receivedBy,
    });
    console.log(`[TX ENGINE] ✅ Stock movement: ${receivedQty} units @ ${newUnitCost}`);
  }

  // Update PO status
  await client.query(
    `UPDATE purchase_orders SET status = 'received', received_by = $1, received_at = CURRENT_TIMESTAMP, freight_distributed = true WHERE id = $2`,
    [receivedBy, orderId]
  );

  // Journal entry — merchandise debit + freight debit + supplier credit
  const subtotal = parseFloat(order.subtotal || 0);
  const taxAmount = parseFloat(order.tax_amount || 0);
  const supplierAccountCode = await getEntityAccountCode(client, 'supplier', order.supplier_id, order.supplier_name);
  const freightExpenseAccountCode = totalLandingCosts > 0 ? await ensureFreightExpenseAccount(client) : null;

  const journalLines = [
    { accountCode: '2.1.1', description: `Mercadoria ${order.order_number}`, debit: subtotal, credit: 0 },
  ];
  if (totalLandingCosts > 0 && freightExpenseAccountCode) {
    journalLines.push({ accountCode: freightExpenseAccountCode, description: `Frete ${order.order_number}`, debit: totalLandingCosts, credit: 0 });
  }
  if (taxAmount > 0) {
    journalLines.push({ accountCode: '3.3.1', description: `IVA compra ${order.order_number}`, debit: taxAmount, credit: 0 });
  }
  journalLines.push({ accountCode: supplierAccountCode, description: `Fornecedor ${order.supplier_name}`, debit: 0, credit: subtotal + totalLandingCosts + taxAmount });

  console.log(`[TX ENGINE] Journal: subtotal=${subtotal}, landedCosts=${totalLandingCosts}, tax=${taxAmount}, total=${subtotal + totalLandingCosts + taxAmount}`);

  await createJournalEntry(client, {
    description: `Compra ${order.order_number} - ${order.supplier_name}`,
    referenceType: 'purchase', referenceId: orderId,
    branchId: order.branch_id, createdBy: receivedBy, lines: journalLines,
  });

  // Payable open item is created on purchase invoice (FC), not on PO receipt — avoids duplicate AP with FC.

  // Audit
  await auditLog(client, {
    tableName: 'purchase_orders', recordId: orderId, action: 'status_change',
    userId: receivedBy, branchId: order.branch_id,
    newValues: { orderNumber: order.order_number, total: subtotal + totalLandingCosts + taxAmount, freightCost, totalLandingCosts },
    description: `Recepção ${order.order_number} - ${order.supplier_name} (frete: ${freightCost})`,
  });

  console.log(`[TX ENGINE] ═══ Purchase ${order.order_number} received ✓ (freight=${freightCost} capitalized) ═══`);
  return order;
}

// ==================== CREATE STOCK TRANSFER ====================

async function createStockTransfer(client, data) {
  const { fromBranchId, toBranchId, items, requestedBy, notes } = data;

  requireParam(fromBranchId, 'fromBranchId');
  requireParam(toBranchId, 'toBranchId');
  if (!items || items.length === 0) throw new Error('Transferência deve ter itens');
  if (fromBranchId === toBranchId) throw new Error('Filial de origem e destino devem ser diferentes');

  const fromBranch = await client.query('SELECT name FROM branches WHERE id = $1', [fromBranchId]);
  const toBranch = await client.query('SELECT name FROM branches WHERE id = $1', [toBranchId]);
  if (fromBranch.rows.length === 0) throw new Error('Filial de origem não encontrada');
  if (toBranch.rows.length === 0) throw new Error('Filial de destino não encontrada');

  const transferNumber = await generateSequenceNumber(client, 'stock_transfer', 'TRF');
  const transferId = randomUUID();

  await client.query(
    `INSERT INTO stock_transfers (id, transfer_number, from_branch_id, from_branch_name, to_branch_id, to_branch_name, requested_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [transferId, transferNumber, fromBranchId, fromBranch.rows[0].name, toBranchId, toBranch.rows[0].name, requestedBy, notes]
  );

  for (const item of items) {
    const itemId = randomUUID();
    await client.query(
      'INSERT INTO stock_transfer_items (id, transfer_id, product_id, product_name, sku, quantity) VALUES ($1,$2,$3,$4,$5,$6)',
      [itemId, transferId, item.productId, item.productName, item.sku, item.quantity]
    );
  }

  await auditLog(client, {
    tableName: 'stock_transfers', recordId: transferId, action: 'create',
    userId: requestedBy, branchId: fromBranchId,
    newValues: { transferNumber, from: fromBranch.rows[0].name, to: toBranch.rows[0].name, items: items.length },
    description: `Transferência ${transferNumber}: ${fromBranch.rows[0].name} → ${toBranch.rows[0].name}`,
  });

  console.log(`[TX ENGINE] Transfer ${transferNumber} created ✓`);

  const itemsResult = await client.query(
    'SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY created_at ASC',
    [transferId],
  );

  return {
    id: transferId,
    transfer_number: transferNumber,
    status: 'pending',
    from_branch_id: fromBranchId,
    from_branch_name: fromBranch.rows[0].name,
    to_branch_id: toBranchId,
    to_branch_name: toBranch.rows[0].name,
    items: itemsResult.rows,
  };
}

// ==================== PROCESS TRANSFER APPROVE (Stock OUT) ====================

async function processTransferApprove(client, transferId, approvedBy) {
  requireParam(transferId, 'transferId');
  requireParam(approvedBy, 'approvedBy');

  const transferResult = await client.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [transferId]);
  const transfer = transferResult.rows[0];
  if (!transfer) throw new Error('Transferência não encontrada');
  if (String(transfer.status || '').toLowerCase() !== 'pending') {
    throw new Error(`Transferência não pode ser aprovada no estado "${transfer.status || 'desconhecido'}".`);
  }

  const itemsResult = await client.query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [transferId]);

  for (const item of itemsResult.rows) {
    await recordStockMovement(client, {
      productId: item.product_id, warehouseId: transfer.from_branch_id,
      movementType: 'OUT', quantity: item.quantity, unitCost: 0,
      referenceType: 'transfer', referenceId: transferId,
      referenceNumber: transfer.transfer_number,
      notes: `Para ${transfer.to_branch_name}`, createdBy: approvedBy,
    });
  }

  await client.query(
    `UPDATE stock_transfers SET status = 'in_transit', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [approvedBy, transferId]
  );

  await auditLog(client, {
    tableName: 'stock_transfers', recordId: transferId, action: 'approve',
    userId: approvedBy, branchId: transfer.from_branch_id,
    description: `Aprovada transferência ${transfer.transfer_number}`,
  });

  console.log(`[TX ENGINE] Transfer ${transfer.transfer_number} approved ✓`);
  return transfer;
}

// ==================== PROCESS TRANSFER RECEIVE (Stock IN) ====================

async function processTransferReceive(client, transferId, receivedQuantities, receivedBy) {
  requireParam(transferId, 'transferId');
  requireParam(receivedBy, 'receivedBy');

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  const transferResult = await client.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [transferId]);
  const transfer = transferResult.rows[0];
  if (!transfer) throw new Error('Transferência não encontrada');
  const transferStatus = String(transfer.status || '').toLowerCase();
  if (transferStatus !== 'in_transit' && transferStatus !== 'approved') {
    throw new Error(`Transferência não pode ser recebida no estado "${transfer.status || 'desconhecido'}".`);
  }

  const itemsResult = await client.query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [transferId]);

  let totalTransferValue = 0;

  for (const item of itemsResult.rows) {
    const receivedQty = receivedQuantities?.[item.product_id] ?? item.quantity;
    await client.query('UPDATE stock_transfer_items SET received_quantity = $1 WHERE id = $2', [receivedQty, item.id]);

    if (receivedQty > 0) {
      // Resolve or create destination branch product by SKU
      const sourceProduct = await client.query(
        'SELECT id, name, sku, barcode, category, price, cost, unit, tax_rate, branch_id FROM products WHERE id = $1',
        [item.product_id]
      );
      if (sourceProduct.rows.length === 0) throw new Error(`Produto de origem não encontrado: ${item.product_id}`);
      const src = sourceProduct.rows[0];
      const unitCost = parseFloat(src.cost) || 0;

      const destProductId = await resolveOrCloneProductForBranch(
        client,
        src,
        transfer.to_branch_id,
        { reuseExistingBySku: true }
      );

      totalTransferValue += unitCost * receivedQty;

      await recordStockMovement(client, {
        productId: destProductId, warehouseId: transfer.to_branch_id,
        movementType: 'IN', quantity: receivedQty, unitCost,
        referenceType: 'transfer', referenceId: transferId,
        referenceNumber: transfer.transfer_number,
        notes: `De ${transfer.from_branch_name}`, createdBy: receivedBy,
      });
    }
  }

  await client.query(
    `UPDATE stock_transfers SET status = 'received', received_by = $1, received_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [receivedBy, transferId]
  );

  // Journal entry for internal movement
  if (totalTransferValue > 0) {
    await createJournalEntry(client, {
      description: `Transferência ${transfer.transfer_number}`,
      referenceType: 'transfer', referenceId: transferId,
      branchId: transfer.from_branch_id, createdBy: receivedBy,
      lines: [
        { accountCode: '2.2', description: `Entrada ${transfer.to_branch_name}`, debit: totalTransferValue, credit: 0 },
        { accountCode: '2.2', description: `Saída ${transfer.from_branch_name}`, debit: 0, credit: totalTransferValue },
      ],
    });
  }

  await auditLog(client, {
    tableName: 'stock_transfers', recordId: transferId, action: 'status_change',
    userId: receivedBy, branchId: transfer.to_branch_id,
    description: `Recepção transferência ${transfer.transfer_number}`,
  });

  console.log(`[TX ENGINE] Transfer ${transfer.transfer_number} received ✓`);
  return transfer;
}

// ==================== PROCESS PAYMENT ====================

async function processPayment(client, paymentData) {
  const {
    paymentType, entityType, entityId, entityName,
    paymentMethod, amount, branchId, createdBy,
    bankAccount, reference, notes, invoiceIds
  } = paymentData;

  requireParam(paymentType, 'paymentType');
  requireParam(entityType, 'entityType');
  requireParam(branchId, 'branchId');
  requireParam(createdBy, 'createdBy');
  const paymentAmount = requirePositive(amount, 'amount');

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  // Sequence-based payment number
  const seqType = paymentType === 'receipt' ? 'payment_receipt' : 'payment_out';
  const prefix = paymentType === 'receipt' ? 'REC' : 'PAG';
  const paymentNumber = await generateSequenceNumber(client, seqType, prefix);

  const paymentId = randomUUID();
  await client.query(
    `INSERT INTO payments (id, payment_number, payment_type, entity_type, entity_id, entity_name,
     payment_method, amount, bank_account, reference, notes, branch_id, created_by, posted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`,
    [paymentId, paymentNumber, paymentType, entityType, entityId, entityName,
     paymentMethod, paymentAmount, bankAccount || '', reference || '', notes || '', branchId, createdBy]
  );

  // Create open item (credit side)
  const paymentOpenItem = await createOpenItem(client, {
    entityType, entityId, documentType: 'payment',
    documentId: paymentId, documentNumber: paymentNumber,
    documentDate: today, originalAmount: paymentAmount, isDebit: false, branchId,
  });

  // Auto-clear against open invoices / payables (debit open items)
  const requestedIds = Array.isArray(invoiceIds)
    ? invoiceIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  let openInvoices;
  if (requestedIds.length > 0) {
    const ph = requestedIds.map((_, i) => `$${i + 3}`).join(', ');
    openInvoices = await client.query(
      `SELECT * FROM open_items
       WHERE entity_type = $1 AND entity_id = $2
         AND status != 'cleared'
         AND (is_debit = 1 OR is_debit = TRUE)
         AND (document_id IN (${ph}) OR id IN (${ph}))
       ORDER BY document_date ASC`,
      [entityType, entityId, ...requestedIds, ...requestedIds],
    );
  } else {
    openInvoices = await client.query(
      `SELECT * FROM open_items
       WHERE entity_type = $1 AND entity_id = $2
         AND status != 'cleared'
         AND (is_debit = 1 OR is_debit = TRUE)
       ORDER BY document_date ASC`,
      [entityType, entityId],
    );
  }

  let remaining = paymentAmount;
  const clearIds = [];
  const clearAmounts = [];
  const clearedRows = [];
  for (const inv of openInvoices.rows) {
    if (remaining <= 0.001) break;
    const invRem = parseFloat(inv.remaining_amount || 0);
    if (invRem <= 0.001) continue;
    const clearAmt = Math.min(remaining, invRem);
    clearIds.push(inv.id);
    clearAmounts.push(clearAmt);
    clearedRows.push(inv);
    remaining -= clearAmt;
  }

  if (clearIds.length > 0) {
    await clearOpenItems(client, {
      paymentItemId: paymentOpenItem.id,
      invoiceItemIds: clearIds,
      amounts: clearAmounts,
      clearedBy: createdBy,
    });
    console.log(
      `[TX ENGINE] Payment ${paymentNumber}: cleared ${clearIds.length} open item(s), ${roundMoney(paymentAmount - remaining)} AOA applied`,
    );
  } else if (requestedIds.length > 0) {
    console.warn(
      `[TX ENGINE] Payment ${paymentNumber}: no matching open debit items for requested document ids`,
    );
  }

  for (const inv of clearedRows) {
    try {
      await linkDocuments(
        client,
        paymentType,
        paymentId,
        paymentNumber,
        inv.document_type,
        inv.document_id,
        inv.document_number,
      );
    } catch (e) {
      console.warn('[TX ENGINE] document link skipped:', e.message);
    }
  }

  if (entityType === 'supplier' && entityId) {
    await syncSupplierBalanceFromOpenItems(client, entityId);
  }

  // Journal entry — prefer bank account for non-cash; fall back to caixa if bank not in COA
  let cashAccountCode = paymentMethod === 'cash' ? '4.1.1' : '4.2.1';
  const preferredCash = await findAccountByCode(client, cashAccountCode);
  if (!preferredCash) {
    const caixa = await findAccountByCode(client, '4.1.1');
    if (!caixa) {
      throw new Error(`Conta de tesouraria não encontrada no plano de contas (${cashAccountCode} / 4.1.1)`);
    }
    cashAccountCode = '4.1.1';
  }
  const entityAccountCode = await getEntityAccountCode(client, entityType, entityId, entityName);

  const lines = paymentType === 'receipt'
    ? [
        { accountCode: cashAccountCode, description: `Recebimento ${paymentNumber}`, debit: paymentAmount, credit: 0 },
        { accountCode: entityAccountCode, description: entityName, debit: 0, credit: paymentAmount },
      ]
    : [
        { accountCode: entityAccountCode, description: entityName, debit: paymentAmount, credit: 0 },
        { accountCode: cashAccountCode, description: `Pagamento ${paymentNumber}`, debit: 0, credit: paymentAmount },
      ];

  await createJournalEntry(client, {
    description: `${paymentType === 'receipt' ? 'Recebimento' : 'Pagamento'} ${paymentNumber} - ${entityName}`,
    referenceType: paymentType, referenceId: paymentId,
    branchId, createdBy, lines,
  });

  await auditLog(client, {
    tableName: 'payments', recordId: paymentId, action: 'create',
    userId: createdBy, branchId,
    newValues: { paymentNumber, paymentType, entityName, amount: paymentAmount, paymentMethod },
    description: `${paymentType === 'receipt' ? 'Recebimento' : 'Pagamento'} ${paymentNumber} - ${entityName} - ${paymentAmount} AOA`,
  });

  console.log(`[TX ENGINE] Payment ${paymentNumber} ✓`);
  return { id: paymentId, payment_number: paymentNumber, amount: paymentAmount };
}

// ==================== EXPORTS ====================

module.exports = {
  // Stock
  recordStockMovement,
  reconcileSkuStockAtWarehouse,
  resolveStockEntryDirection,
  normalizeStandaloneMovementType,
  getStock,
  // Open Items
  createOpenItem,
  clearOpenItems,
  reduceSupplierInvoiceOpenItem,
  adoptPurchaseOrderOpenItemForInvoice,
  syncSupplierBalanceFromOpenItems,
  isOpenItemDebitFlag,
  // Documents
  linkDocuments,
  // Period
  validatePeriod,
  // Transaction Processors
  processSale,
  createPurchaseOrder,
  processPurchaseReceive,
  createStockTransfer,
  processTransferApprove,
  processTransferReceive,
  processPayment,
  processStockAdjustment,
  // Helpers
  auditLog,
  getEntityAccountCode,
  ensureInventoryShrinkageAccount,
};
