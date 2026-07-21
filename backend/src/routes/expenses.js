const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const { postCaixaGlMovement } = require('../lib/caixaGlPosting');
const { createJournalEntry } = require('../accounting');
const { auditErpSafe } = require('../lib/erpAudit');
const { requirePermission } = require('../middleware/requirePermission');
const {
  recordExpenseOnOpenSession,
  syncOpenSessionExpensesFromLedger,
} = require('../lib/caixaCashRefund');
const { resolveBranchFilterId, normalizeBranchIdKey } = require('../lib/branchIdMatch');

const BANK_GL = '431';

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

async function treasuryBranchFromCaixa(caixaId, fallbackBranchId) {
  const id = String(caixaId || '').trim();
  if (!id) return fallbackBranchId;
  try {
    const result = await db.query(
      'SELECT branch_id FROM caixas WHERE id = $1 LIMIT 1',
      [id],
    );
    const branchId = result.rows[0]?.branch_id;
    return branchId ? String(branchId) : fallbackBranchId;
  } catch {
    return fallbackBranchId;
  }
}

async function treasuryBranchFromBank(bankAccountId, fallbackBranchId) {
  const id = String(bankAccountId || '').trim();
  if (!id) return fallbackBranchId;
  try {
    const result = await db.query(
      'SELECT branch_id FROM bank_accounts WHERE id = $1 LIMIT 1',
      [id],
    );
    const branchId = result.rows[0]?.branch_id;
    return branchId ? String(branchId) : fallbackBranchId;
  } catch {
    return fallbackBranchId;
  }
}

async function applyCaixaRegisterDelta(caixaId, delta) {
  const id = String(caixaId || '').trim();
  if (!id || !Number.isFinite(delta) || Math.abs(delta) < 0.001) return;
  await db.query(
    `UPDATE caixas
     SET current_balance = COALESCE(current_balance, 0) + $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [delta, id],
  );
}

async function applyBankAccountDelta(bankAccountId, delta) {
  const id = String(bankAccountId || '').trim();
  if (!id || !Number.isFinite(delta) || Math.abs(delta) < 0.001) return;
  await db.query(
    `UPDATE bank_accounts
     SET balance = COALESCE(balance, 0) + $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [delta, id],
  );
}

async function postBankExpenseGl({
  branchId, amount, category, description, referenceId, createdBy, bankAccountId,
}) {
  const expenseCode = expenseGlAccount(category);
  const amt = Number(amount);
  if (!branchId || !Number.isFinite(amt) || amt <= 0) {
    throw new Error('Invalid bank expense GL params');
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT id FROM journal_entries
       WHERE reference_type = 'expense' AND reference_id = $1 LIMIT 1`,
      [String(referenceId)],
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { alreadyPosted: true };
    }
    let bankGl = BANK_GL;
    try {
      const { ensureBankGlColumn, resolveBankGlForTreasury } = require('../lib/bankGlAccounts');
      await ensureBankGlColumn(db);
      bankGl = await resolveBankGlForTreasury(client, {
        bankAccountId,
        branchId,
      });
    } catch (e) {
      console.warn('[EXPENSES] bank GL resolve:', e.message);
    }
    await createJournalEntry(client, {
      description: `Despesa (banco): ${description}`,
      referenceType: 'expense',
      referenceId: String(referenceId),
      branchId,
      createdBy,
      lines: [
        { accountCode: expenseCode, debit: amt, credit: 0, description },
        { accountCode: bankGl, debit: 0, credit: amt, description: `Pagamento banco — ${description}` },
      ],
    });
    await client.query('COMMIT');
    return { alreadyPosted: false };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {object} row
 * @param {string} paidBy
 * @param {{ applyBalances?: boolean }} [opts]
 *   applyBalances=false → GL-only (repost). Default true for first pay.
 */
async function payExpenseTreasury(row, paidBy, opts = {}) {
  const applyBalances = opts.applyBalances !== false;
  let glError = null;
  if (!row.branchId || row.totalAmount <= 0) return { glError };

  if (row.paymentSource === 'caixa') {
    const glBranchId = await treasuryBranchFromCaixa(row.caixaId, row.branchId);
    let alreadyPosted = false;
    try {
      const glResult = await postCaixaGlMovement({
        branchId: glBranchId,
        amount: row.totalAmount,
        direction: 'out',
        counterAccountCode: expenseGlAccount(row.category),
        description: `Despesa: ${row.description}`,
        referenceType: 'expense',
        referenceId: row.id,
        createdBy: paidBy,
      });
      alreadyPosted = !!glResult?.alreadyPosted;
    } catch (glErr) {
      glError = glErr.message;
      console.warn('[EXPENSES] GL post (caixa):', glErr.message);
    }

    // Only touch drawer/session after a successful GL post (or when already posted).
    if (!glError && applyBalances) {
      if (row.caixaId && !alreadyPosted) {
        try {
          await applyCaixaRegisterDelta(row.caixaId, -row.totalAmount);
        } catch (balErr) {
          console.warn('[EXPENSES] caixa balance:', balErr.message);
        }
      }
      const sessionBranch = glBranchId || row.branchId;
      if (!alreadyPosted) {
        try {
          const sessionHit = await recordExpenseOnOpenSession(null, {
            caixaId: row.caixaId,
            branchId: sessionBranch,
            amount: row.totalAmount,
            expenseId: row.id,
          });
          if (!sessionHit.recorded) {
            console.warn(
              '[EXPENSES] open session not updated:',
              sessionHit.reason,
              'caixa=',
              row.caixaId,
              'branch=',
              sessionBranch,
            );
          }
        } catch (sessErr) {
          console.warn('[EXPENSES] open session:', sessErr.message);
        }
      }
      try {
        await syncOpenSessionExpensesFromLedger(null, sessionBranch);
      } catch (syncErr) {
        console.warn('[EXPENSES] session expense sync:', syncErr.message);
      }
    }
    return { glError };
  }

  if (row.paymentSource === 'bank' && row.bankAccountId) {
    let alreadyPosted = false;
    try {
      const glBranchId = await treasuryBranchFromBank(row.bankAccountId, row.branchId);
      const glResult = await postBankExpenseGl({
        branchId: glBranchId,
        amount: row.totalAmount,
        category: row.category,
        description: row.description,
        referenceId: row.id,
        createdBy: paidBy,
        bankAccountId: row.bankAccountId,
      });
      alreadyPosted = !!glResult?.alreadyPosted;
      if (applyBalances && !alreadyPosted) {
        await applyBankAccountDelta(row.bankAccountId, -row.totalAmount);
      }
    } catch (glErr) {
      glError = glErr.message;
      console.warn('[EXPENSES] GL post (bank):', glErr.message);
      // Do not deduct bank balance when GL failed — pay will be rejected.
    }
  }
  return { glError };
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
        const resolved = (await resolveBranchFilterId(db, branchId)) || branchId;
        const branchKey = normalizeBranchIdKey(resolved) || normalizeBranchIdKey(branchId);
        const branchCol = db.engine === 'postgres' ? 'branch_id::text' : 'CAST(branch_id AS TEXT)';
        sql += ` WHERE (${branchCol} = $1 OR REPLACE(LOWER(TRIM(COALESCE(${branchCol}, ''))), '-', '') = $2)`;
        params.push(resolved, branchKey);
      }
      sql += ' ORDER BY created_at DESC';
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 10000);
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
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

  router.post('/', requirePermission('expense_create'), async (req, res) => {
    try {
      await ensureExpensesTable();
      const body = req.body || {};
      const id = String(body.id || randomUUID());
      const now = new Date().toISOString();
      const prior = await db.query('SELECT status FROM expenses WHERE id = $1 LIMIT 1', [id]);
      const wasAlreadyPaid = String(prior.rows[0]?.status || '') === 'paid';
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

      // Treasury only on first transition to paid (create-and-pay). Re-saving a paid
      // expense must not deduct caixa/bank again.
      if (!wasAlreadyPaid && row.status === 'paid' && row.branchId && row.totalAmount > 0) {
        const { glError } = await payExpenseTreasury(row, row.paidBy || row.requestedBy);
        if (glError) {
          // Do not leave a "paid" expense without a ledger entry.
          await db.query(
            `UPDATE expenses SET status = 'draft', paid_by = NULL, paid_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [row.id],
          );
          const reverted = mapRow((await db.query('SELECT * FROM expenses WHERE id = $1', [row.id])).rows[0]);
          return res.status(422).json({
            error: `Pagamento não concluído — falha no diário: ${glError}`,
            glError,
            data: reverted,
          });
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

  router.post('/:id/pay', requirePermission('expense_create', 'expense_approve'), async (req, res) => {
    try {
      await ensureExpensesTable();
      // expenses.paid_by is TEXT (name OK). Journal created_by is UUID — use user id for GL.
      const paidByLabel = req.body?.paidBy || req.user?.name || req.user?.id || 'system';
      const paidByForGl = req.user?.id || req.body?.paidByUserId || null;
      const paidAt = new Date().toISOString();
      const existing = await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });

      const alreadyPaid = String(existing.rows[0].status || '') === 'paid';
      const priorStatus = String(existing.rows[0].status || 'draft');
      if (!alreadyPaid) {
        await db.query(
          `UPDATE expenses SET status = 'paid', paid_by = $1, paid_at = $2, updated_at = $2 WHERE id = $3`,
          [paidByLabel, paidAt, req.params.id],
        );
      }

      const row = mapRow((await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id])).rows[0]);
      // First pay: GL + drawer/session. Re-pay / retry: GL only (no second cash deduct).
      const { glError } = await payExpenseTreasury(row, paidByForGl || paidByLabel, {
        applyBalances: !alreadyPaid,
      });

      if (glError && !alreadyPaid) {
        await db.query(
          `UPDATE expenses SET status = $1, paid_by = NULL, paid_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [priorStatus === 'paid' ? 'draft' : priorStatus, req.params.id],
        );
        const reverted = mapRow((await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id])).rows[0]);
        return res.status(422).json({
          error: `Pagamento não concluído — falha no diário: ${glError}`,
          glError,
          data: reverted,
        });
      }

      if (broadcastTable) {
        await broadcastTable('expenses');
        await broadcastTable('journal_entries');
        await broadcastTable('chart_of_accounts');
        if (row.paymentSource === 'caixa') {
          await broadcastTable('caixas');
          await broadcastTable('caixa_sessions');
        }
        if (row.paymentSource === 'bank') await broadcastTable('bank_accounts');
      }
      auditErpSafe(req, {
        table: 'expenses',
        id: row.id,
        action: 'pay',
        branchId: row.branchId || undefined,
        description: `Despesa paga ${row.expenseNumber || row.id}: ${row.description} (${row.totalAmount} AOA)`,
        newValues: { paidBy: paidByLabel, paidAt, glError },
      });
      res.json({ data: row, glError });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to pay expense' });
    }
  });

  /** Repost GL for a paid expense when the initial post failed (e.g. legacy exp_* id). */
  router.post('/:id/repost-gl', requirePermission('expense_create', 'accounting_create'), async (req, res) => {
    try {
      await ensureExpensesTable();
      const existing = await db.query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Expense not found' });
      const row = mapRow(existing.rows[0]);
      if (row.status !== 'paid') {
        return res.status(400).json({ error: 'Expense must be paid before posting to ledger' });
      }
      const paidByLabel = req.body?.paidBy || row.paidBy || req.user?.name || req.user?.id || 'system';
      const paidByForGl = req.user?.id || req.body?.paidByUserId || null;
      // Never touch caixa/bank balances on repost — GL only.
      const { glError } = await payExpenseTreasury(row, paidByForGl || paidByLabel, { applyBalances: false });
      if (broadcastTable) {
        await broadcastTable('expenses');
        await broadcastTable('journal_entries');
        await broadcastTable('chart_of_accounts');
      }
      res.json({ data: row, glError, posted: !glError });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to repost expense GL' });
    }
  });

  return router;
};
