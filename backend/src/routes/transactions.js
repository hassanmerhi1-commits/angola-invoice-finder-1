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
  syncSupplierBalanceFromOpenItems,
  isOpenItemDebitFlag,
  linkDocuments,
  validatePeriod,
  auditLog,
} = require('../transactionEngine');
const { createJournalEntry } = require('../accounting');

async function ensureFreightExpenseAccount(client) {
  const existing = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '6.2.6' AND is_active = true LIMIT 1`
  );

  if (existing.rows.length > 0) return;

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
}

async function ensureJournalLineAccounts(client, journalLines = [], entityBalanceUpdate = null, openItem = null) {
  const configs = [
    { pattern: /^3\.2\.\d+$/i, parentCode: '3.2', accountType: 'liability', accountNature: 'credit' },
    { pattern: /^3\.3\.\d+$/i, parentCode: '3.3', accountType: 'liability', accountNature: 'debit' },
    { pattern: /^2\.1\.\d+$/i, parentCode: '2.1', accountType: 'asset', accountNature: 'debit' },
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
  const supplierLines = journalLines.filter((line) => /^3\.2\.\d+$/i.test(String(line.accountCode || '').trim()));
  if (supplierLines.length === 0) return;

  const parent = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '3.2' AND is_active = true LIMIT 1`
  );
  if (parent.rows.length === 0) {
    throw new Error('Conta 3.2 não encontrada para lançar fornecedor');
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

  // ==================== STOCK MOVEMENTS ====================
  router.get('/stock-movements', async (req, res) => {
    try {
      const { productId, warehouseId, referenceType, limit } = req.query;
      let query = 'SELECT sm.*, p.name as product_name, p.sku FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id WHERE 1=1';
      const params = [];
      let idx = 1;
      if (productId) { query += ` AND sm.product_id = $${idx++}`; params.push(productId); }
      if (warehouseId) { query += ` AND sm.warehouse_id = $${idx++}`; params.push(warehouseId); }
      if (referenceType) { query += ` AND sm.reference_type = $${idx++}`; params.push(referenceType); }
      query += ` ORDER BY sm.created_at DESC LIMIT $${idx++}`;
      params.push(parseInt(limit) || 500);
      const result = await db.query(query, params);
      res.json(result.rows);
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

  // ==================== OPEN ITEMS ====================
  router.get('/open-items', async (req, res) => {
    try {
      const { entityType, entityId, status } = req.query;
      let query = 'SELECT * FROM open_items WHERE 1=1';
      const params = [];
      let idx = 1;
      if (entityType) { query += ` AND entity_type = $${idx++}`; params.push(entityType); }
      if (entityId) { query += ` AND entity_id = $${idx++}`; params.push(entityId); }
      if (status) { query += ` AND status = $${idx++}`; params.push(status); }
      else { query += ` AND status != 'cleared'`; }
      query += ' ORDER BY document_date ASC';
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

  // ==================== GENERIC TRANSACTION PROCESSOR ====================
  router.post('/process', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const {
        transactionType, documentId, documentNumber, branchId,
        userId, date, description, amount, currency,
        stockEntries, journalLines, openItem, documentLinks,
        priceUpdates, entityBalanceUpdate,
        taxLines
      } = req.body;

      const effectivePriceUpdates = new Map(
        (priceUpdates || []).map((pu) => [pu.productId, Number(pu.newUnitCost || 0)])
      );

      // Input validation
      if (!branchId) throw new Error('branchId é obrigatório');
      if (!transactionType) throw new Error('transactionType é obrigatório');

      const result = {
        success: false,
        stockMovementIds: [],
        journalEntryId: null,
        openItemId: null,
        documentLinkIds: [],
        errors: [],
      };

      // Validate period
      await validatePeriod(client, date || new Date().toISOString());

      // Phase 1: Stock Movements (through engine)
      if (stockEntries && stockEntries.length > 0) {
        for (const entry of stockEntries) {
          const effectiveUnitCost = effectivePriceUpdates.get(entry.productId) ?? entry.unitCost ?? 0;

          if (transactionType === 'purchase_invoice' && Number(effectiveUnitCost) !== Number(entry.unitCost || 0)) {
            console.log(
              `[TX API] purchase_invoice ${documentNumber}: landed cost applied for ${entry.productId} ` +
              `base=${Number(entry.unitCost || 0)} final=${Number(effectiveUnitCost)}`
            );
          }

          const stockDirection = resolveStockEntryDirection(entry, transactionType, openItem);
          const stockReferenceType =
            transactionType === 'credit_note' && openItem?.entityType === 'supplier'
              ? 'supplier_return'
              : transactionType;

          const movement = await recordStockMovement(client, {
            productId: entry.productId,
            warehouseId: entry.warehouseId,
            movementType: stockDirection,
            quantity: entry.quantity,
            unitCost: effectiveUnitCost,
            referenceType: stockReferenceType,
            referenceId: documentId,
            referenceNumber: documentNumber,
            createdBy: userId,
          });
          result.stockMovementIds.push(movement.id);
        }
      }

      // Phase 2: Price Updates (WAC)
      if (priceUpdates && priceUpdates.length > 0) {
        for (const pu of priceUpdates) {
          const prodResult = await client.query(
            'SELECT stock, cost FROM products WHERE id = $1 FOR UPDATE',
            [pu.productId]
          );
          if (prodResult.rows.length > 0) {
            const p = prodResult.rows[0];
            const currentStock = parseInt(p.stock) || 0;
            const currentCost = parseFloat(p.cost) || 0;
            const previousStock = Math.max(currentStock - pu.quantityReceived, 0);
            const prevTotal = previousStock * currentCost;
            const newTotal = pu.quantityReceived * pu.newUnitCost;
            const totalStock = previousStock + pu.quantityReceived;
            const newAvg = totalStock > 0 ? (prevTotal + newTotal) / totalStock : pu.newUnitCost;

            const nextAvgCost = Number(newAvg.toFixed(2));
            const nextLastCost = Number(Number(pu.newUnitCost || 0).toFixed(2));

            await client.query(
              `UPDATE products
               SET cost = $1,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [nextAvgCost, pu.productId]
            );

            console.log(
              `[TX API] price update ${transactionType} ${documentNumber}: product=${pu.productId} ` +
              `prevStock=${previousStock} received=${pu.quantityReceived} avgCost=${nextAvgCost} lastCost=${nextLastCost}`
            );
          }
        }
      }

      // Phase 3: Journal Entry (through accounting engine — validates balance)
      if (journalLines && journalLines.length > 0) {
        if (journalLines.some((line) => line.accountCode === '6.2.6')) {
          await ensureFreightExpenseAccount(client);
        }
        await ensureJournalLineAccounts(client, journalLines, entityBalanceUpdate, openItem);
        await ensureSupplierJournalAccounts(client, journalLines, entityBalanceUpdate, openItem);

        const entry = await createJournalEntry(client, {
          description,
          referenceType: transactionType,
          referenceId: documentId,
          branchId,
          createdBy: userId,
          lines: journalLines.map(l => ({
            accountCode: l.accountCode,
            description: l.note || description,
            debit: l.debit || 0,
            credit: l.credit || 0,
          })),
        });
        result.journalEntryId = entry.id;
      }

      // Phase 3.5: Tax Engine (IVA / Retenção / IS)
      if (Array.isArray(taxLines) && taxLines.length > 0) {
        const d = new Date(date || new Date().toISOString());
        const periodYear = d.getFullYear();
        const periodMonth = d.getMonth() + 1;

        // Ensure idempotency for retries
        await client.query('DELETE FROM tax_lines WHERE document_type = $1 AND document_id = $2', [transactionType, documentId]);
        await client.query('DELETE FROM tax_summaries WHERE document_type = $1 AND document_id = $2', [transactionType, documentId]);

        for (const tl of taxLines) {
          const taxCode = String(tl.taxCode || '').trim();
          const taxRate = Number(tl.taxRate || 0);
          const baseAmount = Number(tl.baseAmount || 0);
          const taxAmount = Number(tl.taxAmount || 0);
          const lineNumber = Number(tl.lineNumber || 1);
          const isInclusive = !!tl.isInclusive;

          if (!taxCode || !isFinite(baseAmount) || !isFinite(taxAmount)) continue;

          let taxCodeId = null;
          try {
            const tc = await client.query('SELECT id FROM tax_codes WHERE code = $1 LIMIT 1', [taxCode]);
            taxCodeId = tc.rows[0]?.id || null;
          } catch {
            taxCodeId = null;
          }

          await client.query(
            `INSERT INTO tax_lines
             (document_type, document_id, line_number, tax_code_id, tax_code, tax_rate, base_amount, tax_amount, is_inclusive)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [transactionType, documentId, lineNumber, taxCodeId, taxCode, taxRate, baseAmount, taxAmount, isInclusive]
          );
        }

        // Create document-level summaries (grouped by tax code/rate)
        const summaryRows = await client.query(
          `SELECT tax_code, tax_rate,
                  SUM(base_amount) AS total_base,
                  SUM(tax_amount) AS total_tax
           FROM tax_lines
           WHERE document_type = $1 AND document_id = $2
           GROUP BY tax_code, tax_rate`,
          [transactionType, documentId]
        );

        const direction = transactionType === 'sale' ? 'output' : 'input';
        for (const row of summaryRows.rows) {
          await client.query(
            `INSERT INTO tax_summaries
             (document_type, document_id, tax_code, tax_rate, total_base, total_tax, direction, period_year, period_month)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              transactionType,
              documentId,
              row.tax_code,
              Number(row.tax_rate || 0),
              Number(row.total_base || 0),
              Number(row.total_tax || 0),
              direction,
              periodYear,
              periodMonth,
            ]
          );
        }
      }

      // Phase 4: Open Item (through engine)
      if (openItem) {
        const invoiceLink = (documentLinks || []).find((dl) =>
          ['fatura_compra', 'purchase_invoice'].includes(String(dl.targetType || ''))
        );
        const isLinkedSupplierReturn =
          transactionType === 'credit_note' &&
          openItem.entityType === 'supplier' &&
          !isOpenItemDebitFlag(openItem.isDebit) &&
          !!invoiceLink;

        if (isLinkedSupplierReturn) {
          const applied = await reduceSupplierInvoiceOpenItem(client, {
            entityId: openItem.entityId,
            invoiceDocumentId: invoiceLink.targetId,
            amount: openItem.originalAmount,
          });
          if (applied) {
            result.openItemId = applied.id;
            openItem.entityId = applied.entityId || openItem.entityId;
            if (entityBalanceUpdate && entityBalanceUpdate.entityType === 'supplier') {
              entityBalanceUpdate.entityId = applied.entityId || entityBalanceUpdate.entityId;
            }
            console.log(
              `[TX API] Supplier return ${documentNumber}: reduced invoice ${applied.documentNumber} open item by ${applied.applied}`
            );
          } else {
            const oi = await createOpenItem(client, {
              entityType: openItem.entityType,
              entityId: openItem.entityId,
              documentType: openItem.documentType,
              documentId,
              documentNumber,
              documentDate: date || new Date().toISOString().split('T')[0],
              dueDate: openItem.dueDate || null,
              originalAmount: openItem.originalAmount,
              isDebit: openItem.isDebit,
              branchId,
              currency: openItem.currency || currency || 'AOA',
            });
            result.openItemId = oi.id;
            console.warn(
              `[TX API] Supplier return ${documentNumber}: invoice open item not found — created standalone credit open item`
            );
          }
        } else {
          const oi = await createOpenItem(client, {
            entityType: openItem.entityType,
            entityId: openItem.entityId,
            documentType: openItem.documentType,
            documentId,
            documentNumber,
            documentDate: date || new Date().toISOString().split('T')[0],
            dueDate: openItem.dueDate || null,
            originalAmount: openItem.originalAmount,
            isDebit: openItem.isDebit,
            branchId,
            currency: openItem.currency || currency || 'AOA',
          });
          result.openItemId = oi.id;
        }
      }

      // Phase 5: Document Links (through engine)
      if (documentLinks && documentLinks.length > 0) {
        for (const dl of documentLinks) {
          const linkId = await linkDocuments(client, dl.sourceType, dl.sourceId, dl.sourceNumber, dl.targetType, dl.targetId, dl.targetNumber);
          result.documentLinkIds.push(linkId);
        }
      }

      // Phase 6: Entity balance — suppliers: sync from open_items (source of truth)
      if (entityBalanceUpdate) {
        const ebu = entityBalanceUpdate;
        if (ebu.entityType === 'supplier' && ebu.entityId) {
          await syncSupplierBalanceFromOpenItems(client, ebu.entityId);
        } else if (ebu.entityType === 'customer') {
          await client.query('UPDATE clients SET current_balance = COALESCE(current_balance, 0) + $1 WHERE id = $2', [ebu.amount, ebu.entityId]);
        }
      }

      // Phase 7: Audit log (ERP traceability)
      await auditLog(client, {
        tableName: 'transactions',
        recordId: documentId,
        action: 'process',
        userId,
        userName: req.body.userName,
        branchId,
        oldValues: null,
        newValues: {
          transactionType,
          documentNumber,
          date,
          amount,
          currency,
          stockEntriesCount: stockEntries?.length || 0,
          journalLinesCount: journalLines?.length || 0,
          taxLinesCount: Array.isArray(taxLines) ? taxLines.length : 0,
        },
        description: `${transactionType} ${documentNumber} processed`,
      });

      await client.query('COMMIT');

      result.success = true;
      console.log(`[TX API] ${transactionType} ${documentNumber}: stock=${result.stockMovementIds.length}, journal=${!!result.journalEntryId}, openItem=${!!result.openItemId} ✓`);

      await broadcastTable('products');
      if (result.journalEntryId) {
        await broadcastTable('journal_entries');
      }
      res.status(201).json(result);
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
      res.status(500).json({
        success: false,
        error: error.message || 'Transaction failed',
        errors: [error.message],
        stockMovementIds: [],
        documentLinkIds: [],
      });
    } finally {
      client.release();
    }
  });

  return router;
};
