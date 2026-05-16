// Automatic Journal Entry Generator
// Creates double-entry accounting records for all business transactions
const db = require('./db');
const { randomUUID } = require('crypto');

function normalizeUuid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

/** Branch / document ids may be non-UUID strings in SQLite — keep for filtering in Journals. */
function normalizeOptionalId(value) {
  if (value == null || value === '') return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Generate a unique document number from document_sequences (with row-level locking).
 * Falls back to COUNT-based generation if the table doesn't exist yet.
 */
async function generateSequenceNumber(client, documentType, prefix) {
  const savepointName = 'document_sequence_generation';
  let savepointCreated = false;

  try {
    await client.query(`SAVEPOINT ${savepointName}`);
    savepointCreated = true;

    const yr = new Date().getFullYear();
    const seqResult = await client.query(
      `SELECT id, current_number FROM document_sequences
       WHERE document_type = $1 AND fiscal_year = $2
       FOR UPDATE`,
      [documentType, yr]
    );

    if (seqResult.rows.length > 0) {
      const nextNum = parseInt(seqResult.rows[0].current_number) + 1;
      await client.query(
        `UPDATE document_sequences SET current_number = $1 WHERE id = $2`,
        [nextNum, seqResult.rows[0].id]
      );
      return `${prefix}-${yr}-${String(nextNum).padStart(5, '0')}`;
    }

    // Auto-create row
    const insertResult = await client.query(
      `INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, current_number)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (document_type, fiscal_year)
       DO UPDATE SET current_number = document_sequences.current_number + 1
       RETURNING current_number`,
      [randomUUID(), documentType, prefix, yr]
    );
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);

    const nextNum = parseInt(insertResult.rows[0]?.current_number ?? 1, 10);
    return `${prefix}-${yr}-${String(nextNum).padStart(5, '0')}`;
  } catch (e) {
    if (savepointCreated) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (rollbackError) {
        console.error('[ACCOUNTING] Failed to recover sequence savepoint:', rollbackError.message);
      }
    }

    // Fallback if table doesn't exist
    console.warn(`[ACCOUNTING] document_sequences unavailable for ${documentType}:`, e.message);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}${today}${String(Date.now() % 10000).padStart(4, '0')}`;
  }
}

/**
 * Find account by code (e.g., '4.1.1' for Caixa Principal)
 */
async function findAccountByCode(client, code) {
  const result = await client.query(
    'SELECT id, code, name FROM chart_of_accounts WHERE code = $1 AND is_active = true',
    [code]
  );
  return result.rows[0] || null;
}

/**
 * Create a journal entry with lines (within an existing transaction)
 * @param {object} client - PostgreSQL client (from pool.connect())
 * @param {object} params - Journal entry parameters
 */
async function createJournalEntry(client, params) {
  const {
    description, referenceType, referenceId, branchId,
    createdBy, lines, entryDate
  } = params;

  // Input validation
  if (!lines || lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  if (!description) {
    throw new Error('Journal entry description is required');
  }

  // Generate entry number from centralized sequences
  const prefixMap = {
    sale: 'VD', purchase: 'CP', purchase_invoice: 'CP', transfer: 'TRF',
    expense: 'DSP', adjustment: 'AJ', receipt: 'REC', payment: 'PAG',
    credit_note: 'NC', debit_note: 'ND', payment_receipt: 'REC', payment_out: 'PAG',
  };
  const prefix = prefixMap[referenceType] || 'JE';
  const entryNumber = await generateSequenceNumber(client, 'journal', prefix);

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  // STRICT: Reject unbalanced entries
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry not balanced: Debit=${totalDebit.toFixed(2)}, Credit=${totalCredit.toFixed(2)}. Difference=${Math.abs(totalDebit - totalCredit).toFixed(2)}`);
  }

  // Reject zero-amount entries
  if (totalDebit === 0 && totalCredit === 0) {
    throw new Error('Journal entry cannot have zero total');
  }

  const entryId = randomUUID();

  // Insert journal entry header
  await client.query(
    `INSERT INTO journal_entries 
     (id, entry_number, entry_date, description, reference_type, reference_id, 
      total_debit, total_credit, is_posted, posted_at, branch_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, $9, $10)`,
     [entryId, entryNumber, entryDate || new Date().toISOString().split('T')[0],
      description, referenceType, normalizeOptionalId(referenceId),
      totalDebit, totalCredit, normalizeOptionalId(branchId), normalizeOptionalId(createdBy)]
  );

  // Insert journal entry lines
  for (const line of lines) {
    if ((line.debit || 0) === 0 && (line.credit || 0) === 0) {
      continue; // Skip zero lines
    }

    const account = await findAccountByCode(client, line.accountCode);
    if (!account) {
      throw new Error(`Conta contabilística não encontrada: ${line.accountCode}`);
    }

    const lineId = randomUUID();
    await client.query(
      `INSERT INTO journal_entry_lines 
       (id, journal_entry_id, account_id, description, debit_amount, credit_amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [lineId, entryId, account.id, line.description || description, 
       line.debit || 0, line.credit || 0]
    );

    // Update account current_balance
    const balanceChange = (line.debit || 0) - (line.credit || 0);
    await client.query(
      `UPDATE chart_of_accounts SET 
       current_balance = current_balance + $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [balanceChange, account.id]
    );
  }

  console.log(`[ACCOUNTING] Created ${entryNumber} (${referenceType}): D=${totalDebit.toFixed(2)} C=${totalCredit.toFixed(2)}`);
  return { id: entryId, entry_number: entryNumber, total_debit: totalDebit, total_credit: totalCredit };
}

module.exports = {
  createJournalEntry,
  findAccountByCode,
  generateSequenceNumber,
  normalizeUuid,
};
