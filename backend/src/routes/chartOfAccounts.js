// Chart of Accounts API routes
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../middleware/requirePermission');
const { buildJournalBranchFilter } = require('../lib/branchIdMatch');
const { auditErpSafe } = require('../lib/erpAudit');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get all accounts with hierarchy
  router.get('/', async (req, res) => {
    try {
      // Grouped join instead of a correlated COUNT(*) per row — the chart has
      // hundreds of rows, so the old query re-scanned the table per account.
      const result = await db.query(`
        SELECT 
          coa.*,
          parent.name as parent_name,
          parent.code as parent_code,
          COALESCE(kids.children_count, 0) as children_count
        FROM chart_of_accounts coa
        LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
        LEFT JOIN (
          SELECT parent_id, COUNT(*) AS children_count
          FROM chart_of_accounts
          WHERE parent_id IS NOT NULL
          GROUP BY parent_id
        ) kids ON kids.parent_id = coa.id
        WHERE coa.is_active = true
        ORDER BY coa.code
      `);
      res.set('Cache-Control', 'private, max-age=30');
      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch accounts' });
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
  // Supplier/client AP/AR spans all filials — never filter by toolbar branchId.
  router.get('/:id/ledger', async (req, res) => {
    try {
      const { id } = req.params;
      const { start_date, end_date } = req.query;

      let dateFilter = '';
      const params = [id];
      let paramIndex = 2;

      if (start_date && end_date) {
        dateFilter = `AND je.entry_date BETWEEN $${paramIndex++} AND $${paramIndex++}`;
        params.push(start_date, end_date);
      }

      const branchJoin = db.engine === 'postgres'
        ? 'LEFT JOIN branches b ON b.id::text = je.branch_id::text'
        : 'LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(je.branch_id AS TEXT)';

      const result = await db.query(`
        WITH RECURSIVE account_tree AS (
          SELECT id, code, name FROM chart_of_accounts WHERE id = $1
          UNION ALL
          SELECT c.id, c.code, c.name
          FROM chart_of_accounts c
          INNER JOIN account_tree t ON c.parent_id = t.id
        )
        SELECT 
          jel.id,
          jel.journal_entry_id,
          jel.account_id,
          atree.code AS account_code,
          atree.name AS account_name,
          jel.description,
          jel.debit_amount,
          jel.credit_amount,
          je.entry_number,
          COALESCE(
            je.entry_date::text,
            CASE WHEN je.created_at IS NOT NULL THEN to_char(je.created_at::date, 'YYYY-MM-DD') END
          ) AS entry_date,
          je.description as journal_description,
          je.reference_type,
          je.reference_id,
          je.branch_id,
          b.name AS branch_name,
          je.is_posted,
          je.created_at as journal_created_at
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
        INNER JOIN account_tree atree ON atree.id = jel.account_id
        ${branchJoin}
        WHERE je.is_posted = true ${dateFilter}
        ORDER BY je.entry_date DESC, je.created_at DESC
      `, params);

      // Leaf with opening balance only: surface it as a synthetic line so drill-down
      // is not empty while the chart still shows a non-zero balance.
      if ((result.rows || []).length === 0) {
        const acc = await db.query(
          `SELECT id, code, name, opening_balance, current_balance, is_header
           FROM chart_of_accounts WHERE id = $1`,
          [id],
        );
        const row = acc.rows[0];
        const opening = Number(row?.opening_balance) || 0;
        const current = Number(row?.current_balance) || 0;
        const kids = await db.query(
          `SELECT COUNT(*) AS n FROM chart_of_accounts WHERE parent_id = $1`,
          [id],
        );
        const childCount = Number(kids.rows[0]?.n || kids.rows[0]?.count || 0);
        if (row && !row.is_header && childCount === 0 && (opening !== 0 || current !== 0)) {
          const amt = opening !== 0 ? opening : current;
          return res.json([{
            id: `opening-${id}`,
            journal_entry_id: null,
            account_id: id,
            account_code: row.code,
            account_name: row.name,
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

      res.json(result.rows);
    } catch (error) {
      console.error('[CHART OF ACCOUNTS ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch account ledger' });
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
