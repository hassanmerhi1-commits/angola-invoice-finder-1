// Suppliers API routes — with auto Chart of Accounts sub-account creation
const express = require('express');
const db = require('../db');
const { openItemDebitAmountCase } = require('../lib/sqlDialect');
const { auditErpSafe } = require('../lib/erpAudit');
const { requirePermission } = require('../middleware/requirePermission');
const {
  ensureSupplierSubAccount,
} = require('../lib/entityCoaAccounts');

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
      // One grouped scan of open_items instead of a correlated subquery per supplier row.
      const result = await db.query(
        `SELECT s.*, COALESCE(b.balance, 0) AS balance
         FROM suppliers s
         LEFT JOIN (
           SELECT oi.entity_id, SUM(
             ${openItemDebitAmountCase(db, 'oi')}
           ) AS balance
           FROM open_items oi
           WHERE oi.entity_type = 'supplier' AND oi.status != 'cleared'
           GROUP BY oi.entity_id
         ) b ON b.entity_id = s.id
         WHERE s.is_active = true
         ORDER BY s.name`
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
  });

  router.post('/', requirePermission('purchase_create', 'admin_settings'), async (req, res) => {
    // Validate before opening a transaction so we can return a clean 400.
    if (!cleanText(req.body?.name)) {
      return res.status(400).json({ error: 'Nome do fornecedor é obrigatório' });
    }
    if (!normalizeSupplierNif(req.body?.nif)) {
      return res.status(400).json({ error: 'NIF do fornecedor é obrigatório' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { name, nif, email, phone, address, city, country, contactPerson, paymentTerms, notes, accountParentCode } = req.body;
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

      const supplier = result.rows[0];

      // Auto-create 3.2.XXX sub-account (non-fatal — supplier row must still commit)
      let accountCode = null;
      try {
        accountCode = await ensureSupplierSubAccount(client, normalizedName, normalizedNif, accountParentCode);
      } catch (subErr) {
        console.warn('[SUPPLIERS] Sub-account creation skipped:', subErr.message);
      }

      await client.query('COMMIT');
      await broadcastTable('suppliers');
      await broadcastTable('chart_of_accounts');

      supplier._accountCode = accountCode;
      auditErpSafe(req, {
        table: 'suppliers',
        id: supplier.id,
        action: 'create',
        description: `Fornecedor criado: ${normalizedName}${normalizedNif ? ` (${normalizedNif})` : ''}`,
        newValues: { name: normalizedName, nif: normalizedNif, accountCode },
      });
      res.status(201).json(supplier);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SUPPLIERS ERROR]', error);
      const msg = String(error.message || '');
      if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505' || /unique|duplicate/i.test(msg)) {
        return res.status(409).json({ error: 'Já existe um fornecedor com este NIF.' });
      }
      res.status(500).json({ error: error.message || 'Failed to create supplier' });
    } finally {
      client.release();
    }
  });

  // Batch import — auto-creates sub-accounts for each supplier
  router.post('/batch', requirePermission('purchase_create', 'inventory_import', 'admin_settings'), async (req, res) => {
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
      auditErpSafe(req, {
        table: 'suppliers',
        id: null,
        action: 'import',
        description: `Importação de fornecedores: +${imported} / fail ${failed}`,
        newValues: { imported, failed },
      });
      res.json({ imported, failed, errors });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[SUPPLIERS BATCH ERROR]', error);
      res.status(500).json({ error: error.message || 'Batch import failed' });
    } finally {
      client.release();
    }
  });

  router.put('/:id', requirePermission('purchase_create', 'admin_settings'), async (req, res) => {
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
      auditErpSafe(req, {
        table: 'suppliers',
        id,
        action: 'update',
        description: `Fornecedor actualizado: ${name || id}`,
        newValues: { name, nif, isActive },
      });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to update supplier' });
    }
  });

  router.post('/reconcile-balances', requirePermission('admin_settings', 'admin_consistency'), async (req, res) => {
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

  router.delete('/:id', requirePermission('admin_settings', 'purchase_create'), async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE suppliers SET is_active = false WHERE id = $1', [id]);
      await broadcastTable('suppliers');
      auditErpSafe(req, {
        table: 'suppliers',
        id,
        action: 'delete',
        description: `Fornecedor desactivado: ${id}`,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[SUPPLIERS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete supplier' });
    }
  });

  return router;
};
