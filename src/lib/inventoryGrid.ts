import { Product } from '@/types/erp';
import { api } from '@/lib/api/client';
import { normalizeTaxRate } from '@/lib/taxUtils';

const CACHE_PREFIX = 'nexor:inventory-grid:v9:';

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
const CACHE_TTL_MS = 120_000;

type CacheEntry = { at: number; rows: Product[] };

export function cacheKey(branchId: string | undefined, consolidated: boolean): string {
  return consolidated ? 'hq' : String(branchId || '').trim() || 'none';
}

function readCache(key: string): Product[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.rows;
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

export async function fetchInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
}): Promise<Product[]> {
  const res = await api.products.inventoryGrid({
    branchId: opts.branchId,
    consolidated: opts.consolidated,
  });
  if (res.error) {
    throw new Error(res.error);
  }
  if (!Array.isArray(res.data?.rows)) {
    throw new Error('Failed to load inventory grid');
  }
  const mapped = mapInventoryGridRows(res.data.rows);
  writeCache(cacheKey(opts.branchId, opts.consolidated), mapped);
  return mapped;
}

export function readInventoryGridCache(
  branchId: string | undefined,
  consolidated: boolean,
): Product[] | null {
  return readCache(cacheKey(branchId, consolidated));
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
