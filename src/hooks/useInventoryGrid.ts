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
  // HQ/Sede is always loaded live — never paint a stale/partial cached grid.
  if (consolidated) return null;
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
      const fresh = await fetchInventoryGrid({
        branchId: opts.branchId,
        consolidated: opts.consolidated,
        bypassCache: true,
        filialBranchIds: opts.filialBranchIds,
        noFallback: opts.consolidated,
      });
      if (gen !== generationRef.current) return;
      setRows(fresh);
      setError(null);
      if (!opts.consolidated) {
        const key = cacheKey(opts.branchId, false);
        writeCache(key, fresh);
        saveLanInventoryGrid(key, fresh);
      }
    },
    [opts.branchId, opts.consolidated, opts.filialBranchIds],
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
        if (opts.consolidated) setRows([]);
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

    // Sede/HQ: one live fetch, no cache, no background revalidate that reverts prices.
    if (opts.consolidated) {
      setRows([]);
      setLoading(true);
      void loadLive(gen)
        .catch((err) => {
          console.error('[useInventoryGrid] HQ load failed:', err);
          if (gen === generationRef.current) {
            setRows([]);
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (gen === generationRef.current) setLoading(false);
        });
      return () => {
        generationRef.current++;
      };
    }

    // Filial: warm cache then refresh once.
    const warm = readWarmStartRows(opts.branchId, false);
    if (warm?.length) {
      setRows(warm);
      setLoading(false);
    } else {
      setRows([]);
      setLoading(true);
    }

    void (async () => {
      try {
        if (isInventoryGridCacheFresh(opts.branchId, false, 120_000)) {
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
        if (gen === generationRef.current && !warm?.length) {
          setRows([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (gen === generationRef.current) setLoading(false);
      }
    })();

    return () => {
      generationRef.current++;
    };
  }, [enabled, scopeKey, filialKey, opts.branchId, opts.consolidated, opts.filialBranchIds, loadLive]);

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
        if (!opts.consolidated) {
          writeCache(key, next);
          saveLanInventoryGrid(key, next);
        }
        return next;
      });
    },
    [enabled, opts.branchId, opts.consolidated],
  );

  return { rows, loading, error, refresh, invalidate, patchRow };
}
