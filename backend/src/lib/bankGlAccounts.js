/**
 * Link operational bank_accounts rows to chart of accounts (431 / 431xxxx leaves).
 * Uses parent_id (schema), never parent_code.
 */
const crypto = require('crypto');
const { findAccountByCode } = require('../accounting');

const BANK_PARENT_CODE = '431';
/** Prefer a real equity leaf; created under 51 if missing. */
const OPENING_EQUITY_LEAF = '511';
const OPENING_EQUITY_PARENT = '51';
const OPENING_EQUITY_FALLBACK = '561'; // Reservas de reavaliação — legais (non-header)

function cleanName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

async function ensureBankGlColumn(db) {
  try {
    if (db.engine === 'postgres') {
      await db.query(
        `ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS gl_account_code VARCHAR(32) DEFAULT ''`,
      );
    } else if (db.sqlite) {
      try {
        db.sqlite.exec(`ALTER TABLE bank_accounts ADD COLUMN gl_account_code TEXT DEFAULT ''`);
      } catch (_) {
        /* already exists */
      }
    }
  } catch (e) {
    console.warn('[BANK GL] ensure column:', e.message);
  }
}

async function nextBankLeafCode(client) {
  const res = await client.query(
    `SELECT code FROM chart_of_accounts WHERE code LIKE $1 AND is_header = false`,
    [`${BANK_PARENT_CODE}%`],
  );
  const codes = (res.rows || []).map((r) => String(r.code || '').trim());
  let maxSeq = 0;
  for (const code of codes) {
    if (!code.startsWith(BANK_PARENT_CODE) || code === BANK_PARENT_CODE) continue;
    const parsed = Number(code.slice(BANK_PARENT_CODE.length));
    if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed;
  }
  return `${BANK_PARENT_CODE}${String(maxSeq + 1).padStart(4, '0')}`;
}

async function ensureBankLeafAccount(client, bankName, accountNumber) {
  const label = cleanName(
    [bankName, accountNumber].filter(Boolean).join(' — ') || 'Conta bancária',
  );

  const parent = await client.query(
    `SELECT id, level, code FROM chart_of_accounts
     WHERE code = $1 AND is_active = true LIMIT 1`,
    [BANK_PARENT_CODE],
  );
  if (!parent.rows[0]) {
    console.warn('[BANK GL] parent 431 missing — using pooled 431');
    return BANK_PARENT_CODE;
  }
  const parentId = parent.rows[0].id;

  const existing = await client.query(
    `SELECT code FROM chart_of_accounts
     WHERE parent_id = $1 AND is_header = false AND is_active = true
       AND LOWER(TRIM(name)) = LOWER($2)
     LIMIT 1`,
    [parentId, label],
  );
  if (existing.rows[0]?.code) return String(existing.rows[0].code);

  const code = await nextBankLeafCode(client);
  const id = crypto.randomUUID();
  const childLevel = (parseInt(parent.rows[0].level, 10) || 2) + 1;
  try {
    await client.query(
      `INSERT INTO chart_of_accounts (
        id, code, name, account_type, account_nature, level, is_header, parent_id,
        opening_balance, current_balance, is_active, description
      ) VALUES ($1,$2,$3,'asset','debit',$4,false,$5,0,0,true,$6)
      ON CONFLICT (code) DO NOTHING`,
      [
        id,
        code,
        label,
        childLevel,
        parentId,
        `Conta bancária operacional: ${label}`,
      ],
    );
    try {
      await client.query(
        `UPDATE chart_of_accounts SET children_count = (
           SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
         ) WHERE id = $1`,
        [parentId],
      );
    } catch (_) {
      /* children_count optional */
    }
  } catch (e) {
    console.warn('[BANK GL] create leaf:', e.message);
  }

  const created = await findAccountByCode(client, code);
  if (created?.code) return String(created.code);

  const again = await client.query(
    `SELECT code FROM chart_of_accounts
     WHERE parent_id = $1 AND is_header = false AND is_active = true
       AND LOWER(TRIM(name)) = LOWER($2)
     LIMIT 1`,
    [parentId, label],
  );
  return again.rows[0]?.code ? String(again.rows[0].code) : BANK_PARENT_CODE;
}

/** Equity leaf for bank opening balances (never post to header 51). */
async function resolveOpeningEquityAccountCode(client) {
  const preferred = await findAccountByCode(client, OPENING_EQUITY_LEAF);
  const preferredIsHeader = preferred
    && (preferred.is_header === true || preferred.is_header === 1 || preferred.is_header === 't');
  if (preferred && !preferredIsHeader) {
    return OPENING_EQUITY_LEAF;
  }

  const parent = await client.query(
    `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [OPENING_EQUITY_PARENT],
  );
  if (parent.rows[0]) {
    const parentId = parent.rows[0].id;
    const child = await client.query(
      `SELECT code FROM chart_of_accounts
       WHERE parent_id = $1 AND is_header = false AND is_active = true
       ORDER BY code ASC LIMIT 1`,
      [parentId],
    );
    if (child.rows[0]?.code) return String(child.rows[0].code);

    // Create 511 under Capital
    try {
      const id = crypto.randomUUID();
      const childLevel = (parseInt(parent.rows[0].level, 10) || 1) + 1;
      await client.query(
        `INSERT INTO chart_of_accounts (
          id, code, name, account_type, account_nature, level, is_header, parent_id,
          opening_balance, current_balance, is_active, description
        ) VALUES ($1,$2,$3,'equity','credit',$4,false,$5,0,0,true,$6)
        ON CONFLICT (code) DO NOTHING`,
        [
          id,
          OPENING_EQUITY_LEAF,
          'Capital subscrito — saldos de abertura',
          childLevel,
          parentId,
          'Contrapartida de saldos iniciais de bancos/caixa',
        ],
      );
      const created = await findAccountByCode(client, OPENING_EQUITY_LEAF);
      if (created) return OPENING_EQUITY_LEAF;
    } catch (e) {
      console.warn('[BANK GL] ensure equity 511:', e.message);
    }
  }

  const fallback = await findAccountByCode(client, OPENING_EQUITY_FALLBACK);
  if (fallback) return OPENING_EQUITY_FALLBACK;
  return OPENING_EQUITY_FALLBACK;
}

/**
 * Resolve (and optionally create) the GL leaf for a bank account row.
 */
async function resolveBankGlAccountCode(client, bankRow, opts = {}) {
  const existing = String(bankRow?.gl_account_code || bankRow?.glAccountCode || '').trim();
  if (existing) {
    const acc = await findAccountByCode(client, existing);
    if (acc) return existing;
  }
  const code = await ensureBankLeafAccount(
    client,
    bankRow?.bank_name || bankRow?.bankName,
    bankRow?.account_number || bankRow?.accountNumber,
  );
  const bankId = String(bankRow?.id || '').trim();
  if (bankId && opts.persist !== false) {
    try {
      await client.query(
        `UPDATE bank_accounts SET gl_account_code = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [code, bankId],
      );
    } catch (e) {
      console.warn('[BANK GL] persist gl_account_code:', e.message);
    }
  }
  return code;
}

async function resolveBankGlAccountCodeById(client, bankAccountId) {
  const id = String(bankAccountId || '').trim();
  if (!id) return BANK_PARENT_CODE;
  const res = await client.query('SELECT * FROM bank_accounts WHERE id = $1 LIMIT 1', [id]);
  if (!res.rows[0]) return BANK_PARENT_CODE;
  return resolveBankGlAccountCode(client, res.rows[0]);
}

/** Primary (or first active) bank for a branch → GL leaf; else pooled 431. */
async function resolveDefaultBranchBankGl(client, branchId) {
  const bid = String(branchId || '').trim();
  if (!bid) return BANK_PARENT_CODE;
  try {
    const res = await client.query(
      `SELECT * FROM bank_accounts
       WHERE CAST(branch_id AS TEXT) = $1
         AND (is_active = true OR is_active = 1 OR is_active IS NULL)
       ORDER BY is_primary DESC, updated_at DESC, created_at DESC
       LIMIT 1`,
      [bid],
    );
    if (res.rows[0]) return resolveBankGlAccountCode(client, res.rows[0]);
  } catch (e) {
    console.warn('[BANK GL] default branch bank:', e.message);
  }
  return BANK_PARENT_CODE;
}

/**
 * Resolve bank GL for a movement: explicit bankAccountId → that leaf;
 * else primary bank of branch; else 431.
 */
async function resolveBankGlForTreasury(client, { bankAccountId, branchId } = {}) {
  const explicit = String(bankAccountId || '').trim();
  if (explicit) {
    return resolveBankGlAccountCodeById(client, explicit);
  }
  return resolveDefaultBranchBankGl(client, branchId);
}

async function postBankOpeningBalanceJournal(client, {
  bankId,
  branchId,
  glAccountCode,
  openingBalance,
  createdBy,
  bankLabel,
}) {
  const amount = Number(openingBalance) || 0;
  if (amount <= 0) return null;
  const { createJournalEntry } = require('../accounting');
  const equity = await resolveOpeningEquityAccountCode(client);
  return createJournalEntry(client, {
    description: `Saldo inicial banco ${bankLabel || bankId}`,
    referenceType: 'adjustment',
    referenceId: bankId,
    branchId,
    createdBy,
    lines: [
      { accountCode: glAccountCode, description: 'Saldo inicial bancário', debit: amount, credit: 0 },
      { accountCode: equity, description: 'Contrapartida saldo inicial', debit: 0, credit: amount },
    ],
  });
}

module.exports = {
  BANK_PARENT_CODE,
  ensureBankGlColumn,
  resolveBankGlAccountCode,
  resolveBankGlAccountCodeById,
  resolveDefaultBranchBankGl,
  resolveBankGlForTreasury,
  ensureBankLeafAccount,
  resolveOpeningEquityAccountCode,
  postBankOpeningBalanceJournal,
};
