// Shared selling-price helpers used by POS and sales invoices.
// Products carry 4 selling-price levels (price / price2 / price3 / price4).
// A client can declare a default price level (1-4) and a signed % adjustment
// (positive = surcharge, negative = discount) applied automatically.

import type { Product, Client } from '@/types/erp';

export const PRICE_LEVELS = [1, 2, 3, 4] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];

/** Clamp any value to a valid price level (1-4), defaulting to 1. */
export function normalizePriceLevel(value: unknown): PriceLevel {
  const n = Math.trunc(Number(value));
  return (n >= 1 && n <= 4 ? n : 1) as PriceLevel;
}

/**
 * Base ex-VAT price for the requested level. Falls back to price level 1 when the
 * requested level has no value (0/undefined) so a sale never gets a zero price by
 * accident.
 */
export function getPriceForLevel(product: Pick<Product, 'price' | 'price2' | 'price3' | 'price4'>, level: number): number {
  const lvl = normalizePriceLevel(level);
  const byLevel: Record<PriceLevel, number | undefined> = {
    1: product.price,
    2: product.price2,
    3: product.price3,
    4: product.price4,
  };
  const chosen = Number(byLevel[lvl] ?? 0);
  if (chosen > 0) return chosen;
  return Number(product.price ?? 0);
}

/** Apply a signed % adjustment to a price, rounded to 2 decimals. */
export function applyPriceAdjustment(price: number, adjustmentPct: number | undefined): number {
  const pct = Number(adjustmentPct) || 0;
  if (!pct) return Number(price.toFixed(2));
  return Number((price * (1 + pct / 100)).toFixed(2));
}

/** Effective ex-VAT unit price for a product given a price level and client adjustment. */
export function effectiveUnitPrice(
  product: Pick<Product, 'price' | 'price2' | 'price3' | 'price4'>,
  level: number,
  adjustmentPct?: number,
): number {
  return applyPriceAdjustment(getPriceForLevel(product, level), adjustmentPct);
}

/** Resolve the price level + adjustment a client implies (with sensible defaults). */
export function clientPricing(client: Client | null | undefined): { level: PriceLevel; adjustmentPct: number } {
  return {
    level: normalizePriceLevel(client?.defaultPriceLevel ?? 1),
    adjustmentPct: Number(client?.priceAdjustmentPct) || 0,
  };
}
