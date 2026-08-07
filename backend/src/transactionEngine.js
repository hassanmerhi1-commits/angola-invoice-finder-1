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
const {
  openItemIsDebitSql,
  openItemDebitAmountCase,
  emptyBranchIdClause,
  coalesceActiveNotZero,
  activeFlagWhere,
} = require('./lib/sqlDialect');
const { createJournalEntry, generateSequenceNumber, allocateUniqueSaleInvoiceNumber, isUniqueViolation, findAccountByCode } = require('./accounting');
const {
  findProductBySkuAndBranch,
  isCatalogBranchScope,
  isUniqueSkuBranchError,
  loadMainBranchIds,
  sqlMovementSkuKey,
} = require('./lib/productSkuResolve');
const { randomUUID } = require('crypto');
const { normalizeSqlDate } = require('./lib/dateSql');
const { resolveBranchCaixaGlAccountCode } = require('./lib/resolveBranchCaixaGlAccount');
const { resolveEntityAccountCode } = require('./lib/entityCoaAccounts');
const { resolveBankGlForTreasury } = require('./lib/bankGlAccounts');
const { runInSavepoint, runOptionalInSavepoint } = require('./lib/pgSavepoint');

// ==================== PGC (novo com IVA) POSTING ACCOUNT CODES ====================
// Angola Plano Geral de Contabilidade with no-dot numbering (main 11 → first sub 111).
// Central map so the chart-of-accounts renumbering stays in a single place.
const ACC = {
  CLIENTS_PARENT: '31',
  CLIENTS_CURRENT: '311', // Clientes - correntes (default/parent for client sub-accounts)
  SUPPLIERS_PARENT: '32',
  SUPPLIERS_CURRENT: '321', // Fornecedores - correntes (default/parent for supplier sub-accounts)
  IVA_DEDUCTIBLE: '3451', // Estado > IVA dedutível (input VAT)
  IVA_LIQUIDATED: '3452', // Estado > IVA liquidado (output VAT)
  CASH: '451', // Caixa (Fundo fixo) — default cash leaf
  CASH_PARENT: '45', // Caixa
  BANK: '431', // Depósitos à ordem - Moeda nacional
  BANK_PARENT: '43', // Depósitos à ordem
  SALES: '613', // Vendas - Mercadorias
  OTHER_INCOME: '638', // Outros proveitos e ganhos operacionais
  REVALUATION_RESERVE: '561', // Reservas de reavaliação
  PURCHASES_MERCHANDISE: '212', // Compras - Mercadorias
  INVENTORY_STOCK: '261', // Mercadorias em armazém
  COGS: '711', // Custo das mercadorias vendidas
  COGS_PARENT: '71', // Custo das existências vendidas
  FREIGHT_ON_PURCHASES: '752', // Fornecimentos e serviços de terceiros
  FREIGHT_PARENT: '75', // Outros custos e perdas operacionais
  INVENTORY_SHRINKAGE: '758', // Outros custos e perdas operacionais
};

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
  if (uuid) {
    const check = await client.query(
      db.engine === 'postgres'
        ? `SELECT id::text AS id FROM branches WHERE id::text = $1 LIMIT 1`
        : `SELECT CAST(id AS TEXT) AS id FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1`,
      [uuid],
    );
    if (check.rows[0]?.id) return String(check.rows[0].id);
  }

  const { resolveBranchFilterId } = require('./lib/branchIdMatch');
  const resolved = await resolveBranchFilterId(client, trimmed);
  return resolved || null;
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
  const {
    tableName, recordId, action, userId, userName, branchId,
    oldValues, newValues, description, metadata, workstationId, ipAddress,
  } = params;
  const savepointName = 'audit_log_insert';
  let savepointCreated = false;
  try {
    await client.query(`SAVEPOINT ${savepointName}`);
    savepointCreated = true;
    const auditId = randomUUID();
    const baseParams = [
      auditId, tableName, recordId, action, userId, userName, branchId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      description,
    ];
    try {
      await client.query(
        `INSERT INTO audit_log (
          id, table_name, record_id, action, user_id, user_name, branch_id,
          old_values, new_values, description, metadata, workstation_id, ip_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          ...baseParams,
          metadata ? JSON.stringify(metadata) : null,
          workstationId || null,
          ipAddress || null,
        ],
      );
    } catch (extendedErr) {
      await client.query(
        `INSERT INTO audit_log (
          id, table_name, record_id, action, user_id, user_name, branch_id,
          old_values, new_values, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        baseParams,
      );
    }
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);
  } catch (e) {
    if (savepointCreated) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (rollbackError) {
        console.error('[AUDIT] Failed to recover savepoint:', rollbackError.message);
        throw e;
      }
    }
    console.warn('[AUDIT] Log skipped:', e.message);
  }
}

// ==================== ENTITY ACCOUNT LOOKUP ====================

async function getEntityAccountCode(client, entityType, entityId, entityName) {
  // Resolve (and create if needed) the 8-digit leaf under 311/321 — never post
  // payments/purchases to the parent once a supplier/client leaf exists.
  return resolveEntityAccountCode(client, entityType, entityId, entityName);
}

/** Resolve the 311xxxx client receivable leaf for a registered customer (credit sales). */
async function resolveCustomerReceivableAccount(client, clientId) {
  const result = await client.query(
    `SELECT id, name, nif, credit_limit, current_balance, payment_terms_days
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId],
  );
  if (result.rows.length === 0) {
    throw new Error('Cliente não encontrado');
  }
  const row = result.rows[0];
  const name = String(row.name || '').trim();
  // Always resolve/create the 8-digit leaf (311xxxxx) — never post credit sales to header 311.
  const accountCode = await resolveEntityAccountCode(client, 'customer', clientId, name);
  return { accountCode, client: row };
}

const INVENTORY_MERCHANDISE_ACCOUNT = ACC.PURCHASES_MERCHANDISE;
const INVENTORY_STOCK_ACCOUNT = ACC.INVENTORY_STOCK;

async function ensureFreightExpenseAccount(client) {
  const existing = await findAccountByCode(client, ACC.FREIGHT_ON_PURCHASES);
  if (existing) return existing.code;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [ACC.FREIGHT_PARENT]
  );

  if (parentResult.rows.length === 0) {
    throw new Error(`Conta ${ACC.FREIGHT_PARENT} não encontrada para lançar frete`);
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, $2, 'Fornecimentos e serviços de terceiros', 'expense', 'debit', $3, 2, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), ACC.FREIGHT_ON_PURCHASES, parentResult.rows[0].id]
  );

  return ACC.FREIGHT_ON_PURCHASES;
}

async function ensureInventoryShrinkageAccount(client) {
  const existing = await findAccountByCode(client, ACC.INVENTORY_SHRINKAGE);
  if (existing) return existing.code;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [ACC.FREIGHT_PARENT]
  );
  if (parentResult.rows.length === 0) {
    return ACC.COGS;
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, $2, 'Perdas e Quebras de Inventário', 'expense', 'debit', $3, 2, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), ACC.INVENTORY_SHRINKAGE, parentResult.rows[0].id]
  );

  return ACC.INVENTORY_SHRINKAGE;
}

async function ensureInventoryStockAccount(client) {
  const existing = await findAccountByCode(client, INVENTORY_STOCK_ACCOUNT);
  if (existing) return existing.code;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '26' AND ${activeFlagWhere(db, 'is_active')} LIMIT 1`,
  );
  const parentId = parentResult.rows[0]?.id || null;

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, $2, 'Mercadorias', 'asset', 'debit', $3, 2, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), INVENTORY_STOCK_ACCOUNT, parentId],
  );

  return INVENTORY_STOCK_ACCOUNT;
}

async function assertTransferStockAvailable(client, productId, warehouseId, quantity, productName, actorUuid) {
  const stockInfo = await getAvailableStockForSale(client, productId, warehouseId, actorUuid);
  const qty = Number(quantity);
  if (stockInfo.available + 0.0001 < qty) {
    throw new Error(
      `Stock insuficiente para ${stockInfo.name || productName || 'produto'}. `
      + `Disponível: ${stockInfo.available}, Solicitado: ${qty}`,
    );
  }
  return stockInfo;
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

  const skuRow = await client.query(
    `SELECT sku FROM products WHERE id = $1`,
    [productId],
  );
  const skuKey = String(skuRow.rows[0]?.sku || '').trim();
  if (skuKey) {
    await client.query(
      `UPDATE products
       SET cost = $1, last_cost = $2, avg_cost = $1, updated_at = CURRENT_TIMESTAMP
       WHERE ${coalesceActiveNotZero(db, 'is_active')}
         AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($3)
         AND id != $4`,
      [nextAvg, nextLast, skuKey, productId],
    );
  }
}

/** Stamp supplier on purchased products (inventory grid "Fornecedor" column). */
async function applyPurchaseSupplierToProducts(client, params) {
  const supplierName = String(params.supplierName || '').trim();
  const supplierUuid = normalizeUuid(params.supplierId);
  if (!supplierName && !supplierUuid) return;

  let linkedSupplierId = null;
  if (supplierUuid) {
    const chk = await client.query('SELECT id FROM suppliers WHERE id = $1 LIMIT 1', [supplierUuid]);
    if (chk.rows.length > 0) linkedSupplierId = supplierUuid;
  }

  const productIds = [...new Set((params.productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const skuKeys = [...new Set((params.skuKeys || []).map((s) => String(s || '').trim()).filter(Boolean))];

  for (const pid of productIds) {
    if (linkedSupplierId) {
      await client.query(
        `UPDATE products
         SET supplier_id = $1,
             supplier_name = COALESCE(NULLIF($2, ''), supplier_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [linkedSupplierId, supplierName, pid],
      );
    } else if (supplierName) {
      await client.query(
        `UPDATE products
         SET supplier_name = COALESCE(NULLIF($1, ''), supplier_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [supplierName, pid],
      );
    }
  }

  for (const sku of skuKeys) {
    if (linkedSupplierId) {
      await client.query(
        `UPDATE products
         SET supplier_id = $1,
             supplier_name = COALESCE(NULLIF($2, ''), supplier_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE ${coalesceActiveNotZero(db, 'is_active')}
           AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($3)`,
        [linkedSupplierId, supplierName, sku],
      );
    } else if (supplierName) {
      await client.query(
        `UPDATE products
         SET supplier_name = COALESCE(NULLIF($1, ''), supplier_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE ${coalesceActiveNotZero(db, 'is_active')}
           AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($2)`,
        [supplierName, sku],
      );
    }
  }
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

function buildStockAdjustmentJournalLines(direction, referenceType, totalValue, docLabel, freightOpts = {}) {
  const amount = Math.round((parseFloat(totalValue) || 0) * 100) / 100;
  if (amount <= 0) return [];

  const ref = String(referenceType || '').toLowerCase();
  const landingCosts = Math.round((parseFloat(freightOpts.landingCosts) || 0) * 100) / 100;
  const freightSourceAccount = String(freightOpts.freightSourceAccount || '').trim();
  const freightSourceName = String(freightOpts.freightSourceName || '').trim() || 'Pagamento frete';
  const supplierAccountCode = String(freightOpts.supplierAccountCode || '').trim();
  const splitFreight = landingCosts > 0 && freightSourceAccount.length > 0;
  const merchandiseValue = splitFreight
    ? Math.max(Math.round((amount - landingCosts) * 100) / 100, 0)
    : amount;

  if (direction === 'IN') {
    let creditAccount = ACC.OTHER_INCOME;
    let creditDesc = 'Contrapartida entrada inventário';

    if (ref === 'initial') {
      creditAccount = ACC.REVALUATION_RESERVE;
      creditDesc = 'Existências iniciais';
    } else if (ref === 'purchase') {
      if (!/^321\d+$/i.test(supplierAccountCode)) {
        throw new Error('Stock purchase journal requires a supplier leaf account (321xxxxx)');
      }
      creditAccount = supplierAccountCode;
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

    const lines = [];
    if (merchandiseValue > 0) {
      lines.push(
        {
          accountCode: INVENTORY_MERCHANDISE_ACCOUNT,
          description: `Entrada mercadorias ${docLabel}`,
          debit: merchandiseValue,
          credit: 0,
        },
        {
          accountCode: creditAccount,
          description: creditDesc,
          debit: 0,
          credit: merchandiseValue,
        },
      );
    }
    if (splitFreight) {
      lines.push(
        {
          accountCode: ACC.FREIGHT_ON_PURCHASES,
          description: `Frete / transporte ${docLabel}`,
          debit: landingCosts,
          credit: 0,
        },
        {
          accountCode: freightSourceAccount,
          description: `${freightSourceName} — frete ${docLabel}`,
          debit: 0,
          credit: landingCosts,
        },
      );
    }
    if (lines.length > 0) return lines;

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

  const shrinkageAccount = ACC.INVENTORY_SHRINKAGE;
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
    landingCosts,
    freightSourceAccount,
    freightSourceName,
    supplierId,
    supplierName,
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
  const touchedProductIds = new Set();
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
    if (resolvedProductId) touchedProductIds.add(String(resolvedProductId));
    totalValue += qty * unitCost;

    if (normalizedDirection === 'IN' && unitCost > 0) {
      await applyWeightedAverageCostAfterIn(client, resolvedProductId, qty, unitCost);
    }

    // Optional VAT update on stock IN (Stock Entry can edit product IVA).
    // Any rate change requires acknowledgement — never silently write 5% (or any other
    // rate) onto an existing product from Adjust In / import defaults.
    if (normalizedDirection === 'IN' && line.taxRate != null && line.taxRate !== '') {
      const {
        DEFAULT_VAT_RATE,
        normalizeTaxRate,
        taxCodeForRate,
        shouldPreserveExistingTaxRate,
        isTruthyFlag,
      } = require('./taxDefaults');
      const rate = normalizeTaxRate(line.taxRate, Number.NaN);
      if (Number.isFinite(rate) && rate >= 0) {
        let skipTaxWrite = false;
        try {
          const curRes = await client.query(
            `SELECT tax_rate, vat_override FROM products WHERE id = $1`,
            [resolvedProductId],
          );
          const cur = curRes.rows?.[0];
          if (cur) {
            const clientSetsOverride = isTruthyFlag(line.vatOverride ?? line.vat_override);
            if (
              shouldPreserveExistingTaxRate(cur, rate, {
                clientSetsOverride,
                forceVatChange: line.forceVatChange === true,
              })
            ) {
              skipTaxWrite = true;
            }
          }
        } catch (_) {
          /* products.vat_override may be missing on older DBs */
        }
        if (!skipTaxWrite) {
          const code = taxCodeForRate(rate);
          await client.query(
            `UPDATE products SET tax_rate = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [rate, resolvedProductId],
          );
          try {
            await client.query(
              `UPDATE products SET tax_code = $1 WHERE id = $2`,
              [code, resolvedProductId],
            );
          } catch (_) {
            /* tax_code column may be missing on older DBs */
          }
          if (Math.abs(rate - Number(DEFAULT_VAT_RATE)) > 0.0001) {
            try {
              await client.query(
                `UPDATE products SET vat_override = $1 WHERE id = $2`,
                [true, resolvedProductId],
              );
            } catch (_) { /* column may be missing */ }
          }
        }
      }
    }
  }

  totalValue = Math.round(totalValue * 100) / 100;

  let supplierAccountCode = '';
  if (
    normalizedDirection === 'IN'
    && String(referenceType || '').toLowerCase() === 'purchase'
  ) {
    if (!supplierId && !supplierName) {
      throw new Error(
        'Stock purchase adjustment requires supplierId or supplierName so the AP leaf (321xxxxx) can be posted.',
      );
    }
    supplierAccountCode = await resolveEntityAccountCode(
      client,
      'supplier',
      supplierId || null,
      supplierName || '',
    );
    if (!/^321\d+$/i.test(String(supplierAccountCode || ''))) {
      throw new Error(
        `Could not resolve supplier COA leaf for stock purchase (got ${supplierAccountCode || 'none'}).`,
      );
    }
  }

  let journalEntryId = null;
  const journalLines = buildStockAdjustmentJournalLines(
    normalizedDirection,
    referenceType,
    totalValue,
    docLabel,
    { landingCosts, freightSourceAccount, freightSourceName, supplierAccountCode },
  );

  if (journalLines.length > 0) {
    if (journalLines.some((l) => l.accountCode === ACC.INVENTORY_SHRINKAGE)) {
      await ensureInventoryShrinkageAccount(client);
    }
    if (journalLines.some((l) => l.accountCode === ACC.FREIGHT_ON_PURCHASES)) {
      await ensureFreightExpenseAccount(client);
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

  // Compact snapshots so clients can patch inventory rows without a full grid refetch.
  // Use portable IN (...) placeholders — ANY($1::uuid[]) is Postgres-only and breaks SQLite.
  const touchedIds = [...touchedProductIds];
  let productUpdates = [];
  if (touchedIds.length > 0) {
    const placeholders = touchedIds.map((_, i) => `$${i + 1}`).join(', ');
    const snap = await client.query(
      `SELECT id, sku, stock, cost, avg_cost, last_cost, tax_rate
       FROM products WHERE id IN (${placeholders})`,
      touchedIds,
    );
    productUpdates = snap.rows.map((r) => ({
      productId: String(r.id),
      sku: r.sku != null ? String(r.sku) : '',
      stock: Math.max(0, parseFloat(r.stock) || 0),
      cost: parseFloat(r.cost) || 0,
      avgCost: parseFloat(r.avg_cost) || 0,
      lastCost: parseFloat(r.last_cost) || 0,
      taxRate: r.tax_rate != null && r.tax_rate !== '' ? Number(r.tax_rate) : undefined,
    }));
  }

  return {
    documentId,
    referenceNumber: docNumber,
    movementIds,
    journalEntryId,
    totalValue,
    direction: normalizedDirection,
    productUpdates,
  };
}

const ADJUSTMENT_VOID_REF_TYPES = new Set([
  'adjustment',
  'correction',
  'damage',
  'initial',
  'loss',
  'expired',
  'internal_use',
  'sample',
  'donation',
]);

/**
 * Void a stock adjustment document: reverse movements + reverse journal (audit-safe).
 */
async function voidStockAdjustment(client, data) {
  const documentId = String(data.documentId || data.referenceId || '').trim();
  const voidedBy = normalizeUuid(data.voidedBy || data.createdBy);
  const reason = String(data.reason || 'Anulado pelo utilizador').trim();

  if (!documentId) throw new Error('documentId é obrigatório');

  const voidCheck = await client.query(
    `SELECT id FROM stock_movements
     WHERE reference_id = $1 AND reference_type = 'adjustment_void'
     LIMIT 1`,
    [documentId],
  );
  if (voidCheck.rows.length > 0) {
    throw new Error('Este ajuste já foi anulado');
  }

  const movResult = await client.query(
    `SELECT sm.*, p.sku, p.name AS product_name
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     WHERE sm.reference_id = $1
       AND sm.reference_type != 'adjustment_void'
       AND COALESCE(sm.notes, '') NOT LIKE '%[ANULADO]%'
     ORDER BY sm.created_at`,
    [documentId],
  );

  if (movResult.rows.length === 0) {
    throw new Error('Ajuste não encontrado ou já anulado');
  }

  for (const row of movResult.rows) {
    const refType = String(row.reference_type || '').toLowerCase();
    if (!ADJUSTMENT_VOID_REF_TYPES.has(refType) && !/^AJ-/i.test(String(row.reference_number || ''))) {
      throw new Error('Apenas ajustes de inventário podem ser anulados');
    }
  }

  const first = movResult.rows[0];
  const warehouseId = first.warehouse_id;
  const refNumber = String(first.reference_number || documentId).trim();
  const voidRefNumber = `VOID-${refNumber}`;
  const docDate = new Date().toISOString().split('T')[0];
  await validatePeriod(client, docDate);

  const reversalIds = [];
  for (const row of movResult.rows) {
    const opposite = String(row.movement_type).toUpperCase() === 'IN' ? 'OUT' : 'IN';
    const movement = await recordStockMovement(client, {
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      movementType: opposite,
      quantity: row.quantity,
      unitCost: Number(row.unit_cost) || 0,
      referenceType: 'adjustment_void',
      referenceId: documentId,
      referenceNumber: voidRefNumber,
      notes: `${reason} — anula ${refNumber}`,
      createdBy: voidedBy,
    });
    reversalIds.push(movement.id);
  }

  let voidJournalEntryId = null;
  const jeResult = await client.query(
    `SELECT * FROM journal_entries
     WHERE reference_id = $1 AND reference_type = 'adjustment'
     LIMIT 1`,
    [documentId],
  );
  if (jeResult.rows[0]) {
    const linesResult = await client.query(
      `SELECT jel.debit_amount, jel.credit_amount, coa.code AS account_code
       FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE jel.journal_entry_id = $1`,
      [jeResult.rows[0].id],
    );
    const reverseLines = linesResult.rows
      .filter((l) => (Number(l.debit_amount) || 0) > 0 || (Number(l.credit_amount) || 0) > 0)
      .map((l) => ({
        accountCode: l.account_code,
        description: `Anulação ${refNumber}`,
        debit: Number(l.credit_amount) || 0,
        credit: Number(l.debit_amount) || 0,
      }));
    if (reverseLines.length > 0) {
      const entry = await createJournalEntry(client, {
        description: `Anulação ajuste ${refNumber}`,
        referenceType: 'adjustment_void',
        referenceId: documentId,
        branchId: jeResult.rows[0].branch_id || warehouseId,
        createdBy: voidedBy,
        entryDate: docDate,
        lines: reverseLines,
      });
      voidJournalEntryId = entry.id;
    }
  }

  await client.query(
    `UPDATE stock_movements
     SET notes = CASE
       WHEN COALESCE(notes, '') LIKE '%[ANULADO]%' THEN notes
       ELSE trim(COALESCE(notes, '') || ' [ANULADO]')
     END
     WHERE reference_id = $1 AND reference_type != 'adjustment_void'`,
    [documentId],
  );

  await auditLog(client, {
    tableName: 'stock_movements',
    recordId: documentId,
    action: 'void',
    userId: voidedBy,
    branchId: warehouseId,
    description: `Ajuste anulado ${refNumber}`,
    newValues: { voidRefNumber, reversalCount: reversalIds.length },
  });

  return {
    documentId,
    voidReferenceNumber: voidRefNumber,
    reversalMovementIds: reversalIds,
    voidJournalEntryId,
  };
}

/**
 * Replace a stock adjustment: void original + post new adjustment in one transaction.
 */
async function replaceStockAdjustment(client, data) {
  const documentId = String(data.documentId || '').trim();
  if (!documentId) throw new Error('documentId é obrigatório');

  await voidStockAdjustment(client, {
    documentId,
    voidedBy: data.createdBy,
    reason: String(data.voidReason || 'Substituído por edição'),
  });

  return processStockAdjustment(client, {
    direction: data.direction,
    warehouseId: data.warehouseId ?? data.warehouse_id,
    referenceNumber: data.referenceNumber ?? data.reference_number,
    referenceType: data.referenceType ?? data.reference_type,
    entryDate: data.entryDate ?? data.entry_date,
    notes: data.notes,
    createdBy: data.createdBy ?? data.created_by,
    lines: data.lines,
    landingCosts: data.landingCosts ?? data.landing_costs,
    freightSourceAccount: data.freightSourceAccount ?? data.freight_source_account,
    freightSourceName: data.freightSourceName ?? data.freight_source_name,
    supplierId: data.supplierId ?? data.supplier_id,
    supplierName: data.supplierName ?? data.supplier_name,
  });
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

  const { resolveBranchFilterId } = require('./lib/branchIdMatch');
  const resolvedWh = String(
    (await resolveBranchFilterId(client, warehouseId)) || warehouseId || '',
  ).trim();
  const whKey = resolvedWh.replace(/-/g, '').toLowerCase();

  const code = String(productIdOrCode).trim();
  const lookup = await client.query(
    `SELECT id
     FROM products
     WHERE ${coalesceActiveNotZero(db, 'is_active')}
       AND (
         LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
         OR TRIM(COALESCE(barcode, '')) = $2
       )
       AND (
         branch_id = $3
         OR branch_id IS NULL
         OR REPLACE(LOWER(TRIM(COALESCE(branch_id::text, ''))), '-', '') = $4
       )
     ORDER BY CASE
       WHEN branch_id = $3 THEN 0
       WHEN REPLACE(LOWER(TRIM(COALESCE(branch_id::text, ''))), '-', '') = $4 THEN 1
       WHEN branch_id IS NULL THEN 2
       ELSE 3
     END, created_at ASC
     LIMIT 1`,
    [code, code, resolvedWh, whKey]
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
  const { branchKeysEqual, resolveBranchFilterId } = require('./lib/branchIdMatch');
  const toBranch = String(
    (await resolveBranchFilterId(client, branchId)) || branchId || '',
  ).trim();
  if (!toBranch) throw new Error('branchId inválido para produto de destino');

  if (src.branch_id && branchKeysEqual(src.branch_id, toBranch)) {
    return src.id;
  }

  const sku = src.sku != null ? String(src.sku).trim() : '';
  if (sku) {
    const existing = await findProductBySkuAndBranch(client, sku, toBranch);
    if (existing) {
      const inactive =
        existing.is_active === 0 ||
        existing.is_active === false ||
        String(existing.is_active).toLowerCase() === 'false';
      if (inactive) {
        await client.query(
          `UPDATE products SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [existing.id],
        );
      }
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
  if (nameTrim && sku) {
    const byName = await client.query(
      `SELECT id, sku FROM products
       WHERE ${coalesceActiveNotZero(db, 'is_active')} AND branch_id = $1 AND LOWER(TRIM(name)) = LOWER($2)
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [toBranch, nameTrim]
    );
    if (byName.rows.length > 0) {
      const foundSku = String(byName.rows[0].sku || '').trim().toLowerCase();
      if (foundSku === sku.toLowerCase()) {
        return byName.rows[0].id;
      }
    }
  }

  const cloneId = randomUUID();
  const unitCost = parseFloat(src.cost) || 0;
  const mainBranchIds = await loadMainBranchIds(client);
  const storedBranchId = isCatalogBranchScope(toBranch, mainBranchIds)
    ? null
    : toBranch;

  try {
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
        require('./taxDefaults').normalizeTaxRate(src.tax_rate),
        storedBranchId,
      ],
    );
  } catch (insertErr) {
    if (isUniqueSkuBranchError(insertErr) && sku) {
      const again = await findProductBySkuAndBranch(client, sku, toBranch);
      if (again?.id) {
        const inactive =
          again.is_active === 0 ||
          again.is_active === false ||
          String(again.is_active).toLowerCase() === 'false';
        if (inactive) {
          await client.query(
            `UPDATE products SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [again.id],
          );
        }
        console.log(
          `[TX ENGINE] Reused existing product ${sku} @ ${toBranch} (${again.id}) after UNIQUE conflict`,
        );
        return again.id;
      }
    }
    throw insertErr;
  }
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

/**
 * Products migrated from SQLite often have products.stock but no stock_movements.
 * Before the first OUT, seed an opening IN so reconcile does not zero stock after a partial sale.
 */
async function ensureOpeningStockMovement(client, productId, warehouseId, createdByUuid) {
  const wh = String(warehouseId || '').trim();
  const pid = String(productId || '').trim();
  if (!wh || !pid) return;

  const movCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [pid, wh],
  );
  if (Number(movCount.rows[0]?.n || 0) > 0) return;

  const prod = await client.query(
    `SELECT stock, sku FROM products WHERE id = $1 FOR UPDATE`,
    [pid],
  );
  if (prod.rows.length === 0) return;

  let legacy = Math.max(0, parseFloat(prod.rows[0].stock || 0));
  const sku = String(prod.rows[0].sku || '').trim();
  if (sku) {
    const mainBranchIds = await loadMainBranchIds(client);
    const isCatalogWh = isCatalogBranchScope(wh, mainBranchIds);
    let legacySql = `
      SELECT COALESCE(SUM(stock), 0) AS legacy_stock
      FROM products
      WHERE ${coalesceActiveNotZero(db, 'is_active')}
        AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)`;
    const params = [sku];
    if (isCatalogWh) {
      legacySql += ` AND (${emptyBranchIdClause(db, 'branch_id')}`;
      for (const mainId of mainBranchIds) {
        params.push(mainId);
        legacySql += ` OR branch_id = $${params.length}`;
      }
      legacySql += ')';
    } else {
      params.push(wh);
      legacySql += ` AND (branch_id = $${params.length} OR ${emptyBranchIdClause(db, 'branch_id')})`;
    }
    const skuLegacy = await client.query(legacySql, params);
    legacy = Math.max(legacy, parseFloat(skuLegacy.rows[0]?.legacy_stock || 0));
  }

  if (legacy <= 0.0001) return;

  const movementId = randomUUID();
  let locationId = null;
  try {
    const { ensureDefaultWarehouse } = require('./lib/warehouses');
    const meta = await ensureDefaultWarehouse(client, wh);
    locationId = meta?.id || null;
  } catch {
    locationId = null;
  }
  await client.query(
    `INSERT INTO stock_movements
     (id, product_id, warehouse_id, location_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, reference_number, notes, created_by)
     VALUES ($1, $2, $3, $4, 'IN', $5, 0, 'opening_balance', NULL, 'LEGACY', 'Saldo inicial (stock existente)', $6)`,
    [movementId, pid, wh, locationId, legacy, createdByUuid],
  );
}

/**
 * Available qty for POS / sales — matches inventory grid (SKU ledger at warehouse + legacy stock).
 * Returns the product row id that should receive the OUT movement (filial row when applicable).
 */
async function getAvailableStockForSale(client, productId, warehouseId, createdByUuid = null) {
  const wh = String(warehouseId || '').trim();
  if (!productId || !wh) {
    throw new Error('Produto ou filial inválido');
  }

  let pid = isUuid(productId) ? productId : await resolveStockProductId(client, productId, wh);

  const mainBranchIds = await loadMainBranchIds(client);
  const isFilialWh = !isCatalogBranchScope(wh, mainBranchIds);

  const prodRes = await client.query(
    `SELECT id, name, sku, stock, branch_id FROM products WHERE id = $1 FOR UPDATE`,
    [pid],
  );
  if (prodRes.rows.length === 0) {
    throw new Error(`Produto não encontrado: ${productId}`);
  }
  let prod = prodRes.rows[0];
  const sku = String(prod.sku || '').trim();

  if (isFilialWh && sku) {
    const filialRow = await findProductBySkuAndBranch(client, sku, wh);
    if (filialRow && String(filialRow.id) !== String(pid)) {
      await client.query(`SELECT id, name, sku, stock, branch_id FROM products WHERE id = $1 FOR UPDATE`, [filialRow.id]);
      pid = filialRow.id;
      prod = filialRow;
    }
  }

  await ensureOpeningStockMovement(client, pid, wh, createdByUuid);

  const movProd = await client.query(
    `SELECT COALESCE(SUM(
       CASE WHEN movement_type = 'IN' THEN quantity WHEN movement_type = 'OUT' THEN -quantity ELSE 0 END
     ), 0) AS s
     FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [pid, wh],
  );
  const movementStock = Math.max(0, parseFloat(movProd.rows[0]?.s || 0));

  let skuMovement = movementStock;
  if (sku) {
    const skuKeyExpr = sqlMovementSkuKey('pm');
    const skuMov = await client.query(
      `SELECT CASE
         WHEN COALESCE(SUM(
           CASE WHEN sm.movement_type = 'IN' THEN sm.quantity WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END
         ), 0) < 0 THEN 0
         ELSE COALESCE(SUM(
           CASE WHEN sm.movement_type = 'IN' THEN sm.quantity WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END
         ), 0)
       END AS s
       FROM stock_movements sm
       INNER JOIN products pm ON pm.id = sm.product_id
       WHERE sm.warehouse_id = $1 AND ${skuKeyExpr} = LOWER(TRIM($2))`,
      [wh, sku],
    );
    skuMovement = Math.max(0, parseFloat(skuMov.rows[0]?.s || 0));
  }

  let legacyStock = Math.max(0, parseFloat(prod.stock || 0));
  if (sku) {
    let legacySql = `
      SELECT COALESCE(SUM(stock), 0) AS legacy_stock
      FROM products
      WHERE ${coalesceActiveNotZero(db, 'is_active')}
        AND LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM($1))`;
    const params = [sku];
    if (isFilialWh) {
      params.push(wh);
      legacySql += ` AND branch_id = $${params.length}`;
    } else {
      legacySql += ` AND (${emptyBranchIdClause(db, 'branch_id')}`;
      for (const mid of mainBranchIds) {
        params.push(mid);
        legacySql += ` OR branch_id = $${params.length}`;
      }
      legacySql += ')';
    }
    const leg = await client.query(legacySql, params);
    legacyStock = Math.max(legacyStock, parseFloat(leg.rows[0]?.legacy_stock || 0));
  }

  const availableOnHand = Math.max(skuMovement, movementStock, legacyStock);

  // Soft holds from reserved sales orders at this branch (warehouse_id = branch today).
  let reservedHold = 0;
  try {
    const holdParams = [wh, String(pid)];
    let holdSql = `
      SELECT COALESCE(SUM(i.reserved_qty), 0) AS qty
      FROM sales_order_items i
      INNER JOIN sales_orders o ON o.id = i.sales_order_id
      WHERE o.status IN ('reserved', 'partially_shipped')
        AND CAST(o.branch_id AS TEXT) = CAST($1 AS TEXT)
        AND COALESCE(i.reserved_qty, 0) > 0
        AND (
          CAST(i.product_id AS TEXT) = CAST($2 AS TEXT)`;
    if (sku) {
      holdParams.push(sku);
      holdSql += ` OR LOWER(TRIM(COALESCE(i.sku, ''))) = LOWER(TRIM($${holdParams.length}))`;
    }
    holdSql += ')';
    const hold = await client.query(holdSql, holdParams);
    reservedHold = Math.max(0, parseFloat(hold.rows[0]?.qty || 0));
  } catch (_) {
    // sales_orders may not exist on older DBs
  }

  const available = Math.max(0, availableOnHand - reservedHold);
  return { productId: pid, name: prod.name, available, reservedHold, onHand: availableOnHand };
}

/** After movements, align products.stock with movement ledger for this SKU at this warehouse. */
async function reconcileSkuStockAtWarehouse(client, sku, warehouseId) {
  const skuKey = String(sku || '').trim().toLowerCase();
  const wh = String(warehouseId || '').trim();
  if (!skuKey || !wh) return;

  const pmSkuMatch = `${sqlMovementSkuKey('pm')} = $2`;

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
       AND ${pmSkuMatch}`,
    [wh, skuKey]
  );
  const total = Math.max(0, parseFloat(sumResult.rows[0]?.total || 0));

  const mainBranchIds = await loadMainBranchIds(client);
  const rowSkuMatch = `${sqlMovementSkuKey('products')} = $2`;

  if (isCatalogBranchScope(wh, mainBranchIds)) {
    const params = [total, skuKey];
    let sql = `
      UPDATE products
      SET stock = $1, updated_at = CURRENT_TIMESTAMP
      WHERE ${coalesceActiveNotZero(db, 'is_active')}
        AND ${rowSkuMatch}
        AND (
          ${emptyBranchIdClause(db, 'branch_id')}`;
    for (const mainId of mainBranchIds) {
      params.push(mainId);
      sql += ` OR branch_id = $${params.length}`;
    }
    sql += ')';
    await client.query(sql, params);
    return;
  }

  // Filial: branch-owned rows + any product id that has movements at this warehouse (catalog IN at filial).
  await client.query(
    `UPDATE products
     SET stock = $1, updated_at = CURRENT_TIMESTAMP
     WHERE ${coalesceActiveNotZero(db, 'is_active')}
       AND ${rowSkuMatch}
       AND (
         branch_id = $3
         OR id IN (
           SELECT DISTINCT sm.product_id
           FROM stock_movements sm
           INNER JOIN products pm ON pm.id = sm.product_id
           WHERE sm.warehouse_id = $3
             AND ${pmSkuMatch}
         )
       )`,
    [total, skuKey, wh],
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

  const { branchKeysEqual } = require('./lib/branchIdMatch');
  if (src.branch_id && branchKeysEqual(src.branch_id, branchKey)) {
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

  if (normalizedMovementType === 'OUT') {
    await ensureOpeningStockMovement(client, resolvedProductId, resolvedWarehouseId, createdByUuid);
  }

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
         WHERE ${coalesceActiveNotZero(db, 'is_active')}
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

  let locationId = null;
  try {
    const { ensureDefaultWarehouse } = require('./lib/warehouses');
    const meta = await ensureDefaultWarehouse(client, resolvedWarehouseId);
    locationId = meta?.id || null;
  } catch {
    locationId = null;
  }

  const movementId = randomUUID();
  await client.query(
    `INSERT INTO stock_movements 
     (id, product_id, warehouse_id, location_id, movement_type, quantity, unit_cost,
      reference_type, reference_id, reference_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [movementId, resolvedProductId, resolvedWarehouseId, locationId, normalizedMovementType, qty, unitCost || 0,
     referenceType, referenceUuid, referenceNumber || '', notes || '', createdByUuid]
  );

  // Sync products.stock from movement ledger (never stock = stock - qty on a row that may still be 0).
  const skuForReconcile = await client.query('SELECT sku FROM products WHERE id = $1', [resolvedProductId]);
  const skuValue = skuForReconcile.rows[0]?.sku;
  if (skuValue) {
    await reconcileSkuStockAtWarehouse(client, skuValue, resolvedWarehouseId);
  } else {
    const sumResult = await client.query(
      `SELECT COALESCE(SUM(
         CASE WHEN movement_type = 'IN' THEN quantity WHEN movement_type = 'OUT' THEN -quantity ELSE 0 END
       ), 0) AS total
       FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
      [resolvedProductId, resolvedWarehouseId],
    );
    const total = Math.max(0, parseFloat(sumResult.rows[0]?.total || 0));
    await client.query(
      `UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [total, resolvedProductId],
    );
  }

  // Purchase/receipt IN: keep cost in sync and fill missing selling price from same SKU.
  if (normalizedMovementType === 'IN') {
    const cost = Number(unitCost || 0);
    if (cost > 0) {
      await client.query(
        `UPDATE products SET
           last_cost = $1,
           cost = CASE WHEN COALESCE(cost, 0) <= 0.0001 THEN $1 ELSE cost END,
           first_cost = CASE WHEN COALESCE(first_cost, 0) <= 0.0001 THEN $1 ELSE first_cost END,
           avg_cost = CASE WHEN COALESCE(avg_cost, 0) <= 0.0001 THEN $1 ELSE avg_cost END,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [cost, resolvedProductId],
      );
    }
    const skuKeyExpr = sqlMovementSkuKey('products');
    const peerSkuKeyExpr = sqlMovementSkuKey('p2');
    await client.query(
      `UPDATE products SET
         price = COALESCE((
           SELECT MAX(COALESCE(p2.price, 0))
           FROM products p2
           WHERE ${coalesceActiveNotZero(db, 'p2.is_active')}
             AND ${peerSkuKeyExpr} = ${skuKeyExpr}
             AND p2.id != products.id
             AND COALESCE(p2.price, 0) > 0
         ), price),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND COALESCE(price, 0) <= 0`,
      [resolvedProductId],
    );
  }

  // POS / inventory-grid reuse a short in-memory result cache — bust it on every ledger write.
  try {
    require('./lib/inventoryGridServerCache').invalidateInventoryGridResultCache();
  } catch (_) { /* ignore */ }

  return { id: movementId, product_id: resolvedProductId, movement_type: normalizedMovementType, quantity: qty };
}

/**
 * Get current stock for a product at a warehouse (SKU ledger at warehouse — matches inventory grid / POS).
 */
async function getStock(productId, warehouseId) {
  const resolvedWarehouseId = await resolveWarehouseId(db, warehouseId);
  const wh = resolvedWarehouseId || warehouseId;

  let pid = productId;
  if (!isUuid(productId)) {
    pid = await resolveStockProductId(db, productId, wh);
  }

  const skuRow = await db.query('SELECT sku FROM products WHERE id = $1', [pid]);
  const sku = skuRow.rows[0]?.sku != null ? String(skuRow.rows[0].sku).trim() : '';

  if (sku) {
    const skuKeyExpr = sqlMovementSkuKey('pm');
    const result = await db.query(
      `SELECT CASE
         WHEN COALESCE(SUM(
           CASE WHEN sm.movement_type = 'IN' THEN sm.quantity WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END
         ), 0) < 0 THEN 0
         ELSE COALESCE(SUM(
           CASE WHEN sm.movement_type = 'IN' THEN sm.quantity WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END
         ), 0)
       END AS stock
       FROM stock_movements sm
       INNER JOIN products pm ON pm.id = sm.product_id
       WHERE sm.warehouse_id = $1 AND ${skuKeyExpr} = LOWER(TRIM($2))`,
      [wh, sku],
    );
    return parseFloat(result.rows[0]?.stock || 0);
  }

  const result = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS stock
     FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [pid, wh],
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
  const docDate = normalizeSqlDate(documentDate, { allowNull: false });
  const due = normalizeSqlDate(dueDate);
  await client.query(
    `INSERT INTO open_items 
     (id, entity_type, entity_id, document_type, document_id, document_number,
      document_date, due_date, currency, original_amount, remaining_amount, is_debit, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)`,
    [oiId, entityType, entityId, documentType, documentId, documentNumber,
     docDate, due, currency || 'AOA', amount, isDebit, branchId]
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
    const debitWhere = openItemIsDebitSql(db, '');
    let result = await client.query(
      `SELECT id, entity_id, remaining_amount, document_number
       FROM open_items
       WHERE entity_type = 'supplier'
         AND document_id = $1
         AND ${debitWhere}
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
           AND ${debitWhere}
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
  const balanceCase = openItemDebitAmountCase(db, '');
  await client.query(
    `UPDATE suppliers SET balance = COALESCE((
       SELECT SUM(${balanceCase})
       FROM open_items
       WHERE entity_type = 'supplier' AND entity_id = $1
     ), 0)
     WHERE id = $1`,
    [supplierId]
  );
}

/**
 * Recompute clients.current_balance from open items. Credit sales bump the
 * balance inline; receipts / credit notes / voids must call this so the
 * balance falls again — otherwise credit-limit checks block clients who paid.
 */
async function syncClientBalanceFromOpenItems(client, clientId) {
  if (!clientId) return;
  const balanceCase = openItemDebitAmountCase(db, '');
  await runOptionalInSavepoint(client, 'client_balance_sync', async () => {
    await client.query(
      `UPDATE clients SET current_balance = COALESCE((
         SELECT SUM(${balanceCase})
         FROM open_items
         WHERE entity_type = 'customer' AND entity_id = $1
       ), 0),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [clientId],
    );
  }, (e) => {
    console.warn('[TX ENGINE] Client balance sync skipped:', e.message);
  });
}

async function reduceSupplierInvoiceOpenItem(client, { entityId, invoiceDocumentId, amount }) {
  const reduction = Number(amount || 0);
  if (!invoiceDocumentId || reduction <= 0) return null;

  const documentIds = await resolveSupplierPayableDocumentIds(client, invoiceDocumentId);
  let remaining = reduction;
  let lastResult = null;

  for (const docId of documentIds) {
    if (remaining <= 0.001) break;

    const debitWhere = openItemIsDebitSql(db, '');
    let result = await client.query(
      `SELECT id, entity_id, remaining_amount, document_number
       FROM open_items
       WHERE entity_type = 'supplier'
         AND document_id = $1
         AND ${debitWhere}
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
           AND ${debitWhere}
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

const SALE_PAYMENT_METHODS = new Set(['cash', 'card', 'transfer', 'cheque', 'mixed', 'credit']);

function normalizeSalePaymentMethod(saleData) {
  const raw = saleData?.paymentMethod ?? saleData?.payment_method ?? 'cash';
  const method = String(raw).trim().toLowerCase();
  if (!SALE_PAYMENT_METHODS.has(method)) {
    throw new Error(
      `Método de pagamento inválido: "${raw}". Use cash, card, transfer, cheque, mixed ou credit.`,
    );
  }
  return method;
}

async function processSale(client, saleData) {
  const paymentMethod = normalizeSalePaymentMethod(saleData);
  const {
    branchId, cashierId, cashierName, items,
    subtotal, taxAmount, discount, total,
    amountPaid, change,
    customerNif, customerName,
    clientRequestId, idempotencyKey,
    dueDate, invoiceType: requestedInvoiceType,
    parentProformaNumber, parentProformaId,
  } = saleData;
  const clientId = String(saleData.clientId || saleData.client_id || '').trim() || null;
  const clientReqId = clientRequestId || idempotencyKey || null;
  const salesOrderId = String(
    saleData.salesOrderId
    || saleData.sales_order_id
    || saleData.parentSalesOrderId
    || '',
  ).trim() || null;

  // ── Validation ──
  requireParam(branchId, 'branchId');
  requireParam(cashierId, 'cashierId');
  if (!items || items.length === 0) throw new Error('Venda deve ter pelo menos um item');
  const totalAmount = requirePositive(total, 'total');
  const isCreditSale = paymentMethod === 'credit';
  if (isCreditSale) {
    requireParam(clientId, 'clientId');
  }

  const today = new Date().toISOString().split('T')[0];
  let saleDueDate = dueDate ? String(dueDate).slice(0, 10) : today;

  // ── Step 0: Validate period ──
  await validatePeriod(client, today);

  // If linked sales order already shipped (stock OUT on sales_order), skip stock validation + movement.
  let skipSaleStock = false;
  if (salesOrderId) {
    const shipped = await client.query(
      `SELECT id FROM stock_movements
       WHERE reference_type = 'sales_order'
         AND movement_type = 'OUT'
         AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
       LIMIT 1`,
      [salesOrderId],
    );
    skipSaleStock = shipped.rows.length > 0;
  }

  // ── Step 1: Resolve fiscal type (number allocated after validation, before insert) ──
  const {
    validateSaleInvoiceType,
    normalizeCustomerNif,
    sequenceKeyForInvoiceType,
    prefixForInvoiceType,
  } = require('./lib/fiscalInvoiceType');
  const normalizedCustomerNif = normalizeCustomerNif(customerNif);
  const { normalizeBranchCode } = require('./accounting');

  const invoiceType = validateSaleInvoiceType({
    customerNif: normalizedCustomerNif,
    paymentMethod,
    total: totalAmount,
  });

  const branchCodeRow = await client.query('SELECT code, name FROM branches WHERE id = $1 LIMIT 1', [branchId]);
  const branchCode = normalizeBranchCode(branchCodeRow.rows[0]?.code);
  const branchNameForGl = String(branchCodeRow.rows[0]?.name || '').trim();
  const seqKey = sequenceKeyForInvoiceType(invoiceType);
  const seqPrefix = prefixForInvoiceType(invoiceType);
  const seqScope = { branchId, branchCode };

  // ── Step 2: Resolve product IDs + Validate stock BEFORE any writes (FOR UPDATE) ──
  const resolvedItems = [];
  const cashierUuid = normalizeUuid(cashierId);
  for (const item of items) {
    let pid = isUuid(item.productId) ? item.productId : null;

    if (!pid && (item.productId || item.sku)) {
      try {
        pid = await runInSavepoint(client, 'resolve_product', () =>
          resolveStockProductId(client, item.productId || item.sku, branchId),
        );
      } catch {
        pid = null;
      }
    }

    let resolvedPid = pid;
    if (pid && !skipSaleStock) {
      const stockInfo = await getAvailableStockForSale(client, pid, branchId, cashierUuid);
      resolvedPid = stockInfo.productId;
      if (stockInfo.available + 0.0001 < Number(item.quantity)) {
        throw new Error(
          `Stock insuficiente para ${stockInfo.name}. Disponível: ${stockInfo.available}, Solicitado: ${item.quantity}`,
        );
      }
    } else if (pid && skipSaleStock) {
      try {
        resolvedPid = await runInSavepoint(client, 'resolve_product_shipped', () =>
          resolveStockProductId(client, pid, branchId),
        );
      } catch {
        resolvedPid = pid;
      }
    }

    resolvedItems.push({ ...item, resolvedPid });
  }

  if (clientReqId) {
    const dupClient = await client.query(
      `SELECT id FROM sales WHERE client_request_id = $1 LIMIT 1`,
      [clientReqId]
    );
    if (dupClient.rows.length > 0) {
      const existing = await client.query(`SELECT * FROM sales WHERE id = $1`, [dupClient.rows[0].id]);
      const row = existing.rows[0];
      return {
        id: row.id,
        invoice_number: row.invoice_number,
        invoice_type: row.invoice_type,
        total: parseFloat(row.total),
        status: row.status,
        duplicate: true,
      };
    }
  }

  // ── Step 3a: Allocate invoice number + insert sale header ──
  let invoiceNumber = await allocateUniqueSaleInvoiceNumber(client, seqKey, seqPrefix, seqScope);
  const saleId = randomUUID();
  const saleHeaderParams = [saleId, invoiceNumber, branchId, cashierId, cashierName,
    subtotal, taxAmount, discount || 0, totalAmount,
    paymentMethod, amountPaid, change, normalizedCustomerNif || null, customerName,
    clientId, clientReqId, saleDueDate, invoiceType];

  const insertSaleHeader = async (number) => {
    const params = [...saleHeaderParams];
    params[1] = number;
    const savepoint = 'sale_header_insert';
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await client.query(
        `INSERT INTO sales (id, invoice_number, branch_id, cashier_id, cashier_name,
          subtotal, tax_amount, discount, total, payment_method, amount_paid, change,
          customer_nif, customer_name, client_id, status, fiscal_status, client_request_id, due_date, invoice_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed','issued',$16,$17,$18)`,
        params,
      );
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return null;
    } catch (insertErr) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      if (isUniqueViolation(insertErr) && /client_request_id/i.test(insertErr.message || '')) {
        const existing = await client.query(
          `SELECT * FROM sales WHERE client_request_id = $1 LIMIT 1`,
          [clientReqId],
        );
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          return {
            id: row.id,
            invoice_number: row.invoice_number,
            invoice_type: row.invoice_type,
            total: parseFloat(row.total),
            status: row.status,
            duplicate: true,
          };
        }
      }
      if (isUniqueViolation(insertErr) && /invoice_number/i.test(insertErr.message || '')) {
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw insertErr;
      }
      if (!/fiscal_status|invoice_type/i.test(insertErr.message || '')) {
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw insertErr;
      }
      await client.query(
        `INSERT INTO sales (id, invoice_number, branch_id, cashier_id, cashier_name,
          subtotal, tax_amount, discount, total, payment_method, amount_paid, change,
          customer_nif, customer_name, client_id, status, client_request_id, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'completed',$16,$17)`,
        params.slice(0, -1),
      );
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return null;
    }
  };

  let headerInsert = null;
  try {
    headerInsert = await insertSaleHeader(invoiceNumber);
  } catch (insertErr) {
    if (isUniqueViolation(insertErr) && /client_request_id/i.test(insertErr.message || '')) {
      const existing = await client.query(
        `SELECT * FROM sales WHERE client_request_id = $1 LIMIT 1`,
        [clientReqId],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return {
          id: row.id,
          invoice_number: row.invoice_number,
          invoice_type: row.invoice_type,
          total: parseFloat(row.total),
          status: row.status,
          duplicate: true,
        };
      }
    }
    if (isUniqueViolation(insertErr) && /invoice_number/i.test(insertErr.message || '')) {
      invoiceNumber = await allocateUniqueSaleInvoiceNumber(client, seqKey, seqPrefix, seqScope);
      headerInsert = await insertSaleHeader(invoiceNumber);
    } else {
      throw insertErr;
    }
  }

  if (headerInsert?.duplicate) {
    return headerInsert;
  }

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

    if (pid && !skipSaleStock) {
      // COGS unit cost (prefer weighted average)
      const costResult = await client.query('SELECT cost, avg_cost FROM products WHERE id = $1', [pid]);
      let unitCost = 0;
      if (costResult.rows.length > 0) {
        const row = costResult.rows[0];
        if (row.avg_cost != null && row.avg_cost !== '' && Number.isFinite(Number(row.avg_cost))) {
          unitCost = Number(row.avg_cost);
        } else {
          unitCost = Number(row.cost) || 0;
        }
        totalCOGS += unitCost * item.quantity;
      }

      await recordStockMovement(client, {
        productId: pid, warehouseId: branchId,
        movementType: 'OUT', quantity: item.quantity, unitCost,
        referenceType: 'sale', referenceId: saleId,
        referenceNumber: invoiceNumber, createdBy: cashierId,
      });
    } else if (pid && skipSaleStock) {
      // Still need COGS for journal when goods already left on SO ship.
      const costResult = await client.query('SELECT cost, avg_cost FROM products WHERE id = $1', [pid]);
      if (costResult.rows.length > 0) {
        const row = costResult.rows[0];
        let unitCost = 0;
        if (row.avg_cost != null && row.avg_cost !== '' && Number.isFinite(Number(row.avg_cost))) {
          unitCost = Number(row.avg_cost);
        } else {
          unitCost = Number(row.cost) || 0;
        }
        totalCOGS += unitCost * item.quantity;
      }
    }
  }

  // ── Step 4: Journal entries (balanced) ──
  let debitAccountCode = ACC.BANK;
  let creditCustomer = null;

  if (isCreditSale) {
    const resolved = await resolveCustomerReceivableAccount(client, clientId);
    debitAccountCode = resolved.accountCode;
    creditCustomer = resolved.client;
    const creditLimit = parseFloat(creditCustomer.credit_limit) || 0;
    const currentBalance = parseFloat(creditCustomer.current_balance) || 0;
    // No positive limit = no credit. A limit of 0 must block on-account sales.
    if (creditLimit <= 0) {
      throw new Error(
        `${creditCustomer.name} não tem limite de crédito definido. `
        + 'Defina um limite de crédito maior que 0 na ficha do cliente para vender a prazo.',
      );
    }
    if (currentBalance + totalAmount > creditLimit + 0.01) {
      throw new Error(
        `Limite de crédito excedido para ${creditCustomer.name}. `
        + `Saldo: ${currentBalance.toLocaleString('pt-AO')} AOA, limite: ${creditLimit.toLocaleString('pt-AO')} AOA.`,
      );
    }
    const termsDays = Math.trunc(Number(creditCustomer.payment_terms_days) || 0);
    if (!dueDate && termsDays > 0) {
      const due = new Date(today);
      due.setDate(due.getDate() + termsDays);
      saleDueDate = due.toISOString().slice(0, 10);
      await client.query(`UPDATE sales SET due_date = $1 WHERE id = $2`, [saleDueDate, saleId]);
    }
  } else if (paymentMethod === 'cash') {
    debitAccountCode = await resolveBranchCaixaGlAccountCode(client, {
      branchId,
      branchName: branchNameForGl,
      saleId,
    });
  } else {
    // Card / transfer / multibanco — per-bank leaf when known, else branch primary bank, else 431.
    const saleBankId = saleData.bankAccountId || saleData.bank_account_id || null;
    debitAccountCode = await resolveBankGlForTreasury(client, {
      bankAccountId: saleBankId,
      branchId,
    });
  }

  const revenueLines = [
    { accountCode: debitAccountCode, description: `Venda ${invoiceNumber}`, debit: parseFloat(total), credit: 0 },
    { accountCode: ACC.SALES, description: `Receita ${invoiceNumber}`, debit: 0, credit: parseFloat(subtotal) },
  ];
  if (parseFloat(taxAmount) > 0) {
    revenueLines.push({ accountCode: ACC.IVA_LIQUIDATED, description: `IVA ${invoiceNumber}`, debit: 0, credit: parseFloat(taxAmount) });
  }

  const saleCustomerLabel = String(customerName || creditCustomer?.name || '').trim();
  const saleJournalDesc = saleCustomerLabel
    ? `Venda ${invoiceNumber} - ${saleCustomerLabel}`
    : `Venda ${invoiceNumber}`;

  await createJournalEntry(client, {
    description: saleJournalDesc, referenceType: 'sale', referenceId: saleId,
    branchId, createdBy: cashierId, lines: revenueLines,
  });

  if (totalCOGS > 0) {
    await createJournalEntry(client, {
      description: saleCustomerLabel
        ? `CMV ${invoiceNumber} - ${saleCustomerLabel}`
        : `CMV ${invoiceNumber}`,
      referenceType: 'sale', referenceId: saleId,
      lines: [
        { accountCode: ACC.COGS, description: 'Custo Mercadorias Vendidas', debit: totalCOGS, credit: 0 },
        { accountCode: ACC.INVENTORY_STOCK, description: 'Saída Mercadorias', debit: 0, credit: totalCOGS },
      ],
    });
  }

  // ── Step 5: Open item (credit / on-account sales only) ──
  if (isCreditSale) {
    await createOpenItem(client, {
      entityType: 'customer', entityId: clientId, documentType: 'invoice',
      documentId: saleId, documentNumber: invoiceNumber, documentDate: today,
      dueDate: saleDueDate, originalAmount: totalAmount, isDebit: true, branchId,
    });
    await client.query(
      `UPDATE clients SET current_balance = COALESCE(current_balance, 0) + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [totalAmount, clientId],
    );
  }

  // Tax summary (non-critical)
  await runOptionalInSavepoint(client, 'tax_summary', async () => {
    await client.query(
      `INSERT INTO tax_summaries (id, document_type, document_id, tax_code, tax_rate, total_base, total_tax, direction, period_year, period_month)
       VALUES ($1,'sale',$2,'IVA14',14.00,$3,$4,'output',$5,$6)`,
      [randomUUID(), saleId, parseFloat(subtotal), parseFloat(taxAmount), new Date().getFullYear(), new Date().getMonth() + 1],
    );
  }, (e) => {
    console.warn('[TX] Tax summary skipped:', e.message);
  });

  // ── Step 6: Audit ──
  const proformaNote = parentProformaNumber
    ? ` — conversão de Proforma ${String(parentProformaNumber).trim()}`
    : '';
  await auditLog(client, {
    tableName: 'sales', recordId: saleId, action: 'create',
    userId: cashierId, userName: cashierName, branchId,
    newValues: {
      invoiceNumber,
      invoiceType,
      total: totalAmount,
      paymentMethod,
      items: items.length,
      parentProformaId: parentProformaId || null,
      parentProformaNumber: parentProformaNumber || null,
    },
    description: `Venda ${invoiceNumber} (${invoiceType})${proformaNote} - ${totalAmount.toLocaleString()} AOA`,
  });

  console.log(`[TX ENGINE] Sale ${invoiceNumber} (${invoiceType}) ✓`);
  return {
    id: saleId,
    invoice_number: invoiceNumber,
    invoice_type: invoiceType,
    total: totalAmount,
    status: 'completed',
    payment_method: paymentMethod,
  };
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

  // Mutual exclusion: stock already posted for this PO → do not receive again.
  const priorPoStock = await client.query(
    `SELECT id FROM stock_movements
     WHERE reference_type = 'purchase'
       AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [orderId],
  );
  if (priorPoStock.rows.length > 0) {
    throw new Error(
      `Ordem ${order.order_number} já tem stock recebido. Não receba de novo — use a fatura de compra (FC) só para AP se ainda em falta.`,
    );
  }

  // Mutual exclusion: FC already posted stock for this order number → block PO receive.
  const orderNo = String(order.order_number || '').trim();
  if (orderNo) {
    const linkedInvoices = await client.query(
      `SELECT id, invoice_number FROM purchase_invoices
       WHERE LOWER(TRIM(COALESCE(order_no, ''))) = LOWER($1)
         AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelled', 'voided', 'draft')`,
      [orderNo],
    );
    for (const inv of linkedInvoices.rows || []) {
      const fcStock = await client.query(
        `SELECT id FROM stock_movements
         WHERE reference_type = 'purchase_invoice'
           AND CAST(reference_id AS TEXT) = CAST($1 AS TEXT)
         LIMIT 1`,
        [inv.id],
      );
      if (fcStock.rows.length > 0) {
        throw new Error(
          `Stock já lançado pela fatura de compra ${inv.invoice_number || inv.id}. Não use "Receber" na OC — a FC é a fonte de stock.`,
        );
      }
    }
  }

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

    // STOCK MOVEMENT with landed cost (freight included), then true WAC
    await recordStockMovement(client, {
      productId: resolvedProductId, warehouseId: order.branch_id,
      movementType: 'IN', quantity: receivedQty, unitCost: newUnitCost,
      referenceType: 'purchase', referenceId: orderId,
      referenceNumber: order.order_number, createdBy: receivedBy,
    });
    if (newUnitCost > 0) {
      await applyWeightedAverageCostAfterIn(client, resolvedProductId, receivedQty, newUnitCost);
    }
    console.log(`[TX ENGINE] ✅ Stock + WAC: ${receivedQty} @ ${newUnitCost} (prev cost ${oldCost})`);
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
    { accountCode: ACC.PURCHASES_MERCHANDISE, description: `Mercadoria ${order.order_number}`, debit: subtotal, credit: 0 },
  ];
  if (totalLandingCosts > 0 && freightExpenseAccountCode) {
    journalLines.push({ accountCode: freightExpenseAccountCode, description: `Frete ${order.order_number}`, debit: totalLandingCosts, credit: 0 });
  }
  if (taxAmount > 0) {
    journalLines.push({ accountCode: ACC.IVA_DEDUCTIBLE, description: `IVA compra ${order.order_number}`, debit: taxAmount, credit: 0 });
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
  const {
    fromBranchId,
    toBranchId,
    items,
    requestedBy,
    notes,
    fromWarehouseId,
    toWarehouseId,
  } = data;

  requireParam(fromBranchId, 'fromBranchId');
  requireParam(toBranchId, 'toBranchId');
  if (!items || items.length === 0) throw new Error('Transferência deve ter itens');
  if (fromBranchId === toBranchId) throw new Error('Filial de origem e destino devem ser diferentes');

  const fromBranch = await client.query('SELECT name FROM branches WHERE id = $1', [fromBranchId]);
  const toBranch = await client.query('SELECT name FROM branches WHERE id = $1', [toBranchId]);
  if (fromBranch.rows.length === 0) throw new Error('Filial de origem não encontrada');
  if (toBranch.rows.length === 0) throw new Error('Filial de destino não encontrada');

  const { resolveWarehouseMeta } = require('./lib/warehouses');
  const fromWh = await resolveWarehouseMeta(
    client,
    fromWarehouseId,
    fromBranchId,
    fromBranch.rows[0].name,
  );
  const toWh = await resolveWarehouseMeta(
    client,
    toWarehouseId,
    toBranchId,
    toBranch.rows[0].name,
  );

  const transferNumber = await generateSequenceNumber(client, 'stock_transfer', 'TRF');
  const transferId = randomUUID();
  const actorUuid = normalizeUuid(requestedBy);

  for (const item of items) {
    // Ledger still keys stock by branch id (not warehouses.id).
    await assertTransferStockAvailable(
      client,
      item.productId,
      fromBranchId,
      item.quantity,
      item.productName,
      actorUuid,
    );
  }

  try {
    await client.query(
      `INSERT INTO stock_transfers (
         id, transfer_number, from_branch_id, from_branch_name, to_branch_id, to_branch_name,
         from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name,
         requested_by, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        transferId,
        transferNumber,
        fromBranchId,
        fromBranch.rows[0].name,
        toBranchId,
        toBranch.rows[0].name,
        fromWh.id || '',
        fromWh.name || '',
        toWh.id || '',
        toWh.name || '',
        requestedBy,
        notes,
      ],
    );
  } catch (e) {
    // Pre-064 DBs without warehouse columns — fall back
    if (!/from_warehouse_id|column/i.test(String(e.message || ''))) throw e;
    await client.query(
      `INSERT INTO stock_transfers (id, transfer_number, from_branch_id, from_branch_name, to_branch_id, to_branch_name, requested_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [transferId, transferNumber, fromBranchId, fromBranch.rows[0].name, toBranchId, toBranch.rows[0].name, requestedBy, notes],
    );
  }

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
    newValues: {
      transferNumber,
      from: fromBranch.rows[0].name,
      to: toBranch.rows[0].name,
      fromWarehouse: fromWh.name || null,
      toWarehouse: toWh.name || null,
      items: items.length,
    },
    description: `Transferência ${transferNumber}: ${fromBranch.rows[0].name} → ${toBranch.rows[0].name}`,
  });

  console.log(`[TX ENGINE] Transfer ${transferNumber} created ✓`);

  const itemsResult = await client.query(
    'SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY id ASC',
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
    from_warehouse_id: fromWh.id || '',
    from_warehouse_name: fromWh.name || '',
    to_warehouse_id: toWh.id || '',
    to_warehouse_name: toWh.name || '',
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
  const approverUuid = normalizeUuid(approvedBy);

  for (const item of itemsResult.rows) {
    const stockInfo = await assertTransferStockAvailable(
      client,
      item.product_id,
      transfer.from_branch_id,
      item.quantity,
      item.product_name,
      approverUuid,
    );

    await recordStockMovement(client, {
      productId: stockInfo.productId,
      warehouseId: transfer.from_branch_id,
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
    await ensureInventoryStockAccount(client);
    await createJournalEntry(client, {
      description: `Transferência ${transfer.transfer_number}`,
      referenceType: 'transfer', referenceId: transferId,
      branchId: transfer.from_branch_id, createdBy: receivedBy,
      lines: [
        { accountCode: ACC.INVENTORY_STOCK, description: `Entrada ${transfer.to_branch_name}`, debit: totalTransferValue, credit: 0 },
        { accountCode: ACC.INVENTORY_STOCK, description: `Saída ${transfer.from_branch_name}`, debit: 0, credit: totalTransferValue },
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
    bankAccount, reference, notes, invoiceIds,
    paymentSource, caixaId, bankAccountId,
  } = paymentData;

  requireParam(paymentType, 'paymentType');
  requireParam(entityType, 'entityType');
  requireParam(branchId, 'branchId');
  requireParam(createdBy, 'createdBy');
  const paymentAmount = requirePositive(amount, 'amount');

  let resolvedEntityName = String(entityName || '').trim();
  if (!resolvedEntityName && entityId) {
    try {
      if (entityType === 'supplier') {
        const r = await client.query(`SELECT name FROM suppliers WHERE id = $1 LIMIT 1`, [entityId]);
        resolvedEntityName = String(r.rows[0]?.name || '').trim();
      } else if (entityType === 'customer') {
        const r = await client.query(`SELECT name FROM clients WHERE id = $1 LIMIT 1`, [entityId]);
        resolvedEntityName = String(r.rows[0]?.name || '').trim();
      }
    } catch (err) {
      console.warn('[TX ENGINE] entity name lookup failed:', err.message);
    }
  }
  if (!resolvedEntityName) {
    resolvedEntityName = entityType === 'supplier' ? 'Fornecedor' : 'Cliente';
  }

  const today = new Date().toISOString().split('T')[0];
  await validatePeriod(client, today);

  // Sequence-based payment number
  const seqType = paymentType === 'receipt' ? 'payment_receipt' : 'payment_out';
  const prefix = paymentType === 'receipt' ? 'REC' : 'PAG';
  const paymentNumber = await generateSequenceNumber(client, seqType, prefix);
  const journalRefType = paymentType === 'receipt' ? 'payment_receipt' : 'payment_out';

  // Treasury source: explicit paymentSource, else infer from paymentMethod
  const source = String(paymentSource || '').trim().toLowerCase();
  const wantsCaixa = source === 'caixa'
    || (!source && String(paymentMethod || '').toLowerCase() === 'cash');
  const treasuryRef = wantsCaixa
    ? (String(caixaId || '').trim() || bankAccount || '')
    : (String(bankAccountId || bankAccount || '').trim());
  const resolvedMethod = paymentMethod
    || (wantsCaixa ? 'cash' : 'transfer');

  const paymentId = randomUUID();
  await client.query(
    `INSERT INTO payments (id, payment_number, payment_type, entity_type, entity_id, entity_name,
     payment_method, amount, bank_account, reference, notes, branch_id, created_by, posted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`,
    [paymentId, paymentNumber, paymentType, entityType, entityId, resolvedEntityName,
     resolvedMethod, paymentAmount, treasuryRef, reference || '', notes || '', branchId, createdBy]
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

  const debitWhere = openItemIsDebitSql(db, '');
  let openInvoices;
  if (requestedIds.length > 0) {
    const ph = requestedIds.map((_, i) => `$${i + 3}`).join(', ');
    openInvoices = await client.query(
      `SELECT * FROM open_items
       WHERE entity_type = $1 AND entity_id = $2
         AND status != 'cleared'
         AND ${debitWhere}
         AND (document_id IN (${ph}) OR id IN (${ph}))
       ORDER BY document_date ASC`,
      [entityType, entityId, ...requestedIds],
    );
  } else {
    openInvoices = await client.query(
      `SELECT * FROM open_items
       WHERE entity_type = $1 AND entity_id = $2
         AND status != 'cleared'
         AND ${debitWhere}
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
  } else if (entityType === 'customer' && entityId) {
    await syncClientBalanceFromOpenItems(client, entityId);
  }

  // Treasury GL: honour explicit caixa/bank source when provided; else infer from paymentMethod.
  const resolvedCaixaId = String(caixaId || '').trim();
  let treasuryBranchId = branchId;
  if (wantsCaixa && resolvedCaixaId) {
    try {
      const cxRes = await client.query(
        'SELECT branch_id FROM caixas WHERE id = $1 LIMIT 1',
        [resolvedCaixaId],
      );
      const cxBranch = cxRes.rows[0]?.branch_id;
      if (cxBranch) treasuryBranchId = String(cxBranch);
    } catch (e) {
      console.warn('[TX ENGINE] Caixa branch lookup skipped:', e.message);
    }
  }

  let cashAccountCode;
  if (wantsCaixa) {
    cashAccountCode = await resolveBranchCaixaGlAccountCode(client, { branchId: treasuryBranchId });
  } else {
    cashAccountCode = await resolveBankGlForTreasury(client, {
      bankAccountId: bankAccountId || bankAccount,
      branchId: treasuryBranchId || branchId,
    });
  }
  const preferredCash = await findAccountByCode(client, cashAccountCode);
  if (!preferredCash) {
    const fallbackCode = wantsCaixa ? ACC.CASH : ACC.BANK;
    const fallback = await findAccountByCode(client, fallbackCode)
      || await findAccountByCode(client, ACC.CASH);
    if (!fallback) {
      throw new Error(`Conta de tesouraria não encontrada no plano de contas (${cashAccountCode} / ${ACC.CASH})`);
    }
    cashAccountCode = fallback.code || fallbackCode;
  }
  const entityAccountCode = await getEntityAccountCode(client, entityType, entityId, resolvedEntityName);

  const lines = paymentType === 'receipt'
    ? [
        { accountCode: cashAccountCode, description: `Recebimento ${paymentNumber}`, debit: paymentAmount, credit: 0 },
        { accountCode: entityAccountCode, description: resolvedEntityName, debit: 0, credit: paymentAmount },
      ]
    : [
        { accountCode: entityAccountCode, description: resolvedEntityName, debit: paymentAmount, credit: 0 },
        { accountCode: cashAccountCode, description: `Pagamento ${paymentNumber}`, debit: 0, credit: paymentAmount },
      ];

  await createJournalEntry(client, {
    description: `${paymentType === 'receipt' ? 'Recebimento' : 'Pagamento'} ${paymentNumber} - ${resolvedEntityName}`,
    referenceType: journalRefType, referenceId: paymentId,
    branchId, createdBy, lines,
  });

  // Operational caixa balance (register drawer) when paying/receiving cash from a specific caixa
  if (wantsCaixa && resolvedCaixaId) {
    try {
      const delta = paymentType === 'receipt' ? paymentAmount : -paymentAmount;
      await client.query(
        `UPDATE caixas
         SET current_balance = COALESCE(current_balance, 0) + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [delta, resolvedCaixaId],
      );
    } catch (e) {
      console.warn('[TX ENGINE] Caixa balance update skipped:', e.message);
    }
  }

  await auditLog(client, {
    tableName: 'payments', recordId: paymentId, action: 'create',
    userId: createdBy, branchId,
    newValues: {
      paymentNumber, paymentType, entityName: resolvedEntityName, amount: paymentAmount,
      paymentMethod: resolvedMethod, paymentSource: wantsCaixa ? 'caixa' : 'bank',
      caixaId: resolvedCaixaId || null, bankAccountId: String(bankAccountId || '').trim() || null,
      treasuryGl: cashAccountCode,
    },
    description: `${paymentType === 'receipt' ? 'Recebimento' : 'Pagamento'} ${paymentNumber} - ${resolvedEntityName} - ${paymentAmount} AOA`,
  });

  console.log(`[TX ENGINE] Payment ${paymentNumber} ✓`);
  return { id: paymentId, payment_number: paymentNumber, amount: paymentAmount };
}

// ==================== EXPORTS ====================

module.exports = {
  // Stock
  recordStockMovement,
  ensureOpeningStockMovement,
  getAvailableStockForSale,
  reconcileSkuStockAtWarehouse,
  resolveOrCloneProductForBranch,
  resolveStockEntryDirection,
  normalizeStandaloneMovementType,
  getStock,
  // Open Items
  createOpenItem,
  clearOpenItems,
  reduceSupplierInvoiceOpenItem,
  adoptPurchaseOrderOpenItemForInvoice,
  syncSupplierBalanceFromOpenItems,
  syncClientBalanceFromOpenItems,
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
  voidStockAdjustment,
  replaceStockAdjustment,
  // Helpers
  resolveWarehouseId,
  auditLog,
  getEntityAccountCode,
  ensureInventoryShrinkageAccount,
  applyPurchaseSupplierToProducts,
  applyWeightedAverageCostAfterIn,
};
