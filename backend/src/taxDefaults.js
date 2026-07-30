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

module.exports = {
  ALLOWED_VAT_RATES,
  DEFAULT_VAT_RATE,
  DEFAULT_TAX_CODE,
  parseTaxRateOrNull,
  isAllowedVatRate,
  normalizeTaxRate,
  taxCodeForRate,
};
