const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

function mapRow(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default === true || row.is_default === 1,
    isActive: row.is_active === true || row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = function warehousesRouter(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const branchId = String(req.query.branchId || '').trim();
      let sql = 'SELECT * FROM warehouses WHERE COALESCE(is_active, true) = true';
      const params = [];
      if (branchId) {
        sql += ' AND branch_id::text = $1';
        params.push(branchId);
      }
      sql += ' ORDER BY is_default DESC, name ASC';
      let r;
      try {
        r = await db.query(sql, params);
      } catch (_) {
        // SQLite / text branch_id
        sql = 'SELECT * FROM warehouses WHERE COALESCE(is_active, 1) = 1';
        if (branchId) {
          sql += ' AND CAST(branch_id AS TEXT) = $1';
        }
        sql += ' ORDER BY is_default DESC, name ASC';
        r = await db.query(sql, params);
      }
      res.json((r.rows || []).map(mapRow));
    } catch (e) {
      // Table may not exist yet on old DBs
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json([]);
      }
      res.status(500).json({ error: e.message || 'Failed to list warehouses' });
    }
  });

  router.post('/', requirePermission('admin_settings', 'inventory_create'), async (req, res) => {
    try {
      const id = crypto.randomUUID();
      const branchId = String(req.body?.branchId || '').trim();
      const code = String(req.body?.code || '').trim().toUpperCase();
      const name = String(req.body?.name || '').trim();
      const isDefault = !!req.body?.isDefault;
      if (!branchId || !code || !name) {
        return res.status(400).json({ error: 'branchId, code and name are required' });
      }
      if (isDefault) {
        await db.query(
          'UPDATE warehouses SET is_default = false WHERE branch_id::text = $1',
          [branchId],
        ).catch(() => db.query(
          'UPDATE warehouses SET is_default = 0 WHERE CAST(branch_id AS TEXT) = $1',
          [branchId],
        ));
      }
      await db.query(
        `INSERT INTO warehouses (id, branch_id, code, name, is_default, is_active)
         VALUES ($1,$2,$3,$4,$5,true)`,
        [id, branchId, code, name, isDefault],
      );
      const r = await db.query('SELECT * FROM warehouses WHERE id = $1', [id]);
      await broadcastTable?.('warehouses', id);
      auditErpSafe(req, {
        table: 'warehouses',
        id,
        action: 'create',
        description: `Armazém criado: ${name} (${code})`,
        newValues: { branchId, code, name, isDefault },
        branchId,
      });
      res.status(201).json(mapRow(r.rows[0]));
    } catch (e) {
      res.status(400).json({ error: e.message || 'Failed to create warehouse' });
    }
  });

  router.put('/:id', requirePermission('admin_settings', 'inventory_edit'), async (req, res) => {
    try {
      const name = req.body?.name != null ? String(req.body.name).trim() : null;
      const isDefault = req.body?.isDefault;
      const isActive = req.body?.isActive;
      const existing = await db.query('SELECT * FROM warehouses WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Warehouse not found' });
      const row = existing.rows[0];
      if (isDefault === true) {
        await db.query(
          'UPDATE warehouses SET is_default = false WHERE branch_id = $1',
          [row.branch_id],
        ).catch(() => {});
      }
      await db.query(
        `UPDATE warehouses SET
           name = COALESCE($2, name),
           is_default = COALESCE($3, is_default),
           is_active = COALESCE($4, is_active),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          req.params.id,
          name,
          isDefault === undefined ? null : !!isDefault,
          isActive === undefined ? null : !!isActive,
        ],
      );
      const r = await db.query('SELECT * FROM warehouses WHERE id = $1', [req.params.id]);
      await broadcastTable?.('warehouses', req.params.id);
      auditErpSafe(req, {
        table: 'warehouses',
        id: req.params.id,
        action: 'update',
        description: `Armazém actualizado: ${r.rows[0]?.name || req.params.id}`,
        newValues: { name, isDefault, isActive },
        branchId: r.rows[0]?.branch_id,
      });
      res.json(mapRow(r.rows[0]));
    } catch (e) {
      res.status(400).json({ error: e.message || 'Failed to update warehouse' });
    }
  });

  /** Ensure each branch has a default warehouse (code MAIN). */
  router.post('/ensure-defaults', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { ensureDefaultWarehouse } = require('../lib/warehouses');
      const branches = await db.query('SELECT id, code, name FROM branches WHERE COALESCE(is_active, true) = true');
      let created = 0;
      for (const b of branches.rows || []) {
        const result = await ensureDefaultWarehouse(db, b.id, b.name || b.code || 'Main');
        if (result?.created) created += 1;
      }
      res.json({ success: true, created });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to ensure warehouses' });
    }
  });

  return router;
};
