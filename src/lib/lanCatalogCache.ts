import { Product, Supplier } from '@/types/erp';
import { isThinClientMode } from '@/lib/api/config';

const PRODUCTS_PREFIX = 'nexor:lan-products:v1:';
const CLIENTS_KEY = 'nexor:lan-clients:v1';
const SUPPLIERS_KEY = 'nexor:lan-suppliers:v1';
const GRID_PREFIX = 'nexor:lan-inventory-grid:v3:';

type CacheEntry<T> = { at: number; data: T };

function readEntry<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeEntry<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}

export function lanCatalogScopeKey(branchId?: string, consolidated?: boolean): string {
  if (consolidated) return 'hq';
  return String(branchId || '').trim() || 'all';
}

export function isLanCatalogCacheEnabled(): boolean {
  return typeof window !== 'undefined' && isThinClientMode();
}

export function saveLanProducts(scopeKey: string, products: Product[]): void {
  if (!isLanCatalogCacheEnabled() || !scopeKey || !products.length) return;
  writeEntry(`${PRODUCTS_PREFIX}${scopeKey}`, products);
}

export function readLanProducts(scopeKey: string): Product[] | null {
  if (!scopeKey) return null;
  const data = readEntry<Product[]>(`${PRODUCTS_PREFIX}${scopeKey}`);
  return Array.isArray(data) && data.length > 0 ? data : null;
}

export function saveLanClients(clients: Array<Record<string, unknown>>): void {
  if (!isLanCatalogCacheEnabled() || !clients.length) return;
  writeEntry(CLIENTS_KEY, clients);
}

export function readLanClients(): Array<Record<string, unknown>> | null {
  const data = readEntry<Array<Record<string, unknown>>>(CLIENTS_KEY);
  return Array.isArray(data) && data.length > 0 ? data : null;
}

export function saveLanSuppliers(suppliers: Supplier[]): void {
  if (!isLanCatalogCacheEnabled() || !suppliers.length) return;
  writeEntry(SUPPLIERS_KEY, suppliers);
}

export function readLanSuppliers(): Supplier[] | null {
  const data = readEntry<Supplier[]>(SUPPLIERS_KEY);
  return Array.isArray(data) && data.length > 0 ? data : null;
}

export function saveLanInventoryGrid(scopeKey: string, rows: Product[]): void {
  if (!isLanCatalogCacheEnabled() || !scopeKey || !rows.length) return;
  writeEntry(`${GRID_PREFIX}${scopeKey}`, rows);
}

export function readLanInventoryGrid(scopeKey: string): Product[] | null {
  if (!scopeKey) return null;
  const data = readEntry<Product[]>(`${GRID_PREFIX}${scopeKey}`);
  return Array.isArray(data) && data.length > 0 ? data : null;
}

/** Drop LAN inventory grid cache for one scope, or all grid scopes when omitted. */
export function invalidateLanInventoryGrid(scopeKey?: string): void {
  try {
    if (scopeKey) {
      localStorage.removeItem(`${GRID_PREFIX}${scopeKey}`);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(GRID_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Drop LAN product list caches (all scopes or one). */
export function invalidateLanProducts(scopeKey?: string): void {
  try {
    if (scopeKey) {
      localStorage.removeItem(`${PRODUCTS_PREFIX}${scopeKey}`);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PRODUCTS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
