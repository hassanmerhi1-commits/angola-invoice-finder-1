const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { buildCaixaReconciliation } = require('../lib/caixaReconciliation');
const { applyCaixaClose } = require('../sync/caixaIngest');

async function caixaTablesExist() {
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'caixa_sessions' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'caixa_sessions' LIMIT 1`,
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

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

module.exports = function caixaRouter(broadcastTable) {
  const router = express.Router();

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

      const orderBy = db.engine === 'postgres' ? 'opened_at DESC NULLS LAST' : 'opened_at DESC';
      const result = await db.query(
        `SELECT * FROM caixa_sessions
         WHERE branch_id = $1 AND status = 'open'
         ORDER BY ${orderBy}
         LIMIT 1`,
        [branchId],
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
      res.status(201).json(mapSessionRow(row.rows[0]));
    } catch (error) {
      console.error('[CAIXA] session open:', error);
      res.status(500).json({ error: error.message || 'Failed to open caixa session' });
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
      res.json(result);
    } catch (error) {
      console.error('[CAIXA] session close:', error);
      res.status(500).json({ error: error.message || 'Failed to close caixa session' });
    }
  });

  return router;
};
