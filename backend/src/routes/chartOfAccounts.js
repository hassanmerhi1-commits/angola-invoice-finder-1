// Chart of Accounts API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');
const { auditErpSafe } = require('../lib/erpAudit');

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

  // Get account ledger (posted lines for this account + all descendants —
  // chart headers roll up child balances, so drill-down must include children).
  // Include code-prefix children (PGC) when parent_id links are missing/incomplete.
  // Supplier/client AP/AR spans all filiais — never filter by toolbar branchId.
  router.get('/:id/ledger', async (req, res) => {
    try {
      const { id } = req.params;
      let { start_date, end_date, limit: limitRaw } = req.query;
      const parsedLimit = parseInt(String(limitRaw || '300'), 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 2000)
        : 300;

      // Never OR uuid id with varchar code in one predicate — Postgres then types $1 as
      // uuid and rejects `code = $1` (operator does not exist: character varying = uuid).
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
        // Account codes (e.g. "31", "451") — match code only; never touch uuid id.
        rootRes = await db.query(
          `${rootSelect} WHERE ${idText('code')} = ${idText('$1')} LIMIT 1`,
          [key],
        );
      }
      // Fallback: UUID that was not found as id, or code typed like a uuid (rare).
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
      const activeClause = db.engine === 'postgres'
        ? '(is_active IS DISTINCT FROM false)'
        : '(is_active = 1 OR is_active IS NULL OR is_active = true)';
      const postedClause = db.engine === 'postgres'
        ? '(je.is_posted IS DISTINCT FROM false)'
        : '(je.is_posted = 1 OR je.is_posted IS NULL OR je.is_posted = true)';
      const entryDateExpr = db.engine === 'postgres'
        ? `COALESCE(
            NULLIF(TRIM(je.entry_date::text), ''),
            CASE WHEN je.created_at IS NOT NULL THEN to_char(je.created_at::date, 'YYYY-MM-DD') END
          )`
        : `COALESCE(NULLIF(TRIM(CAST(je.entry_date AS TEXT)), ''), substr(CAST(je.created_at AS TEXT), 1, 10))`;

      // Control accounts 321/311: always expand by PGC code prefix so ledger
      // shows leaf activity under the parent even when is_header is false.
      const codeStr = String(root.code || '');
      const isHeader =
        root.is_header === true || root.is_header === 1 || root.is_header === '1';
      const expandByCode =
        isHeader
        || codeStr === '321' || codeStr === '311'
        || codeStr === '32' || codeStr === '31';
      // Cash (45x) / bank (43x) parents fan out into every POS/sale line when we
      // also LIKE '45%' — that sorted tens of thousands of rows before LIMIT.
      // Prefer parent_id walk only for those high-volume trees.
      const isHighVolumeTreasury = /^(43|45)/.test(codeStr);
      const useCodePrefix = expandByCode && !isHighVolumeTreasury && codeStr.length >= 2;

      // Parent/control / treasury without a date window — keep the window tight.
      let defaultedRange = false;
      if ((expandByCode || isHighVolumeTreasury) && !start_date && !end_date) {
        const to = new Date();
        const from = new Date(to);
        const days = isHighVolumeTreasury ? 30 : 90;
        from.setUTCDate(from.getUTCDate() - days);
        start_date = from.toISOString().slice(0, 10);
        end_date = to.toISOString().slice(0, 10);
        defaultedRange = true;
      }

      // Resolve matching CoA rows first (small set), then hit journal lines by uuid
      // so Postgres can use idx_journal_lines_account — avoid OR cast(code) in the hot path.
      let treeSql;
      let treeParams;
      if (expandByCode || isHighVolumeTreasury) {
        if (useCodePrefix) {
          treeSql = `
            WITH RECURSIVE by_parent AS (
              SELECT id, code, name FROM chart_of_accounts WHERE ${idText('id')} = ${idText('$1')}
              UNION
              SELECT c.id, c.code, c.name
              FROM chart_of_accounts c
              INNER JOIN by_parent t ON ${idText('c.parent_id')} = ${idText('t.id')}
            ),
            by_code AS (
              SELECT id, code, name
              FROM chart_of_accounts
              WHERE ${activeClause}
                AND CAST($2 AS TEXT) <> ''
                AND (
                  ${idText('code')} = ${idText('$2')}
                  OR (
                    length(${idText('code')}) > length(CAST($2 AS TEXT))
                    AND ${idText('code')} LIKE CAST($2 AS TEXT) || '%'
                  )
                )
            )
            SELECT id, code, name FROM by_parent
            UNION
            SELECT id, code, name FROM by_code`;
          treeParams = [String(root.id), String(root.code || '')];
        } else {
          treeSql = `
            WITH RECURSIVE by_parent AS (
              SELECT id, code, name FROM chart_of_accounts WHERE ${idText('id')} = ${idText('$1')}
              UNION
              SELECT c.id, c.code, c.name
              FROM chart_of_accounts c
              INNER JOIN by_parent t ON ${idText('c.parent_id')} = ${idText('t.id')}
            )
            SELECT id, code, name FROM by_parent`;
          treeParams = [String(root.id)];
        }
      } else {
        treeSql = `SELECT id, code, name FROM chart_of_accounts WHERE ${idText('id')} = ${idText('$1')}`;
        treeParams = [String(root.id)];
      }
      const treeRes = await db.query(treeSql, treeParams);
      const treeRows = treeRes.rows || [];
      const accountIds = [...new Set(treeRows.map((r) => String(r.id)).filter(Boolean))];
      const nameByKey = new Map();
      for (const r of treeRows) {
        nameByKey.set(String(r.id), r);
        if (r.code) nameByKey.set(String(r.code), r);
      }

      if (accountIds.length === 0) {
        return res.json([]);
      }

      const params = [];
      let paramIndex = 1;
      let accountMatchSql;
      if (db.engine === 'postgres') {
        // UUID-only — uses idx_journal_lines_account. Legacy code-in-account_id
        // rows are rare after normalize; skip OR text cast (kills the plan).
        params.push(accountIds);
        accountMatchSql = `jel.account_id = ANY($${paramIndex++}::uuid[])`;
      } else {
        const idPlaceholders = accountIds.map(() => `$${paramIndex++}`);
        params.push(...accountIds);
        accountMatchSql = `${idText('jel.account_id')} IN (${idPlaceholders.join(',')})`;
      }

      // Filter/order on real entry_date (indexed) — the old COALESCE(text) expression
      // forced a full sort of every matching cash line before LIMIT.
      let dateFilter = '';
      if (db.engine === 'postgres') {
        if (start_date) {
          dateFilter += ` AND je.entry_date >= $${paramIndex++}::date`;
          params.push(String(start_date).slice(0, 10));
        }
        if (end_date) {
          dateFilter += ` AND je.entry_date <= $${paramIndex++}::date`;
          params.push(String(end_date).slice(0, 10));
        }
      } else {
        if (start_date) {
          dateFilter += ` AND (${entryDateExpr}) >= $${paramIndex++}`;
          params.push(String(start_date).slice(0, 10));
        }
        if (end_date) {
          dateFilter += ` AND (${entryDateExpr}) <= $${paramIndex++}`;
          params.push(String(end_date).slice(0, 10));
        }
      }

      const branchJoin = db.engine === 'postgres'
        ? 'LEFT JOIN branches b ON b.id::text = je.branch_id::text'
        : 'LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(je.branch_id AS TEXT)';

      const limitParam = `$${paramIndex++}`;
      params.push(limit);

      const jeJoin = db.engine === 'postgres'
        ? 'INNER JOIN journal_entries je ON je.id = jel.journal_entry_id'
        : `INNER JOIN journal_entries je ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}`;

      const orderBy = db.engine === 'postgres'
        ? 'ORDER BY je.entry_date DESC NULLS LAST, je.created_at DESC NULLS LAST'
        : `ORDER BY (${entryDateExpr}) DESC, je.created_at DESC`;

      const result = await db.query(`
        SELECT
          jel.id,
          jel.journal_entry_id,
          jel.account_id,
          jel.description,
          jel.debit_amount,
          jel.credit_amount,
          je.entry_number,
          ${entryDateExpr} AS entry_date,
          je.description as journal_description,
          je.reference_type,
          je.reference_id,
          je.branch_id,
          b.name AS branch_name,
          je.is_posted,
          je.created_at as journal_created_at
        FROM journal_entry_lines jel
        ${jeJoin}
        ${branchJoin}
        WHERE ${postedClause}
          AND ${accountMatchSql}
          ${dateFilter}
        ${orderBy}
        LIMIT ${limitParam}
      `, params);

      const rows = (result.rows || []).map((row) => {
        const meta = nameByKey.get(String(row.account_id))
          || nameByKey.get(String(row.account_id || '').trim());
        return {
          ...row,
          account_code: meta?.code || root.code,
          account_name: meta?.name || root.name,
        };
      });

      // Leaf with opening balance only: surface it as a synthetic line so drill-down
      // is not empty while the chart still shows a non-zero balance.
      if (rows.length === 0) {
        const opening = Number(root.opening_balance) || 0;
        const stored = Number(root.current_balance) || 0;
        const kids = await db.query(
          `SELECT COUNT(*) AS n FROM chart_of_accounts
           WHERE ${idText('parent_id')} = ${idText('$1')}`,
          [String(root.id)],
        );
        const childCount = Number(kids.rows[0]?.n || kids.rows[0]?.count || 0);
        // Prefer stored balance — unbounded SUM over cash history was another
        // multi-second stall when the date window happened to be empty.
        let current = stored || opening;
        if (childCount === 0 && opening === 0 && stored === 0) {
          const ownNetParams = [String(root.id)];
          let ownNetDate = '';
          if (db.engine === 'postgres' && start_date) {
            ownNetParams.push(String(start_date).slice(0, 10));
            ownNetDate += ` AND je.entry_date >= $${ownNetParams.length}::date`;
          }
          if (db.engine === 'postgres' && end_date) {
            ownNetParams.push(String(end_date).slice(0, 10));
            ownNetDate += ` AND je.entry_date <= $${ownNetParams.length}::date`;
          }
          const ownNet = await db.query(
            `SELECT COALESCE(SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)), 0) AS net
             FROM journal_entry_lines jel
             INNER JOIN journal_entries je ON ${
               db.engine === 'postgres'
                 ? 'je.id = jel.journal_entry_id'
                 : `${idText('je.id')} = ${idText('jel.journal_entry_id')}`
             }
             WHERE ${postedClause}
               AND ${
                 db.engine === 'postgres'
                   ? 'jel.account_id = $1::uuid'
                   : `${idText('jel.account_id')} = ${idText('$1')}`
               }
               ${ownNetDate}`,
            ownNetParams,
          );
          current = opening + (Number(ownNet.rows[0]?.net) || 0);
        }
        if (childCount === 0 && (opening !== 0 || current !== 0 || stored !== 0)) {
          const amt = opening !== 0 ? opening : (current !== 0 ? current : stored);
          return res.json([{
            id: `opening-${root.id}`,
            journal_entry_id: null,
            account_id: root.id,
            account_code: root.code,
            account_name: root.name,
            description: 'Saldo de abertura',
            debit_amount: amt > 0 ? amt : 0,
            credit_amount: amt < 0 ? Math.abs(amt) : 0,
            entry_number: 'OPEN',
            entry_date: '',
            journal_description: 'Opening balance',
            reference_type: 'opening',
            reference_id: null,
            is_posted: true,
            journal_created_at: null,
          }]);
        }
      }

      res.set('X-Ledger-Limit', String(limit));
      res.set('X-Ledger-Has-More', String(rows.length >= limit));
      if (defaultedRange) {
        res.set('X-Ledger-Default-Range', isHighVolumeTreasury ? '30d' : '90d');
        res.set('X-Ledger-Start', String(start_date));
        res.set('X-Ledger-End', String(end_date));
      }
      res.json(rows);
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
