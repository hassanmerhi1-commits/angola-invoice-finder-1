const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { postCaixaGlMovement } = require('../lib/caixaGlPosting');
const { auditErpSafe } = require('../lib/erpAudit');

const EXPENSE_GL_ACCOUNTS = {
  staff: '722',
  transport: '752',
  utilities: '752',
  materials: '752',
  maintenance: '752',
  other: '758',
};

function expenseGlAccount(category) {
  return (category && EXPENSE_GL_ACCOUNTS[category]) || '758';
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    expenseNumber: row.expense_number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    category: row.category,
    description: row.description,
    amount: Number(row.amount) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    paymentSource: row.payment_source,
    caixaId: row.caixa_id,
    bankAccountId: row.bank_account_id,
    payeeName: row.payee_name,
    invoiceNumber: row.invoice_number,
    status: row.status,
    requestedBy: row.created_by,
    requestedAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    paidBy: row.paid_by,
    paidAt: row.paid_at,
    transactionId: row.transaction_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureExpensesTable() {
  if (db.engine === 'postgres') return;
  try {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        expense_number TEXT NOT NULL DEFAULT '',
        branch_id TEXT NOT NULL DEFAULT '',
        branch_name TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'other',
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        payment_source TEXT NOT NULL DEFAULT 'caixa',
        caixa_id TEXT,
        bank_account_id TEXT,
        payee_name TEXT,
        invoice_number TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT,
        approved_by TEXT,
        approved_at TEXT,
        paid_by TEXT,
        paid_at TEXT,
        transaction_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_branch ON expenses(branch_id);
    `);
  } catch (_) {}
}

module.exports = function expensesRouter(broadcastTable) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      await ensureExpensesTable();
      const branchId = String(req.query.branchId || '').trim();
      const params = [];
      let sql = 'SELECT * FROM expenses';
      if (branchId) {
        sql += ' WHERE branch_id = $1';
        params.push(branchId);
      }
      sql += ' ORDER BY created_at DESC';
      const result = await db.query(sql, params);
      res.json({ data: (result.rows || []).map(mapRow) });
    } catch (error) {
      console.error('[EXPENSES] list:', error);
      res.status(500).json({ error: error.message || 'Failed to list expenses' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      await ensureExpensesTable();
      const result = await db.query('SELECT * FROM expenses WHERE id = $1 LIMIT 1', [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Expense not found' });
      res.json({ data: mapRow(result.rows[0]) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load expense' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      await ensureExpensesTable();
      const body = req.body || {};
      const id = String(body.id || randomUUID());
      const now = new Date().toISOString();
      await db.query(
        `INSERT INTO expenses (
          id, expense_number, branch_id, branch_name, category, description,
          amount, tax_amount, total_amount, payment_source, caixa_id, bank_account_id,
          payee_name, invoice_number, status, created_by, approved_by, approved_at,
          paid_by, paid_at, transaction_id, notes, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )
        ON CONFLICT (id) DO UPDATE SET
          expense_number = EXCLUDED.expense_number,
          branch_id = EXCLUDED.branch_id,
          branch_name = EXCLUDED.branch_name,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          amount = EXCLUDED.amount,
          tax_amount = EXCLUDED.tax_amount,
          total_amount = EXCLUDED.total_amount,
          payment_source = EXCLUDED.payment_source,
          caixa_id = EXCLUDED.caixa_id,
          bank_account_id = EXCLUDED.bank_account_id,
          payee_name = EXCLUDED.payee_name,
          invoice_number = EXCLUDED.invoice_number,
          status = EXCLUDED.status,
          created_by = EXCLUDED.created_by,
          approved_by = EXCLUDED.approved_by,
          approved_at = EXCLUDED.approved_at,
          paid_by = EXCLUDED.paid_by,
          paid_at = EXCLUDED.paid_at,
          transaction_id = EXCLUDED.transaction_id,
          notes = EXCLUDED.notes,
          updated_at = EXCLUDED.updated_at`,
        [
          id,
          body.expenseNumber || body.expense_number || '',
          body.branchId || body.branch_id || '',
          body.branchName || body.branch_name || '',
          body.category || 'other',
          body.description || '',
          Number(body.amount) || 0,
          Number(body.taxAmount ?? body.tax_amount) || 0,
          Number(body.totalAmount ?? body.total_amount) || 0,
          body.paymentSource || body.payment_source || 'caixa',
          body.caixaId || body.caixa_id || null,
          body.bankAccountId || body.bank_account_id || null,
          body.payeeName || body.payee_name || null,
          body.invoiceNumber || body.invoice_number || null,
          body.status || 'draft',
          body.requestedBy || body.created_by || req.user?.id || null,
          body.approvedBy || body.approved_by || null,
          body.approvedAt || body.approved_at || null,
          body.paidBy || body.paid_by || null,
          body.paidAt || body.paid_at || null,
          body.transactionId || body.transaction_id || null,
          body.notes || null,
          body.createdAt || body.created_at || now,
          now,
        ],
      );

      const saved = await db.query('SELECT * FROM expenses WHERE id = $1', [id]);
      const row = mapRow(saved.rows[0]);

      if (row.status === 'paid' && row.paymentSource === 'caixa' && row.branchId) {
        try {
          await postCaixaGlMovement({
            branchId: row.branchId,
            amount: row.totalAmount,
            direction: 'out',
            counterAccountCode: expenseGlAccount(row.category),
            description: `Despesa: ${row.description}`,
            referenceType: 'expense',
            referenceId: row.id,
            createdBy: row.paidBy || row.requestedBy,
          });
        } catch (glErr) {
          console.warn('[EXPENSES] GL post on save:', glErr.message);
        }
      }

      if (broadcastTable) await broadcastTable('expenses');
      auditErpSafe(req, {
        table: 'expenses',
        id: row.id,
        action: row.status === 'paid' ? 'create_and_pay' : 'create',
        branchId: row.branchId || undefined,
        description: `Despesa ${row.expenseNumber || row.id}: ${row.description} (${row.totalAmount} AOA)`,
        newValues: {
          category: row.category,
          totalAmount: row.totalAmount,
          status: row.status,
          paymentSource: row.paymentSource,
        },
      });
      res.status(201).json({ data: row });
    } catch (error) {
      console.error('[EXPENSES] create:', error);
      res.status(500).json({ error: error.message || 'Failed to save expense' });
    }
  });

  router.post('/:id/pay', async (req, res) => {
    try {
      await ensureExpensesTable();
      const paidBy = req.body?.paidBy || req.user?.name || req.user?.id || 'system';
      const paidAt = new Date().toISOString();
      const existing = await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });

      await db.query(
        `UPDATE expenses SET status = 'paid', paid_by = $1, paid_at = $2, updated_at = $2 WHERE id = $3`,
        [paidBy, paidAt, req.params.id],
      );

      const row = mapRow((await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id])).rows[0]);
      let glError = null;
      if (row.paymentSource === 'caixa' && row.branchId && row.totalAmount > 0) {
        try {
          await postCaixaGlMovement({
            branchId: row.branchId,
            amount: row.totalAmount,
            direction: 'out',
            counterAccountCode: expenseGlAccount(row.category),
            description: `Despesa: ${row.description}`,
            referenceType: 'expense',
            referenceId: row.id,
            createdBy: paidBy,
          });
        } catch (glErr) {
          glError = glErr.message;
          console.warn('[EXPENSES] GL post on pay:', glErr.message);
        }
      }

      if (broadcastTable) await broadcastTable('expenses');
      auditErpSafe(req, {
        table: 'expenses',
        id: row.id,
        action: 'pay',
        branchId: row.branchId || undefined,
        description: `Despesa paga ${row.expenseNumber || row.id}: ${row.description} (${row.totalAmount} AOA)`,
        newValues: { paidBy, paidAt, glError },
      });
      res.json({ data: row, glError });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to pay expense' });
    }
  });

  return router;
};
