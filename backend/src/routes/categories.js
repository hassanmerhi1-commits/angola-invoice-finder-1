// Categories API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');
const { cleanCategoryName, categoryNameKey } = require('../lib/categoryNames');
const { canonicalSkuString, sqlMovementSkuKey } = require('../lib/productSkuResolve');

const MANAGE_PERMISSION = requirePermission('inventory_edit', 'inventory_create', 'admin_settings');

function activeFlag() {
  return db.engine === 'postgres' ? true : 1;
}

function inactiveFlag() {
  return db.engine === 'postgres' ? false : 0;
}

async function withDbTx(fn) {
  if (db.engine === 'postgres' && db.pool) {
    const client = await db.pool.connect();
    const query = async (text, params) => {
      const result = await client.query(text, params);
      return { rows: result.rows || [], rowCount: result.rowCount || 0 };
    };
    try {
      await client.query('BEGIN');
      const result = await fn({ query });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
      throw error;
    } finally {
      client.release();
    }
  }
  await db.query('BEGIN');
  try {
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw error;
  }
}

async function findCategoryByName(q, name) {
  const result = await q.query(
    'SELECT * FROM categories WHERE lower(name) = lower($1) ORDER BY is_active DESC LIMIT 1',
    [name],
  );
  return result.rows[0] || null;
}

async function ensureActiveCategory(q, name) {
  const row = await findCategoryByName(q, name);
  if (row) {
    const inactive = row.is_active === false || row.is_active === 0;
    if (!inactive && row.name === name) return row;
    const updated = await q.query(
      `UPDATE categories
       SET name = $1, is_active = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [name, activeFlag(), row.id],
    );
    return updated.rows[0] || row;
  }
  const inserted = await q.query(
    'INSERT INTO categories (name, description, color, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, '', '#3b82f6', activeFlag()],
  );
  return inserted.rows[0];
}

async function rewriteProductCategory(q, fromName, toName) {
  const result = await q.query(
    `UPDATE products
     SET category = $1, updated_at = CURRENT_TIMESTAMP
     WHERE lower(trim(COALESCE(category, ''))) = lower($2)`,
    [toName, fromName],
  );
  return result.rowCount || 0;
}

async function countProductsInCategory(q, name) {
  const result = await q.query(
    `SELECT COUNT(*) AS n
     FROM products
     WHERE lower(trim(COALESCE(category, ''))) = lower($1)`,
    [name],
  );
  return parseInt(result.rows[0]?.n, 10) || 0;
}

async function deactivateCategoryName(q, name) {
  await q.query(
    `UPDATE categories
     SET is_active = $1, updated_at = CURRENT_TIMESTAMP
     WHERE lower(name) = lower($2)`,
    [inactiveFlag(), name],
  );
}

async function assignSkus(q, name, skus) {
  const keys = [];
  const seen = new Set();
  for (const raw of skus) {
    const key = canonicalSkuString(raw).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  let updated = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const placeholders = chunk.map((_, idx) => `$${idx + 2}`).join(', ');
    const result = await q.query(
      `UPDATE products
       SET category = $1, updated_at = CURRENT_TIMESTAMP
       WHERE ${sqlMovementSkuKey('products')} IN (${placeholders})`,
      [name, ...chunk],
    );
    updated += result.rowCount || 0;
  }
  return { updated, skus: keys.length };
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM categories WHERE is_active = true ORDER BY name');
      res.json(result.rows);
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch categories' });
    }
  });

  router.post('/', requirePermission('inventory_create', 'admin_settings'), async (req, res) => {
    try {
      const { name, description, color } = req.body;
      const cleaned = cleanCategoryName(name);
      if (!cleaned) {
        return res.status(400).json({ error: 'name_required' });
      }
      const existing = await db.query(
        'SELECT * FROM categories WHERE lower(name) = lower($1) ORDER BY is_active DESC LIMIT 1',
        [cleaned],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        const inactive = row.is_active === false || row.is_active === 0;
        if (!inactive) {
          return res.status(200).json(row);
        }
        const revived = await db.query(
          'UPDATE categories SET is_active = $1, name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
          [activeFlag(), cleaned, row.id],
        );
        await broadcastTable('categories');
        return res.status(200).json(revived.rows[0] || row);
      }
      const result = await db.query(
        'INSERT INTO categories (name, description, color, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
        [cleaned, description || '', color || '#3b82f6', activeFlag()]
      );
      await broadcastTable('categories');
      const created = result.rows[0];
      auditErpSafe(req, {
        table: 'categories',
        id: created?.id,
        action: 'create',
        description: `Categoria criada: ${cleaned}`,
        newValues: { name: cleaned, description, color },
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  router.post('/apply', MANAGE_PERMISSION, async (req, res) => {
    try {
      const action = String(req.body?.action || '').trim();
      const name = cleanCategoryName(req.body?.name);
      const nextName = cleanCategoryName(req.body?.nextName);
      if (!name && action !== 'assign') {
        return res.status(400).json({ error: 'name_required' });
      }

      if (action === 'rename') {
        if (!nextName) return res.status(400).json({ error: 'name_required' });
        if (categoryNameKey(name) !== categoryNameKey(nextName)) {
          const clash = await findCategoryByName(db, nextName);
          if (clash && categoryNameKey(clash.name) !== categoryNameKey(name)) {
            const inactive = clash.is_active === false || clash.is_active === 0;
            if (!inactive) return res.status(409).json({ error: 'duplicate_name' });
          }
        }
        const outcome = await withDbTx(async (q) => {
          const updated = await rewriteProductCategory(q, name, nextName);
          const source = await findCategoryByName(q, name);
          const target = categoryNameKey(name) === categoryNameKey(nextName)
            ? source
            : await findCategoryByName(q, nextName);
          let category = source;
          if (target && (!source || String(target.id) !== String(source.id))) {
            const revived = await q.query(
              `UPDATE categories
               SET name = $1, is_active = $2, updated_at = CURRENT_TIMESTAMP
               WHERE id = $3
               RETURNING *`,
              [nextName, activeFlag(), target.id],
            );
            category = revived.rows[0] || target;
            if (source) await deactivateCategoryName(q, name);
          } else if (source) {
            const renamed = await q.query(
              `UPDATE categories
               SET name = $1, is_active = $2, updated_at = CURRENT_TIMESTAMP
               WHERE id = $3
               RETURNING *`,
              [nextName, activeFlag(), source.id],
            );
            category = renamed.rows[0] || source;
          } else {
            category = await ensureActiveCategory(q, nextName);
          }
          return { updated, category };
        });
        await broadcastTable('categories');
        await broadcastTable('products');
        auditErpSafe(req, {
          table: 'categories',
          id: outcome.category?.id,
          action: 'update',
          description: `Categoria renomeada: ${name} → ${nextName}`,
          oldValues: { name },
          newValues: { name: nextName, products: outcome.updated },
        });
        return res.json({ ok: true, name: nextName, updated: outcome.updated, category: outcome.category });
      }

      if (action === 'delete') {
        const productCount = await countProductsInCategory(db, name);
        if (productCount > 0 && !nextName) {
          return res.status(409).json({ error: 'destination_required', productCount });
        }
        if (nextName && categoryNameKey(nextName) === categoryNameKey(name)) {
          return res.status(400).json({ error: 'duplicate_name' });
        }
        const outcome = await withDbTx(async (q) => {
          let updated = 0;
          if (nextName) {
            await ensureActiveCategory(q, nextName);
            updated = await rewriteProductCategory(q, name, nextName);
          }
          await deactivateCategoryName(q, name);
          return { updated };
        });
        await broadcastTable('categories');
        if (outcome.updated > 0) await broadcastTable('products');
        auditErpSafe(req, {
          table: 'categories',
          action: 'delete',
          description: `Categoria desactivada: ${name}`,
          oldValues: { name },
          newValues: { moveTo: nextName || null, products: outcome.updated },
        });
        return res.json({ ok: true, updated: outcome.updated, productCount });
      }

      if (action === 'assign') {
        if (!name) return res.status(400).json({ error: 'name_required' });
        const skus = Array.isArray(req.body?.skus) ? req.body.skus : [];
        if (skus.length === 0) return res.status(400).json({ error: 'name_required' });
        if (skus.length > 5000) return res.status(400).json({ error: 'too_many' });
        const outcome = await withDbTx(async (q) => {
          const category = await ensureActiveCategory(q, name);
          const assigned = await assignSkus(q, name, skus);
          return { category, ...assigned };
        });
        await broadcastTable('categories');
        await broadcastTable('products');
        auditErpSafe(req, {
          table: 'categories',
          id: outcome.category?.id,
          action: 'update',
          description: `Produtos movidos para a categoria ${name}`,
          newValues: { name, skus: outcome.skus, products: outcome.updated },
        });
        return res.json({ ok: true, name, updated: outcome.updated, skus: outcome.skus });
      }

      return res.status(400).json({ error: 'name_required' });
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  router.put('/:id', requirePermission('inventory_edit', 'admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, color, isActive } = req.body;
      const cleaned = cleanCategoryName(name);
      if (!cleaned) return res.status(400).json({ error: 'name_required' });
      const currentRes = await db.query('SELECT * FROM categories WHERE id = $1 LIMIT 1', [id]);
      const current = currentRes.rows[0];
      if (!current) return res.status(404).json({ error: 'Category not found' });
      const oldName = cleanCategoryName(current.name);
      if (categoryNameKey(cleaned) !== categoryNameKey(oldName)) {
        const clash = await findCategoryByName(db, cleaned);
        if (clash && String(clash.id) !== String(id)) {
          const inactive = clash.is_active === false || clash.is_active === 0;
          if (!inactive) return res.status(409).json({ error: 'duplicate_name' });
        }
      }
      const updatedRow = await withDbTx(async (q) => {
        if (cleaned !== oldName) await rewriteProductCategory(q, oldName, cleaned);
        const result = await q.query(
          'UPDATE categories SET name = $1, description = $2, color = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
          [cleaned, description || '', color || '#3b82f6', isActive, id]
        );
        return result.rows[0];
      });
      await broadcastTable('categories');
      if (cleaned !== oldName) await broadcastTable('products');
      auditErpSafe(req, {
        table: 'categories',
        id,
        action: 'update',
        description: `Categoria actualizada: ${cleaned}`,
        oldValues: { name: oldName },
        newValues: { name: cleaned, description, color, isActive },
      });
      res.json(updatedRow);
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  router.delete('/:id', requirePermission('inventory_edit', 'admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE categories SET is_active = $1 WHERE id = $2', [inactiveFlag(), id]);
      await broadcastTable('categories');
      auditErpSafe(req, {
        table: 'categories',
        id,
        action: 'delete',
        description: `Categoria desactivada: ${id}`,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  return router;
};
