// Unified Transaction API routes
// Exposes stock movements, open items, document links, and the generic transaction processor
const express = require('express');
const db = require('../db');
const { randomUUID } = require('crypto');
const {
  recordStockMovement,
  resolveStockEntryDirection,
  normalizeStandaloneMovementType,
  createOpenItem,
  reduceSupplierInvoiceOpenItem,
  adoptPurchaseOrderOpenItemForInvoice,
  syncSupplierBalanceFromOpenItems,
  isOpenItemDebitFlag,
  linkDocuments,
  validatePeriod,
  auditLog,
  processStockAdjustment,
  voidStockAdjustment,
  replaceStockAdjustment,
  applyPurchaseSupplierToProducts,
} = require('../transactionEngine');
const { attachUserBranchScope, resolveWarehouseId } = require('../middleware/branchScope');
const { isUniqueSkuBranchError } = require('../lib/productSkuResolve');
const { processTransactionBody } = require('../transactionProcessor');
const {
  createJournalEntry,
  generateSequenceNumber,
  peekSequenceNumber,
  normalizeBranchCode,
  DOCUMENT_SEQUENCE_CONFIG,
  resolveSequenceConfig,
} = require('../accounting');

const SEQUENCE_DOCUMENT_TYPES = new Set(Object.keys(DOCUMENT_SEQUENCE_CONFIG));

function mapStockMovementRow(row) {
  const createdBy = String(row.created_by || '').trim();
  const createdByName = String(row.created_by_name || '').trim();
  const createdByEmail = String(row.created_by_email || '').trim();
  let userLabel = createdByName;
  if (!userLabel && createdByEmail) userLabel = createdByEmail;
  if (!userLabel && createdBy && !/^[0-9a-f-]{36}$/i.test(createdBy)) {
    userLabel = createdBy;
  }
  return {
    ...row,
    branch_id: row.warehouse_id,
    branch_name: row.branch_name || null,
    branch_code: row.branch_code || null,
    created_by_name: userLabel || null,
  };
}

async function resolveSequenceScopeForRequest(client, documentType, branchId) {
  const cfg = resolveSequenceConfig(documentType);
  if (!cfg.perBranch) return {};
  const bid = String(branchId || '').trim();
  if (!bid) {
    throw new Error('branchId é obrigatório para numeração por filial');
  }
  const result = await client.query(
    'SELECT id, code FROM branches WHERE id = $1 LIMIT 1',
    [bid]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Filial não encontrada');
  }
  return {
    branchId: row.id,
    branchCode: normalizeBranchCode(row.code),
  };
}

async function ensureFreightExpenseAccount(client) {
  const existing = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '752' AND is_active = true LIMIT 1`
  );

  if (existing.rows.length > 0) return;

  const parentResult = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '75' AND is_active = true LIMIT 1`
  );

  if (parentResult.rows.length === 0) {
    throw new Error('Conta 75 não encontrada para lançar frete');
  }

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, '752', 'Fornecimentos e serviços de terceiros', 'expense', 'debit', $2, 2, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [randomUUID(), parentResult.rows[0].id]
  );
}

async function ensureJournalLineAccounts(client, journalLines = [], entityBalanceUpdate = null, openItem = null) {
  // Angola PGC (novo com IVA): dynamic sub-accounts live under 321 (suppliers) and 311 (clients).
  const configs = [
    { pattern: /^321\d+$/i, parentCode: '321', accountType: 'liability', accountNature: 'credit' },
    { pattern: /^311\d+$/i, parentCode: '311', accountType: 'asset', accountNature: 'debit' },
  ];

  for (const line of journalLines) {
    const code = String(line.accountCode || '').trim();
    if (!code) continue;

    const existing = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [code],
    );
    if (existing.rows.length > 0) continue;

    const cfg = configs.find((c) => c.pattern.test(code));
    if (!cfg) {
      throw new Error(`Conta contabilística não encontrada: ${code}`);
    }

    const parent = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [cfg.parentCode],
    );
    if (parent.rows.length === 0) {
      throw new Error(`Conta pai ${cfg.parentCode} não encontrada para criar ${code}`);
    }

    const accountName =
      String(line.accountName || '').trim()
      || String(line.note || '').trim()
      || String(entityBalanceUpdate?.entityName || '').trim()
      || String(openItem?.entityName || '').trim()
      || code;

    await client.query(
      `INSERT INTO chart_of_accounts
       (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
       VALUES ($1, $2, $3, '', $4, $5, $6, 3, false, true, 0, 0)`,
      [randomUUID(), code, accountName, cfg.accountType, cfg.accountNature, parent.rows[0].id],
    );
  }
}

async function ensureSupplierJournalAccounts(client, journalLines = [], entityBalanceUpdate = null, openItem = null) {
  const supplierLines = journalLines.filter((line) => /^321\d+$/i.test(String(line.accountCode || '').trim()));
  if (supplierLines.length === 0) return;

  const parent = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '321' AND is_active = true LIMIT 1`
  );
  if (parent.rows.length === 0) {
    throw new Error('Conta 321 não encontrada para lançar fornecedor');
  }

  const parentId = parent.rows[0].id;
  for (const line of supplierLines) {
    const code = String(line.accountCode || '').trim();
    const existing = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [code]
    );
    if (existing.rows.length > 0) continue;

    const supplierName =
      String(line.accountName || '').trim()
      || String(entityBalanceUpdate?.entityName || '').trim()
      || String(openItem?.entityName || '').trim()
      || `Fornecedor ${code}`;
    const supplierNif = String(entityBalanceUpdate?.entityNif || '').trim();

    await client.query(
      `INSERT INTO chart_of_accounts
       (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
       VALUES ($1, $2, $3, $4, 'liability', 'credit', $5, 3, false, true, 0, 0)
       ON CONFLICT (code) DO NOTHING`,
      [randomUUID(), code, supplierName, supplierNif ? `NIF: ${supplierNif}` : '', parentId]
    );
  }

  await client.query(
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     ) WHERE id = $1`,
    [parentId]
  );
}

module.exports = function(broadcastTable) {
  const router = express.Router();
  router.use(attachUserBranchScope);

  // ==================== STOCK MOVEMENTS ====================
  router.get('/stock-movements', async (req, res) => {
    try {
      const { productId, referenceType, limit } = req.query;
      const warehouseId = resolveWarehouseId(req, req.query.warehouseId);
      if (warehouseId === undefined) {
        return res.json([]);
      }
      let query = `SELECT sm.*, p.name AS product_name, p.sku,
        b.name AS branch_name, b.code AS branch_code,
        u.name AS created_by_name, u.email AS created_by_email
        FROM stock_movements sm
        LEFT JOIN products p ON p.id = sm.product_id
        LEFT JOIN branches b ON b.id = sm.warehouse_id
        LEFT JOIN users u ON u.id = sm.created_by
        WHERE 1=1`;
      const params = [];
      let idx = 1;
      if (productId) { query += ` AND sm.product_id = $${idx++}`; params.push(productId); }
      if (warehouseId) { query += ` AND sm.warehouse_id = $${idx++}`; params.push(warehouseId); }
      if (referenceType) { query += ` AND sm.reference_type = $${idx++}`; params.push(referenceType); }
      query += ` ORDER BY sm.created_at DESC LIMIT $${idx++}`;
      params.push(parseInt(limit) || 500);
      const result = await db.query(query, params);
      res.json(result.rows.map(mapStockMovementRow));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stock movements' });
    }
  });

  router.post('/stock-movements', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const movementType = normalizeStandaloneMovementType(req.body);
      const movement = await recordStockMovement(client, {
        ...req.body,
        movementType,
        referenceType: req.body.referenceType ?? req.body.reference_type ?? 'adjustment',
      });
      await client.query('COMMIT');
      await broadcastTable('products');
      res.status(201).json(movement);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message || 'Failed to record stock movement' });
    } finally {
      client.release();
    }
  });

  /** Stock adjust entry/exit: movements + weighted cost (IN) + journal — single atomic transaction. */
  router.post('/stock-adjustment', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await processStockAdjustment(client, {
        direction: req.body.direction,
        warehouseId: req.body.warehouseId ?? req.body.warehouse_id,
        referenceNumber: req.body.referenceNumber ?? req.body.reference_number,
        referenceType: req.body.referenceType ?? req.body.reference_type,
        entryDate: req.body.entryDate ?? req.body.entry_date,
        notes: req.body.notes,
        createdBy: req.body.createdBy ?? req.body.created_by ?? req.user?.id,
        lines: req.body.lines,
        landingCosts: req.body.landingCosts ?? req.body.landing_costs,
        freightSourceAccount: req.body.freightSourceAccount ?? req.body.freight_source_account,
        freightSourceName: req.body.freightSourceName ?? req.body.freight_source_name,
      });
      await client.query('COMMIT');
      await broadcastTable('products');
      await broadcastTable('chart_of_accounts');
      res.status(201).json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      const msg = error.message || 'Failed to process stock adjustment';
      const status =
        msg.includes('insuficiente') ||
        msg.includes('obrigatório') ||
        msg.includes('inválido') ||
        msg.includes('Período')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    } finally {
      client.release();
    }
  });

  /** Void (delete) a stock adjustment document — reverses stock and journal. */
  router.delete('/stock-adjustment/:documentId', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await voidStockAdjustment(client, {
        documentId: req.params.documentId,
        voidedBy: req.body?.createdBy ?? req.body?.voidedBy ?? req.user?.id,
        reason: req.body?.reason,
      });
      await client.query('COMMIT');
      await broadcastTable('products');
      await broadcastTable('journal_entries');
      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      const msg = error.message || 'Failed to void stock adjustment';
      const status = /não encontrado|já foi anulado|insuficiente|Período|obrigatório/i.test(msg) ? 400 : 500;
      res.status(status).json({ error: msg });
    } finally {
      client.release();
    }
  });

  /** Edit a stock adjustment — void original and post replacement. */
  router.put('/stock-adjustment/:documentId', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await replaceStockAdjustment(client, {
        documentId: req.params.documentId,
        direction: req.body.direction,
        warehouseId: req.body.warehouseId ?? req.body.warehouse_id,
        referenceNumber: req.body.referenceNumber ?? req.body.reference_number,
        referenceType: req.body.referenceType ?? req.body.reference_type,
        entryDate: req.body.entryDate ?? req.body.entry_date,
        notes: req.body.notes,
        createdBy: req.body.createdBy ?? req.body.created_by ?? req.user?.id,
        lines: req.body.lines,
        landingCosts: req.body.landingCosts ?? req.body.landing_costs,
        freightSourceAccount: req.body.freightSourceAccount ?? req.body.freight_source_account,
        freightSourceName: req.body.freightSourceName ?? req.body.freight_source_name,
        voidReason: req.body.voidReason,
      });
      await client.query('COMMIT');
      await broadcastTable('products');
      await broadcastTable('chart_of_accounts');
      await broadcastTable('journal_entries');
      res.json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      const msg = error.message || 'Failed to update stock adjustment';
      const status =
        msg.includes('insuficiente') ||
        msg.includes('obrigatório') ||
        msg.includes('inválido') ||
        msg.includes('Período') ||
        msg.includes('não encontrado') ||
        msg.includes('anulado')
          ? 400
          : 500;
      res.status(status).json({ error: msg });
    } finally {
      client.release();
    }
  });

  // ==================== OPEN ITEMS ====================
  router.get('/open-items', async (req, res) => {
    try {
      const { entityType, entityId, status, branchId } = req.query;
      let query = `
        SELECT oi.*,
          CASE
            WHEN oi.entity_type = 'supplier' THEN s.name
            WHEN oi.entity_type = 'customer' THEN c.name
            ELSE NULL
          END AS entity_name
        FROM open_items oi
        LEFT JOIN suppliers s ON oi.entity_type = 'supplier' AND s.id = oi.entity_id
        LEFT JOIN clients c ON oi.entity_type = 'customer' AND c.id = oi.entity_id
        WHERE 1=1`;
      const params = [];
      let idx = 1;
      if (entityType) { query += ` AND oi.entity_type = $${idx++}`; params.push(entityType); }
      if (entityId) { query += ` AND oi.entity_id = $${idx++}`; params.push(entityId); }
      if (branchId) { query += ` AND oi.branch_id = $${idx++}`; params.push(branchId); }
      if (status) { query += ` AND oi.status = $${idx++}`; params.push(status); }
      else { query += ` AND oi.status != 'cleared'`; }
      query += ' ORDER BY oi.document_date ASC';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch open items' });
    }
  });

  router.post('/open-items', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const item = await createOpenItem(client, req.body);
      await client.query('COMMIT');
      res.status(201).json(item);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message || 'Failed to create open item' });
    } finally {
      client.release();
    }
  });

  // ==================== DOCUMENT LINKS ====================
  router.get('/document-links', async (req, res) => {
    try {
      const { sourceType, sourceId, targetType, targetId } = req.query;
      let query = 'SELECT * FROM document_links WHERE 1=1';
      const params = [];
      let idx = 1;
      if (sourceType && sourceId) {
        query += ` AND ((source_type = $${idx} AND source_id = $${idx + 1}) OR (target_type = $${idx} AND target_id = $${idx + 1}))`;
        params.push(sourceType, sourceId);
        idx += 2;
      }
      if (targetType && targetId) {
        query += ` AND target_type = $${idx++} AND target_id = $${idx++}`;
        params.push(targetType, targetId);
      }
      query += ' ORDER BY created_at ASC';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch document links' });
    }
  });

  router.post('/document-links', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { sourceType, sourceId, sourceNumber, targetType, targetId, targetNumber } = req.body;
      const linkId = await linkDocuments(client, sourceType, sourceId, sourceNumber, targetType, targetId, targetNumber);
      await client.query('COMMIT');
      res.status(201).json({ success: true, id: linkId });
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message || 'Failed to link documents' });
    } finally {
      client.release();
    }
  });

  // Preview next business number (does not consume sequence)
  router.get('/next-number/:documentType', async (req, res) => {
    const { documentType } = req.params;
    if (!SEQUENCE_DOCUMENT_TYPES.has(documentType)) {
      return res.status(400).json({ error: `Invalid document type: ${documentType}` });
    }
    const { prefix } = resolveSequenceConfig(documentType);
    const client = await db.pool.connect();
    try {
      const scope = await resolveSequenceScopeForRequest(client, documentType, req.query.branchId);
      const documentNumber = await peekSequenceNumber(client, documentType, prefix, scope);
      res.json({ documentNumber, documentType, branchId: scope.branchId || null });
    } catch (error) {
      console.error('[TX API] peek number:', error);
      res.status(error.message?.includes('obrigatório') || error.message?.includes('encontrada') ? 400 : 500)
        .json({ error: error.message || 'Failed to preview document number' });
    } finally {
      client.release();
    }
  });

  // Allocate next business number atomically (consumes sequence)
  router.post('/allocate-number', async (req, res) => {
    const documentType = String(req.body?.documentType || '').trim();
    if (!SEQUENCE_DOCUMENT_TYPES.has(documentType)) {
      return res.status(400).json({ error: `Invalid document type: ${documentType}` });
    }
    const { prefix } = resolveSequenceConfig(documentType);
    const client = await db.pool.connect();
    try {
      const scope = await resolveSequenceScopeForRequest(client, documentType, req.body?.branchId);
      await client.query('BEGIN');
      const documentNumber = await generateSequenceNumber(client, documentType, prefix, scope);
      await client.query('COMMIT');
      res.status(201).json({ documentNumber, documentType, branchId: scope.branchId || null });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[TX API] allocate number:', error);
      const status = error.message?.includes('obrigatório') || error.message?.includes('encontrada') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Failed to allocate document number' });
    } finally {
      client.release();
    }
  });

  // ==================== GENERIC TRANSACTION PROCESSOR ====================
  router.post('/process', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await processTransactionBody(client, req.body);
      await client.query('COMMIT');

      if (result.alreadyProcessed) {
        return res.status(200).json(result);
      }

      if (req.body.transactionType === 'purchase_invoice' && req.body.documentId) {
        try {
          const { enqueuePurchaseInvoiceCreated } = require('../sync/outbox');
          await enqueuePurchaseInvoiceCreated(
            null,
            req.body.documentId,
            req.body.branchId,
            result.stockMovementIds
          );
        } catch (syncErr) {
          console.warn('[TX API] purchase sync enqueue skipped:', syncErr.message);
        }
        const warehouseId =
          req.body.stockEntries?.[0]?.warehouseId
          || req.body.branchId;
        if (warehouseId && result.stockMovementIds?.length > 0) {
          try {
            const { ensureFilialProductsForWarehouse } = require('../lib/filialStockRepair');
            await ensureFilialProductsForWarehouse(warehouseId, client);
          } catch (filialErr) {
            console.warn('[TX API] filial stock repair after purchase:', filialErr.message);
          }
        }
      }

      await broadcastTable('products');
      if (result.journalEntryId) {
        await broadcastTable('journal_entries');
      }
      return res.status(201).json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[TX API ERROR]', error.message);
      console.error('[TX API ERROR STACK]', error.stack);
      console.error('[TX API ERROR PAYLOAD]', JSON.stringify({
        transactionType: req.body.transactionType,
        documentNumber: req.body.documentNumber,
        branchId: req.body.branchId,
        userId: req.body.userId,
        stockEntriesCount: req.body.stockEntries?.length,
        journalLinesCount: req.body.journalLines?.length,
        journalLines: req.body.journalLines?.map(l => ({ code: l.accountCode, d: l.debit, c: l.credit })),
      }, null, 2));
      const friendly = isUniqueSkuBranchError(error)
        ? 'Já existe um produto com este código (SKU) nesta filial. Seleccione-o na lista da fatura em vez de criar um duplicado.'
        : (error.message || 'Transaction failed');
      return res.status(isUniqueSkuBranchError(error) ? 409 : 500).json({
        success: false,
        error: friendly,
        errors: [friendly],
        stockMovementIds: [],
        documentLinkIds: [],
      });
    } finally {
      client.release();
    }
  });

  return router;
};
