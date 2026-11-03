/**
 * Chart template: account structure only.
 * Codes, names, parents, and type. No balances, journals, or documents.
 */

const TEMPLATE_KIND = 'nexor-coa-template';
const TEMPLATE_SCHEMA = 1;
const MAX_ACCOUNTS = 20000;

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
const ACCOUNT_NATURES = new Set(['debit', 'credit']);
const DISPLAY_TABS = new Set([
  'clientes', 'fornecedores', 'caixa', 'bancos',
  'ativos', 'recebimentos', 'custos', 'funcionarios', 'capital',
]);

function cleanCode(value) {
  return String(value || '').trim();
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 255);
}

function normalizeAccount(raw) {
  const code = cleanCode(raw?.code);
  const name = cleanName(raw?.name);
  if (!code || !name) return null;
  if (code.length > 20) return null;
  const accountType = String(raw?.account_type || raw?.accountType || '').trim();
  const accountNature = String(raw?.account_nature || raw?.accountNature || '').trim();
  if (!ACCOUNT_TYPES.has(accountType) || !ACCOUNT_NATURES.has(accountNature)) return null;
  const parentCode = cleanCode(raw?.parent_code || raw?.parentCode || '') || null;
  if (parentCode && parentCode === code) return null;
  const level = Number(raw?.level);
  const tab = String(raw?.display_tab || raw?.displayTab || '').trim();
  return {
    code,
    name,
    description: String(raw?.description || '').trim().slice(0, 2000) || null,
    account_type: accountType,
    account_nature: accountNature,
    level: Number.isFinite(level) && level > 0 ? Math.min(Math.floor(level), 12) : 1,
    is_header: raw?.is_header === true || raw?.is_header === 1 || raw?.isHeader === true,
    parent_code: parentCode,
    display_tab: DISPLAY_TABS.has(tab) ? tab : null,
  };
}

function buildCoaTemplate(rows, exportedAt = new Date().toISOString()) {
  const byCode = new Map();
  for (const row of rows || []) {
    const account = normalizeAccount(row);
    if (!account) continue;
    byCode.set(account.code, account);
  }
  const accounts = [...byCode.values()].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
  return {
    schema: TEMPLATE_SCHEMA,
    kind: TEMPLATE_KIND,
    exportedAt,
    accounts,
  };
}

function parseCoaTemplate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('That file is not a NEXOR chart template');
    error.status = 400;
    throw error;
  }
  if (body.kind !== TEMPLATE_KIND || Number(body.schema) !== TEMPLATE_SCHEMA) {
    const error = new Error('That file is not a NEXOR chart template');
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(body.accounts)) {
    const error = new Error('That file is not a NEXOR chart template');
    error.status = 400;
    throw error;
  }
  if (body.accounts.length > MAX_ACCOUNTS) {
    const error = new Error('Chart template is too large');
    error.status = 400;
    throw error;
  }
  return buildCoaTemplate(body.accounts, body.exportedAt || null).accounts;
}

module.exports = {
  TEMPLATE_KIND,
  TEMPLATE_SCHEMA,
  buildCoaTemplate,
  parseCoaTemplate,
};
