import { useCallback, useEffect, useRef, useState } from 'react';
import { Product } from '@/types/erp';
import {
  cacheKey,
  fetchInventoryGrid,
  invalidateInventoryGridSessionCache,
  isInventoryGridCacheFresh,
  readInventoryGridCache,
  readOfflineInventoryGridFallback,
  writeCache,
} from '@/lib/inventoryGrid';
import { saveLanInventoryGrid } from '@/lib/lanCatalogCache';
import { canonicalProductSku } from '@/lib/productDedupe';

function readWarmStartRows(branchId: string | undefined, consolidated: boolean): Product[] | null {
  return readOfflineInventoryGridFallback(branchId, consolidated);
}

export function useInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
  enabled?: boolean;
  filialBranchIds?: string[];
}) {
  const enabled = opts.enabled !== false;
  const filialKey = (opts.filialBranchIds || []).join(',');
  const scopeKey = opts.consolidated ? 'hq' : String(opts.branchId || '').trim() || 'none';
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(() => enabled);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const loadLive = useCallback(
    async (gen: number) => {
      const filialBranchIds = filialKey ? filialKey.split(',').filter(Boolean) : [];
      const fresh = await fetchInventoryGrid({
        branchId: opts.branchId,
        consolidated: opts.consolidated,
        bypassCache: true,
        filialBranchIds,
        // Always allow stale/filial-merge fallback so Sede never sits on a blank spinner.
        noFallback: false,
      });
      if (gen !== generationRef.current) return;
      setRows(fresh);
      setError(null);
      const key = cacheKey(opts.branchId, opts.consolidated);
      writeCache(key, fresh);
      saveLanInventoryGrid(key, fresh);
    },
    [opts.branchId, opts.consolidated, filialKey],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
    const gen = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      await loadLive(gen);
    } catch (err) {
      console.error('[useInventoryGrid] refresh failed:', err);
      if (gen === generationRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        // Keep whatever rows we already have — do not blank Sede on failure.
      }
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [enabled, opts.branchId, opts.consolidated, loadLive]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    const gen = ++generationRef.current;
    setError(null);

    const warm = readWarmStartRows(opts.branchId, opts.consolidated);
    if (warm?.length) {
      setRows(warm);
      setLoading(false);
    } else {
      // Keep previous rows visible on branch/HQ switch while live data loads.
      setLoading(true);
    }

    void (async () => {
      try {
        if (!opts.consolidated && isInventoryGridCacheFresh(opts.branchId, false, 120_000)) {
          const cached = readInventoryGridCache(opts.branchId, false);
          if (cached?.length) {
            if (gen !== generationRef.current) return;
            setRows(cached);
            setLoading(false);
          }
        }
        await loadLive(gen);
      } catch (err) {
        console.error('[useInventoryGrid] load failed:', err);
        if (gen === generationRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          if (!warm?.length) {
            // Only clear when we had nothing to show.
            setRows((prev) => (prev.length > 0 ? prev : []));
          }
        }
      } finally {
        if (gen === generationRef.current) setLoading(false);
      }
    })();

    return () => {
      // Invalidate in-flight work for this scope only. Next effect run owns loading.
      generationRef.current++;
    };
  }, [enabled, scopeKey, filialKey, opts.branchId, opts.consolidated, loadLive]);

  const invalidate = useCallback(() => {
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
  }, [opts.branchId, opts.consolidated]);

  const patchRow = useCallback(
    (product: Product) => {
      if (!enabled) return;
      generationRef.current++;
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

  return { rows, loading, error, refresh, invalidate, patchRow };
}
