/**
 * Link operational bank_accounts rows to chart of accounts (431 / 431xxxx leaves).
 */
const crypto = require('crypto');
const { findAccountByCode } = require('../accounting');

const BANK_PARENT_CODE = '431';
const OPENING_EQUITY_CODE = '51'; // Capital — counterpart for bank opening balances

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
    `SELECT code FROM chart_of_accounts WHERE code LIKE $1 ORDER BY code DESC LIMIT 80`,
    [`${BANK_PARENT_CODE}%`],
  );
  let max = Number(`${BANK_PARENT_CODE}0000`);
  for (const row of res.rows || []) {
    const raw = String(row.code || '').trim();
    if (!/^\d+$/.test(raw) || raw === BANK_PARENT_CODE) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = String(max + 1);
  if (!next.startsWith(BANK_PARENT_CODE) || next === BANK_PARENT_CODE) {
    return `${BANK_PARENT_CODE}0001`;
  }
  return next;
}

async function ensureBankLeafAccount(client, bankName, accountNumber) {
  const label = cleanName(
    [bankName, accountNumber].filter(Boolean).join(' — ') || 'Conta bancária',
  );
  const existing = await client.query(
    `SELECT code FROM chart_of_accounts
     WHERE parent_code = $1 AND is_header = false AND is_active = true
       AND LOWER(TRIM(name)) = LOWER($2)
     LIMIT 1`,
    [BANK_PARENT_CODE, label],
  );
  if (existing.rows[0]?.code) return String(existing.rows[0].code);

  const parent = await findAccountByCode(client, BANK_PARENT_CODE);
  if (!parent) return BANK_PARENT_CODE;

  const code = await nextBankLeafCode(client);
  const id = crypto.randomUUID();
  try {
    await client.query(
      `INSERT INTO chart_of_accounts (
        id, code, name, account_type, account_nature, level, is_header, parent_code,
        opening_balance, current_balance, is_active, description
      ) VALUES ($1,$2,$3,'asset','debit',$4,false,$5,0,0,true,$6)`,
      [
        id,
        code,
        label,
        Number(parent.level || 2) + 1,
        BANK_PARENT_CODE,
        `Conta bancária operacional: ${label}`,
      ],
    );
  } catch (e) {
    console.warn('[BANK GL] create leaf:', e.message);
  }
  const created = await findAccountByCode(client, code);
  return created?.code || BANK_PARENT_CODE;
}

/**
 * Resolve (and optionally create) the GL leaf for a bank account row.
 * Persists gl_account_code on the bank_accounts table when db handle is given.
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
  const equity = (await findAccountByCode(client, OPENING_EQUITY_CODE))
    ? OPENING_EQUITY_CODE
    : '51';
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
  ensureBankLeafAccount,
  postBankOpeningBalanceJournal,
};
