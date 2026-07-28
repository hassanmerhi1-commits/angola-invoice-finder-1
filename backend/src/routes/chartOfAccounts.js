// Chart of Accounts API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');
const { auditErpSafe } = require('../lib/erpAudit');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Fast list uses stored current_balance (no journal aggregate).
  // Pass ?liveBalances=1 to recompute from posted journals (slower; for Refresh / background merge).
  router.get('/', async (req, res) => {
    try {
      const liveBalances =
        req.query.liveBalances === '1'
        || req.query.liveBalances === 'true'
        || req.query.liveBalances === 'yes';
      const idText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
      const balanceSelect = liveBalances
        ? `COALESCE(coa.opening_balance, 0) + COALESCE(j.net, 0) AS current_balance`
        : `COALESCE(coa.current_balance, coa.opening_balance, 0) AS current_balance`;
      const journalJoin = liveBalances
        ? `LEFT JOIN (
          SELECT jel.account_id,
                 SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS net
          FROM journal_entry_lines jel
          INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE (je.is_posted = true OR je.is_posted = 1 OR je.is_posted IS NULL)
          GROUP BY jel.account_id
        ) j ON ${idText('j.account_id')} = ${idText('coa.id')}
           OR ${idText('j.account_id')} = ${idText('coa.code')}`
        : '';
      // Fast path: use stored children_count (maintained on write). Live path keeps the kids join.
      const kidsJoin = liveBalances
        ? `LEFT JOIN (
          SELECT parent_id, COUNT(*) AS children_count
          FROM chart_of_accounts
          WHERE parent_id IS NOT NULL
          GROUP BY parent_id
        ) kids ON kids.parent_id = coa.id`
        : '';
      const childrenSelect = liveBalances
        ? `COALESCE(kids.children_count, 0) as children_count`
        : `COALESCE(coa.children_count, 0) as children_count`;
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
          ${childrenSelect},
          ${balanceSelect}
        FROM chart_of_accounts coa
        LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
        ${kidsJoin}
        ${journalJoin}
        WHERE coa.is_active = true
        ORDER BY coa.code
      `);
      res.set('Cache-Control', liveBalances ? 'private, max-age=15' : 'private, max-age=60');
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch accounts' });
    }
  });

  router.post('/recompute-balances', requirePermission('admin_settings', 'accounting_create'), async (req, res) => {
    try {
      const { recomputeCoaCurrentBalances } = require('../accounting');
      const result = await recomputeCoaCurrentBalances(db);
      broadcastTable('chart_of_accounts');
      res.json({ success: true, ...result });
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
  // Supplier/client AP/AR spans all filials — never filter by toolbar branchId.
  router.get('/:id/ledger', async (req, res) => {
    try {
      const { id } = req.params;
      const { start_date, end_date, limit: limitRaw } = req.query;
      const parsedLimit = parseInt(String(limitRaw || '500'), 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 2000)
        : 500;

      // Cast both sides to text — Postgres rejects `code = $1` when $1 is inferred as uuid
      // from comparing to `id` (error: operator does not exist: character varying = uuid).
      const asText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
      const rootRes = await db.query(
        `SELECT id, code, name, opening_balance, current_balance, is_header
         FROM chart_of_accounts
         WHERE ${asText('id')} = ${asText('$1')} OR ${asText('code')} = ${asText('$1')}
         LIMIT 1`,
        [String(id)],
      );
      const root = rootRes.rows[0];
      if (!root) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const idText = (col) => (db.engine === 'postgres' ? `${col}::text` : `CAST(${col} AS TEXT)`);
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

      let dateFilter = '';
      // $1 = root id, $2 = root code (for prefix expansion)
      const params = [root.id, String(root.code || '')];
      let paramIndex = 3;

      // Filter on effective date (entry_date or created_at) — many rows have null entry_date.
      if (start_date) {
        dateFilter += ` AND (${entryDateExpr}) >= $${paramIndex++}`;
        params.push(String(start_date).slice(0, 10));
      }
      if (end_date) {
        dateFilter += ` AND (${entryDateExpr}) <= $${paramIndex++}`;
        params.push(String(end_date).slice(0, 10));
      }

      const branchJoin = db.engine === 'postgres'
        ? 'LEFT JOIN branches b ON b.id::text = je.branch_id::text'
        : 'LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(je.branch_id AS TEXT)';

      // Leaf accounts: parent walk alone (just this id). Headers also expand by PGC code prefix
      // when parent_id links are incomplete — that LIKE is expensive on busy trees.
      const expandByCode = root.is_header === true || root.is_header === 1 || root.is_header === '1';
      const byCodeCte = expandByCode
        ? `,
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
        )`
        : '';
      const accountTreeSelect = expandByCode
        ? `SELECT id, code, name FROM by_parent
          UNION
          SELECT id, code, name FROM by_code`
        : `SELECT id, code, name FROM by_parent`;

      // Split parent walk + code-prefix into separate CTEs.
      // Postgres rejects a 3-arm UNION inside one WITH RECURSIVE (self-ref must be
      // only in the recursive term) — that made city ledger return 500 / empty.
      const limitParam = `$${paramIndex++}`;
      params.push(limit);
      const result = await db.query(`
        WITH RECURSIVE by_parent AS (
          SELECT id, code, name FROM chart_of_accounts WHERE ${idText('id')} = ${idText('$1')}
          UNION
          SELECT c.id, c.code, c.name
          FROM chart_of_accounts c
          INNER JOIN by_parent t ON ${idText('c.parent_id')} = ${idText('t.id')}
        )${byCodeCte},
        account_tree AS (
          ${accountTreeSelect}
        )
        SELECT DISTINCT
          jel.id,
          jel.journal_entry_id,
          jel.account_id,
          atree.code AS account_code,
          atree.name AS account_name,
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
        INNER JOIN journal_entries je ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}
        INNER JOIN account_tree atree ON (
          ${idText('atree.id')} = ${idText('jel.account_id')}
          OR ${idText('atree.code')} = ${idText('jel.account_id')}
        )
        ${branchJoin}
        WHERE ${postedClause}
          ${dateFilter}
        ORDER BY (${entryDateExpr}) DESC, je.created_at DESC
        LIMIT ${limitParam}
      `, params);

      // Leaf with opening balance only: surface it as a synthetic line so drill-down
      // is not empty while the chart still shows a non-zero balance.
      if ((result.rows || []).length === 0) {
        const opening = Number(root.opening_balance) || 0;
        const kids = await db.query(
          `SELECT COUNT(*) AS n FROM chart_of_accounts
           WHERE ${idText('parent_id')} = ${idText('$1')}
              OR (
                ${activeClause}
                AND CAST($2 AS TEXT) <> ''
                AND length(${idText('code')}) > length(CAST($2 AS TEXT))
                AND ${idText('code')} LIKE CAST($2 AS TEXT) || '%'
              )`,
          [root.id, String(root.code || '')],
        );
        const childCount = Number(kids.rows[0]?.n || kids.rows[0]?.count || 0);
        const ownNet = await db.query(
          `SELECT COALESCE(SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)), 0) AS net
           FROM journal_entry_lines jel
           INNER JOIN journal_entries je ON ${idText('je.id')} = ${idText('jel.journal_entry_id')}
           WHERE ${postedClause}
             AND (${idText('jel.account_id')} = ${idText('$1')} OR ${idText('jel.account_id')} = ${idText('$2')})`,
          [String(root.id), String(root.code || '')],
        );
        const net = Number(ownNet.rows[0]?.net) || 0;
        const current = opening + net;
        if (childCount === 0 && (opening !== 0 || current !== 0 || Number(root.current_balance) !== 0)) {
          const amt = opening !== 0 ? opening : (current !== 0 ? current : Number(root.current_balance) || 0);
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
      res.set('X-Ledger-Has-More', String((result.rows || []).length >= limit));
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
