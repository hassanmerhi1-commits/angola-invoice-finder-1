// Clients API routes — with auto Chart of Accounts sub-account creation
const express = require('express');
const db = require('../db');
const { auditErpSafe } = require('../lib/erpAudit');
const { requirePermission } = require('../middleware/requirePermission');
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
      // High default cap: pickers need the full list, this only guards runaway tables.
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5000, 1), 50000);
      const result = await db.query('SELECT * FROM clients WHERE is_active = true ORDER BY name LIMIT $1', [limit]);
      res.json(result.rows);
    } catch (error) {
      console.error('[CLIENTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  // Create client (idempotent by NIF — retry after network error must not duplicate)
  router.post('/', requirePermission('client_manage', 'invoice_create'), async (req, res) => {
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

      const existingRes = await conn.query(
        `SELECT * FROM clients
         WHERE REPLACE(COALESCE(nif, ''), ' ', '') = $1
         ORDER BY CASE WHEN COALESCE(is_active, true) THEN 0 ELSE 1 END,
                  created_at ASC NULLS LAST, id ASC
         LIMIT 1`,
        [normalizedNif],
      );
      if (existingRes.rows[0]) {
        let existing = existingRes.rows[0];
        if (existing.is_active === false || existing.is_active === 0) {
          const revived = await conn.query(
            `UPDATE clients
             SET is_active = true, name = $1, email = COALESCE($2, email), phone = COALESCE($3, phone),
                 address = COALESCE($4, address), city = COALESCE($5, city),
                 country = COALESCE($6, country), credit_limit = COALESCE($7, credit_limit),
                 default_price_level = $8, price_adjustment_pct = $9, payment_terms_days = $10,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $11
             RETURNING *`,
            [
              name.trim(), email || null, phone || null, address || null, city || null,
              country || 'Angola', creditLimit ?? null, priceLevel, adjustment, termsDays, existing.id,
            ],
          );
          existing = revived.rows[0] || existing;
        }
        await conn.query('COMMIT');
        await broadcastTable('clients');
        existing._deduplicated = true;
        return res.status(200).json(existing);
      }

      let created;
      try {
        const result = await conn.query(
          `INSERT INTO clients (name, nif, email, phone, address, city, country, credit_limit, current_balance, default_price_level, price_adjustment_pct, payment_terms_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [name.trim(), normalizedNif, email, phone, address, city, country || 'Angola', creditLimit || 0, currentBalance || 0, priceLevel, adjustment, termsDays]
        );
        created = result.rows[0];
      } catch (insertErr) {
        // Race: another request inserted the same NIF — return that row.
        if (insertErr.code === '23505' || /unique/i.test(String(insertErr.message || ''))) {
          const raced = await conn.query(
            `SELECT * FROM clients WHERE REPLACE(COALESCE(nif, ''), ' ', '') = $1 LIMIT 1`,
            [normalizedNif],
          );
          if (raced.rows[0]) {
            await conn.query('COMMIT');
            raced.rows[0]._deduplicated = true;
            return res.status(200).json(raced.rows[0]);
          }
        }
        throw insertErr;
      }

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
  router.put('/:id', requirePermission('client_manage', 'invoice_create'), async (req, res) => {
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

      const nifTaken = await db.query(
        `SELECT id, name FROM clients
         WHERE REPLACE(COALESCE(nif, ''), ' ', '') = $1
           AND CAST(id AS TEXT) <> CAST($2 AS TEXT)
           AND COALESCE(is_active, true) = true
         LIMIT 1`,
        [normalizedNif, id],
      );
      if (nifTaken.rows[0]) {
        return res.status(409).json({
          error: `Já existe um cliente activo com este NIF (${nifTaken.rows[0].name || normalizedNif})`,
        });
      }

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
  router.delete('/:id', requirePermission('client_manage', 'invoice_create'), async (req, res) => {
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
