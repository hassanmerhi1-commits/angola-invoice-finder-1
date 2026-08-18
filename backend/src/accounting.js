// Automatic Journal Entry Generator
// Creates double-entry accounting records for all business transactions
const { randomUUID } = require('crypto');

/** Central registry of atomic document sequences (prefix + document_type key). */
const DOCUMENT_SEQUENCE_CONFIG = {
  invoice: { prefix: 'INV', perBranch: false },
  purchase_invoice: { prefix: 'FC', perBranch: true },
  credit_note: { prefix: 'NC', perBranch: true },
  debit_note: { prefix: 'ND', perBranch: true },
  transport_document: { prefix: 'GT', perBranch: true },
  simplified_invoice: { prefix: 'FS', perBranch: true },
  invoice_receipt: { prefix: 'FR', perBranch: true },
  sales_invoice: { prefix: 'FT', perBranch: true },
  payment_receipt: { prefix: 'REC', perBranch: false },
  payment_out: { prefix: 'PAG', perBranch: false },
  purchase_order: { prefix: 'PO', perBranch: false },
  stock_transfer: { prefix: 'TRF', perBranch: false },
  journal: { prefix: 'JE', perBranch: false },
};

function resolveSequenceConfig(documentType) {
  const cfg = DOCUMENT_SEQUENCE_CONFIG[documentType];
  if (!cfg) {
    throw new Error(`Tipo de documento desconhecido para numeração: ${documentType}`);
  }
  return cfg;
}

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

function normalizeBranchCode(code) {
  const cleaned = String(code || 'SEDE').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned || 'SEDE';
}

/**
 * @param {{ branchId?: string, branchCode?: string }} scope
 */
function normalizeSequenceScope(documentType, scope = {}) {
  const cfg = resolveSequenceConfig(documentType);
  if (!cfg.perBranch) {
    return { branchId: '', branchCode: '' };
  }
  const branchId = String(scope.branchId || '').trim();
  const branchCode = normalizeBranchCode(scope.branchCode);
  if (!branchId) {
    throw new Error('branchId é obrigatório para numeração por filial');
  }
  return { branchId, branchCode };
}

function formatSequenceNumber(prefix, yr, seqNum, scope, perBranch) {
  const n = String(seqNum).padStart(5, '0');
  if (perBranch) {
    return `${prefix}-${scope.branchCode}-${yr}-${n}`;
  }
  return `${prefix}-${yr}-${n}`;
}

/**
 * Generate a unique document number from document_sequences (with row-level locking).
 * @param {{ branchId?: string, branchCode?: string }} scope
 */
async function generateSequenceNumber(client, documentType, prefix, scope = {}) {
  const cfg = resolveSequenceConfig(documentType);
  const normalizedScope = normalizeSequenceScope(documentType, scope);
  const savepointName = 'document_sequence_generation';
  let savepointCreated = false;

  try {
    await client.query(`SAVEPOINT ${savepointName}`);
    savepointCreated = true;

    const yr = new Date().getFullYear();
    const seqResult = await client.query(
      `SELECT id, current_number FROM document_sequences
       WHERE document_type = $1 AND fiscal_year = $2 AND branch_id = $3
       FOR UPDATE`,
      [documentType, yr, normalizedScope.branchId]
    );

    if (seqResult.rows.length > 0) {
      const nextNum = parseInt(seqResult.rows[0].current_number, 10) + 1;
      await client.query(
        `UPDATE document_sequences SET current_number = $1 WHERE id = $2`,
        [nextNum, seqResult.rows[0].id]
      );
      await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      return formatSequenceNumber(prefix, yr, nextNum, normalizedScope, cfg.perBranch);
    }

    const insertResult = await client.query(
      `INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (document_type, fiscal_year, branch_id)
       DO UPDATE SET current_number = document_sequences.current_number + 1
       RETURNING current_number`,
      [randomUUID(), documentType, prefix, yr, normalizedScope.branchId]
    );
    await client.query(`RELEASE SAVEPOINT ${savepointName}`);

    const nextNum = parseInt(insertResult.rows[0]?.current_number ?? 1, 10);
    return formatSequenceNumber(prefix, yr, nextNum, normalizedScope, cfg.perBranch);
  } catch (e) {
    if (savepointCreated) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);
      } catch (rollbackError) {
        console.error('[ACCOUNTING] Failed to recover sequence savepoint:', rollbackError.message);
        throw e;
      }
    }

    console.warn(`[ACCOUNTING] document_sequences unavailable for ${documentType}:`, e.message);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const yr = new Date().getFullYear();
    if (cfg.perBranch) {
      return `${prefix}-${normalizedScope.branchCode}-${yr}-${String(Date.now() % 10000).padStart(4, '0')}`;
    }
    return `${prefix}${today}${String(Date.now() % 10000).padStart(4, '0')}`;
  }
}

/**
 * Preview the next sequence number without consuming it (for UI labels only).
 * @param {{ branchId?: string, branchCode?: string }} scope
 */
async function peekSequenceNumber(client, documentType, prefix, scope = {}) {
  const cfg = resolveSequenceConfig(documentType);
  const normalizedScope = normalizeSequenceScope(documentType, scope);
  const yr = new Date().getFullYear();
  try {
    const seqResult = await client.query(
      `SELECT current_number FROM document_sequences
       WHERE document_type = $1 AND fiscal_year = $2 AND branch_id = $3`,
      [documentType, yr, normalizedScope.branchId]
    );
    const nextNum = seqResult.rows.length > 0
      ? parseInt(seqResult.rows[0].current_number, 10) + 1
      : 1;
    return formatSequenceNumber(prefix, yr, nextNum, normalizedScope, cfg.perBranch);
  } catch {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (cfg.perBranch) {
      return `${prefix}-${normalizedScope.branchCode}-${yr}-00001`;
    }
    return `${prefix}${today}0001`;
  }
}

function isUniqueViolation(error) {
  return error?.code === '23505' || /unique constraint|duplicate key/i.test(String(error?.message || ''));
}

/** Parse FT-SEDE-2026-00042 → 42 */
function parsePerBranchSequenceNumber(invoiceNumber, prefix, branchCode, fiscalYear) {
  const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc(prefix)}-${esc(branchCode)}-${fiscalYear}-(\\d+)$`, 'i');
  const m = String(invoiceNumber || '').trim().match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Align document_sequences with the highest invoice_number already in sales (post-migration / preview drift).
 */
async function bumpSequenceFromExistingSales(client, documentType, prefix, scope = {}) {
  const cfg = resolveSequenceConfig(documentType);
  if (!cfg.perBranch) return 0;
  const normalizedScope = normalizeSequenceScope(documentType, scope);
  const yr = new Date().getFullYear();
  const likePattern = `${prefix}-${normalizedScope.branchCode}-${yr}-%`;
  const result = await client.query(
    'SELECT invoice_number FROM sales WHERE invoice_number ILIKE $1',
    [likePattern],
  );
  let maxNum = 0;
  for (const row of result.rows || []) {
    const n = parsePerBranchSequenceNumber(
      row.invoice_number,
      prefix,
      normalizedScope.branchCode,
      yr,
    );
    if (n != null && n > maxNum) maxNum = n;
  }
  if (maxNum <= 0) return 0;

  const db = require('./db');
  const { sqlScalarMax } = require('./lib/sqlDialect');
  await client.query(
    `INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (document_type, fiscal_year, branch_id)
     DO UPDATE SET current_number = ${sqlScalarMax(db, 'document_sequences.current_number', 'EXCLUDED.current_number')}`,
    [randomUUID(), documentType, prefix, yr, normalizedScope.branchId, maxNum],
  );
  return maxNum;
}

/**
 * Atomically allocate a sale invoice number — never trust UI preview hints.
 */
async function allocateUniqueSaleInvoiceNumber(client, documentType, prefix, scope = {}) {
  await bumpSequenceFromExistingSales(client, documentType, prefix, scope);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = await generateSequenceNumber(client, documentType, prefix, scope);
    const dup = await client.query(
      'SELECT 1 FROM sales WHERE invoice_number = $1 LIMIT 1',
      [candidate],
    );
    if (!dup.rows.length) return candidate;
    console.warn(`[ACCOUNTING] Invoice number collision (${candidate}) — resyncing sequence`);
    await bumpSequenceFromExistingSales(client, documentType, prefix, scope);
  }
  throw new Error('Não foi possível gerar número de fatura único. Verifique sequências em Definições ou contacte suporte.');
}

/**
 * Find account by code (e.g., '451' for Caixa)
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
/** Block posts into closed/locked months (shared by all JE creators). */
async function assertPeriodOpenForJournal(client, entryDate) {
  const d = new Date(entryDate || new Date().toISOString().split('T')[0]);
  if (Number.isNaN(d.getTime())) return;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  try {
    const result = await client.query(
      `SELECT status FROM accounting_periods WHERE year = $1 AND month = $2`,
      [year, month],
    );
    if (result.rows.length > 0 && result.rows[0].status !== 'open') {
      throw new Error(
        `Período contabilístico ${month}/${year} está ${result.rows[0].status}. Não é possível lançar.`,
      );
    }
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('Período contabilístico')) throw e;
    if (/does not exist|relation .* does not exist/i.test(msg)) return;
    throw e;
  }
}

async function createJournalEntry(client, params) {
  const {
    description, referenceType, referenceId, branchId,
    createdBy, createdByName, lines, entryDate
  } = params;

  if (!lines || lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  if (!description) {
    throw new Error('Journal entry description is required');
  }

  await assertPeriodOpenForJournal(client, entryDate);

  const prefixMap = {
    sale: 'VD', purchase: 'CP', purchase_invoice: 'CP', transfer: 'TRF',
    expense: 'DSP', adjustment: 'AJ', adjustment_void: 'AJV', receipt: 'REC', payment: 'PAG',
    credit_note: 'NC', debit_note: 'ND', payment_receipt: 'REC', payment_out: 'PAG',
  };
  const prefix = prefixMap[referenceType] || 'JE';
  const entryNumber = await generateSequenceNumber(client, 'journal', prefix);

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry not balanced: Debit=${totalDebit.toFixed(2)}, Credit=${totalCredit.toFixed(2)}. Difference=${Math.abs(totalDebit - totalCredit).toFixed(2)}`);
  }

  if (totalDebit === 0 && totalCredit === 0) {
    throw new Error('Journal entry cannot have zero total');
  }

  const entryId = randomUUID();
  const refRaw = normalizeOptionalId(referenceId);
  // Older DBs still have reference_id as UUID — reject manual_* style ids from the UI.
  const storedReferenceId =
    refRaw && (normalizeUuid(refRaw) || !/^manual_/i.test(refRaw)) ? refRaw : entryId;

  await client.query(
    `INSERT INTO journal_entries 
     (id, entry_number, entry_date, description, reference_type, reference_id, 
      total_debit, total_credit, is_posted, posted_at, branch_id, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, $9, $10, $11)`,
    [entryId, entryNumber, entryDate || new Date().toISOString().split('T')[0],
      description, referenceType, storedReferenceId,
      // created_by is UUID in Postgres — never pass display names like "HUSSEIN MERHI"
      totalDebit, totalCredit, normalizeOptionalId(branchId), normalizeUuid(createdBy), String(createdByName || '').trim()]
  );

  for (const line of lines) {
    if ((line.debit || 0) === 0 && (line.credit || 0) === 0) {
      continue;
    }

    const account = await findAccountByCode(client, line.accountCode);
    if (!account) {
      throw new Error(`Conta contabilística não encontrada: ${line.accountCode}`);
    }

    // Control accounts 321/311 must not receive operational AP/AR lines.
    // Manual / adjustment journals may still post to the parent when needed.
    const acctCode = String(account.code || line.accountCode || '').trim();
    const refType = String(referenceType || '').trim().toLowerCase();
    const allowParent =
      params.allowParentEntityAccount === true
      || line.allowParentEntityAccount === true
      || isEditableJournalReferenceType(refType);
    if (!allowParent && (acctCode === '321' || acctCode === '311')) {
      throw new Error(
        `Cannot post to parent account ${acctCode}. Use the supplier/customer leaf (e.g. ${acctCode}00001).`,
      );
    }

    const lineId = randomUUID();
    const lineEntryDate = entryDate || new Date().toISOString().split('T')[0];
    try {
      await client.query(
        `INSERT INTO journal_entry_lines
         (id, journal_entry_id, account_id, description, debit_amount, credit_amount, entry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [lineId, entryId, account.id, line.description || description,
          line.debit || 0, line.credit || 0, lineEntryDate],
      );
    } catch (e) {
      // Pre-migration DBs without entry_date column.
      if (!/entry_date|42703/i.test(String(e.message || e))) throw e;
      await client.query(
        `INSERT INTO journal_entry_lines
         (id, journal_entry_id, account_id, description, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lineId, entryId, account.id, line.description || description,
          line.debit || 0, line.credit || 0],
      );
    }

    const balanceChange = (line.debit || 0) - (line.credit || 0);
    await client.query(
      `UPDATE chart_of_accounts SET
       current_balance = COALESCE(current_balance, 0) + $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE CAST(id AS TEXT) = CAST($2 AS TEXT)
          OR CAST(code AS TEXT) = CAST($2 AS TEXT)`,
      [balanceChange, account.id]
    );
  }

  console.log(`[ACCOUNTING] Created ${entryNumber} (${referenceType}): D=${totalDebit.toFixed(2)} C=${totalCredit.toFixed(2)}`);

  const { runOptionalInSavepoint } = require('./lib/pgSavepoint');
  await runOptionalInSavepoint(client, 'journal_outbox', async () => {
    const { enqueueJournalPosted } = require('./sync/outbox');
    await enqueueJournalPosted(client, entryId, branchId);
  }, (e) => {
    console.warn('[ACCOUNTING] Journal outbox skipped:', e.message);
  });

  return { id: entryId, entry_number: entryNumber, total_debit: totalDebit, total_credit: totalCredit };
}

/** Manual / adjustment journals may be edited in place. System docs must be reversed instead. */
const EDITABLE_JOURNAL_REFERENCE_TYPES = new Set([
  'adjustment',
  'ajuste',
  'manual',
  'journal',
  'je',
]);

function isEditableJournalReferenceType(referenceType) {
  const t = String(referenceType || '').trim().toLowerCase();
  return !t || EDITABLE_JOURNAL_REFERENCE_TYPES.has(t);
}

/**
 * Replace lines + header on an existing manual journal entry.
 * Rolls COA balances back for old lines, then applies the new lines.
 * Keeps the same entry_number / id for audit continuity.
 */
async function updateJournalEntry(client, entryId, params) {
  const { description, lines, entryDate, createdBy } = params;

  if (!entryId) throw new Error('Journal entry id is required');
  if (!lines || lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  if (!description) {
    throw new Error('Journal entry description is required');
  }

  const existing = await client.query(
    `SELECT id, entry_number, entry_date, description, reference_type, branch_id, is_posted
     FROM journal_entries WHERE id = $1 FOR UPDATE`,
    [entryId],
  );
  if (!existing.rows.length) {
    throw new Error('Journal entry not found');
  }
  const entry = existing.rows[0];
  if (String(entry.description || '').includes('[REVERSED]')) {
    throw new Error('Cannot edit a reversed journal entry');
  }
  if (String(entry.reference_type || '') === 'journal_reversal') {
    throw new Error('Cannot edit a reversal journal entry');
  }
  if (!isEditableJournalReferenceType(entry.reference_type)) {
    throw new Error(
      `Cannot edit ${entry.reference_type || 'system'} journal entries. Reverse them or correct the source document.`,
    );
  }

  const newDate = entryDate || entry.entry_date || new Date().toISOString().split('T')[0];
  await assertPeriodOpenForJournal(client, entry.entry_date);
  await assertPeriodOpenForJournal(client, newDate);

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(
      `Journal entry not balanced: Debit=${totalDebit.toFixed(2)}, Credit=${totalCredit.toFixed(2)}. `
      + `Difference=${Math.abs(totalDebit - totalCredit).toFixed(2)}`,
    );
  }
  if (totalDebit === 0 && totalCredit === 0) {
    throw new Error('Journal entry cannot have zero total');
  }

  const oldLines = await client.query(
    `SELECT account_id, debit_amount, credit_amount
     FROM journal_entry_lines WHERE journal_entry_id = $1`,
    [entryId],
  );
  for (const old of oldLines.rows) {
    const balanceChange = -(Number(old.debit_amount) || 0) + (Number(old.credit_amount) || 0);
    if (balanceChange !== 0) {
      await client.query(
        `UPDATE chart_of_accounts SET
         current_balance = COALESCE(current_balance, 0) + $1,
         updated_at = CURRENT_TIMESTAMP
         WHERE CAST(id AS TEXT) = CAST($2 AS TEXT)
            OR CAST(code AS TEXT) = CAST($2 AS TEXT)`,
        [balanceChange, old.account_id],
      );
    }
  }

  await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`, [entryId]);

  await client.query(
    `UPDATE journal_entries SET
       entry_date = $1,
       description = $2,
       total_debit = $3,
       total_credit = $4,
       is_posted = true,
       posted_at = COALESCE(posted_at, CURRENT_TIMESTAMP),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $5`,
    [newDate, description, totalDebit, totalCredit, entryId],
  );

  for (const line of lines) {
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit === 0 && credit === 0) continue;

    const account = await findAccountByCode(client, line.accountCode);
    if (!account) {
      throw new Error(`Conta contabilística não encontrada: ${line.accountCode}`);
    }

    const acctCode = String(account.code || line.accountCode || '').trim();
    const allowParent =
      params.allowParentEntityAccount === true
      || line.allowParentEntityAccount === true
      || isEditableJournalReferenceType(entry.reference_type);
    if (!allowParent && (acctCode === '321' || acctCode === '311')) {
      throw new Error(
        `Cannot post to parent account ${acctCode}. Use the supplier/customer leaf (e.g. ${acctCode}00001).`,
      );
    }

    const lineEntryDate = newDate || entry.entry_date || new Date().toISOString().split('T')[0];
    try {
      await client.query(
        `INSERT INTO journal_entry_lines
         (id, journal_entry_id, account_id, description, debit_amount, credit_amount, entry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), entryId, account.id, line.description || description, debit, credit, lineEntryDate],
      );
    } catch (e) {
      if (!/entry_date|42703/i.test(String(e.message || e))) throw e;
      await client.query(
        `INSERT INTO journal_entry_lines
         (id, journal_entry_id, account_id, description, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), entryId, account.id, line.description || description, debit, credit],
      );
    }

    const balanceChange = debit - credit;
    await client.query(
      `UPDATE chart_of_accounts SET
       current_balance = COALESCE(current_balance, 0) + $1,
       updated_at = CURRENT_TIMESTAMP
       WHERE CAST(id AS TEXT) = CAST($2 AS TEXT)
          OR CAST(code AS TEXT) = CAST($2 AS TEXT)`,
      [balanceChange, account.id],
    );
  }

  console.log(
    `[ACCOUNTING] Updated ${entry.entry_number} (${entry.reference_type}): D=${totalDebit.toFixed(2)} C=${totalCredit.toFixed(2)}`,
  );

  return {
    id: entryId,
    entry_number: entry.entry_number,
    total_debit: totalDebit,
    total_credit: totalCredit,
    updated: true,
    createdBy: normalizeUuid(createdBy),
  };
}

/**
 * Rebuild chart_of_accounts.current_balance from opening + posted journal lines.
 * Matches journal lines by account id OR account code (legacy rows stored the code
 * in account_id). A strict id-only join left supplier/client leaves at 0 while
 * ledger drill-down still showed movements.
 */
async function normalizeJournalAccountIds(client) {
  // Normalize legacy code-keyed lines to the account UUID when possible.
  try {
    await client.query(`
      UPDATE journal_entry_lines jel
      SET account_id = coa.id
      FROM chart_of_accounts coa
      WHERE CAST(jel.account_id AS TEXT) = CAST(coa.code AS TEXT)
        AND CAST(jel.account_id AS TEXT) <> CAST(coa.id AS TEXT)
    `);
  } catch (e) {
    try {
      await client.query(`
        UPDATE journal_entry_lines
        SET account_id = (
          SELECT coa.id FROM chart_of_accounts coa
          WHERE CAST(coa.code AS TEXT) = CAST(journal_entry_lines.account_id AS TEXT)
          LIMIT 1
        )
        WHERE EXISTS (
          SELECT 1 FROM chart_of_accounts coa
          WHERE CAST(coa.code AS TEXT) = CAST(journal_entry_lines.account_id AS TEXT)
            AND CAST(coa.id AS TEXT) <> CAST(journal_entry_lines.account_id AS TEXT)
        )
      `);
    } catch (e2) {
      console.warn('[ACCOUNTING] journal line account_id normalize skipped:', e2.message || e.message);
    }
  }
}

/**
 * Fast path for CoA page refresh: normalize code→UUID, then aggregate by account_id
 * only (indexed). Avoids the slow OR-join that timed out on city Tailscale.
 */
async function fastRecomputeCoaCurrentBalances(client) {
  // Postgres: is_posted is boolean — never compare to integer 1.
  const postedClause = '(je.is_posted IS DISTINCT FROM false)';
  await normalizeJournalAccountIds(client);

  try {
    // One statement: never zero the whole chart first. A reset+apply window made
    // GET /chart-of-accounts return opening (often 0) while recompute was running,
    // so the UI numbers flashed off and on.
    await client.query(`
      WITH id_net AS (
        SELECT CAST(jel.account_id AS TEXT) AS id,
               SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS net
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
          ON CAST(je.id AS TEXT) = CAST(jel.journal_entry_id AS TEXT)
        WHERE ${postedClause}
        GROUP BY CAST(jel.account_id AS TEXT)
      ),
      code_net AS (
        SELECT CAST(coa_c.id AS TEXT) AS id,
               SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS net
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
          ON CAST(je.id AS TEXT) = CAST(jel.journal_entry_id AS TEXT)
        INNER JOIN chart_of_accounts coa_c
          ON CAST(coa_c.code AS TEXT) = CAST(jel.account_id AS TEXT)
        WHERE ${postedClause}
          AND CAST(coa_c.id AS TEXT) <> CAST(jel.account_id AS TEXT)
        GROUP BY CAST(coa_c.id AS TEXT)
      ),
      nets AS (
        SELECT CAST(coa2.id AS TEXT) AS id,
               COALESCE(i.net, 0) + COALESCE(c.net, 0) AS net
        FROM chart_of_accounts coa2
        LEFT JOIN id_net i ON i.id = CAST(coa2.id AS TEXT)
        LEFT JOIN code_net c ON c.id = CAST(coa2.id AS TEXT)
      )
      UPDATE chart_of_accounts coa
      SET current_balance = COALESCE(coa.opening_balance, 0) + COALESCE(n.net, 0),
          updated_at = CURRENT_TIMESTAMP
      FROM nets n
      WHERE CAST(coa.id AS TEXT) = n.id
    `);
    return { ok: true };
  } catch (e) {
    // SQLite / older shapes: fall back to full recompute.
    console.warn('[ACCOUNTING] fast COA recompute failed, using full recompute:', e.message);
    return recomputeCoaCurrentBalances(client);
  }
}

async function recomputeCoaCurrentBalances(client, accountIds) {
  const ids = Array.isArray(accountIds)
    ? [...new Set(accountIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : null;

  if (ids && ids.length === 0) return { updated: 0 };

  const postedClause = '(je.is_posted IS DISTINCT FROM false)';
  const lineMatchesAccount = `
    CAST(jel.account_id AS TEXT) = CAST(coa2.id AS TEXT)
    OR CAST(jel.account_id AS TEXT) = CAST(coa2.code AS TEXT)
  `;
  const lineMatchesSelf = `
    CAST(jel.account_id AS TEXT) = CAST(chart_of_accounts.id AS TEXT)
    OR CAST(jel.account_id AS TEXT) = CAST(chart_of_accounts.code AS TEXT)
  `;

  await normalizeJournalAccountIds(client);

  if (ids) {
    const r = await client.query(
      `UPDATE chart_of_accounts coa
       SET current_balance = COALESCE(coa.opening_balance, 0) + COALESCE(j.net, 0),
           updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT coa2.id AS id,
                SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS net
         FROM journal_entry_lines jel
         INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
         INNER JOIN chart_of_accounts coa2 ON (${lineMatchesAccount})
         WHERE ${postedClause}
           AND (
             CAST(coa2.id AS TEXT) = ANY($1::text[])
             OR CAST(coa2.code AS TEXT) = ANY($1::text[])
           )
         GROUP BY coa2.id
       ) j
       WHERE CAST(coa.id AS TEXT) = CAST(j.id AS TEXT)`,
      [ids],
    );
    await client.query(
      `UPDATE chart_of_accounts
       SET current_balance = COALESCE(opening_balance, 0),
           updated_at = CURRENT_TIMESTAMP
       WHERE (
           CAST(id AS TEXT) = ANY($1::text[])
           OR CAST(code AS TEXT) = ANY($1::text[])
         )
         AND NOT EXISTS (
           SELECT 1
           FROM journal_entry_lines jel
           INNER JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${postedClause}
           WHERE ${lineMatchesSelf}
         )`,
      [ids],
    );
    return { updated: ids.length, rowCount: r.rowCount || 0 };
  }

  // Full rebuild — works on Postgres (UPDATE…FROM) and SQLite via the same shape when supported.
  try {
    const r = await client.query(
      `UPDATE chart_of_accounts coa
       SET current_balance = COALESCE(coa.opening_balance, 0) + COALESCE(j.net, 0),
           updated_at = CURRENT_TIMESTAMP
       FROM (
         SELECT coa2.id AS id,
                SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS net
         FROM journal_entry_lines jel
         INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
         INNER JOIN chart_of_accounts coa2 ON (${lineMatchesAccount})
         WHERE ${postedClause}
         GROUP BY coa2.id
       ) j
       WHERE CAST(coa.id AS TEXT) = CAST(j.id AS TEXT)`,
    );
    await client.query(
      `UPDATE chart_of_accounts
       SET current_balance = COALESCE(opening_balance, 0),
           updated_at = CURRENT_TIMESTAMP
       WHERE NOT EXISTS (
         SELECT 1
         FROM journal_entry_lines jel
         INNER JOIN journal_entries je ON je.id = jel.journal_entry_id AND ${postedClause}
         WHERE ${lineMatchesSelf}
       )`,
    );
    return { updated: r.rowCount || 0 };
  } catch (e) {
    // SQLite fallback: per-account recompute
    console.warn('[ACCOUNTING] bulk COA recompute failed, using row loop:', e.message);
    const accounts = await client.query(`SELECT id, code, COALESCE(opening_balance, 0) AS opening_balance FROM chart_of_accounts`);
    let updated = 0;
    for (const acc of accounts.rows || []) {
      const netRes = await client.query(
        `SELECT COALESCE(SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)), 0) AS net
         FROM journal_entry_lines jel
         INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE ${postedClause}
           AND (CAST(jel.account_id AS TEXT) = CAST($1 AS TEXT)
                OR CAST(jel.account_id AS TEXT) = CAST($2 AS TEXT))`,
        [acc.id, acc.code],
      );
      const net = Number(netRes.rows?.[0]?.net) || 0;
      await client.query(
        `UPDATE chart_of_accounts
         SET current_balance = $1, updated_at = CURRENT_TIMESTAMP
         WHERE CAST(id AS TEXT) = CAST($2 AS TEXT)`,
        [Number(acc.opening_balance) + net, acc.id],
      );
      updated += 1;
    }
    return { updated };
  }
}

module.exports = {
  createJournalEntry,
  updateJournalEntry,
  isEditableJournalReferenceType,
  findAccountByCode,
  generateSequenceNumber,
  peekSequenceNumber,
  allocateUniqueSaleInvoiceNumber,
  bumpSequenceFromExistingSales,
  isUniqueViolation,
  normalizeUuid,
  normalizeBranchCode,
  normalizeSequenceScope,
  formatSequenceNumber,
  DOCUMENT_SEQUENCE_CONFIG,
  resolveSequenceConfig,
  normalizeJournalAccountIds,
  fastRecomputeCoaCurrentBalances,
  recomputeCoaCurrentBalances,
};
