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

/** Best available cached rows (session / LAN grid / LAN products) for an instant warm start. */
function readWarmStartRows(branchId: string | undefined, consolidated: boolean): Product[] | null {
  return readOfflineInventoryGridFallback(branchId, consolidated);
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
    // Session only — durable LAN/SQLite caches must survive offline refresh.
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
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
    } catch (err) {
      console.error('[useInventoryGrid] refresh failed:', err);
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

    // Stale-while-revalidate: paint only cache for *this* scope. Never keep the previous
    // branch's rows on screen while Sede (consolidated) or another filial loads — that
    // looked like "Sede Soyo sometimes shows only other branch products" or an empty
    // list when a cold consolidated fetch failed and left the old filial painted.
    const warm = readWarmStartRows(opts.branchId, opts.consolidated);
    if (warm?.length) {
      setRows(warm);
      setLoading(false);
    } else {
      setRows([]);
      setLoading(true);
    }

    void (async () => {
      try {
        // Warm + "fresh" session: paint immediately, then soft-revalidate.
        // Skipping the network entirely left Inventory showing stale cost/price
        // after purchases (catalog warmer / other tabs can leave a fresh-but-wrong cache).
        if (isInventoryGridCacheFresh(opts.branchId, opts.consolidated, 120_000)) {
          const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
          if (cached?.length) {
            if (gen !== generationRef.current) return;
            setRows(cached);
            setLoading(false);
            void (async () => {
              try {
                const soft = await fetchInventoryGrid({
                  branchId: opts.branchId,
                  consolidated: opts.consolidated,
                  bypassCache: true,
                });
                if (gen !== generationRef.current) return;
                setRows(soft);
              } catch {
                /* keep painted cache */
              }
            })();
            return;
          }
        }
        // Soft revalidate: paint warm rows, then force a network round-trip.
        const fresh = await fetchInventoryGrid({
          branchId: opts.branchId,
          consolidated: opts.consolidated,
          bypassCache: true,
        });
        if (gen !== generationRef.current) return;
        setRows(fresh);
      } catch (err) {
        console.error('[useInventoryGrid] load failed:', err);
        if (gen === generationRef.current && !warm?.length) {
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
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
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
