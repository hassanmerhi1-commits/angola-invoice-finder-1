/**
 * Per-city sales and purchase accounts, and the revenue/settlement
 * accounts already used on a sale. Cash tills are resolved separately.
 */
const DEFAULT_SALES_ACCOUNT = '613';
const DEFAULT_PURCHASE_ACCOUNT = '212';
const VAT_LIQUIDATED = '3452';
const COGS_ACCOUNT = '711';
const STOCK_ACCOUNT = '261';

function isHeaderFlag(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function isActiveFlag(value) {
  return value !== false && value !== 0 && value !== '0' && value !== 'f' && value !== 'false';
}

function cleanCode(value) {
  return String(value || '').trim();
}

function leafError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function accountMatchesKind(row, kind) {
  const code = cleanCode(row.code);
  if (kind === 'revenue') return row.account_type === 'revenue';
  if (kind === 'purchase') return row.account_type === 'expense' || row.account_type === 'asset';
  if (kind === 'cash') return code.startsWith('45') && code !== '45';
  return false;
}

/**
 * Empty code clears the link. A real code must be an active leaf of the right kind.
 * @returns {Promise<string>} stored code, or '' when cleared
 */
async function requireLeafAccount(db, code, kind) {
  const cleaned = cleanCode(code);
  if (!cleaned) return '';
  const result = await db.query(
    `SELECT code, account_type, is_header, is_active
     FROM chart_of_accounts WHERE code = $1 LIMIT 1`,
    [cleaned],
  );
  const row = result.rows?.[0];
  if (!row || !isActiveFlag(row.is_active)) {
    throw leafError(`Conta ${cleaned} não está no plano.`);
  }
  if (isHeaderFlag(row.is_header)) {
    throw leafError(`Conta ${cleaned} é um grupo. Escolha uma conta por baixo dela.`);
  }
  if (!accountMatchesKind(row, kind)) {
    if (kind === 'revenue') throw leafError(`Conta ${cleaned} não é uma conta de vendas.`);
    if (kind === 'purchase') throw leafError(`Conta ${cleaned} não é uma conta de compras.`);
    throw leafError(`Conta ${cleaned} não é uma conta de caixa.`);
  }
  return cleanCode(row.code);
}

async function readBranchColumn(client, branchId, column) {
  const id = cleanCode(branchId);
  if (!id) return '';
  try {
    const result = await client.query(
      `SELECT ${column} AS code FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1`,
      [id],
    );
    return cleanCode(result.rows?.[0]?.code);
  } catch (err) {
    console.warn(`[posting] ${column}:`, err.message);
    return '';
  }
}

async function storedLeafOrEmpty(client, code, kind) {
  const cleaned = cleanCode(code);
  if (!cleaned) return '';
  try {
    return await requireLeafAccount(client, cleaned, kind);
  } catch (_) {
    return '';
  }
}

async function resolveBranchSalesAccountCode(client, branchId) {
  const stored = await readBranchColumn(client, branchId, 'sales_account_code');
  const leaf = await storedLeafOrEmpty(client, stored, 'revenue');
  return leaf || DEFAULT_SALES_ACCOUNT;
}

async function resolveBranchPurchaseAccountCode(client, branchId) {
  const stored = await readBranchColumn(client, branchId, 'purchase_account_code');
  const leaf = await storedLeafOrEmpty(client, stored, 'purchase');
  return leaf || DEFAULT_PURCHASE_ACCOUNT;
}

async function postedSaleLines(client, saleId) {
  const id = cleanCode(saleId);
  if (!id) return [];
  try {
    const result = await client.query(
      `SELECT coa.code AS code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE je.reference_type = 'sale' AND je.reference_id = $1`,
      [id],
    );
    return result.rows || [];
  } catch (err) {
    console.warn('[posting] sale journal:', err.message);
    return [];
  }
}

function pickPostedRevenueCode(rows) {
  const credits = (rows || [])
    .filter((row) => Number(row.credit_amount) > 0 && cleanCode(row.code) !== VAT_LIQUIDATED)
    .sort((a, b) => Number(b.credit_amount) - Number(a.credit_amount));
  return cleanCode(credits[0]?.code);
}

function pickPostedSettlementCode(rows) {
  const skip = new Set([COGS_ACCOUNT, STOCK_ACCOUNT, VAT_LIQUIDATED]);
  const debits = (rows || [])
    .filter((row) => Number(row.debit_amount) > 0 && !skip.has(cleanCode(row.code)))
    .sort((a, b) => Number(b.debit_amount) - Number(a.debit_amount));
  return cleanCode(debits[0]?.code);
}

async function postedSaleRevenueAccount(client, saleId) {
  return pickPostedRevenueCode(await postedSaleLines(client, saleId));
}

async function postedSaleSettlementAccount(client, saleId) {
  return pickPostedSettlementCode(await postedSaleLines(client, saleId));
}

/** Revenue account for a new sale, or the account the original sale already used. */
async function resolveRevenueAccountForDocument(client, { saleId, branchId } = {}) {
  const posted = await postedSaleRevenueAccount(client, saleId);
  if (posted) return posted;
  return resolveBranchSalesAccountCode(client, branchId);
}

module.exports = {
  DEFAULT_SALES_ACCOUNT,
  DEFAULT_PURCHASE_ACCOUNT,
  requireLeafAccount,
  resolveBranchSalesAccountCode,
  resolveBranchPurchaseAccountCode,
  postedSaleRevenueAccount,
  postedSaleSettlementAccount,
  resolveRevenueAccountForDocument,
  pickPostedRevenueCode,
  pickPostedSettlementCode,
};
