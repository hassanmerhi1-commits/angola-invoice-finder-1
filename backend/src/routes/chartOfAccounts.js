// Chart of Accounts API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');
const { auditErpSafe } = require('../lib/erpAudit');
const { fetchAccountLedger } = require('../lib/coaLedgerQuery');

module.exports = function(broadcastTable) {
  const router = express.Router();

  const idText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
  const postedClauseSql = () => (db.engine === 'postgres'
    ? '(je.is_posted IS DISTINCT FROM false)'
    : '(je.is_posted = 1 OR je.is_posted IS NULL OR je.is_posted = true)');
  const activeClauseSql = (alias = 'coa') => (db.engine === 'postgres'
    ? `(${alias}.is_active IS DISTINCT FROM false)`
    : `(${alias}.is_active = 1 OR ${alias}.is_active IS NULL OR ${alias}.is_active = true)`);

  /**
   * Live journal net per account — SAME match rules as GET /:id/ledger
   * (cast joins on journal id + account id OR PGC code).
   */
  function journalNetSubquery() {
    const posted = postedClauseSql();
    return `
      SELECT u.account_key AS account_key, SUM(u.net) AS net
      FROM (
        SELECT ${idText('jel.account_id')} AS account_key,
               COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0) AS net
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
          ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}
        WHERE ${posted}
        UNION ALL
        SELECT ${idText('coa_c.id')} AS account_key,
               COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0) AS net
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
          ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}
        INNER JOIN chart_of_accounts coa_c
          ON ${idText('coa_c.code')} = ${idText('jel.account_id')}
        WHERE ${posted}
          AND ${idText('coa_c.id')} <> ${idText('jel.account_id')}
      ) u
      GROUP BY u.account_key
    `;
  }

  // Fast by default (stored current_balance). Pass ?liveBalances=1 for journal-join parity.
  // Parent 321/311 remap + balance recompute always run in the background — never block list GET.
  router.get('/', async (req, res) => {
    const wantLive = /^(1|true|yes)$/i.test(String(req.query.liveBalances || ''));
    try {
      setImmediate(() => {
        const run = async () => {
          try {
            const { countParentEntityLines, repairParentEntityCoaPostings } = require('../lib/repairParentEntityCoa');
            const pending = await countParentEntityLines(db);
            if (pending > 0) {
              console.log(`[CHART OF ACCOUNTS] Background-repairing ${pending} parent 321/311 line(s)…`);
              await repairParentEntityCoaPostings(db, { dryRun: false });
            }
          } catch (e) {
            console.warn('[CHART OF ACCOUNTS] entity leaf repair failed:', e.message);
          }
          try {
            const { fastRecomputeCoaCurrentBalances } = require('../accounting');
            await fastRecomputeCoaCurrentBalances(db);
            try { broadcastTable('chart_of_accounts'); } catch (_) {}
          } catch (e) {
            console.warn('[CHART OF ACCOUNTS] background recompute failed:', e.message);
          }
        };
        void run();
      });

      const balanceExpr = wantLive
        ? `COALESCE(coa.opening_balance, 0) + COALESCE(j.net, 0)`
        : `COALESCE(coa.current_balance, coa.opening_balance, 0)`;
      const joinLive = wantLive
        ? `LEFT JOIN (
          ${journalNetSubquery()}
        ) j ON j.account_key = ${idText('coa.id')}`
        : '';

      const result = await db.query(`
        SELECT 
          coa.id,
          coa.code,
          coa.name,
          coa.description,
          coa.account_type,
          coa.account_nature,
          coa.parent_id,
          coa.level,
          coa.is_header,
          coa.is_active,
          coa.opening_balance,
          coa.branch_id,
          coa.created_at,
          coa.updated_at,
          parent.name as parent_name,
          parent.code as parent_code,
          COALESCE(coa.children_count, 0) as children_count,
          ${balanceExpr} AS current_balance
        FROM chart_of_accounts coa
        LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
        ${joinLive}
        WHERE ${activeClauseSql('coa')}
        ORDER BY coa.code
      `);
      res.set('Cache-Control', 'no-store');
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      try {
        const fallback = await db.query(`
          SELECT 
            coa.id, coa.code, coa.name, coa.description, coa.account_type, coa.account_nature,
            coa.parent_id, coa.level, coa.is_header, coa.is_active, coa.opening_balance,
            coa.branch_id, coa.created_at, coa.updated_at,
            parent.name as parent_name, parent.code as parent_code,
            COALESCE(coa.children_count, 0) as children_count,
            COALESCE(coa.current_balance, coa.opening_balance, 0) AS current_balance
          FROM chart_of_accounts coa
          LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
          WHERE ${activeClauseSql('coa')}
          ORDER BY coa.code
        `);
        res.set('Cache-Control', 'no-store');
        res.json(fallback.rows);
      } catch (e2) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
      }
    }
  });

  router.post('/recompute-balances', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { repairParentEntityCoaPostings } = require('../lib/repairParentEntityCoa');
      const { fastRecomputeCoaCurrentBalances, recomputeCoaCurrentBalances } = require('../accounting');
      const repair = await repairParentEntityCoaPostings(db, { dryRun: false });
      let result;
      try {
        result = await fastRecomputeCoaCurrentBalances(db);
      } catch (_) {
        result = await recomputeCoaCurrentBalances(db);
      }
      broadcastTable('chart_of_accounts');
      res.json({ success: true, repair, ...result });
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to recompute account balances' });
    }
  });

  async function accountBalancesAsOf(asOf) {
    let dateFilter = '';
    const params = [];
    if (asOf) {
      dateFilter = 'AND je.entry_date <= $1';
      params.push(asOf);
    }
    const result = await db.query(
      `
        SELECT 
          coa.id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_nature,
          coa.level,
          coa.is_header,
          coa.opening_balance,
          COALESCE(SUM(jel.debit_amount), 0) as total_debits,
          COALESCE(SUM(jel.credit_amount), 0) as total_credits,
          coa.opening_balance + 
            CASE 
              WHEN coa.account_nature = 'debit' THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
              ELSE COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
            END as closing_balance
        FROM chart_of_accounts coa
        LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
        LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = true ${dateFilter}
        WHERE coa.is_active = true
        GROUP BY coa.id
        ORDER BY coa.code
      `,
      params,
    );
    return result.rows;
  }

  // Report routes must be registered before /:id
  router.get('/reports/balance-sheet', async (req, res) => {
    try {
      const asOf = String(req.query.as_of || '').trim();
      if (!asOf) {
        return res.status(400).json({ error: 'as_of query parameter is required' });
      }
      const previousAsOf = String(req.query.previous_as_of || '').trim() || null;

      const currentRows = await accountBalancesAsOf(asOf);
      const previousRows = previousAsOf ? await accountBalancesAsOf(previousAsOf) : [];
      const previousById = new Map(
        previousRows.map((row) => [row.id, Number(row.closing_balance) || 0]),
      );

      const rows = currentRows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        account_type: row.account_type,
        account_nature: row.account_nature,
        level: row.level,
        is_header: !!row.is_header,
        current_balance: Number(row.closing_balance) || 0,
        previous_balance: previousById.get(row.id) ?? 0,
      }));

      res.json({
        as_of: asOf,
        previous_as_of: previousAsOf,
        rows,
      });
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to generate balance sheet' });
    }
  });

  router.get('/reports/trial-balance', async (req, res) => {
    try {
      const { start_date, end_date, branchId } = req.query;

      let dateFilter = '';
      const params = [];
      let paramIndex = 1;

      if (start_date && end_date) {
        dateFilter = `AND je.entry_date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(start_date, end_date);
      }

      let branchFilter = '';
      if (branchId) {
        const branchClause = await buildJournalBranchFilter(db, branchId, paramIndex);
        if (branchClause.sql) {
          branchFilter = branchClause.sql;
          params.push(...branchClause.params);
        }
      }

      const result = await db.query(`
        SELECT 
          coa.id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_nature,
          coa.level,
          coa.is_header,
          coa.opening_balance,
          COALESCE(SUM(jel.debit_amount), 0) as total_debits,
          COALESCE(SUM(jel.credit_amount), 0) as total_credits,
          coa.opening_balance + 
            CASE 
              WHEN coa.account_nature = 'debit' THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
              ELSE COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
            END as closing_balance
        FROM chart_of_accounts coa
        LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
        LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = true ${dateFilter} ${branchFilter}
        WHERE coa.is_active = true
        GROUP BY coa.id
        ORDER BY coa.code
      `, params);

      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to generate trial balance' });
    }
  });

  // Reset the chart of accounts to the Angola PGC (novo com IVA) — admin only (destructive).
  router.post('/reseed', requirePermission('admin_settings'), async (req, res) => {
    try {
      const result = await db.resetChartOfAccountsToPgc();
      await broadcastTable('chart_of_accounts');
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to reset chart of accounts' });
    }
  });

  // Find-or-create one supplier leaf (321xxxxx) — used by purchase Save.
  // Never download the full chart for a single ensure (Tailscale).
  router.post('/ensure-supplier', requirePermission('purchase_create', 'accounting_create', 'admin_settings'), async (req, res) => {
    let client = null;
    try {
      const name = String(req.body?.name || req.body?.supplierName || '').trim();
      const nif = String(req.body?.nif || req.body?.supplierNif || '').trim() || null;
      const parentCode = String(req.body?.parentCode || req.body?.accountParentCode || '').trim() || undefined;
      if (!name) {
        return res.status(400).json({ error: 'Supplier name is required' });
      }
      const { ensureSupplierSubAccount } = require('../lib/entityCoaAccounts');
      if (db.engine === 'postgres' && db.pool) {
        client = await db.pool.connect();
      }
      const q = client || db;
      const code = await ensureSupplierSubAccount(q, name, nif, parentCode);
      if (!code) {
        return res.status(500).json({ error: 'Failed to ensure supplier account' });
      }
      const row = await q.query(
        `SELECT id, code, name, description, parent_id FROM chart_of_accounts WHERE code = $1 LIMIT 1`,
        [code],
      );
      try { broadcastTable('chart_of_accounts'); } catch (_) { /* ignore */ }
      res.json({
        id: row.rows[0]?.id || null,
        code,
        name: row.rows[0]?.name || name,
        description: row.rows[0]?.description || null,
        parent_id: row.rows[0]?.parent_id || null,
      });
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ensure-supplier]', error);
      res.status(500).json({ error: error.message || 'Failed to ensure supplier account' });
    } finally {
      if (client) {
        try { client.release(); } catch (_) { /* ignore */ }
      }
    }
  });

  // Get accounts by type
  router.get('/type/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const result = await db.query(`
        SELECT * FROM chart_of_accounts 
        WHERE account_type = $1 AND is_active = true
        ORDER BY code
      `, [type]);
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch accounts by type' });
    }
  });

  // Get account by ID
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.query(`
        SELECT 
          coa.*,
          parent.name as parent_name,
          parent.code as parent_code
        FROM chart_of_accounts coa
        LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
        WHERE coa.id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch account' });
    }
  });

  // Get children of an account
  router.get('/:id/children', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.query(`
        SELECT * FROM chart_of_accounts 
        WHERE parent_id = $1 AND is_active = true
        ORDER BY code
      `, [id]);
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch child accounts' });
    }
  });

  // Create new account
  router.post('/', requirePermission('accounting_create'), async (req, res) => {
    try {
      const { 
        code, name, description, account_type, account_nature,
        parent_id, level, is_header, opening_balance, branch_id 
      } = req.body;

      // Validate required fields
      if (!code || !name || !account_type || !account_nature) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Check for duplicate code
      const existing = await db.query('SELECT id FROM chart_of_accounts WHERE code = $1', [code]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Account code already exists' });
      }

      const result = await db.query(`
        INSERT INTO chart_of_accounts 
        (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
        RETURNING *
      `, [code, name, description, account_type, account_nature, parent_id, level || 1, is_header || false, opening_balance || 0, branch_id]);

      await broadcastTable('chart_of_accounts');
      auditErpSafe(req, {
        table: 'chart_of_accounts',
        id: result.rows[0]?.id,
        action: 'create',
        description: `Conta criada: ${code} — ${name}`,
        newValues: { code, name, account_type, account_nature, opening_balance },
      });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  // Update account
  router.put('/:id', requirePermission('accounting_create'), async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        code, name, description, account_type, account_nature,
        parent_id, level, is_header, is_active, opening_balance 
      } = req.body;

      // Check for duplicate code (excluding current account)
      if (code) {
        const existing = await db.query('SELECT id FROM chart_of_accounts WHERE code = $1 AND id != $2', [code, id]);
        if (existing.rows.length > 0) {
          return res.status(400).json({ error: 'Account code already exists' });
        }
      }

      const result = await db.query(`
        UPDATE chart_of_accounts SET
          code = COALESCE($1, code),
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          account_type = COALESCE($4, account_type),
          account_nature = COALESCE($5, account_nature),
          parent_id = $6,
          level = COALESCE($7, level),
          is_header = COALESCE($8, is_header),
          is_active = COALESCE($9, is_active),
          opening_balance = COALESCE($10, opening_balance),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
        RETURNING *
      `, [code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      await broadcastTable('chart_of_accounts');
      auditErpSafe(req, {
        table: 'chart_of_accounts',
        id,
        action: 'update',
        description: `Conta actualizada: ${result.rows[0]?.code || id} — ${result.rows[0]?.name || ''}`,
        newValues: { code, name, is_active, opening_balance },
      });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to update account' });
    }
  });

  // Delete (soft) account
  router.delete('/:id', requirePermission('admin_settings'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if account has children
      const children = await db.query('SELECT id FROM chart_of_accounts WHERE parent_id = $1', [id]);
      if (children.rows.length > 0) {
        return res.status(400).json({ error: 'Cannot delete account with child accounts' });
      }

      // Check if account has journal entries
      const entries = await db.query('SELECT id FROM journal_entry_lines WHERE account_id = $1 LIMIT 1', [id]);
      if (entries.rows.length > 0) {
        return res.status(400).json({ error: 'Cannot delete account with transactions' });
      }

      await db.query('UPDATE chart_of_accounts SET is_active = false WHERE id = $1', [id]);
      await broadcastTable('chart_of_accounts');
      auditErpSafe(req, {
        table: 'chart_of_accounts',
        id,
        action: 'delete',
        description: `Conta desactivada: ${id}`,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to delete account' });
    }
  });

  // Get account ledger — single account + date window only (see coaLedgerQuery.js).
  // Never expands children: rolling up 321/45 killed the query on busy DBs.
  router.get('/:id/ledger', async (req, res) => {
    try {
      const { id } = req.params;
      let { start_date, end_date, limit: limitRaw } = req.query;
      const parsedLimit = parseInt(String(limitRaw || '50'), 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 100)
        : 50;

      const idText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
      const key = String(id || '').trim();
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
      const rootSelect = `SELECT id, code, name, opening_balance, current_balance, is_header
         FROM chart_of_accounts`;
      let rootRes;
      if (looksLikeUuid) {
        rootRes = await db.query(
          `${rootSelect} WHERE ${idText('id')} = ${idText('$1')} LIMIT 1`,
          [key],
        );
      } else {
        rootRes = await db.query(
          `${rootSelect} WHERE ${idText('code')} = ${idText('$1')} LIMIT 1`,
          [key],
        );
      }
      if (!rootRes.rows[0] && looksLikeUuid) {
        rootRes = await db.query(
          `${rootSelect} WHERE ${idText('code')} = ${idText('$1')} LIMIT 1`,
          [key],
        );
      } else if (!rootRes.rows[0] && !looksLikeUuid) {
        rootRes = await db.query(
          `${rootSelect} WHERE ${idText('id')} = ${idText('$1')} LIMIT 1`,
          [key],
        );
      }
      const root = rootRes.rows[0];
      if (!root) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const result = await fetchAccountLedger(db, root, {
        start_date,
        end_date,
        limit,
      });

      res.set('X-Ledger-Limit', String(result.hardLimit));
      res.set('X-Ledger-Has-More', String(result.rows.length >= result.hardLimit));
      if (result.isHeader || result.isHighVolumeParent) {
        res.set('X-Ledger-Open-Leaf', '1');
      }
      if (result.defaultedRange) {
        res.set('X-Ledger-Default-Range', 'bounded');
        res.set('X-Ledger-Start', result.startDate);
        res.set('X-Ledger-End', result.endDate);
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: error.message || 'Failed to fetch account ledger' });
    }
  });

  // Get account balance with movements
  router.get('/:id/balance', async (req, res) => {
    try {
      const { id } = req.params;
      const { start_date, end_date } = req.query;

      let dateFilter = '';
      const params = [id];

      if (start_date && end_date) {
        dateFilter = 'AND je.entry_date BETWEEN $2 AND $3';
        params.push(start_date, end_date);
      }

      const result = await db.query(`
        SELECT 
          coa.id,
          coa.code,
          coa.name,
          coa.account_type,
          coa.account_nature,
          coa.opening_balance,
          COALESCE(SUM(jel.debit_amount), 0) as total_debits,
          COALESCE(SUM(jel.credit_amount), 0) as total_credits,
          coa.opening_balance + 
            CASE 
              WHEN coa.account_nature = 'debit' THEN COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
              ELSE COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
            END as current_balance
        FROM chart_of_accounts coa
        LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
        LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = true ${dateFilter}
        WHERE coa.id = $1
        GROUP BY coa.id
      `, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to get account balance' });
    }
  });

  return router;
};
