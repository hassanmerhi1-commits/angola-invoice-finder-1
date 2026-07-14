// Clients API routes — with auto Chart of Accounts sub-account creation
const express = require('express');
const db = require('../db');
const { auditErpSafe } = require('../lib/erpAudit');
const {
  ensureClientSubAccount,
} = require('../lib/entityCoaAccounts');

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

/** Payment terms in days: non-negative integer; 0 = due immediately / on receipt. */
function clampPaymentTermsDays(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
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
    const { name, nif, email, phone, address, city, country, creditLimit, currentBalance, defaultPriceLevel, priceAdjustmentPct, paymentTermsDays, accountParentCode } = req.body;

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
    const termsDays = clampPaymentTermsDays(paymentTermsDays);

    const conn = await db.pool.connect();
    try {
      await conn.query('BEGIN');

      const result = await conn.query(
        `INSERT INTO clients (name, nif, email, phone, address, city, country, credit_limit, current_balance, default_price_level, price_adjustment_pct, payment_terms_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [name.trim(), normalizedNif, email, phone, address, city, country || 'Angola', creditLimit || 0, currentBalance || 0, priceLevel, adjustment, termsDays]
      );

      const created = result.rows[0];

      // Auto-create the 31x receivables sub-account (non-fatal — client row must still commit).
      let accountCode = null;
      try {
        accountCode = await ensureClientSubAccount(conn, name.trim(), normalizedNif, accountParentCode);
      } catch (subErr) {
        console.warn('[CLIENTS] Sub-account creation skipped:', subErr.message);
      }

      await conn.query('COMMIT');
      await broadcastTable('clients');
      await broadcastTable('chart_of_accounts');

      if (created) created._accountCode = accountCode;
      auditErpSafe(req, {
        table: 'clients',
        id: created?.id,
        action: 'create',
        description: `Cliente criado: ${name.trim()}${normalizedNif ? ` (${normalizedNif})` : ''}`,
        newValues: { name: name.trim(), nif: normalizedNif, accountCode },
      });
      res.status(201).json(created);
    } catch (error) {
      try { await conn.query('ROLLBACK'); } catch (_) {}
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to create client' });
    } finally {
      conn.release();
    }
  });

  // Update client
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nif, email, phone, address, city, country, creditLimit, currentBalance, isActive, defaultPriceLevel, priceAdjustmentPct, paymentTermsDays } = req.body;

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
      const termsDays = clampPaymentTermsDays(paymentTermsDays);

      const result = await db.query(
        `UPDATE clients 
         SET name = $1, nif = $2, email = $3, phone = $4, address = $5, city = $6, 
             country = $7, credit_limit = $8, current_balance = $9, is_active = $10,
             default_price_level = $11, price_adjustment_pct = $12, payment_terms_days = $13,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $14
         RETURNING *`,
        [name.trim(), normalizedNif, email, phone, address, city, country, creditLimit, currentBalance, isActive, priceLevel, adjustment, termsDays, id]
      );
      
      await broadcastTable('clients');
      auditErpSafe(req, {
        table: 'clients',
        id,
        action: 'update',
        description: `Cliente actualizado: ${name.trim()}`,
        newValues: { name: name.trim(), nif: normalizedNif, isActive },
      });
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
      auditErpSafe(req, {
        table: 'clients',
        id,
        action: 'delete',
        description: `Cliente desactivado: ${id}`,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete client' });
    }
  });

  return router;
};
