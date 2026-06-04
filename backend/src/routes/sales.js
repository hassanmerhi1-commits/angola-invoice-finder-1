// Sales API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { processSale } = require('../transactionEngine');
const { peekSequenceNumber } = require('../accounting');
const { enqueueSaleCreated } = require('../sync/outbox');
const { signSaleInvoice } = require('../agt/signSale');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // READ
  router.get('/', async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = 'SELECT * FROM sales';
      const params = [];
      if (branchId) { query += ' WHERE branch_id = $1'; params.push(branchId); }
      query += ' ORDER BY created_at DESC';
      const result = await db.query(query, params);

      for (let sale of result.rows) {
        const itemsResult = await db.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
        sale.items = itemsResult.rows;
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch sales' });
    }
  });

  // CREATE: Delegated to Transaction Engine
  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const sale = await processSale(client, req.body);
      const idemKey = req.body.clientRequestId || req.body.idempotencyKey || `sale:${sale.id}`;
      if (req.body.clientRequestId || req.body.idempotencyKey) {
        await client.query(
          `UPDATE sales SET client_request_id = $1 WHERE id = $2`,
          [idemKey, sale.id]
        );
      }
      await enqueueSaleCreated(client, sale.id, req.body.branchId, idemKey);
      await client.query('COMMIT');
      signSaleInvoice(sale.id).catch((e) => console.warn('[AGT SIGN]', e.message));
      await broadcastTable('sales');
      await broadcastTable('products');
      res.status(201).json({ ...sale, items: req.body.items });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to create sale' });
    } finally {
      client.release();
    }
  });

  router.post('/:id/mark-printed', async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE sales SET printed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING id, invoice_number, printed_at`,
        [req.params.id],
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      await broadcastTable('sales');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[SALES mark-printed]', error);
      res.status(500).json({ error: error.message || 'Failed to mark printed' });
    }
  });

  // Update due date on an existing sale (and linked open item)
  router.patch('/:id', async (req, res) => {
    try {
      const { dueDate } = req.body;
      if (!dueDate) {
        return res.status(400).json({ error: 'dueDate is required' });
      }
      const due = String(dueDate).slice(0, 10);
      const result = await db.query(
        `UPDATE sales SET due_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [due, req.params.id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Sale not found' });
      }
      await db.query(
        `UPDATE open_items SET due_date = $1
         WHERE document_id = $2 AND document_type = 'invoice' AND status != 'cleared'`,
        [due, req.params.id],
      );
      await broadcastTable('sales');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to update sale' });
    }
  });

  // Preview next invoice number (actual number assigned atomically in processSale)
  router.get('/generate-invoice-number/:branchCode', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const invoiceNumber = await peekSequenceNumber(client, 'invoice', 'INV');
      res.json({ invoiceNumber });
    } catch (error) {
      console.error('[SALES ERROR]', error);
      res.status(500).json({ error: 'Failed to generate invoice number' });
    } finally {
      client.release();
    }
  });

  return router;
};
