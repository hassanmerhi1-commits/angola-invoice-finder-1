// Exchange Rate Management Routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // List all exchange rates (optionally filter by currency pair)
  router.get('/', async (req, res) => {
    try {
      const { from, to, limit } = req.query;
      let query = 'SELECT * FROM exchange_rates';
      const params = [];
      const conditions = [];

      if (from) { params.push(from); conditions.push(`from_currency = $${params.length}`); }
      if (to) { params.push(to); conditions.push(`to_currency = $${params.length}`); }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY effective_date DESC, from_currency';
      if (limit) { params.push(parseInt(limit)); query += ` LIMIT $${params.length}`; }

      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Latest rates view
  router.get('/latest', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM v_latest_exchange_rates');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create/update rate
  router.post('/', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { from_currency, to_currency = 'AOA', rate, effective_date, source = 'manual' } = req.body;
      const result = await db.query(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (from_currency, to_currency, effective_date)
         DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
         RETURNING *`,
        [from_currency, to_currency || 'AOA', rate, effective_date, source]
      );
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete rate
  router.delete('/:id', requirePermission('admin_settings'), async (req, res) => {
    try {
      await db.query('DELETE FROM exchange_rates WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Convert amount
  router.get('/convert', async (req, res) => {
    try {
      const { from, to = 'AOA', amount, date } = req.query;
      const effectiveDate = date || new Date().toISOString().split('T')[0];
      
      if (from === to) return res.json({ rate: 1, converted: parseFloat(amount) });

      const rateResult = await db.query(
        `SELECT rate FROM exchange_rates 
         WHERE from_currency = $1 AND to_currency = $2 AND effective_date <= $3
         ORDER BY effective_date DESC LIMIT 1`,
        [from, to, effectiveDate]
      );

      if (!rateResult.rows.length) {
        return res.status(404).json({ error: `No rate found for ${from}→${to}` });
      }

      const rate = parseFloat(rateResult.rows[0].rate);
      res.json({ rate, converted: parseFloat(amount) * rate, from, to, date: effectiveDate });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
