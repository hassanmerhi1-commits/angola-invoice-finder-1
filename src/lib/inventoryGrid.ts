import { Product } from '@/types/erp';
import { api } from '@/lib/api/client';
import { saveLanInventoryGrid, readLanInventoryGrid } from '@/lib/lanCatalogCache';
import { normalizeTaxRate } from '@/lib/taxUtils';
import {
  buildSellingPriceBySku,
  withSellingPriceFromMap,
} from '@/lib/productDedupe';
import { writeSellingPriceHintsSession } from '@/lib/sellingPriceHints';

const CACHE_PREFIX = 'nexor:inventory-grid:v15:';

/** Normalize stock from API row (movement ledger or products.stock). */
export function readProductStock(row: Record<string, unknown> | Product): number {
  const raw =
    row.stock ??
    row.ledger_stock ??
    row.ledgerStock ??
    row.stock_qty ??
    row.stockQty ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
const CACHE_TTL_MS = 300_000;

type CacheEntry = { at: number; rows: Product[] };

export function cacheKey(branchId: string | undefined, consolidated: boolean): string {
  return consolidated ? 'hq' : String(branchId || '').trim() || 'none';
}

function readCacheEntry(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCache(key: string): Product[] | null {
  return readCacheEntry(key)?.rows ?? null;
}

/** Session cache ignoring TTL — used when the server is offline. */
export function readInventoryGridCacheStale(
  branchId: string | undefined,
  consolidated: boolean,
): Product[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + cacheKey(branchId, consolidated));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    return parsed?.rows?.length ? parsed.rows : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, rows: Product[]): void {
  try {
    const entry: CacheEntry = { at: Date.now(), rows };
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}

/** Clear cached grid rows after stock transfers or branch-scoped product changes. */
export function invalidateInventoryGridCacheForBranches(
  branchIds: Array<string | undefined | null>,
): void {
  const seen = new Set<string>();
  for (const id of branchIds) {
    const key = String(id || '').trim();
    if (!key || key === 'all' || seen.has(key)) continue;
    seen.add(key);
    invalidateInventoryGridCache(key, false);
  }
  invalidateInventoryGridCache(undefined, true);
}

export function invalidateInventoryGridCache(branchId?: string, consolidated?: boolean): void {
  try {
    if (branchId != null || consolidated != null) {
      sessionStorage.removeItem(CACHE_PREFIX + cacheKey(branchId, !!consolidated));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('nexor:inventory-grid:')) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Fast row map — grid columns only (no per-row object spread). */
export function mapInventoryGridRows(rows: any[]): Product[] {
  const out: Product[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    out[i] = {
      id: p.id,
      name: p.name ?? '',
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      category: p.category ?? 'GERAL',
      price: Number(p.price) || 0,
      price2: p.price2 != null ? Number(p.price2) : p.price_2 != null ? Number(p.price_2) : undefined,
      price3: p.price3 != null ? Number(p.price3) : p.price_3 != null ? Number(p.price_3) : undefined,
      price4: p.price4 != null ? Number(p.price4) : p.price_4 != null ? Number(p.price_4) : undefined,
      cost: Number(p.cost) || 0,
      firstCost: Number(p.first_cost ?? p.firstCost ?? p.cost) || 0,
      lastCost: Number(p.last_cost ?? p.lastCost ?? p.cost) || 0,
      avgCost: Number(p.avg_cost ?? p.avgCost ?? p.cost) || 0,
      stock: readProductStock(p),
      unit: p.unit ?? 'UN',
      taxRate: normalizeTaxRate(p.tax_rate ?? p.taxRate),
      branchId: p.branch_id ?? p.branchId ?? '',
      supplierId: p.supplier_id ?? p.supplierId,
      supplierName: p.supplier_name ?? p.supplierName ?? '',
      isActive: true,
      createdAt: p.created_at ?? p.createdAt ?? '',
      updatedAt: p.updated_at ?? p.updatedAt ?? '',
    };
  }
  return out;
}

function readOfflineInventoryGridFallback(
  branchId: string | undefined,
  consolidated: boolean,
): Product[] | null {
  const key = cacheKey(branchId, consolidated);
  return (
    readInventoryGridCacheStale(branchId, consolidated)
    || readLanInventoryGrid(key)
    || readCache(key)
  );
}

export async function fetchInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
  /** When true, always hit the network (branch switch). */
  bypassCache?: boolean;
}): Promise<Product[]> {
  const key = cacheKey(opts.branchId, opts.consolidated);
  if (!opts.bypassCache) {
    const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
    if (cached?.length) return cached;
  }
  try {
    const res = await api.products.inventoryGrid({
      branchId: opts.branchId,
      consolidated: opts.consolidated,
    });
    if (res.error) {
      throw new Error(res.error);
    }
    const rawRows = Array.isArray(res.data?.rows)
      ? res.data.rows
      : Array.isArray(res.data)
        ? res.data
        : null;
    if (!rawRows) {
      throw new Error('Failed to load inventory grid');
    }
    const hints = (res.data?.sellingPrices ?? {}) as Record<string, number>;
    if (Object.keys(hints).length > 0) {
      writeSellingPriceHintsSession(hints);
    }
    const mapped = mapInventoryGridRows(rawRows);
    const priceBySku = buildSellingPriceBySku(mapped, hints);
    const priced = mapped.map((row) => withSellingPriceFromMap(row, priceBySku));
    writeCache(key, priced);
    saveLanInventoryGrid(key, priced);
    return priced;
  } catch (err) {
    const stale = readOfflineInventoryGridFallback(opts.branchId, opts.consolidated);
    if (stale?.length) {
      console.warn('[inventoryGrid] Server unreachable — using cached inventory rows');
      return stale;
    }
    throw err;
  }
}

export function readInventoryGridCache(
  branchId: string | undefined,
  consolidated: boolean,
): Product[] | null {
  return readCache(cacheKey(branchId, consolidated));
}

/** True when session cache is still valid — skip network on repeat visits. */
export function isInventoryGridCacheFresh(
  branchId: string | undefined,
  consolidated: boolean,
  maxAgeMs = 60_000,
): boolean {
  const entry = readCacheEntry(cacheKey(branchId, consolidated));
  if (!entry?.rows?.length) return false;
  return Date.now() - entry.at <= maxAgeMs;
}

export async function loadInventoryGridWithCache(opts: {
  branchId?: string;
  consolidated: boolean;
  onStale?: (rows: Product[]) => void;
}): Promise<Product[]> {
  const key = cacheKey(opts.branchId, opts.consolidated);
  const stale = readCache(key);
  if (stale?.length) {
    opts.onStale?.(stale);
  }
  const fresh = await fetchInventoryGrid(opts);
  writeCache(key, fresh);
  return fresh;
}
