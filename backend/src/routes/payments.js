// Payments API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { processPayment } = require('../transactionEngine');
const { enqueuePaymentCreated } = require('../sync/outbox');
const { getEntityBalanceSelect } = require('../entityBalanceSql');
const { listSupplierPayables } = require('../lib/supplierPayablesList');
const { listCustomerReceivables } = require('../lib/customerReceivablesList');
const { listChecklistDues } = require('../lib/openItemsBriefing');
const { requirePermission } = require('../middleware/requirePermission');
const { ensureYearPeriods, fetchPeriods, getPeriodById } = require('../lib/accountingPeriods');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ
  router.get('/', async (req, res) => {
    try {
      const { entityType, entityId, branchId } = req.query;
      let query = `
        SELECT p.*,
          COALESCE(
            NULLIF(TRIM(p.entity_name), ''),
            CASE
              WHEN p.entity_type = 'supplier' THEN s.name
              WHEN p.entity_type = 'customer' THEN c.name
              ELSE NULL
            END
          ) AS entity_name
        FROM payments p
        LEFT JOIN suppliers s ON p.entity_type = 'supplier' AND s.id = p.entity_id
        LEFT JOIN clients c ON p.entity_type = 'customer' AND c.id = p.entity_id
        WHERE 1=1`;
      const params = [];
      let idx = 1;
      if (entityType) { query += ` AND p.entity_type = $${idx++}`; params.push(entityType); }
      if (entityId) { query += ` AND p.entity_id = $${idx++}`; params.push(entityId); }
      if (branchId) { query += ` AND p.branch_id = $${idx++}`; params.push(branchId); }
      query += ' ORDER BY p.created_at DESC';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('[PAYMENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', requirePermission('accounting_payment', 'accounting_receipt'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const payment = await processPayment(client, req.body);
      await enqueuePaymentCreated(client, payment.id, req.body.branchId);
      await client.query('COMMIT');
      await broadcastTable('payments');
      if (req.body.entityType === 'supplier') {
        await broadcastTable('suppliers');
      }
      res.status(201).json(payment);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PAYMENTS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to create payment' });
    } finally {
      client.release();
    }
  });

  // READ: Customer receivables from open items
  router.get('/receivables-aging', async (req, res) => {
    try {
      const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
      const rows = await listCustomerReceivables(db, { branchId, sinceDays: null });
      res.json(rows);
    } catch (error) {
      console.error('[PAYMENTS RECEIVABLES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch receivables' });
    }
  });

  // READ: Checklist due receipts / due payments (matches Pagamentos → Itens em aberto)
  router.get('/checklist-dues', async (_req, res) => {
    try {
      const dues = await listChecklistDues();
      res.json(dues);
    } catch (error) {
      console.error('[PAYMENTS CHECKLIST DUES]', error);
      res.status(500).json({ error: error.message || 'Failed to load checklist dues' });
    }
  });

  // READ: Supplier payables (open items + confirmed purchase invoices missing open items)
  router.get('/payables-aging', async (req, res) => {
    try {
      const branchId = req.query.branchId ? String(req.query.branchId).trim() : '';
      const rows = await listSupplierPayables(db, { branchId, sinceDays: null });
      res.json(rows);
    } catch (error) {
      console.error('[PAYMENTS PAYABLES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch payables' });
    }
  });

  // POST: Fast backfill — create missing supplier payables from saved purchase invoices only
  router.post('/backfill-missing-payables', requirePermission('purchase_create'), async (req, res) => {
    try {
      const { backfillMissingSupplierOpenItems } = require('../supplierBalanceRepair');
      const backfill = await backfillMissingSupplierOpenItems();
      if (broadcastTable) await broadcastTable('suppliers');
      res.json(backfill);
    } catch (error) {
      console.error('[PAYMENTS BACKFILL]', error);
      res.status(500).json({ error: error.message || 'Failed to backfill payables' });
    }
  });

  // POST: Backfill missing supplier open items from purchase invoices (admin repair)
  router.post('/repair-supplier-payables', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { runSupplierBalanceRepair } = require('../supplierBalanceRepair');
      const repair = await runSupplierBalanceRepair();
      const rows = await listSupplierPayables(db, { sinceDays: null });
      if (broadcastTable) await broadcastTable('suppliers');
      res.json({
        backfill: { created: repair.created ?? 0, skipped: repair.skipped ?? 0 },
        repair,
        payablesCount: rows.length,
      });
    } catch (error) {
      console.error('[PAYMENTS PAYABLES REPAIR]', error);
      res.status(500).json({ error: error.message || 'Failed to repair supplier payables' });
    }
  });

  // READ: Open items
  router.get('/open-items/:entityType/:entityId', async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      if (entityType === 'supplier') {
        try {
          const { ensurePayablesForSupplier } = require('../supplierBalanceRepair');
          await ensurePayablesForSupplier(entityId);
        } catch (repairErr) {
          console.warn('[PAYMENTS] ensure payables for supplier:', repairErr.message);
        }
      }

      const { resolveSupplierEntityIds } = require('../supplierBalanceRepair');
      const entityIds =
        entityType === 'supplier'
          ? await resolveSupplierEntityIds(entityId)
          : [String(entityId).trim()].filter(Boolean);
      if (!entityIds.length) {
        return res.json([]);
      }

      const entityCol =
        db.engine === 'postgres' ? 'entity_id::text' : 'CAST(entity_id AS TEXT)';
      const placeholders = entityIds.map((_, i) => `$${i + 2}`).join(', ');
      const result = await db.query(
        `SELECT * FROM open_items
         WHERE entity_type = $1
           AND ${entityCol} IN (${placeholders})
           AND status != 'cleared'
         ORDER BY document_date ASC`,
        [entityType, ...entityIds],
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[PAYMENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch open items' });
    }
  });

  // READ: Entity balance
  router.get('/balance/:entityType/:entityId', async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const result = await db.query(
        `SELECT * FROM v_entity_balance WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId]
      );
      res.json(result.rows[0] || { balance: 0, open_items_count: 0 });
    } catch (error) {
      console.error('[PAYMENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  });

  // READ: Stock from movements view
  router.get('/stock/:productId/:warehouseId', async (req, res) => {
    try {
      const { productId, warehouseId } = req.params;
      const result = await db.query(
        `SELECT * FROM v_current_stock WHERE product_id = $1 AND warehouse_id = $2`,
        [productId, warehouseId]
      );
      res.json(result.rows[0] || { current_stock: 0 });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stock' });
    }
  });

  // READ: Full statement for an entity (all open_items + payments)
  router.get('/statement/:entityType/:entityId', async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const { dateFrom, dateTo } = req.query;

      // 1) All open items (invoices, credit notes, debit notes) — including cleared
      let oiQuery = `SELECT id, document_type, document_id, document_number, document_date, due_date,
                      original_amount, remaining_amount, is_debit, status, created_at
                      FROM open_items WHERE entity_type = $1 AND entity_id = $2`;
      const oiParams = [entityType, entityId];
      let idx = 3;
      if (dateFrom) { oiQuery += ` AND document_date >= $${idx++}`; oiParams.push(dateFrom); }
      if (dateTo)   { oiQuery += ` AND document_date <= $${idx++}`; oiParams.push(dateTo); }
      oiQuery += ' ORDER BY document_date ASC, created_at ASC';
      const oiResult = await db.query(oiQuery, oiParams);

      // 2) All payments for this entity
      let pQuery = `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at
                    FROM payments WHERE entity_type = $1 AND entity_id = $2`;
      const pParams = [entityType, entityId];
      idx = 3;
      if (dateFrom) { pQuery += ` AND created_at >= $${idx++}`; pParams.push(dateFrom); }
      if (dateTo)   { pQuery += ` AND created_at <= $${idx++}`; pParams.push(dateTo + 'T23:59:59'); }
      pQuery += ' ORDER BY created_at ASC';
      const pResult = await db.query(pQuery, pParams);

      // 3) Current balance
      const balResult = await db.query(getEntityBalanceSelect(), [entityType, entityId]);

      res.json({
        openItems: oiResult.rows,
        payments: pResult.rows,
        balance: balResult.rows[0] || { balance: 0, open_items_count: 0 }
      });
    } catch (error) {
      console.error('[PAYMENTS STATEMENT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch statement' });
    }
  });

  // READ: Document flow
  router.get('/document-flow/:docType/:docId', async (req, res) => {
    try {
      const { docType, docId } = req.params;
      const result = await db.query(
        `SELECT * FROM document_links WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2) ORDER BY created_at ASC`,
        [docType, docId]
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch document flow' });
    }
  });

  // READ: Periods (server is source of truth — transaction engine blocks closed/locked months)
  router.get('/periods', async (req, res) => {
    try {
      const year = req.query.year != null && req.query.year !== '' ? Number(req.query.year) : undefined;
      const rows = await fetchPeriods({ year });
      res.json(rows);
    } catch (error) {
      console.error('[PAYMENTS] periods list:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch periods' });
    }
  });

  router.post('/periods/:id/close', requirePermission('reports_close', 'accounting_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const { closedBy } = req.body;
      const period = await getPeriodById(id);
      if (!period) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Período não encontrado' });
      }
      if (period.status !== 'open') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Período já está ${period.status}` });
      }
      await client.query(
        `UPDATE accounting_periods SET status = 'closed', closed_by = $1, closed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [closedBy || null, id],
      );
      await client.query('COMMIT');
      if (broadcastTable) await broadcastTable('accounting_periods');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PAYMENTS] close period:', error);
      res.status(500).json({ error: error.message || 'Failed to close period' });
    } finally {
      client.release();
    }
  });

  router.post('/periods/:id/lock', requirePermission('reports_close', 'accounting_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const period = await getPeriodById(id);
      if (!period) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Período não encontrado' });
      }
      if (period.status !== 'closed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: period.status === 'locked'
            ? 'Período já está bloqueado permanentemente'
            : 'Feche o período antes de o bloquear',
        });
      }
      await client.query(
        `UPDATE accounting_periods SET status = 'locked' WHERE id = $1`,
        [id],
      );
      await client.query('COMMIT');
      if (broadcastTable) await broadcastTable('accounting_periods');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PAYMENTS] lock period:', error);
      res.status(500).json({ error: error.message || 'Failed to lock period' });
    } finally {
      client.release();
    }
  });

  router.post('/periods/:id/reopen', requirePermission('reports_close', 'accounting_create'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const period = await getPeriodById(id);
      if (!period) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Período não encontrado' });
      }
      if (period.status === 'locked') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Período bloqueado — não pode ser reaberto' });
      }
      if (period.status === 'open') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Período já está aberto' });
      }
      await client.query(
        `UPDATE accounting_periods SET status = 'open', closed_by = NULL, closed_at = NULL WHERE id = $1`,
        [id],
      );
      await client.query('COMMIT');
      if (broadcastTable) await broadcastTable('accounting_periods');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[PAYMENTS] reopen period:', error);
      res.status(500).json({ error: error.message || 'Failed to reopen period' });
    } finally {
      client.release();
    }
  });

  // READ: Stock movements
  router.get('/stock-movements', async (req, res) => {
    try {
      const { productId, warehouseId, referenceType } = req.query;
      let query = 'SELECT sm.*, p.name as product_name, p.sku FROM stock_movements sm JOIN products p ON p.id = sm.product_id WHERE 1=1';
      const params = [];
      let idx = 1;
      if (productId) { query += ` AND sm.product_id = $${idx++}`; params.push(productId); }
      if (warehouseId) { query += ` AND sm.warehouse_id = $${idx++}`; params.push(warehouseId); }
      if (referenceType) { query += ` AND sm.reference_type = $${idx++}`; params.push(referenceType); }
      query += ' ORDER BY sm.created_at DESC LIMIT 500';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch stock movements' });
    }
  });

  return router;
};
