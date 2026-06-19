// Clients API routes — with auto Chart of Accounts sub-account creation
const express = require('express');
const db = require('../db');

// Angola PGC (novo com IVA): Clientes group is account 31; client
// sub-accounts default to 311 (Clientes - correntes). Auto codes are 8 digits
// (e.g. 31100001) so each client gets its own receivables ledger account.
const CLIENT_GROUP_CODE = '31';
const CLIENT_PARENT_CODE = '311';
const ENTITY_ACCOUNT_CODE_LENGTH = 8;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNif(nif) {
  return String(nif || '').replace(/\s/g, '').trim();
}

// Build the next free 8-digit code under a parent (parent "311" -> "31100001").
function nextEntityAccountCode(parentCode, existingCodes) {
  const suffixLen = ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length;
  const maxSeq = existingCodes.reduce((max, code) => {
    if (!code || !code.startsWith(parentCode) || code.length <= parentCode.length) return max;
    const parsed = Number(code.slice(parentCode.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parentCode}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}

/**
 * Auto-create an 8-digit sub-account in chart_of_accounts for a client.
 * Idempotent — skips if an account with the same name/NIF already exists in the
 * Clientes group. Mirrors the supplier sub-account behaviour so that "New customer
 * account" and "New client" both register the client ledger entry.
 */
async function ensureClientSubAccount(client, clientName, clientNif, parentCode) {
  const normalizedName = cleanText(clientName);
  const normalizedNif = normalizeNif(clientNif);

  // Validate the requested parent (must be in the 31 group); else fall back to 311.
  let requestedParentCode = cleanText(parentCode) || CLIENT_PARENT_CODE;
  if (!requestedParentCode.startsWith(CLIENT_GROUP_CODE)) {
    requestedParentCode = CLIENT_PARENT_CODE;
  }

  // Skip if it already exists anywhere in the client group (avoid duplicates).
  const existing = normalizedNif
    ? await client.query(
        `SELECT code
         FROM chart_of_accounts
         WHERE code LIKE '${CLIENT_GROUP_CODE}%'
           AND level >= 3
           AND is_header = false
           AND (
             lower(name) = lower($1)
             OR description ILIKE '%' || $2::text || '%'
           )
         LIMIT 1`,
        [normalizedName, normalizedNif]
      )
    : await client.query(
        `SELECT code
         FROM chart_of_accounts
         WHERE code LIKE '${CLIENT_GROUP_CODE}%'
           AND level >= 3
           AND is_header = false
           AND lower(name) = lower($1)
         LIMIT 1`,
        [normalizedName]
      );
  if (existing.rows.length > 0) return existing.rows[0].code;

  // Find the chosen parent, falling back to 311 then the 31 group.
  let resolvedParentCode = requestedParentCode;
  let parent = await client.query(
    `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [resolvedParentCode]
  );
  if (parent.rows.length === 0 && resolvedParentCode !== CLIENT_PARENT_CODE) {
    resolvedParentCode = CLIENT_PARENT_CODE;
    parent = await client.query(
      `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [resolvedParentCode]
    );
  }
  if (parent.rows.length === 0) {
    resolvedParentCode = CLIENT_GROUP_CODE;
    parent = await client.query(
      `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [resolvedParentCode]
    );
  }
  if (parent.rows.length === 0) {
    console.warn(`[CLIENTS] Parent account ${CLIENT_PARENT_CODE}/${CLIENT_GROUP_CODE} not found — skipping sub-account`);
    return null;
  }
  const parentId = parent.rows[0].id;
  const childLevel = (parseInt(parent.rows[0].level, 10) || 2) + 1;

  const seqResult = await client.query(
    `SELECT code FROM chart_of_accounts WHERE code LIKE '${resolvedParentCode}%' AND is_header = false`
  );
  const code = nextEntityAccountCode(resolvedParentCode, seqResult.rows.map((r) => r.code));

  await client.query(
    `INSERT INTO chart_of_accounts
     (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance)
     VALUES ($1, $2, $3, 'asset', 'debit', $4, $5, false, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [code, normalizedName, normalizedNif ? `NIF: ${normalizedNif}` : '', parentId, childLevel]
  );

  await client.query(
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     ) WHERE id = $1`,
    [parentId]
  );

  console.log(`[CLIENTS] Created sub-account ${code} — ${normalizedName}`);
  return code;
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
