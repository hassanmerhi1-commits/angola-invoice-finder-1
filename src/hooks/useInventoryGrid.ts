import { useCallback, useEffect, useRef, useState } from 'react';
import { Product } from '@/types/erp';
import {
  cacheKey,
  fetchInventoryGrid,
  invalidateInventoryGridCache,
  isInventoryGridCacheFresh,
  readInventoryGridCache,
  readInventoryGridCacheStale,
  writeCache,
} from '@/lib/inventoryGrid';
import { saveLanInventoryGrid, readLanInventoryGrid } from '@/lib/lanCatalogCache';
import { canonicalProductSku } from '@/lib/productDedupe';

/** Best available cached rows (session cache, then LAN cache) for an instant warm start. */
function readWarmStartRows(branchId: string | undefined, consolidated: boolean): Product[] | null {
  const stale = readInventoryGridCacheStale(branchId, consolidated);
  if (stale?.length) return stale;
  const lan = readLanInventoryGrid(cacheKey(branchId, consolidated));
  return lan?.length ? lan : null;
}

export function useInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
  /** When false, skips fetch (e.g. optional HQ price reference). */
  enabled?: boolean;
}) {
  const enabled = opts.enabled !== false;
  const scopeKey = opts.consolidated ? 'hq' : String(opts.branchId || '').trim() || 'none';
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(() => enabled);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    invalidateInventoryGridCache(opts.branchId, opts.consolidated);
    const gen = ++generationRef.current;
    setLoading(true);
    try {
      const fresh = await fetchInventoryGrid({
        branchId: opts.branchId,
        consolidated: opts.consolidated,
        bypassCache: true,
      });
      if (gen !== generationRef.current) return;
      setRows(fresh);
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [enabled, opts.branchId, opts.consolidated]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }

    const gen = ++generationRef.current;

    // Stale-while-revalidate: show cached rows for this scope instantly. When switching
    // to a cold scope, keep previous rows visible (avoid a blank 10s loading screen)
    // until the new branch payload arrives.
    const warm = readWarmStartRows(opts.branchId, opts.consolidated);
    if (warm?.length) {
      setRows(warm);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void (async () => {
      try {
        // Reuse fresh session cache on tab revisits / remounts / branch re-select (≤120s).
        if (isInventoryGridCacheFresh(opts.branchId, opts.consolidated, 120_000)) {
          const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
          if (cached?.length) {
            if (gen !== generationRef.current) return;
            setRows(cached);
            setLoading(false);
            return;
          }
        }
        const fresh = await fetchInventoryGrid({
          branchId: opts.branchId,
          consolidated: opts.consolidated,
          bypassCache: false,
        });
        if (gen !== generationRef.current) return;
        setRows(fresh);
      } catch (err) {
        console.error('[useInventoryGrid] load failed:', err);
        if (gen === generationRef.current && !warm?.length) {
          // Keep whatever was on screen from the previous scope if fetch fails.
        }
      } finally {
        if (gen === generationRef.current) setLoading(false);
      }
    })();

    return () => {
      generationRef.current++;
    };
  }, [enabled, scopeKey, opts.branchId, opts.consolidated]);

  const invalidate = useCallback(() => {
    invalidateInventoryGridCache(opts.branchId, opts.consolidated);
  }, [opts.branchId, opts.consolidated]);

  const patchRow = useCallback(
    (product: Product) => {
      if (!enabled) return;
      const key = cacheKey(opts.branchId, opts.consolidated);
      setRows((prev) => {
        const skuKey = canonicalProductSku(product.sku).toLowerCase();
        let idx = prev.findIndex((p) => p.id === product.id);
        if (idx < 0 && skuKey) {
          idx = prev.findIndex(
            (p) => canonicalProductSku(p.sku).toLowerCase() === skuKey,
          );
        }
        const next =
          idx >= 0
            ? prev.map((p, i) => (i === idx ? { ...p, ...product } : p))
            : [product, ...prev];
        writeCache(key, next);
        saveLanInventoryGrid(key, next);
        return next;
      });
    },
    [enabled, opts.branchId, opts.consolidated],
  );

  return { rows, loading, refresh, invalidate, patchRow };
}
