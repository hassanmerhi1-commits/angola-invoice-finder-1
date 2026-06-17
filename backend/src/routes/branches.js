// Branches API routes
const express = require('express');
const db = require('../db');
const { branchesListSql } = require('../lib/sqlDialect');
const crypto = require('crypto');

function buildBranchCode(name = '') {
  const cleaned = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = (cleaned.slice(0, 3) || 'FIL').padEnd(3, 'X');
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `${base}-${suffix}`.slice(0, 10);
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  /**
   * Auto-create a 45X Caixa sub-account for a branch (Angola PGC novo com IVA).
   * 451/452/453 are reserved by the PGC, so branch caixa accounts start at 454.
   */
  async function ensureBranchCaixaAccount(client, branchId, branchName) {
    // Check if already exists
    const existing = await client.query(
      `SELECT code FROM chart_of_accounts WHERE code LIKE '45%' AND level = 2 AND is_header = false
       AND (branch_id = $1 OR name LIKE '%' || $2 || '%')`,
      [branchId, branchName]
    );
    if (existing.rows.length > 0) return existing.rows[0].code;

    // Find parent 45 (Caixa)
    const parent = await client.query(
      `SELECT id FROM chart_of_accounts WHERE code = '45' AND is_active = true LIMIT 1`
    );
    if (parent.rows.length === 0) {
      console.warn('[BRANCHES] Parent account 45 (Caixa) not found — skipping sub-account');
      return null;
    }
    const parentId = parent.rows[0].id;

    // Next sequence (skip the PGC-reserved 451/452/453)
    const seqResult = await client.query(
      `SELECT COUNT(*) as count FROM chart_of_accounts WHERE code LIKE '45%' AND level = 2 AND is_header = false`
    );
    const nextSeq = Math.max(3, parseInt(seqResult.rows[0].count)) + 1;
    const code = `45${nextSeq}`;

    await client.query(
      `INSERT INTO chart_of_accounts
       (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
       VALUES ($1, $2, $3, 'asset', 'debit', $4, 2, false, 0, 0, $5)
       ON CONFLICT (code) DO NOTHING`,
      [code, `Caixa - ${branchName}`, `Conta caixa da filial ${branchName}`, parentId, branchId]
    );

    // Update parent children_count
    await client.query(
      `UPDATE chart_of_accounts SET children_count = (
         SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
       ) WHERE id = $1`,
      [parentId]
    );

    console.log(`[BRANCHES] Created sub-account ${code} — Caixa - ${branchName}`);
    return code;
  }

  // Get all branches
  router.get('/', async (req, res) => {
    try {
      const result = await db.query(branchesListSql(db));
      res.json(
        result.rows.map((row) => ({
          ...row,
          isMain: row.is_main === 1 || row.is_main === true || row.is_main === '1',
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
  router.post('/', async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { name, code, address, phone, isMain } = req.body;
      const normalizedName = String(name || '').trim();
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
        `INSERT INTO branches (name, code, address, phone, is_main)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
         [normalizedName, normalizedCode, address?.trim?.() || '', phone?.trim?.() || '', isMain || false]
      );

      const branch = result.rows[0];

      // Auto-create Caixa sub-account for this branch
      await ensureBranchCaixaAccount(client, branch.id, normalizedName);

      await client.query('COMMIT');
      await broadcastTable('branches');
      await broadcastTable('chart_of_accounts');
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

  // Update branch
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, address, phone, isMain } = req.body;
      const normalizedName = String(name || '').trim();
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
        `UPDATE branches SET name = $1, code = $2, address = $3, phone = $4, is_main = $5
         WHERE id = $6 RETURNING *`,
         [normalizedName, normalizedCode, address?.trim?.() || '', phone?.trim?.() || '', isMain, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Branch not found' });
      }
      
      await broadcastTable('branches');
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[BRANCHES ERROR]', error);
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Branch code already exists' });
      }
      res.status(500).json({ error: 'Failed to update branch' });
    }
  });

  // Soft-delete branch (deactivate)
  router.delete('/:id', async (req, res) => {
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
