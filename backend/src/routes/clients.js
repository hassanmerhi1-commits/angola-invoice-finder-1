// Clients API routes
const express = require('express');
const db = require('../db');

function normalizeNif(nif) {
  return String(nif || '').replace(/\s/g, '').trim();
}

function validateClientNif(nif) {
  const cleaned = normalizeNif(nif);
  if (!cleaned) return 'NIF is required';
  if (!/^\d{10}$/.test(cleaned)) return 'NIF must have 10 digits';
  return null;
}

/** Price level must be 1..4; default to 1 for anything else. */
function clampPriceLevel(value) {
  const n = Math.trunc(Number(value));
  return n >= 1 && n <= 4 ? n : 1;
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all clients
  router.get('/', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM clients WHERE is_active = true ORDER BY name');
      res.json(result.rows);
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  // Create client
  router.post('/', async (req, res) => {
    try {
      const { name, nif, email, phone, address, city, country, creditLimit, currentBalance, defaultPriceLevel, priceAdjustmentPct } = req.body;

      if (!String(name || '').trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const nifError = validateClientNif(nif);
      if (nifError) {
        return res.status(400).json({ error: nifError });
      }
      const normalizedNif = normalizeNif(nif);
      const priceLevel = clampPriceLevel(defaultPriceLevel);
      const adjustment = Number(priceAdjustmentPct) || 0;

      const result = await db.query(
        `INSERT INTO clients (name, nif, email, phone, address, city, country, credit_limit, current_balance, default_price_level, price_adjustment_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [name.trim(), normalizedNif, email, phone, address, city, country || 'Angola', creditLimit || 0, currentBalance || 0, priceLevel, adjustment]
      );
      
      await broadcastTable('clients');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to create client' });
    }
  });

  // Update client
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nif, email, phone, address, city, country, creditLimit, currentBalance, isActive, defaultPriceLevel, priceAdjustmentPct } = req.body;

      if (!String(name || '').trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const nifError = validateClientNif(nif);
      if (nifError) {
        return res.status(400).json({ error: nifError });
      }
      const normalizedNif = normalizeNif(nif);
      const priceLevel = clampPriceLevel(defaultPriceLevel);
      const adjustment = Number(priceAdjustmentPct) || 0;

      const result = await db.query(
        `UPDATE clients 
         SET name = $1, nif = $2, email = $3, phone = $4, address = $5, city = $6, 
             country = $7, credit_limit = $8, current_balance = $9, is_active = $10,
             default_price_level = $11, price_adjustment_pct = $12, updated_at = CURRENT_TIMESTAMP
         WHERE id = $13
         RETURNING *`,
        [name.trim(), normalizedNif, email, phone, address, city, country, creditLimit, currentBalance, isActive, priceLevel, adjustment, id]
      );
      
      await broadcastTable('clients');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to update client' });
    }
  });

  // Delete client (soft delete)
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE clients SET is_active = false WHERE id = $1', [id]);
      
      await broadcastTable('clients');
      res.json({ success: true });
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete client' });
    }
  });

  return router;
};
