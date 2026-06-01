import { api } from '@/lib/api/client';
import type { Product } from '@/types/erp';
import {
  applyCanonicalSkuAggregates,
  buildCanonicalSkuAggregates,
  canonicalProductSku,
  type CanonicalSkuAggregates,
} from '@/lib/productDedupe';

const SESSION_KEY = 'nexor:selling-prices:v1';
let hintsCache: { at: number; data: Record<string, number> } | null = null;
const HINTS_TTL_MS = 120_000;

export function readSellingPriceHintsSession(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSellingPriceHintsSession(data: Record<string, number>): void {
  try {
    if (!data || Object.keys(data).length === 0) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

/** Best PVP per SKU from server (all branches, catalog + filial + purchase lines). */
export async function fetchSellingPriceHints(force = false): Promise<Record<string, number>> {
  const now = Date.now();
  if (!force && hintsCache && now - hintsCache.at < HINTS_TTL_MS) {
    return hintsCache.data;
  }

  const session = readSellingPriceHintsSession();
  if (!force && Object.keys(session).length > 0) {
    hintsCache = { at: now, data: session };
    return session;
  }

  try {
    const res = await api.products.sellingPrices();
    if (!res.error && res.data && typeof res.data === 'object') {
      const data = res.data as Record<string, number>;
      hintsCache = { at: now, data };
      writeSellingPriceHintsSession(data);
      return data;
    }
  } catch {
    /* non-blocking */
  }

  if (Object.keys(session).length > 0) return session;
  return hintsCache?.data ?? {};
}

export function invalidateSellingPriceHintsCache(): void {
  hintsCache = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function mergeSellingPriceHintsIntoAggregates(
  aggregates: Map<string, CanonicalSkuAggregates>,
  hints: Record<string, number>,
): Map<string, CanonicalSkuAggregates> {
  for (const [rawSku, rawPrice] of Object.entries(hints)) {
    const key = canonicalProductSku(rawSku).toLowerCase();
    const price = Number(rawPrice) || 0;
    if (!key || price <= 0) continue;
    const cur = aggregates.get(key) || {
      stock: 0,
      price: 0,
      cost: 0,
      firstCost: 0,
      lastCost: 0,
      avgCost: 0,
    };
    cur.price = Math.max(cur.price, price);
    aggregates.set(key, cur);
  }
  return aggregates;
}

export function applySellingPriceHintsToProducts(
  products: Product[],
  hints: Record<string, number>,
): Product[] {
  if (!hints || Object.keys(hints).length === 0) return products;
  const aggregates = mergeSellingPriceHintsIntoAggregates(
    buildCanonicalSkuAggregates(products),
    hints,
  );
  return products.map((p) => {
    const key = canonicalProductSku(p.sku).toLowerCase();
    const agg = key ? aggregates.get(key) : undefined;
    return agg ? applyCanonicalSkuAggregates(p, agg) : p;
  });
}
