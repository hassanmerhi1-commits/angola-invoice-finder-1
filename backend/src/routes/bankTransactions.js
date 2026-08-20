const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { auditErpSafe } = require('../lib/erpAudit');

function mapTxn(row) {
  if (!row) return null;
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    branchId: row.branch_id || '',
    type: row.type || 'manual',
    direction: row.direction === 'out' ? 'out' : 'in',
    amount: Number(row.amount) || 0,
    balanceAfter: Number(row.balance_after) || 0,
    referenceType: row.reference_type || undefined,
    referenceId: row.reference_id || undefined,
    referenceNumber: row.reference_number || undefined,
    transactionDate: row.transaction_date
      ? new Date(row.transaction_date).toISOString()
      : undefined,
    valueDate: row.value_date || undefined,
    bankReference: row.bank_reference || undefined,
    description: row.description || '',
    category: row.category || undefined,
    payee: row.payee || undefined,
    createdBy: row.created_by || '',
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : undefined,
    notes: row.notes || undefined,
    isReconciled: row.is_reconciled === true || row.is_reconciled === 1,
    reconciledAt: row.reconciled_at
      ? new Date(row.reconciled_at).toISOString()
      : undefined,
    reconciliationId: row.reconciliation_id || undefined,
  };
}

module.exports = function bankTransactionsRouter() {
  const router = express.Router();

  router.get('/', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const bankAccountId = String(req.query.bankAccountId || req.query.bank_account_id || '').trim();
      const branchId = String(req.query.branchId || req.query.branch_id || '').trim();
      const params = [];
      const where = [];
      if (bankAccountId) {
        params.push(bankAccountId);
        where.push(`bank_account_id = $${params.length}`);
      }
      if (branchId) {
        params.push(branchId);
        where.push(`branch_id = $${params.length}`);
      }
      const sql = `
        SELECT * FROM bank_transactions
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY transaction_date DESC, created_at DESC
        LIMIT 5000
      `;
      const r = await db.query(sql, params);
      res.json((r.rows || []).map(mapTxn));
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.json([]);
      }
      console.error('[BANK_TXNS]', e);
      res.status(500).json({ error: e.message || 'Failed to list bank transactions' });
    }
  });

  router.post('/', requireAuth, requirePermission('bank_manage', 'admin_settings'), async (req, res) => {
    try {
      const b = req.body || {};
      const bankAccountId = String(b.bankAccountId || b.bank_account_id || '').trim();
      if (!bankAccountId) {
        return res.status(400).json({ error: 'bankAccountId is required' });
      }
      const id = String(b.id || '').trim() || crypto.randomUUID();
      const direction = b.direction === 'out' ? 'out' : 'in';
      const amount = Number(b.amount) || 0;
      await db.query(
        `INSERT INTO bank_transactions (
           id, bank_account_id, branch_id, type, direction, amount, balance_after,
           reference_type, reference_id, reference_number, transaction_date, value_date,
           bank_reference, description, category, payee, created_by, notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, CURRENT_TIMESTAMP),$12,
           $13,$14,$15,$16,$17,$18
         )
         ON CONFLICT (id) DO UPDATE SET
           amount = EXCLUDED.amount,
           balance_after = EXCLUDED.balance_after,
           description = EXCLUDED.description,
           bank_reference = EXCLUDED.bank_reference,
           notes = EXCLUDED.notes`,
        [
          id,
          bankAccountId,
          String(b.branchId || b.branch_id || ''),
          String(b.type || 'manual'),
          direction,
          amount,
          Number(b.balanceAfter ?? b.balance_after) || 0,
          b.referenceType || b.reference_type || null,
          b.referenceId || b.reference_id || null,
          b.referenceNumber || b.reference_number || null,
          b.transactionDate || b.transaction_date || null,
          b.valueDate || b.value_date || null,
          b.bankReference || b.bank_reference || null,
          String(b.description || ''),
          b.category || null,
          b.payee || null,
          b.createdBy || b.created_by || req.user?.id || null,
          b.notes || null,
        ],
      );
      const r = await db.query(`SELECT * FROM bank_transactions WHERE id = $1`, [id]);
      const mapped = mapTxn(r.rows[0]);
      auditErpSafe(req, {
        table: 'bank_transactions',
        id,
        action: 'create',
        description: `Movimento bancário: ${direction} ${amount} (${mapped?.description || bankAccountId})`,
        newValues: { bankAccountId, direction, amount, type: String(b.type || 'manual') },
        branchId: String(b.branchId || b.branch_id || ''),
      });
      res.status(201).json(mapped);
    } catch (e) {
      if (/does not exist|no such table/i.test(String(e.message))) {
        return res.status(503).json({ error: 'bank_transactions table not ready' });
      }
      console.error('[BANK_TXNS]', e);
      res.status(500).json({ error: e.message || 'Failed to create bank transaction' });
    }
  });

  return router;
};
