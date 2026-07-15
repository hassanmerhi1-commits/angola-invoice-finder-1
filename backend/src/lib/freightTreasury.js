/**
 * Resolve FC freight payment source to GL accounts and update caixa registers.
 */
const { resolveBranchCaixaGlAccountCode } = require('./resolveBranchCaixaGlAccount');

const BANK_GL = '431';

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pick(inv, ...keys) {
  for (const key of keys) {
    const v = inv?.[key];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

/**
 * @param {object} client
 * @param {object} inv - purchase invoice (camelCase or snake)
 */
async function resolveFreightTreasuryGl(client, inv) {
  const paymentSource = String(
    pick(inv, 'freightPaymentSource', 'freight_payment_source') || 'caixa',
  ).trim().toLowerCase();
  const caixaId = String(pick(inv, 'freightCaixaId', 'freight_caixa_id') || '').trim();
  const bankAccountId = String(pick(inv, 'freightBankAccountId', 'freight_bank_account_id') || '').trim();
  const legacyCode = String(pick(inv, 'freightSourceAccount', 'freight_source_account') || '').trim();
  const legacyName = String(pick(inv, 'freightSourceName', 'freight_source_name') || '').trim();
  const branchId = String(pick(inv, 'branchId', 'branch_id', 'warehouseId', 'warehouse_id') || '').trim();

  if (paymentSource === 'bank') {
    return {
      paymentSource: 'bank',
      accountCode: BANK_GL,
      accountName: legacyName || (bankAccountId ? `Banco (${bankAccountId})` : 'Banco'),
      caixaId: null,
      bankAccountId: bankAccountId || null,
      treasuryBranchId: branchId || null,
    };
  }

  if (caixaId) {
    const cxRes = await client.query(
      'SELECT id, branch_id, branch_name, name FROM caixas WHERE id = $1 LIMIT 1',
      [caixaId],
    );
    const cx = cxRes.rows[0];
    const cxBranch = cx?.branch_id ? String(cx.branch_id) : branchId;
    const glCode = await resolveBranchCaixaGlAccountCode(client, { branchId: cxBranch });
    const label = [cx?.branch_name, cx?.name].filter(Boolean).join(' — ') || cx?.name || 'Caixa';
    return {
      paymentSource: 'caixa',
      accountCode: glCode,
      accountName: label,
      caixaId,
      bankAccountId: null,
      treasuryBranchId: cxBranch || null,
    };
  }

  if (legacyCode) {
    return {
      paymentSource: paymentSource || 'caixa',
      accountCode: legacyCode,
      accountName: legacyName || legacyCode,
      caixaId: null,
      bankAccountId: null,
      treasuryBranchId: branchId || null,
    };
  }

  const fallbackGl = await resolveBranchCaixaGlAccountCode(client, { branchId });
  return {
    paymentSource: 'caixa',
    accountCode: fallbackGl,
    accountName: legacyName || 'Caixa',
    caixaId: null,
    bankAccountId: null,
    treasuryBranchId: branchId || null,
  };
}

function landingCostsFromInvoice(inv) {
  return roundMoney(
    Number(pick(inv, 'freightCost', 'freight_cost') || 0)
    + Number(pick(inv, 'freightOtherCosts', 'freight_other_costs') || 0),
  );
}

/**
 * Patch journal lines so freight credit uses resolved treasury GL.
 */
function isFreightTreasuryCreditLine(line) {
  const ac = String(line.accountCode || line.account_code || '').trim();
  const credit = roundMoney(line.credit || 0);
  const debit = roundMoney(line.debit || 0);
  if (credit <= 0 || debit > 0) return false;
  if (ac === '752' || /^321/.test(ac) || /^345/.test(ac) || ac === '343' || ac === '349') return false;
  const note = String(line.note || line.description || '').toLowerCase();
  return note.includes('frete') || note.includes('freight') || /^45/.test(ac) || ac === '431' || ac === '451';
}

function applyFreightTreasuryToJournalLines(journalLines, treasury) {
  const landing = roundMoney(
    (journalLines || [])
      .filter((l) => String(l.accountCode || l.account_code || '').trim() === '752')
      .reduce((s, l) => s + Number(l.debit || 0), 0),
  );
  if (landing <= 0 || !treasury?.accountCode) return journalLines || [];

  const code = String(treasury.accountCode).trim();
  const name = String(treasury.accountName || code).trim();
  let patchedFreightCredit = false;

  const mapped = (journalLines || []).map((line) => {
    if (!patchedFreightCredit && isFreightTreasuryCreditLine(line)
      && roundMoney(line.credit || 0) === landing) {
      patchedFreightCredit = true;
      return {
        ...line,
        accountCode: code,
        account_code: code,
        accountName: name,
        account_name: name,
      };
    }
    return line;
  });

  return mapped;
}

async function applyCaixaRegisterDelta(client, caixaId, delta) {
  const id = String(caixaId || '').trim();
  const amt = roundMoney(delta);
  if (!id || !Number.isFinite(amt) || Math.abs(amt) < 0.001) return;
  await client.query(
    `UPDATE caixas
     SET current_balance = COALESCE(current_balance, 0) + $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [amt, id],
  );
}

/**
 * Sync operational caixa after journal (repost reverses prior caixa out first).
 */
async function syncFreightCaixaRegister(client, inv, prior = {}) {
  const landing = landingCostsFromInvoice(inv);
  const treasury = await resolveFreightTreasuryGl(client, inv);
  const priorCaixaId = String(prior.caixaId || '').trim();
  const priorAmount = roundMoney(prior.landingCosts || 0);

  if (priorCaixaId && priorAmount > 0) {
    await applyCaixaRegisterDelta(client, priorCaixaId, priorAmount);
  }

  if (treasury.paymentSource === 'caixa' && treasury.caixaId && landing > 0) {
    await applyCaixaRegisterDelta(client, treasury.caixaId, -landing);
  }
}

async function readPriorFreightCaixaState(client, invoiceId) {
  const invRes = await client.query(
    `SELECT freight_cost, freight_other_costs, freight_payment_source,
            freight_caixa_id, freight_bank_account_id
     FROM purchase_invoices WHERE id = $1 LIMIT 1`,
    [invoiceId],
  );
  const row = invRes.rows[0];
  if (!row) return { landingCosts: 0, caixaId: null };

  return {
    landingCosts: roundMoney(Number(row.freight_cost || 0) + Number(row.freight_other_costs || 0)),
    caixaId: String(row.freight_caixa_id || '').trim() || null,
    paymentSource: String(row.freight_payment_source || 'caixa').toLowerCase(),
  };
}

module.exports = {
  BANK_GL,
  roundMoney,
  landingCostsFromInvoice,
  resolveFreightTreasuryGl,
  applyFreightTreasuryToJournalLines,
  applyCaixaRegisterDelta,
  syncFreightCaixaRegister,
  readPriorFreightCaixaState,
};
