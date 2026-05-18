// Suppliers API routes — with auto Chart of Accounts sub-account creation
const express = require('express');
const db = require('../db');

/**
 * Auto-create a 3.2.XXX sub-account in chart_of_accounts for a supplier.
 * Idempotent — skips if an account with the same name already exists.
 */
async function ensureSupplierSubAccount(client, supplierName, supplierNif) {
  const normalizedName = cleanText(supplierName);
  const normalizedNif = normalizeSupplierNif(supplierNif);

  // Check if already exists
  const existing = normalizedNif
    ? await client.query(
        `SELECT code
         FROM chart_of_accounts
         WHERE code LIKE '3.2.%'
           AND level = 3
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
         WHERE code LIKE '3.2.%'
           AND level = 3
           AND is_header = false
           AND lower(name) = lower($1)
         LIMIT 1`,
        [normalizedName]
      );
  if (existing.rows.length > 0) return existing.rows[0].code;

  // Find parent 3.2
  const parent = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = '3.2' AND is_active = true LIMIT 1`
  );
  if (parent.rows.length === 0) {
    console.warn('[SUPPLIERS] Parent account 3.2 (Fornecedores) not found — skipping sub-account');
    return null;
  }
  const parentId = parent.rows[0].id;

  // Next sequence
  const seqResult = await client.query(
    `SELECT COUNT(*) as count FROM chart_of_accounts WHERE code LIKE '3.2.%' AND level = 3 AND is_header = false`
  );
  const nextSeq = parseInt(seqResult.rows[0].count) + 1;
  const code = `3.2.${nextSeq.toString().padStart(3, '0')}`;

  await client.query(
    `INSERT INTO chart_of_accounts
     (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance)
     VALUES ($1, $2, $3, 'liability', 'credit', $4, 3, false, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [code, normalizedName, normalizedNif ? `NIF: ${normalizedNif}` : '', parentId]
  );

  // Update parent children_count
  await client.query(
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     ) WHERE id = $1`,
    [parentId]
  );

  console.log(`[SUPPLIERS] Created sub-account ${code} — ${normalizedName}`);
  return code;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSupplierNif(value) {
  const nif = cleanText(value);
  return nif || null;
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await db.query(
        `SELECT s.*,
                COALESCE((
                  SELECT SUM(CASE WHEN oi.is_debit = 1 OR oi.is_debit = TRUE THEN oi.remaining_amount ELSE -oi.remaining_amount END)
                  FROM open_items oi
                  WHERE oi.entity_type = 'supplier' AND oi.entity_id = s.id
                ), 0) AS balance
         FROM suppliers s
         WHERE s.is_active = true
         ORDER BY s.name`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
  });

  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { name, nif, email, phone, address, city, country, contactPerson, paymentTerms, notes } = req.body;
      const normalizedName = cleanText(name);
      const normalizedNif = normalizeSupplierNif(nif);
      if (!normalizedName) {
        throw new Error('Nome do fornecedor é obrigatório');
      }
      const result = await client.query(
        `INSERT INTO suppliers (name, nif, email, phone, address, city, country, contact_person, payment_terms, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [normalizedName, normalizedNif, cleanText(email), cleanText(phone), cleanText(address), cleanText(city), cleanText(country) || 'Angola', cleanText(contactPerson), paymentTerms || '30_days', cleanText(notes)]
      );

      // Auto-create 3.2.XXX sub-account
      const accountCode = await ensureSupplierSubAccount(client, normalizedName, normalizedNif);

      await client.query('COMMIT');
      await broadcastTable('suppliers');
      await broadcastTable('chart_of_accounts');

      const supplier = result.rows[0];
      supplier._accountCode = accountCode; // Return so frontend knows the code
      res.status(201).json(supplier);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to create supplier' });
    } finally {
      client.release();
    }
  });

  // Batch import — auto-creates sub-accounts for each supplier
  router.post('/batch', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { suppliers: supplierList } = req.body;
      if (!Array.isArray(supplierList)) {
        return res.status(400).json({ error: 'suppliers array is required' });
      }

      let imported = 0, failed = 0;
      const errors = [];

      for (const s of supplierList) {
        try {
          // Upsert by NIF
          const normalizedName = cleanText(s.name);
          const normalizedNif = normalizeSupplierNif(s.nif);
          if (!normalizedName) throw new Error('Missing supplier name');

          let upsertResult;
          if (normalizedNif) {
            upsertResult = await client.query(
              `INSERT INTO suppliers (name, nif, email, phone, address, city, country, contact_person, payment_terms, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (nif) DO UPDATE SET
                 name = EXCLUDED.name,
                 email = COALESCE(NULLIF(EXCLUDED.email, ''), suppliers.email),
                 phone = COALESCE(NULLIF(EXCLUDED.phone, ''), suppliers.phone),
                 address = COALESCE(NULLIF(EXCLUDED.address, ''), suppliers.address),
                 city = COALESCE(NULLIF(EXCLUDED.city, ''), suppliers.city),
                 country = COALESCE(NULLIF(EXCLUDED.country, ''), suppliers.country),
                 contact_person = COALESCE(NULLIF(EXCLUDED.contact_person, ''), suppliers.contact_person),
                 payment_terms = COALESCE(NULLIF(EXCLUDED.payment_terms, ''), suppliers.payment_terms),
                 notes = COALESCE(NULLIF(EXCLUDED.notes, ''), suppliers.notes),
                 updated_at = CURRENT_TIMESTAMP
               RETURNING *`,
              [
                normalizedName, normalizedNif, cleanText(s.email), cleanText(s.phone),
                cleanText(s.address), cleanText(s.city), cleanText(s.country) || 'Angola',
                cleanText(s.contactPerson || s.contact_person), s.paymentTerms || s.payment_terms || '30_days',
                cleanText(s.notes)
              ]
            );
          } else {
            const existingByName = await client.query('SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1', [normalizedName]);
            if (existingByName.rows.length > 0) {
              upsertResult = await client.query(
                `UPDATE suppliers
                 SET email = COALESCE(NULLIF($1, ''), email),
                     phone = COALESCE(NULLIF($2, ''), phone),
                     address = COALESCE(NULLIF($3, ''), address),
                     city = COALESCE(NULLIF($4, ''), city),
                     country = COALESCE(NULLIF($5, ''), country),
                     contact_person = COALESCE(NULLIF($6, ''), contact_person),
                     payment_terms = COALESCE(NULLIF($7, ''), payment_terms),
                     notes = COALESCE(NULLIF($8, ''), notes),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $9
                 RETURNING *`,
                [cleanText(s.email), cleanText(s.phone), cleanText(s.address), cleanText(s.city), cleanText(s.country) || 'Angola', cleanText(s.contactPerson || s.contact_person), s.paymentTerms || s.payment_terms || '30_days', cleanText(s.notes), existingByName.rows[0].id]
              );
            } else {
              upsertResult = await client.query(
                `INSERT INTO suppliers (name, nif, email, phone, address, city, country, contact_person, payment_terms, notes)
                 VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [normalizedName, cleanText(s.email), cleanText(s.phone), cleanText(s.address), cleanText(s.city), cleanText(s.country) || 'Angola', cleanText(s.contactPerson || s.contact_person), s.paymentTerms || s.payment_terms || '30_days', cleanText(s.notes)]
              );
            }
          }

          // Auto-create sub-account
          await ensureSupplierSubAccount(client, normalizedName, normalizedNif);
          imported++;
        } catch (err) {
          failed++;
          errors.push({ supplier: s.name, error: err.message });
        }
      }

      await client.query('COMMIT');
      await broadcastTable('suppliers');
      await broadcastTable('chart_of_accounts');

      console.log(`[SUPPLIERS] Batch import: ${imported} imported, ${failed} failed`);
      res.json({ imported, failed, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SUPPLIERS BATCH ERROR]', error);
      res.status(500).json({ error: error.message || 'Batch import failed' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, nif, email, phone, address, city, country, contactPerson, paymentTerms, notes, isActive } = req.body;
      const result = await db.query(
        `UPDATE suppliers 
         SET name = $1, nif = $2, email = $3, phone = $4, address = $5, city = $6, 
             country = $7, contact_person = $8, payment_terms = $9, notes = $10, is_active = $11, updated_at = CURRENT_TIMESTAMP
         WHERE id = $12 RETURNING *`,
        [name, nif, email, phone, address, city, country, contactPerson, paymentTerms, notes, isActive, id]
      );
      await broadcastTable('suppliers');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to update supplier' });
    }
  });

  router.post('/reconcile-balances', async (req, res) => {
    try {
      const { runDataConsistencyRepair } = require('../dataConsistencyRepair');
      const result = await runDataConsistencyRepair();
      await broadcastTable('suppliers');
      await broadcastTable('clients');
      await broadcastTable('products');
      res.json(result);
    } catch (error) {
      console.error('[SUPPLIERS ERROR] reconcile-balances:', error);
      res.status(500).json({ error: error.message || 'Failed to reconcile balances' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE suppliers SET is_active = false WHERE id = $1', [id]);
      await broadcastTable('suppliers');
      res.json({ success: true });
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete supplier' });
    }
  });

  return router;
};
