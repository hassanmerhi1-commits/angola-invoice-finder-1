// Sales API routes — ALL writes through Transaction Engine
const express = require('express');
const db = require('../db');
const { processSale } = require('../transactionEngine');
const { peekSequenceNumber } = require('../accounting');

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
      await client.query('COMMIT');
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
