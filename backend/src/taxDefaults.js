/** Allowed Angola IVA rates for product master data. */
const ALLOWED_VAT_RATES = [0, 5, 7, 14];

/**
 * @deprecated Do not use for new products — IVA must be chosen explicitly.
 * Kept only as a fallback for legacy document lines that lack a rate.
 */
const DEFAULT_VAT_RATE = 5;
const DEFAULT_TAX_CODE = 'IVA5';

function parseTaxRateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function isAllowedVatRate(value) {
  const n = parseTaxRateOrNull(value);
  if (n === null) return false;
  return ALLOWED_VAT_RATES.includes(Math.round(n));
}

function normalizeTaxRate(value, defaultRate = DEFAULT_VAT_RATE) {
  const parsed = parseTaxRateOrNull(value);
  if (parsed !== null) return parsed;
  return defaultRate;
}

/** Map percent rate → tax_code label used in product / SAF-T. */
function taxCodeForRate(rate) {
  const r = Math.round(Number(rate));
  if (r === 0) return 'IVA0';
  if (r === 5) return 'IVA5';
  if (r === 7) return 'IVA7';
  if (r === 14) return 'IVA14';
  return `IVA${r}`;
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/**
 * Protect stored IVA from silent 5% clobber (Excel/import/form defaults).
 * Allow overwrite only when the client acknowledges an IVA change (vat_override true
 * or forceVatChange), matching ProductDetailDialog which sets vatOverride on edit.
 */
function shouldPreserveExistingTaxRate(existing, nextRate, opts = {}) {
  const cur = Number(existing?.tax_rate);
  const next = Number(nextRate);
  if (!Number.isFinite(next) || !Number.isFinite(cur)) return false;
  if (Math.abs(cur - next) < 0.0001) return false;
  if (opts.forceVatChange || opts.clientSetsOverride) return false;

  const locked = isTruthyFlag(existing?.vat_override);
  const nextIsDefault = Math.abs(next - Number(DEFAULT_VAT_RATE)) < 0.0001;
  const curNonDefault = Math.abs(cur - Number(DEFAULT_VAT_RATE)) > 0.0001;

  // Never silently replace 14/7/0 (or a locked rate) with default 5%.
  if (nextIsDefault && (locked || curNonDefault)) return true;
  // Locked rate: ignore unacknowledged tax changes of any kind.
  if (locked) return true;
  return false;
}

module.exports = {
  ALLOWED_VAT_RATES,
  DEFAULT_VAT_RATE,
  DEFAULT_TAX_CODE,
  parseTaxRateOrNull,
  isAllowedVatRate,
  normalizeTaxRate,
  taxCodeForRate,
  isTruthyFlag,
  shouldPreserveExistingTaxRate,
};
