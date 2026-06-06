import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import { Product } from '@/types/erp';
import {
  cacheKey,
  fetchInventoryGrid,
  invalidateInventoryGridCache,
  isInventoryGridCacheFresh,
  readInventoryGridCache,
  writeCache,
} from '@/lib/inventoryGrid';
import { canonicalProductSku } from '@/lib/productDedupe';

export function useInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
  /** When false, skips fetch (e.g. optional HQ price reference). */
  enabled?: boolean;
}) {
  const enabled = opts.enabled !== false;
  const scopeKey = opts.consolidated ? 'hq' : String(opts.branchId || '').trim();
  const [rows, setRows] = useState<Product[]>(() =>
    enabled ? (readInventoryGridCache(opts.branchId, opts.consolidated) ?? []) : [],
  );
  const [loading, setLoading] = useState(() => enabled && rows.length === 0);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    invalidateInventoryGridCache(opts.branchId, opts.consolidated);
    const gen = ++generationRef.current;
    if (rows.length === 0) setLoading(true);
    try {
      const fresh = await fetchInventoryGrid({
        branchId: opts.branchId,
        consolidated: opts.consolidated,
      });
      if (gen !== generationRef.current) return;
      startTransition(() => setRows(fresh));
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [enabled, opts.branchId, opts.consolidated, rows.length]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    const gen = ++generationRef.current;
    const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
    if (cached?.length) {
      startTransition(() => setRows(cached));
      setLoading(false);
    } else {
      setLoading(true);
    }

    const cacheFresh = isInventoryGridCacheFresh(opts.branchId, opts.consolidated);
    if (cacheFresh) {
      return () => {
        generationRef.current++;
      };
    }

    void (async () => {
      try {
        const fresh = await fetchInventoryGrid({
          branchId: opts.branchId,
          consolidated: opts.consolidated,
        });
        if (gen !== generationRef.current) return;
        startTransition(() => setRows(fresh));
      } catch (err) {
        console.error('[useInventoryGrid] load failed:', err);
        if (gen === generationRef.current && !cached?.length) {
          setRows([]);
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
        return next;
      });
    },
    [enabled, opts.branchId, opts.consolidated],
  );

  return { rows, loading, refresh, invalidate, patchRow };
}
