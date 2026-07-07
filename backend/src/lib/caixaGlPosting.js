/**
 * Post balanced GL journal entries for cash movements against the branch caixa (45x).
 * Shared by HTTP routes and internal sync from Electron record storage.
 */
const db = require('../db');
const { resolveBranchCaixaGlAccount } = require('./caixaReconciliation');
const { createJournalEntry } = require('../accounting');

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

function pick(record, ...keys) {
  if (!record || typeof record !== 'object') return undefined;
  for (const key of keys) {
    if (record[key] != null && record[key] !== '') return record[key];
  }
  return undefined;
}

/**
 * @param {object} params
 * @returns {Promise<{ journalEntryId: string, entryNumber: string, alreadyPosted?: boolean }>}
 */
async function postCaixaGlMovement(params) {
  const {
    branchId,
    amount,
    direction,
    counterAccountCode,
    description,
    referenceType,
    referenceId,
    createdBy,
    entryDate,
  } = params || {};

  const amt = Number(amount);
  if (!branchId) throw new Error('branchId required');
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount must be > 0');
  if (direction !== 'in' && direction !== 'out') {
    throw new Error("direction must be 'in' or 'out'");
  }
  if (!counterAccountCode) throw new Error('counterAccountCode required');

  const refType = String(referenceType || 'adjustment');
  const refId = referenceId != null ? String(referenceId) : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if (refId) {
      const existing = await client.query(
        `SELECT id, entry_number FROM journal_entries
         WHERE reference_type = $1 AND reference_id = $2 LIMIT 1`,
        [refType, refId],
      );
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return {
          alreadyPosted: true,
          journalEntryId: existing.rows[0].id,
          entryNumber: existing.rows[0].entry_number,
        };
      }
    }

    const caixa = await resolveBranchCaixaGlAccount(branchId);
    const caixaCode = caixa.code;

    const lines = direction === 'out'
      ? [
          { accountCode: counterAccountCode, description: description || undefined, debit: amt, credit: 0 },
          { accountCode: caixaCode, description: description || undefined, debit: 0, credit: amt },
        ]
      : [
          { accountCode: caixaCode, description: description || undefined, debit: amt, credit: 0 },
          { accountCode: counterAccountCode, description: description || undefined, debit: 0, credit: amt },
        ];

    const entry = await createJournalEntry(client, {
      description: description || 'Movimento de caixa',
      referenceType: refType,
      referenceId: refId,
      branchId,
      createdBy: createdBy || null,
      entryDate: entryDate || undefined,
      lines,
    });

    await client.query('COMMIT');
    return { journalEntryId: entry.id, entryNumber: entry.entry_number };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Derive a GL post request from an Electron/nexor_records row (expense, caixa txn, transfer).
 * @returns {Promise<{ skipped: true, reason: string } | { skipped: false, result: object }>}
 */
async function syncCaixaGlFromRecord(table, record) {
  const data = record || {};

  if (table === 'expenses') {
    const status = String(pick(data, 'status') || '').toLowerCase();
    const paymentSource = String(pick(data, 'payment_source', 'paymentSource') || '').toLowerCase();
    if (status !== 'paid' || paymentSource !== 'caixa') {
      return { skipped: true, reason: 'expense not a paid caixa payout' };
    }
    const branchId = pick(data, 'branch_id', 'branchId');
    const amount = Number(pick(data, 'total_amount', 'totalAmount') || 0);
    const category = pick(data, 'category');
    const description = pick(data, 'description') || 'Despesa de caixa';
    const id = pick(data, 'id');
    if (!branchId || !(amount > 0) || !id) {
      return { skipped: true, reason: 'expense missing branch/amount/id' };
    }
    const result = await postCaixaGlMovement({
      branchId: String(branchId),
      amount,
      direction: 'out',
      counterAccountCode: expenseGlAccount(category),
      description: `Despesa: ${description}`,
      referenceType: 'expense',
      referenceId: String(id),
      createdBy: pick(data, 'paid_by', 'paidBy') || null,
    });
    return { skipped: false, result };
  }

  if (table === 'caixa_transactions') {
    const type = String(pick(data, 'type', 'transaction_type', 'transactionType') || '').toLowerCase();
    const branchId = pick(data, 'branch_id', 'branchId');
    const amount = Number(pick(data, 'amount') || 0);
    const id = pick(data, 'id');
    const description = pick(data, 'description') || `Movimento de caixa: ${type}`;
    const createdBy = pick(data, 'created_by', 'createdBy', 'performed_by', 'performedBy');

    if (!branchId || !(amount > 0) || !id) {
      return { skipped: true, reason: 'caixa_transaction missing branch/amount/id' };
    }

    if (type === 'withdrawal' || type === 'sangria') {
      const result = await postCaixaGlMovement({
        branchId: String(branchId),
        amount,
        direction: 'out',
        counterAccountCode: '452',
        description,
        referenceType: pick(data, 'reference_type', 'referenceType') || 'manual',
        referenceId: String(pick(data, 'reference_id', 'referenceId') || id),
        createdBy,
      });
      return { skipped: false, result };
    }

    if (type === 'deposit' || type === 'reforco' || type === 'adjustment') {
      const result = await postCaixaGlMovement({
        branchId: String(branchId),
        amount,
        direction: 'in',
        counterAccountCode: '452',
        description,
        referenceType: pick(data, 'reference_type', 'referenceType') || 'manual',
        referenceId: String(pick(data, 'reference_id', 'referenceId') || id),
        createdBy,
      });
      return { skipped: false, result };
    }

    return { skipped: true, reason: `caixa_transaction type ${type} has no GL mapping` };
  }

  if (table === 'money_transfers') {
    const branchId = pick(data, 'branch_id', 'branchId');
    const amount = Number(pick(data, 'amount') || 0);
    const id = pick(data, 'id');
    const sourceType = String(pick(data, 'source_type', 'sourceType') || '').toLowerCase();
    const destType = String(pick(data, 'destination_type', 'destinationType') || '').toLowerCase();
    const reason = pick(data, 'reason') || 'Transferência';
    const createdBy = pick(data, 'created_by', 'createdBy');
    const sourceDesc = pick(data, 'source_description', 'sourceDescription') || sourceType;
    const destDesc = pick(data, 'destination_description', 'destinationDescription') || destType;

    if (!branchId || !(amount > 0) || !id) {
      return { skipped: true, reason: 'money_transfer missing branch/amount/id' };
    }

    if (sourceType === 'caixa' && destType === 'bank') {
      const result = await postCaixaGlMovement({
        branchId: String(branchId),
        amount,
        direction: 'out',
        counterAccountCode: '431',
        description: `Transferência para ${destDesc}: ${reason}`,
        referenceType: 'transfer',
        referenceId: String(id),
        createdBy,
      });
      return { skipped: false, result };
    }

    if (sourceType === 'bank' && destType === 'caixa') {
      const result = await postCaixaGlMovement({
        branchId: String(branchId),
        amount,
        direction: 'in',
        counterAccountCode: '431',
        description: `Transferência de ${sourceDesc}: ${reason}`,
        referenceType: 'transfer',
        referenceId: String(id),
        createdBy,
      });
      return { skipped: false, result };
    }

    return { skipped: true, reason: 'transfer does not affect branch caixa GL' };
  }

  return { skipped: true, reason: `table ${table} not handled` };
}

module.exports = {
  postCaixaGlMovement,
  syncCaixaGlFromRecord,
  expenseGlAccount,
};
