// Branches API routes
const express = require('express');
const db = require('../db');
const { branchesListSql } = require('../lib/sqlDialect');
const { ensureBranchCaixaAccount, ensureAllBranchCaixaAccounts } = require('../lib/branchCaixaAccounts');
const { requirePermission } = require('../middleware/requirePermission');
const crypto = require('crypto');

/** Clamp any incoming value to a valid selling price level (1-4), defaulting to 1. */
function clampPriceLevel(value) {
  const n = Math.trunc(Number(value));
  return n >= 1 && n <= 4 ? n : 1;
}

function buildBranchCode(name = '') {
  const cleaned = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = (cleaned.slice(0, 3) || 'FIL').padEnd(3, 'X');
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `${base}-${suffix}`.slice(0, 10);
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all branches
  router.get('/', async (req, res) => {
    try {
      const result = await db.query(branchesListSql(db));
      res.json(
        result.rows.map((row) => ({
          ...row,
          isMain: row.is_main === 1 || row.is_main === true || row.is_main === '1',
          priceLevel: clampPriceLevel(row.price_level),
          cityId: row.city_id,
          parentBranchId: row.parent_branch_id,
          nodeRole: row.node_role || (row.is_main ? 'main' : 'shop'),
        }))
      );
    } catch (error) {
      console.error('[BRANCHES ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch branches' });
    }
  });

  // Create branch
  router.post('/', requirePermission('admin_settings'), async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { name, code, address, phone, isMain, priceLevel } = req.body;
      const normalizedName = String(name || '').trim();
      const normalizedPriceLevel = clampPriceLevel(priceLevel);
      let normalizedCode = String(code || '').trim().toUpperCase();

      if (!normalizedName) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Branch name is required' });
      }

      // If code provided, check for duplicates
      if (normalizedCode) {
        const existing = await client.query('SELECT id FROM branches WHERE code = $1', [normalizedCode]);
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Branch code '${normalizedCode}' already exists. Please use a different code.` });
        }
      } else {
        normalizedCode = buildBranchCode(normalizedName);
        const existing = await client.query('SELECT id FROM branches WHERE code = $1', [normalizedCode]);
        if (existing.rows.length > 0) {
          normalizedCode = buildBranchCode(normalizedName);
        }
      }
      
      const result = await client.query(
        `INSERT INTO branches (name, code, address, phone, is_main, price_level)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
         [normalizedName, normalizedCode, address?.trim?.() || '', phone?.trim?.() || '', isMain || false, normalizedPriceLevel]
      );

      const branch = result.rows[0];

      await ensureBranchCaixaAccount(client, branch.id, normalizedName);
      try {
        const { ensureDefaultWarehouse } = require('../lib/warehouses');
        await ensureDefaultWarehouse(client, branch.id, normalizedName);
      } catch (whErr) {
        console.warn('[BRANCHES] default warehouse:', whErr.message);
      }

      await client.query('COMMIT');
      await broadcastTable('branches');
      await broadcastTable('chart_of_accounts');
      await broadcastTable('warehouses');
      res.status(201).json(branch);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[BRANCHES ERROR]', error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Branch code already exists. Please try again.' });
      }
      res.status(500).json({ error: 'Failed to create branch' });
    } finally {
      client.release();
    }
  });

  /** Backfill Caixa GL (45x) accounts for branches missing one — safe to run after deploy. */
  router.post('/ensure-caixa-accounts', requirePermission('admin_settings'), async (req, res) => {
    try {
      const result = await ensureAllBranchCaixaAccounts(db);
      if (result.created > 0) {
        await broadcastTable('chart_of_accounts');
      }
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[BRANCHES] ensure-caixa-accounts:', error);
      res.status(500).json({ error: error.message || 'Failed to ensure branch caixa accounts' });
    }
  });

  // Update branch
  router.put('/:id', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, address, phone, isMain, priceLevel } = req.body;
      const normalizedName = String(name || '').trim();
      const normalizedPriceLevel = priceLevel == null ? null : clampPriceLevel(priceLevel);
      let normalizedCode = String(code || '').trim().toUpperCase() || buildBranchCode(normalizedName);

      if (!normalizedName) {
        return res.status(400).json({ error: 'Branch name is required' });
      }

      // Check code uniqueness excluding current branch
      const existing = await db.query('SELECT id FROM branches WHERE code = $1 AND id != $2', [normalizedCode, id]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `Branch code '${normalizedCode}' is already used by another branch.` });
      }
      
      const result = await db.query(
        `UPDATE branches SET name = $1, code = $2, address = $3, phone = $4, is_main = $5, price_level = COALESCE($6, price_level)
         WHERE id = $7 RETURNING *`,
         [normalizedName, normalizedCode, address?.trim?.() || '', phone?.trim?.() || '', isMain, normalizedPriceLevel, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Branch not found' });
      }

      const row = result.rows[0];
      await broadcastTable('branches');
      res.json({
        ...row,
        isMain: row.is_main === 1 || row.is_main === true || row.is_main === '1',
        priceLevel: clampPriceLevel(row.price_level),
        cityId: row.city_id,
        parentBranchId: row.parent_branch_id,
        nodeRole: row.node_role || (row.is_main ? 'main' : 'shop'),
      });
    } catch (error) {
      console.error('[BRANCHES ERROR]', error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Branch code already exists' });
      }
      res.status(500).json({ error: 'Failed to update branch' });
    }
  });

  // Soft-delete branch (deactivate)
  router.delete('/:id', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT id, is_main FROM branches WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Branch not found' });
      }
      if (existing.rows[0].is_main) {
        return res.status(400).json({ error: 'Cannot delete the main branch' });
      }
      await db.query('UPDATE branches SET is_active = 0 WHERE id = $1', [id]);
      await broadcastTable('branches');
      res.json({ success: true });
    } catch (error) {
      console.error('[BRANCHES ERROR]', error);
      res.status(500).json({ error: 'Failed to delete branch' });
    }
  });

  return router;
};
