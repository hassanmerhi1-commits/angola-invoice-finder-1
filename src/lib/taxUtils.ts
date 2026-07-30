/** Allowed Angola IVA rates for product master data. */
export const ALLOWED_VAT_RATES = [0, 5, 7, 14] as const;

/**
 * @deprecated Do not use for new products — IVA must be chosen explicitly.
 * Kept only as a fallback for legacy document lines that lack a rate.
 */
export const DEFAULT_VAT_RATE = 5;
export const DEFAULT_TAX_CODE = 'IVA5';

/** Parse a rate; returns null when missing/invalid (no silent 5% default). */
export function parseTaxRateOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

export function isAllowedVatRate(value: unknown): boolean {
  const n = parseTaxRateOrNull(value);
  if (n === null) return false;
  return (ALLOWED_VAT_RATES as readonly number[]).includes(Math.round(n));
}

/** Parse product / line IVA rate. Prefer parseTaxRateOrNull for new product creates. */
export function normalizeTaxRate(value: unknown, defaultRate = DEFAULT_VAT_RATE): number {
  const parsed = parseTaxRateOrNull(value);
  if (parsed !== null) return parsed;
  return defaultRate;
}

/** Build a display label such as "IVA (5%)" or plain "IVA" when rates differ. */
export function formatTaxLabel(rates: number[], taxWord = 'IVA'): string {
  const unique = [
    ...new Set(
      rates
        .map((r) => normalizeTaxRate(r, Number.NaN))
        .filter((r) => Number.isFinite(r)),
    ),
  ];
  if (unique.length === 0) return `${taxWord} (${DEFAULT_VAT_RATE}%)`;
  if (unique.length === 1) return `${taxWord} (${unique[0]}%)`;
  return taxWord;
}

export function taxRatesFromSaleItems(items: Array<{ taxRate?: number }>): number[] {
  return items.map((item) => normalizeTaxRate(item.taxRate, Number.NaN)).filter((r) => Number.isFinite(r));
}

export interface TaxBreakdownRow {
  rate: number;
  base: number;
  tax: number;
}

/**
 * AGT requires a per-rate IVA summary on fiscal receipts: for every distinct
 * rate, the taxable base (incidência) and the IVA amount. Groups sale items by
 * their tax rate and aggregates net base and tax.
 */
export function taxBreakdownFromItems(
  items: Array<{ taxRate?: number; subtotal?: number; taxAmount?: number }>,
): TaxBreakdownRow[] {
  const byRate = new Map<number, TaxBreakdownRow>();
  for (const item of items) {
    const rate = normalizeTaxRate(item.taxRate);
    const base = Number(item.subtotal || 0);
    const tax = Number(
      item.taxAmount !== undefined && item.taxAmount !== null
        ? item.taxAmount
        : (base * rate) / 100,
    );
    const row = byRate.get(rate) || { rate, base: 0, tax: 0 };
    row.base += base;
    row.tax += tax;
    byRate.set(rate, row);
  }
  return [...byRate.values()].sort((a, b) => a.rate - b.rate);
}

/** AGT legal exemption reason shown for 0% (exempt) lines. */
export const IVA_EXEMPTION_REASON = 'Isento Artigo 12.º do CIVA';
