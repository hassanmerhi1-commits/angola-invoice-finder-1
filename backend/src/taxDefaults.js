/** Default IVA/VAT rate for new products and document lines when none is specified. */
const DEFAULT_VAT_RATE = 5;
const DEFAULT_TAX_CODE = 'IVA5';

function normalizeTaxRate(value, defaultRate = DEFAULT_VAT_RATE) {
  if (value === null || value === undefined || value === '') return defaultRate;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultRate;
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
  DEFAULT_VAT_RATE,
  DEFAULT_TAX_CODE,
  normalizeTaxRate,
  taxCodeForRate,
};
