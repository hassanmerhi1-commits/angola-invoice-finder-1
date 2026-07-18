const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { resolveBranchFilterId } = require('../lib/branchIdMatch');
const { requirePermission } = require('../middleware/requirePermission');
const { buildCaixaReconciliation } = require('../lib/caixaReconciliation');
const { applyCaixaClose } = require('../sync/caixaIngest');
const { postCaixaGlMovement, syncCaixaGlFromRecord } = require('../lib/caixaGlPosting');
const { auditErpSafe } = require('../lib/erpAudit');
const { syncOpenSessionExpensesFromLedger } = require('../lib/caixaCashRefund');

async function caixaTablesExist() {
  // Only cache positive results — a sticky false before migrations made
  // GET /registers always return [] and hid every caixa from expense/supplier pay.
  if (caixaTablesExist.cached === true) return true;
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'caixas' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'caixas' LIMIT 1`,
    );
    const exists = r.rows.length > 0;
    if (exists) caixaTablesExist.cached = true;
    return exists;
  } catch {
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

/**
 * Ensure SEDE / head-office branch has is_main=true so HQ scope works.
 * Also create operational caixas from COA 45x leaf accounts (users often have
 * many GL caixas but only auto "Caixa Principal" registers).
 */
async function ensureTreasuryRegistersFromCoa() {
  try {
    // Prefer a branch named/coded SEDE as head office (fixes Sede Soyo treated like a shop).
    if (db.engine === 'postgres') {
      const sede = await db.query(
        `SELECT id FROM branches
         WHERE name ILIKE '%sede%' OR code ILIKE 'SEDE%' OR UPPER(code) = 'MAIN'
         ORDER BY CASE WHEN name ILIKE '%sede%' THEN 0 ELSE 1 END
         LIMIT 1`,
      );
      if (sede.rows[0]?.id) {
        await db.query('UPDATE branches SET is_main = FALSE WHERE id::text IS DISTINCT FROM $1', [
          String(sede.rows[0].id),
        ]);
        await db.query('UPDATE branches SET is_main = TRUE WHERE id = $1', [sede.rows[0].id]);
      }
    }

    if (!(await caixaTablesExist())) return;

    // Link orphan 45x COA leaves (e.g. "Soyo 03") to branches by name BEFORE syncing registers.
    try {
      const { linkOrphanBranchCaixaAccounts } = require('../lib/resolveBranchCaixaGlAccount');
      await linkOrphanBranchCaixaAccounts(db);
    } catch (linkErr) {
      console.warn('[CAIXA] linkOrphanBranchCaixaAccounts:', linkErr.message);
    }

    // Linked COA leaves + name-matched orphans (multi-caixa filiais like "Soyo 03"
    // often never get coa.branch_id when another 45x already claimed the branch).
    const coa = await db.query(
      db.engine === 'postgres'
        ? `SELECT coa.id, coa.code, coa.name, coa.current_balance,
                  COALESCE(coa.branch_id, b_name.id) AS branch_id,
                  COALESCE(b_link.name, b_name.name) AS branch_name
           FROM chart_of_accounts coa
           LEFT JOIN branches b_link ON b_link.id::text = coa.branch_id::text
           LEFT JOIN LATERAL (
             SELECT b.id, b.name
             FROM branches b
             WHERE coa.branch_id IS NULL
               AND (
                 coa.name ILIKE '%' || b.name || '%'
                 OR (NULLIF(TRIM(b.code), '') IS NOT NULL AND coa.name ILIKE '%' || b.code || '%')
               )
             ORDER BY CASE
               WHEN coa.name ILIKE 'Caixa - ' || b.name THEN 0
               WHEN coa.name ILIKE '%' || b.name || '%' THEN 1
               ELSE 2
             END
             LIMIT 1
           ) b_name ON true
           WHERE coa.is_active = true
             AND coa.is_header = false
             AND coa.code LIKE '45%'
             AND coa.code NOT IN ('45', '451')
             AND LENGTH(TRIM(coa.code)) >= 3
             AND (coa.branch_id IS NOT NULL OR b_name.id IS NOT NULL)`
        : `SELECT coa.id, coa.code, coa.name, coa.current_balance, coa.branch_id,
                  b.name AS branch_name
           FROM chart_of_accounts coa
           LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(coa.branch_id AS TEXT)
           WHERE COALESCE(coa.is_active, 1) != 0
             AND COALESCE(coa.is_header, 0) = 0
             AND coa.code LIKE '45%'
             AND coa.code NOT IN ('45', '451')
             AND coa.branch_id IS NOT NULL
             AND LENGTH(TRIM(coa.code)) >= 3`,
    );

    const now = new Date().toISOString();
    for (const row of coa.rows || []) {
      try {
        const branchId = String(row.branch_id || '').trim();
        // Do NOT skip seed UUID 22222222-… — SOYO 03 was assigned that id in production.
        if (!branchId) continue;
        const branchName = String(row.branch_name || '').trim() || branchId;
        const name = String(row.name || '').trim() || `Caixa ${row.code}`;
        const balance = Number(row.current_balance) || 0;
        // caixas.id is UUID — reuse COA account id (stable 1:1).
        const id = String(row.id);

        const existing = await db.query(
          db.engine === 'postgres'
            ? `SELECT id FROM caixas
               WHERE id::text = $1
                  OR (branch_id::text = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3)))
               LIMIT 1`
            : `SELECT id FROM caixas
               WHERE CAST(id AS TEXT) = $1
                  OR (CAST(branch_id AS TEXT) = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3)))
               LIMIT 1`,
          [id, branchId, name],
        );
        if (existing.rows?.[0]) {
          await db.query(
            `UPDATE caixas
             SET branch_id = $2, branch_name = $3, name = $4, current_balance = $5, updated_at = $6
             WHERE id = $1`,
            [existing.rows[0].id, branchId, branchName, name, balance, now],
          );
          continue;
        }

        await db.query(
          `INSERT INTO caixas (
            id, branch_id, branch_name, name, opening_balance, current_balance,
            status, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$5,'closed',$6,$6)`,
          [id, branchId, branchName, name, balance, now],
        );
      } catch (rowErr) {
        console.warn('[CAIXA] sync register skipped:', row?.code || row?.id, rowErr.message);
      }
    }

    // Heal operational caixas that lost branch_id but still have a branch_name / name match.
    // Never steal caixas from a real branch that happens to use the old seed UUID (SOYO 03).
    try {
      if (db.engine === 'postgres') {
        await db.query(
          `UPDATE caixas c
           SET branch_id = b.id,
               branch_name = COALESCE(NULLIF(TRIM(c.branch_name), ''), b.name),
               updated_at = CURRENT_TIMESTAMP
           FROM branches b
           WHERE (
               c.branch_id IS NULL
               OR (
                 c.branch_id = '22222222-2222-2222-2222-222222222222'::uuid
                 AND NOT EXISTS (
                   SELECT 1 FROM branches bx
                   WHERE bx.id = '22222222-2222-2222-2222-222222222222'::uuid
                 )
               )
             )
             AND (
               (NULLIF(TRIM(c.branch_name), '') IS NOT NULL
                 AND LOWER(TRIM(c.branch_name)) = LOWER(TRIM(b.name)))
               OR LOWER(TRIM(c.name)) LIKE '%' || LOWER(TRIM(b.name)) || '%'
               OR (NULLIF(TRIM(b.code), '') IS NOT NULL
                   AND LOWER(TRIM(c.name)) LIKE '%' || LOWER(TRIM(b.code)) || '%')
             )`,
        );

        // Fix labels when branch_name/name were stored as the raw UUID (SOYO 03 case).
        await db.query(
          `UPDATE caixas c
           SET branch_name = b.name,
               name = CASE
                 WHEN NULLIF(TRIM(c.name), '') IS NULL
                   OR c.name = c.branch_id::text
                   OR c.name ILIKE 'Caixa Principal - ' || c.branch_id::text
                   OR c.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN 'Caixa Principal - ' || b.name
                 ELSE c.name
               END,
               updated_at = CURRENT_TIMESTAMP
           FROM branches b
           WHERE c.branch_id = b.id
             AND (
               NULLIF(TRIM(c.branch_name), '') IS NULL
               OR c.branch_name = c.branch_id::text
               OR c.branch_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               OR c.name ILIKE '%' || c.branch_id::text || '%'
             )`,
        );
      }
    } catch (healErr) {
      console.warn('[CAIXA] heal branch_id:', healErr.message);
    }

    // Remove orphan seed caixa with UUID label when that seed branch is gone.
    await db.query(
      `DELETE FROM caixas
       WHERE branch_id::text = '22222222-2222-2222-2222-222222222222'
         AND NOT EXISTS (
           SELECT 1 FROM branches b WHERE b.id::text = '22222222-2222-2222-2222-222222222222'
         )`,
    );
  } catch (err) {
    console.warn('[CAIXA] ensureTreasuryRegistersFromCoa:', err.message);
  }
}

let lastCoaSyncAt = 0;

function caixaRouter(broadcastTable) {
  const router = express.Router();

  /** List cash registers (caixas) — plain SELECT (COA sync runs at startup / ?sync=1). */
  router.get('/registers', async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.json({ data: [] });
      }
      const forceSync = String(req.query.sync || '') === '1' || String(req.query.sync || '') === 'true';
      if (forceSync && Date.now() - lastCoaSyncAt > 5_000) {
        lastCoaSyncAt = Date.now();
        await ensureTreasuryRegistersFromCoa();
      }

      const branchId = String(req.query.branchId || '').trim();
      const branchJoin = db.engine === 'postgres'
        ? `LEFT JOIN branches b ON b.id::text = c.branch_id::text`
        : `LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(c.branch_id AS TEXT)`;
      const branchNameExpr = db.engine === 'postgres'
        ? `COALESCE(NULLIF(TRIM(c.branch_name), ''), b.name, c.branch_id::text)`
        : `COALESCE(NULLIF(TRIM(c.branch_name), ''), b.name, CAST(c.branch_id AS TEXT))`;
      const orderBy = db.engine === 'postgres'
        ? 'c.updated_at DESC NULLS LAST, c.created_at DESC'
        : 'c.updated_at DESC, c.created_at DESC';

      async function queryRegisters() {
        const params = [];
        let sql = `SELECT c.*, ${branchNameExpr} AS branch_name FROM caixas c ${branchJoin}`;
        if (branchId) {
          const resolved = await resolveBranchFilterId(db, branchId);
          const matchId = resolved || branchId;
          if (db.engine === 'postgres') {
            sql += ' WHERE c.branch_id::text = $1';
          } else {
            sql += ' WHERE CAST(c.branch_id AS TEXT) = $1';
          }
          params.push(matchId);
        } else if (db.engine === 'postgres') {
          // Hide seed UUID only when it is NOT a real branch (SOYO 03 reuses that id).
          sql += ` WHERE (
            c.branch_id::text IS DISTINCT FROM '22222222-2222-2222-2222-222222222222'
            OR EXISTS (
              SELECT 1 FROM branches bx
              WHERE bx.id::text = '22222222-2222-2222-2222-222222222222'
            )
          )`;
        }
        sql += ` ORDER BY ${orderBy}`;
        return db.query(sql, params);
      }

      let result = await queryRegisters();
      // Empty DB only: one COA→caixa heal (startup usually already did this).
      if (!(result.rows || []).length && Date.now() - lastCoaSyncAt > 5_000) {
        lastCoaSyncAt = Date.now();
        await ensureTreasuryRegistersFromCoa();
        result = await queryRegisters();
      }
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
      let resolvedBranchName = branchName;
      if (!resolvedBranchName || resolvedBranchName === resolvedBranchId) {
        const br = await db.query(
          db.engine === 'postgres'
            ? 'SELECT name FROM branches WHERE id::text = $1 LIMIT 1'
            : 'SELECT name FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1',
          [resolvedBranchId],
        );
        resolvedBranchName = br.rows[0]?.name || branchName || '';
      }

      const existing = await db.query(
        db.engine === 'postgres'
          ? 'SELECT * FROM caixas WHERE branch_id::text = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1'
          : 'SELECT * FROM caixas WHERE CAST(branch_id AS TEXT) = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1',
        [resolvedBranchId],
      );
      if (existing.rows[0]) {
        // Heal UUID-as-name labels when ensure is called for a real branch (SOYO 03).
        const row = existing.rows[0];
        if (resolvedBranchName && (
          !row.branch_name || String(row.branch_name) === resolvedBranchId
          || String(row.name || '').includes(resolvedBranchId)
        )) {
          await db.query(
            `UPDATE caixas SET branch_name = $2,
               name = CASE
                 WHEN name IS NULL OR TRIM(name) = '' OR name = $1 OR name ILIKE 'Caixa Principal - ' || $1
                 THEN $3 ELSE name
               END,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [resolvedBranchId, resolvedBranchName, `Caixa Principal - ${resolvedBranchName}`, row.id],
          );
          const healed = await db.query('SELECT * FROM caixas WHERE id = $1', [row.id]);
          return res.json({ data: mapCaixaRow(healed.rows[0]) });
        }
        return res.json({ data: mapCaixaRow(row) });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const name = `Caixa Principal - ${resolvedBranchName || resolvedBranchId}`;
      await db.query(
        `INSERT INTO caixas (
          id, branch_id, branch_name, name, opening_balance, current_balance,
          status, requires_approval, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,0,0,'closed',false,$5,$5)`,
        [id, resolvedBranchId, resolvedBranchName || '', name, now],
      );
      const row = await db.query('SELECT * FROM caixas WHERE id = $1', [id]);
      if (broadcastTable) await broadcastTable('caixas');
      res.status(201).json({ data: mapCaixaRow(row.rows[0]) });
    } catch (error) {
      console.error('[CAIXA] registers ensure:', error);
      res.status(500).json({ error: error.message || 'Failed to ensure caixa' });
    }
  });

  /** Create a named cash register for a branch (Gestão de Caixa). */
  router.post('/registers', requirePermission('caixa_open', 'admin_settings'), async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.status(503).json({ error: 'Caixa tables not available on server' });
      }
      const branchId = String(req.body?.branchId || '').trim();
      const branchName = String(req.body?.branchName || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!branchId) return res.status(400).json({ error: 'branchId required' });
      if (!name) return res.status(400).json({ error: 'name required' });

      const resolvedBranchId = (await resolveBranchFilterId(db, branchId)) || branchId;
      let resolvedBranchName = branchName;
      if (!resolvedBranchName) {
        const br = await db.query(
          db.engine === 'postgres'
            ? 'SELECT name FROM branches WHERE id::text = $1 LIMIT 1'
            : 'SELECT name FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1',
          [resolvedBranchId],
        );
        resolvedBranchName = br.rows[0]?.name || '';
      }

      const id = String(req.body?.id || '').trim() || crypto.randomUUID();
      const now = new Date().toISOString();
      const openingBalance = Number(req.body?.openingBalance) || 0;
      const pettyLimit = req.body?.pettyLimit != null ? Number(req.body.pettyLimit) : null;
      const dailyLimit = req.body?.dailyLimit != null ? Number(req.body.dailyLimit) : null;
      const requiresApproval = !!req.body?.requiresApproval;

      await db.query(
        `INSERT INTO caixas (
          id, branch_id, branch_name, name, opening_balance, current_balance,
          status, petty_limit, daily_limit, requires_approval, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$5,'closed',$6,$7,$8,$9,$9)
        ON CONFLICT (id) DO UPDATE SET
          branch_id = EXCLUDED.branch_id,
          branch_name = EXCLUDED.branch_name,
          name = EXCLUDED.name,
          opening_balance = EXCLUDED.opening_balance,
          current_balance = EXCLUDED.current_balance,
          petty_limit = EXCLUDED.petty_limit,
          daily_limit = EXCLUDED.daily_limit,
          requires_approval = EXCLUDED.requires_approval,
          updated_at = EXCLUDED.updated_at`,
        [
          id,
          resolvedBranchId,
          resolvedBranchName,
          name,
          openingBalance,
          pettyLimit,
          dailyLimit,
          requiresApproval,
          now,
        ],
      );
      const row = await db.query('SELECT * FROM caixas WHERE id = $1', [id]);
      if (!row.rows[0]) {
        return res.status(500).json({ error: 'Failed to save caixa' });
      }
      if (broadcastTable) await broadcastTable('caixas');
      res.status(201).json({ data: mapCaixaRow(row.rows[0]) });
    } catch (error) {
      console.error('[CAIXA] registers create:', error);
      res.status(500).json({ error: error.message || 'Failed to create caixa' });
    }
  });

  /** Update caixa settings (name, limits) — not for posting balances. */
  router.put('/registers/:id', requirePermission('caixa_open', 'admin_settings'), async (req, res) => {
    try {
      if (!(await caixaTablesExist())) {
        return res.status(503).json({ error: 'Caixa tables not available on server' });
      }
      const { id } = req.params;
      const body = req.body || {};
      const name = body.name != null ? String(body.name).trim() : null;
      const pettyLimit = body.pettyLimit != null ? Number(body.pettyLimit) : null;
      const dailyLimit = body.dailyLimit != null ? Number(body.dailyLimit) : null;
      const requiresApproval = body.requiresApproval != null ? !!body.requiresApproval : null;

      const existing = await db.query('SELECT * FROM caixas WHERE id = $1', [id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Caixa not found' });

      const now = new Date().toISOString();
      await db.query(
        `UPDATE caixas SET
          name = COALESCE($2, name),
          petty_limit = COALESCE($3, petty_limit),
          daily_limit = COALESCE($4, daily_limit),
          requires_approval = COALESCE($5, requires_approval),
          updated_at = $6
         WHERE id = $1`,
        [id, name, pettyLimit, dailyLimit, requiresApproval, now],
      );
      const row = await db.query('SELECT * FROM caixas WHERE id = $1', [id]);
      if (broadcastTable) await broadcastTable('caixas');
      res.json({ data: mapCaixaRow(row.rows[0]) });
    } catch (error) {
      console.error('[CAIXA] registers update:', error);
      res.status(500).json({ error: error.message || 'Failed to update caixa' });
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
      let sessionRow = result.rows[0] || null;
      if (sessionRow) {
        try {
          await syncOpenSessionExpensesFromLedger(null, resolvedBranchId);
          const refreshed = await db.query(
            'SELECT * FROM caixa_sessions WHERE id = $1',
            [sessionRow.id],
          );
          sessionRow = refreshed.rows[0] || sessionRow;
        } catch (syncErr) {
          console.warn('[CAIXA] open session expense sync:', syncErr.message);
        }
      }
      res.json(mapSessionRow(sessionRow));
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
}

module.exports = caixaRouter;
module.exports.ensureTreasuryRegistersFromCoa = ensureTreasuryRegistersFromCoa;
