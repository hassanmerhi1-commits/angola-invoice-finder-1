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

  await client.query(
    `INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (document_type, fiscal_year, branch_id)
     DO UPDATE SET current_number = GREATEST(document_sequences.current_number, EXCLUDED.current_number)`,
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
async function createJournalEntry(client, params) {
  const {
    description, referenceType, referenceId, branchId,
    createdBy, lines, entryDate
  } = params;

  if (!lines || lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  if (!description) {
    throw new Error('Journal entry description is required');
  }

  const prefixMap = {
    sale: 'VD', purchase: 'CP', purchase_invoice: 'CP', transfer: 'TRF',
    expense: 'DSP', adjustment: 'AJ', receipt: 'REC', payment: 'PAG',
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

  await client.query(
    `INSERT INTO journal_entries 
     (id, entry_number, entry_date, description, reference_type, reference_id, 
      total_debit, total_credit, is_posted, posted_at, branch_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, CURRENT_TIMESTAMP, $9, $10)`,
    [entryId, entryNumber, entryDate || new Date().toISOString().split('T')[0],
      description, referenceType, normalizeOptionalId(referenceId),
      totalDebit, totalCredit, normalizeOptionalId(branchId), normalizeOptionalId(createdBy)]
  );

  for (const line of lines) {
    if ((line.debit || 0) === 0 && (line.credit || 0) === 0) {
      continue;
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

  try {
    const { enqueueJournalPosted } = require('./sync/outbox');
    await enqueueJournalPosted(client, entryId, branchId);
  } catch (_) {
    /* outbox optional during bootstrap */
  }

  return { id: entryId, entry_number: entryNumber, total_debit: totalDebit, total_credit: totalCredit };
}

module.exports = {
  createJournalEntry,
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
};
