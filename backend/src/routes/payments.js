// Payments API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { processPayment } = require('../transactionEngine');
const { enqueuePaymentCreated } = require('../sync/outbox');
const { ENTITY_BALANCE_SELECT } = require('../entityBalanceSql');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ
  router.get('/', async (req, res) => {
    try {
      const { entityType, entityId, branchId } = req.query;
      let query = 'SELECT * FROM payments WHERE 1=1';
      const params = [];
      let idx = 1;
      if (entityType) { query += ` AND entity_type = $${idx++}`; params.push(entityType); }
      if (entityId) { query += ` AND entity_id = $${idx++}`; params.push(entityId); }
      if (branchId) { query += ` AND branch_id = $${idx++}`; params.push(branchId); }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('[PAYMENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', async (req, res) => {
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

  // READ: Supplier payables from open items (real balance after payments/returns)
  router.get('/payables-aging', async (req, res) => {
    try {
      const result = await db.query(
        `SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
                oi.remaining_amount, oi.original_amount, oi.document_type,
                s.name AS supplier_name, s.nif AS supplier_nif, s.payment_terms
         FROM open_items oi
         INNER JOIN suppliers s ON s.id = oi.entity_id
         WHERE oi.entity_type = 'supplier'
           AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
           AND oi.status != 'cleared'
           AND oi.remaining_amount > 0.01
         ORDER BY s.name, oi.document_date ASC`,
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[PAYMENTS PAYABLES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch payables' });
    }
  });

  // READ: Open items
  router.get('/open-items/:entityType/:entityId', async (req, res) => {
    try {
      const { entityType, entityId } = req.params;
      const result = await db.query(
        `SELECT * FROM open_items WHERE entity_type = $1 AND entity_id = $2 AND status != 'cleared' ORDER BY document_date ASC`,
        [entityType, entityId]
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
      const balResult = await db.query(ENTITY_BALANCE_SELECT, [entityType, entityId]);

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

  // READ: Periods
  router.get('/periods', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM accounting_periods ORDER BY year DESC, month DESC');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch periods' });
    }
  });

  // Period close (administrative — allowed in route)
  router.post('/periods/:id/close', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { id } = req.params;
      const { closedBy } = req.body;
      await client.query(
        `UPDATE accounting_periods SET status = 'closed', closed_by = $1, closed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [closedBy, id]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to close period' });
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
