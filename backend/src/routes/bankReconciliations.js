const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

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
        auditErpSafe(req, {
          table: 'bank_reconciliations',
          id: bankAccountId,
          action: 'delete',
          description: `Reconciliação bancária limpa: ${bankAccountId}`,
          branchId,
        });
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
      auditErpSafe(req, {
        table: 'bank_reconciliations',
        id: bankAccountId,
        action: 'delete',
        description: `Reconciliação bancária eliminada: ${bankAccountId}`,
      });
      res.json({ success: true });
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json({ success: true });
      }
      console.error('[BANK_RECON]', e);
      res.status(500).json({ error: e.message || 'Failed to clear reconciliation' });
    }
  });

  /**
   * Confirm matched pairs: mark bank_transactions as reconciled (cleared).
   * Does NOT post a second GL entry — matched rows are already booked.
   */
  router.post('/:bankAccountId/confirm', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const bankAccountId = String(req.params.bankAccountId || '').trim();
      if (!bankAccountId) return res.status(400).json({ error: 'bankAccountId is required' });

      const session = await db.query(
        `SELECT * FROM bank_reconciliations WHERE bank_account_id = $1 LIMIT 1`,
        [bankAccountId],
      );
      if (!session.rows[0]) {
        return res.status(404).json({ error: 'No reconciliation session for this account' });
      }

      const rows = parseStatementRows(session.rows[0].statement_rows);
      const matchedIds = [
        ...new Set(
          rows
            .filter((r) => r && r.matched && r.matchedTransactionId)
            .map((r) => String(r.matchedTransactionId).trim())
            .filter(Boolean),
        ),
      ];

      if (!matchedIds.length) {
        return res.status(400).json({ error: 'No matched transactions to confirm' });
      }

      const reconId = String(session.rows[0].id);
      let cleared = 0;
      try {
        const upd = await db.query(
          `UPDATE bank_transactions
           SET is_reconciled = true,
               reconciled_at = CURRENT_TIMESTAMP,
               reconciliation_id = $3
           WHERE bank_account_id = $1
             AND id = ANY($2::text[])
             AND COALESCE(is_reconciled, false) = false`,
          [bankAccountId, matchedIds, reconId],
        );
        cleared = upd.rowCount || 0;
      } catch (colErr) {
        if (!/is_reconciled|column/i.test(String(colErr.message))) throw colErr;
        // Migration not applied yet — still mark session complete.
        console.warn('[BANK_RECON] is_reconciled column missing; confirm marks session only');
      }

      await db.query(
        `UPDATE bank_reconciliations
         SET status = 'completed',
             updated_by = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE bank_account_id = $1`,
        [bankAccountId, req.user?.id || req.user?.username || null],
      );

      const r = await db.query(
        `SELECT * FROM bank_reconciliations WHERE bank_account_id = $1 LIMIT 1`,
        [bankAccountId],
      );
      auditErpSafe(req, {
        table: 'bank_reconciliations',
        id: reconId,
        action: 'approve',
        description: `Reconciliação bancária confirmada: ${cleared} movimentos`,
        newValues: { bankAccountId, cleared, matchedCount: matchedIds.length },
      });
      res.json({
        success: true,
        cleared,
        matchedCount: matchedIds.length,
        session: mapSession(r.rows[0]),
      });
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.status(503).json({ error: 'bank tables not ready' });
      }
      console.error('[BANK_RECON]', e);
      res.status(500).json({ error: e.message || 'Failed to confirm reconciliation' });
    }
  });

  return router;
};
