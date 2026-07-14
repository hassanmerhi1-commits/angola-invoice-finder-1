const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { resolveBranchFilterId } = require('../lib/branchIdMatch');
const { requirePermission } = require('../middleware/requirePermission');
const { buildCaixaReconciliation } = require('../lib/caixaReconciliation');
const { applyCaixaClose } = require('../sync/caixaIngest');
const { postCaixaGlMovement, syncCaixaGlFromRecord } = require('../lib/caixaGlPosting');
const { auditErpSafe } = require('../lib/erpAudit');

async function caixaTablesExist() {
  if (caixaTablesExist.cached !== undefined) return caixaTablesExist.cached;
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'caixa_sessions' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'caixa_sessions' LIMIT 1`,
    );
    caixaTablesExist.cached = r.rows.length > 0;
    return caixaTablesExist.cached;
  } catch {
    caixaTablesExist.cached = false;
    return false;
  }
}
caixaTablesExist.cached = undefined;

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caixaId: row.caixa_id,
    branchId: row.branch_id,
    date: row.date,
    openingBalance: Number(row.opening_balance) || 0,
    closingBalance: row.closing_balance != null ? Number(row.closing_balance) : undefined,
    totalIn: Number(row.total_in) || 0,
    totalOut: Number(row.total_out) || 0,
    salesTotal: Number(row.sales_total) || 0,
    expensesTotal: Number(row.expenses_total) || 0,
    adjustments: Number(row.adjustments) || 0,
    status: row.status,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapCaixaRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name || '',
    name: row.name || '',
    openingBalance: Number(row.opening_balance) || 0,
    currentBalance: Number(row.current_balance ?? row.closing_balance ?? 0),
    status: row.status || 'closed',
    pettyLimit: row.petty_limit != null ? Number(row.petty_limit) : undefined,
    dailyLimit: row.daily_limit != null ? Number(row.daily_limit) : undefined,
    requiresApproval: !!row.requires_approval,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closingBalance: row.closing_balance != null ? Number(row.closing_balance) : undefined,
    closingNotes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = function caixaRouter(broadcastTable) {
  const router = express.Router();

  /** List cash registers (caixas) — used by LAN clients for expenses/POS dropdowns. */
  router.get('/registers', async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.json({ data: [] });
      }
      const branchId = String(req.query.branchId || '').trim();
      const params = [];
      let sql = 'SELECT * FROM caixas';
      if (branchId) {
        const resolved = await resolveBranchFilterId(db, branchId);
        const matchId = resolved || branchId;
        if (db.engine === 'postgres') {
          sql += ' WHERE branch_id::text = $1';
        } else {
          sql += ' WHERE CAST(branch_id AS TEXT) = $1';
        }
        params.push(matchId);
      }
      const orderBy = db.engine === 'postgres'
        ? 'updated_at DESC NULLS LAST, created_at DESC'
        : 'updated_at DESC, created_at DESC';
      sql += ` ORDER BY ${orderBy}`;
      const result = await db.query(sql, params);
      res.json({ data: (result.rows || []).map(mapCaixaRow).filter(Boolean) });
    } catch (error) {
      console.error('[CAIXA] registers list:', error);
      res.status(500).json({ error: error.message || 'Failed to list caixas' });
    }
  });

  /** Create a default caixa for a branch when none exists (expenses form). */
  router.post('/registers/ensure', async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.status(503).json({ error: 'Caixa tables not available on server' });
      }
      const branchId = String(req.body?.branchId || '').trim();
      const branchName = String(req.body?.branchName || '').trim();
      if (!branchId) return res.status(400).json({ error: 'branchId required' });

      const resolvedBranchId = (await resolveBranchFilterId(db, branchId)) || branchId;

      const existing = await db.query(
        db.engine === 'postgres'
          ? 'SELECT * FROM caixas WHERE branch_id::text = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1'
          : 'SELECT * FROM caixas WHERE CAST(branch_id AS TEXT) = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1',
        [resolvedBranchId],
      );
      if (existing.rows[0]) {
        return res.json({ data: mapCaixaRow(existing.rows[0]) });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const name = `Caixa Principal - ${branchName || resolvedBranchId}`;
      await db.query(
        `INSERT INTO caixas (
          id, branch_id, branch_name, name, opening_balance, current_balance,
          status, requires_approval, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,0,0,'closed',false,$5,$5)`,
        [id, resolvedBranchId, branchName || '', name, now],
      );
      const row = await db.query('SELECT * FROM caixas WHERE id = $1', [id]);
      if (broadcastTable) await broadcastTable('caixas');
      res.status(201).json({ data: mapCaixaRow(row.rows[0]) });
    } catch (error) {
      console.error('[CAIXA] registers ensure:', error);
      res.status(500).json({ error: error.message || 'Failed to ensure caixa' });
    }
  });

  router.get('/reconciliation', async (req, res) => {
    try {
      const branchId = String(req.query.branchId || '').trim();
      const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const session = {
        openingBalance: req.query.sessionOpening,
        totalIn: req.query.sessionCashIn,
        totalOut: req.query.sessionCashOut,
        salesTotal: req.query.sessionSalesTotal,
        expensesTotal: req.query.sessionExpensesTotal,
        openedAt: req.query.sessionOpenedAt,
      };
      const report = await buildCaixaReconciliation({ branchId, date, session });
      res.json(report);
    } catch (error) {
      console.error('[CAIXA] reconciliation:', error);
      res.status(400).json({ error: error.message || 'Failed to build reconciliation' });
    }
  });

  router.get('/sessions/open', async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.json(null);
      }
      const branchId = String(req.query.branchId || '').trim();
      if (!branchId) return res.status(400).json({ error: 'branchId required' });

      const resolvedBranchId = (await resolveBranchFilterId(db, branchId)) || branchId;
      const orderBy = db.engine === 'postgres' ? 'opened_at DESC NULLS LAST' : 'opened_at DESC';
      const branchFilter = db.engine === 'postgres'
        ? 'branch_id::text = $1'
        : 'CAST(branch_id AS TEXT) = $1';
      const result = await db.query(
        `SELECT * FROM caixa_sessions
         WHERE ${branchFilter} AND status = 'open'
         ORDER BY ${orderBy}
         LIMIT 1`,
        [resolvedBranchId],
      );
      res.json(mapSessionRow(result.rows[0]));
    } catch (error) {
      console.error('[CAIXA] open session get:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch open session' });
    }
  });

  router.post('/sessions/open', requirePermission('caixa_open', 'pos_access'), async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.status(503).json({ error: 'Caixa tables not available on server' });
      }
      const {
        id,
        caixaId,
        branchId,
        branchName,
        openingBalance,
        openedBy,
        date,
      } = req.body || {};

      if (!branchId) return res.status(400).json({ error: 'branchId required' });

      const existing = await db.query(
        `SELECT id FROM caixa_sessions WHERE branch_id = $1 AND status = 'open' LIMIT 1`,
        [branchId],
      );
      if (existing.rows.length > 0) {
        const row = await db.query(`SELECT * FROM caixa_sessions WHERE id = $1`, [existing.rows[0].id]);
        return res.json(mapSessionRow(row.rows[0]));
      }

      const sessionId = id || crypto.randomUUID();
      const cxId = caixaId || crypto.randomUUID();
      const today = date || new Date().toISOString().slice(0, 10);
      const openBal = Number(openingBalance) || 0;
      const now = new Date().toISOString();

      await db.query(
        `INSERT INTO caixas (id, branch_id, branch_name, name, opening_balance, current_balance, status, opened_by, opened_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, 'open', $6, $7, $7)
         ON CONFLICT (id) DO UPDATE SET
           status = 'open',
           opening_balance = excluded.opening_balance,
           current_balance = excluded.current_balance,
           opened_by = excluded.opened_by,
           opened_at = excluded.opened_at,
           updated_at = excluded.updated_at`,
        [cxId, branchId, branchName || '', `Caixa Principal - ${branchName || branchId}`, openBal, openedBy || '', now],
      );

      await db.query(
        `INSERT INTO caixa_sessions (
          id, caixa_id, branch_id, date, opening_balance, total_in, total_out,
          sales_total, expenses_total, adjustments, status, opened_by, opened_at
        ) VALUES ($1,$2,$3,$4,$5,0,0,0,0,0,'open',$6,$7)`,
        [sessionId, cxId, branchId, today, openBal, openedBy || '', now],
      );

      if (broadcastTable) await broadcastTable('caixa_sessions');
      const row = await db.query(`SELECT * FROM caixa_sessions WHERE id = $1`, [sessionId]);
      auditErpSafe(req, {
        table: 'caixa_sessions',
        id: sessionId,
        action: 'open',
        branchId,
        description: `Caixa aberta — ${branchName || branchId} (saldo ${openBal})`,
        newValues: { openingBalance: openBal, openedBy },
      });
      res.status(201).json(mapSessionRow(row.rows[0]));
    } catch (error) {
      console.error('[CAIXA] session open:', error);
      res.status(500).json({ error: error.message || 'Failed to open caixa session' });
    }
  });

  // Post a balanced GL journal entry for a cash movement (expense, withdrawal/sangria,
  // deposit/reforço, or transfer leg) against the branch-specific caixa account (45x).
  router.post('/gl/post', requirePermission('pos_access', 'caixa_open', 'caixa_close', 'admin_settings'), async (req, res) => {
    try {
      const result = await postCaixaGlMovement(req.body || {});
      if (broadcastTable) {
        try { await broadcastTable('journal_entries'); } catch (_) { /* non-fatal */ }
      }
      auditErpSafe(req, {
        table: 'caixa_gl',
        id: result?.journalEntryId || result?.id || null,
        action: 'gl_post',
        branchId: req.body?.branchId,
        description: `Caixa GL: ${req.body?.description || req.body?.referenceType || 'movimento'} (${Number(req.body?.amount) || 0} AOA)`,
        newValues: req.body || {},
      });
      if (result.alreadyPosted) {
        return res.json(result);
      }
      res.status(201).json(result);
    } catch (error) {
      console.error('[CAIXA] gl post:', error);
      res.status(500).json({ error: error.message || 'Failed to post GL entry' });
    }
  });

  // Loopback-only: Electron server posts GL after saving expense/caixa records (no user JWT).
  router.post('/gl/sync-record', async (req, res) => {
    try {
      const { table, record } = req.body || {};
      if (!table || !record) {
        return res.status(400).json({ error: 'table and record required' });
      }
      const outcome = await syncCaixaGlFromRecord(String(table), record);
      if (outcome.skipped) {
        return res.json({ skipped: true, reason: outcome.reason });
      }
      if (broadcastTable) {
        try { await broadcastTable('journal_entries'); } catch (_) { /* non-fatal */ }
      }
      res.status(201).json(outcome.result);
    } catch (error) {
      console.error('[CAIXA] gl sync-record:', error);
      res.status(500).json({ error: error.message || 'Failed to sync GL from record' });
    }
  });

  router.post('/sessions/:id/close', requirePermission('caixa_close', 'pos_access'), async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.status(503).json({ error: 'Caixa tables not available on server' });
      }
      const { id } = req.params;
      const body = req.body || {};
      const result = await applyCaixaClose({
        session: {
          id,
          caixaId: body.caixaId,
          branchId: body.branchId,
          date: body.date,
          openingBalance: body.openingBalance,
          closingBalance: body.closingBalance ?? body.countedCash,
          totalIn: body.totalIn,
          totalOut: body.totalOut,
          salesTotal: body.salesTotal,
          expensesTotal: body.expensesTotal,
          adjustments: body.adjustments,
          openedBy: body.openedBy,
          closedBy: body.closedBy,
          openedAt: body.openedAt,
          closedAt: body.closedAt || new Date().toISOString(),
          notes: body.notes,
        },
        caixa: body.caixa,
      });
      if (broadcastTable) {
        await broadcastTable('caixa_sessions');
        await broadcastTable('caixas');
      }
      auditErpSafe(req, {
        table: 'caixa_sessions',
        id,
        action: 'close',
        branchId: body.branchId,
        description: `Caixa fechada — ${body.branchId || id}`,
        newValues: {
          closingBalance: body.closingBalance ?? body.countedCash,
          closedBy: body.closedBy,
        },
      });
      res.json(result);
    } catch (error) {
      console.error('[CAIXA] session close:', error);
      res.status(500).json({ error: error.message || 'Failed to close caixa session' });
    }
  });

  return router;
};
