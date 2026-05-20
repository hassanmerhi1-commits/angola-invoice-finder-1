/** Parse product / line IVA rate; supports 0%, 5%, 7%, 14%, etc. */
export function normalizeTaxRate(value: unknown, defaultRate = 14): number {
  if (value === null || value === undefined || value === '') return defaultRate;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultRate;
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
  if (unique.length === 0) return `${taxWord} (14%)`;
  if (unique.length === 1) return `${taxWord} (${unique[0]}%)`;
  return taxWord;
}

export function taxRatesFromSaleItems(items: Array<{ taxRate?: number }>): number[] {
  return items.map((item) => normalizeTaxRate(item.taxRate, Number.NaN)).filter((r) => Number.isFinite(r));
}
