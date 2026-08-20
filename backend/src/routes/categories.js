// Categories API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

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
      const result = await db.query(
        'INSERT INTO categories (name, description, color) VALUES ($1, $2, $3) RETURNING *',
        [name, description, color]
      );
      await broadcastTable('categories');
      const created = result.rows[0];
      auditErpSafe(req, {
        table: 'categories',
        id: created?.id,
        action: 'create',
        description: `Categoria criada: ${name || created?.name || ''}`,
        newValues: { name, description, color },
      });
      res.status(201).json(created);
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  router.put('/:id', requirePermission('inventory_edit', 'admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, color, isActive } = req.body;
      const result = await db.query(
        'UPDATE categories SET name = $1, description = $2, color = $3, is_active = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
        [name, description, color, isActive, id]
      );
      await broadcastTable('categories');
      auditErpSafe(req, {
        table: 'categories',
        id,
        action: 'update',
        description: `Categoria actualizada: ${name || id}`,
        newValues: { name, description, color, isActive },
      });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[CATEGORIES ERROR]', error);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  router.delete('/:id', requirePermission('inventory_edit', 'admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('UPDATE categories SET is_active = false WHERE id = $1', [id]);
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
