const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');

function parseStatementRows(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    branchId: row.branch_id || '',
    statementRows: parseStatementRows(row.statement_rows),
    status: row.status || 'in_progress',
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = function bankReconciliationsRouter() {
  const router = express.Router();

  router.get('/:bankAccountId', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const bankAccountId = String(req.params.bankAccountId || '').trim();
      if (!bankAccountId) return res.status(400).json({ error: 'bankAccountId is required' });
      const r = await db.query(
        `SELECT * FROM bank_reconciliations WHERE bank_account_id = $1 LIMIT 1`,
        [bankAccountId],
      );
      if (!r.rows[0]) return res.json(null);
      res.json(mapSession(r.rows[0]));
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json(null);
      }
      console.error('[BANK_RECON]', e);
      res.status(500).json({ error: e.message || 'Failed to load reconciliation' });
    }
  });

  router.put('/:bankAccountId', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const bankAccountId = String(req.params.bankAccountId || '').trim();
      if (!bankAccountId) return res.status(400).json({ error: 'bankAccountId is required' });

      const statementRows = Array.isArray(req.body?.statementRows) ? req.body.statementRows : [];
      const status = String(req.body?.status || 'in_progress').trim() || 'in_progress';
      const branchId = String(req.body?.branchId || req.body?.branch_id || '').trim();
      const updatedBy = req.user?.id || req.user?.username || null;
      const payload = JSON.stringify(statementRows);

      if (!statementRows.length) {
        await db.query(`DELETE FROM bank_reconciliations WHERE bank_account_id = $1`, [bankAccountId]);
        return res.json({ success: true, cleared: true });
      }

      const existing = await db.query(
        `SELECT id FROM bank_reconciliations WHERE bank_account_id = $1 LIMIT 1`,
        [bankAccountId],
      );

      if (existing.rows[0]) {
        await db.query(
          `UPDATE bank_reconciliations
           SET statement_rows = $2,
               status = $3,
               branch_id = COALESCE(NULLIF($4, ''), branch_id),
               updated_by = $5,
               updated_at = CURRENT_TIMESTAMP
           WHERE bank_account_id = $1`,
          [bankAccountId, payload, status, branchId, updatedBy],
        );
      } else {
        await db.query(
          `INSERT INTO bank_reconciliations
             (id, bank_account_id, branch_id, statement_rows, status, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), bankAccountId, branchId, payload, status, updatedBy],
        );
      }

      const r = await db.query(
        `SELECT * FROM bank_reconciliations WHERE bank_account_id = $1 LIMIT 1`,
        [bankAccountId],
      );
      res.json(mapSession(r.rows[0]));
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.status(503).json({ error: 'bank_reconciliations table not ready' });
      }
      console.error('[BANK_RECON]', e);
      res.status(500).json({ error: e.message || 'Failed to save reconciliation' });
    }
  });

  router.delete('/:bankAccountId', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const bankAccountId = String(req.params.bankAccountId || '').trim();
      await db.query(`DELETE FROM bank_reconciliations WHERE bank_account_id = $1`, [bankAccountId]);
      res.json({ success: true });
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json({ success: true });
      }
      console.error('[BANK_RECON]', e);
      res.status(500).json({ error: e.message || 'Failed to clear reconciliation' });
    }
  });

  return router;
};
