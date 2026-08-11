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

/** Rows confirmed by GET /products/:id or a successful save — must win over stale grid refetches. */
function applyPinnedPatches(rows: Product[], pins: Map<string, Product>): Product[] {
  if (pins.size === 0) return rows;
  return rows.map((p) => {
    const skuKey = canonicalProductSku(p.sku).toLowerCase();
    const pin = pins.get(p.id) || (skuKey ? pins.get(skuKey) : undefined);
    return pin ? { ...p, ...pin } : p;
  });
}

function pinProductRow(pins: Map<string, Product>, product: Product): void {
  pins.set(product.id, product);
  const skuKey = canonicalProductSku(product.sku).toLowerCase();
  if (skuKey) pins.set(skuKey, product);
}

export function useInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
  /** When false, skips fetch (e.g. optional HQ price reference). */
  enabled?: boolean;
  /** Branch ids for rebuilding HQ view when consolidated=1 fails. */
  filialBranchIds?: string[];
}) {
  const enabled = opts.enabled !== false;
  const filialKey = (opts.filialBranchIds || []).join(',');
  const scopeKey = opts.consolidated ? 'hq' : String(opts.branchId || '').trim() || 'none';
  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(() => enabled);
  const generationRef = useRef(0);
  const pinnedRowsRef = useRef(new Map<string, Product>());

  const commitRows = useCallback(
    (next: Product[], gen: number) => {
      if (gen !== generationRef.current) return;
      const merged = applyPinnedPatches(next, pinnedRowsRef.current);
      setRows(merged);
      writeCache(cacheKey(opts.branchId, opts.consolidated), merged);
      saveLanInventoryGrid(cacheKey(opts.branchId, opts.consolidated), merged);
    },
    [opts.branchId, opts.consolidated],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    pinnedRowsRef.current.clear();
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
    const gen = ++generationRef.current;
    setLoading(true);
    try {
      const fresh = await fetchInventoryGrid({
        branchId: opts.branchId,
        consolidated: opts.consolidated,
        bypassCache: true,
        filialBranchIds: opts.filialBranchIds,
      });
      commitRows(fresh, gen);
    } catch (err) {
      console.error('[useInventoryGrid] refresh failed:', err);
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [enabled, opts.branchId, opts.consolidated, opts.filialBranchIds, commitRows]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      return;
    }

    const gen = ++generationRef.current;
    pinnedRowsRef.current.clear();

    const warm = readWarmStartRows(opts.branchId, opts.consolidated);
    if (warm?.length) {
      setRows(applyPinnedPatches(warm, pinnedRowsRef.current));
      setLoading(false);
    } else {
      setRows([]);
      setLoading(true);
    }

    void (async () => {
      try {
        if (isInventoryGridCacheFresh(opts.branchId, opts.consolidated, 120_000)) {
          const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
          if (cached?.length) {
            if (gen !== generationRef.current) return;
            commitRows(cached, gen);
            setLoading(false);
            void (async () => {
              try {
                const prevCount = cached.length;
                const soft = await fetchInventoryGrid({
                  branchId: opts.branchId,
                  consolidated: opts.consolidated,
                  bypassCache: true,
                  filialBranchIds: opts.filialBranchIds,
                });
                if (gen !== generationRef.current) return;
                if (
                  opts.consolidated
                  && prevCount > 80
                  && soft.length < prevCount * 0.85
                ) {
                  console.warn(
                    '[useInventoryGrid] ignoring suspicious HQ shrink',
                    prevCount,
                    '->',
                    soft.length,
                  );
                  return;
                }
                commitRows(soft, gen);
              } catch {
                /* keep painted cache */
              }
            })();
            return;
          }
        }
        const fresh = await fetchInventoryGrid({
          branchId: opts.branchId,
          consolidated: opts.consolidated,
          bypassCache: true,
          filialBranchIds: opts.filialBranchIds,
        });
        commitRows(fresh, gen);
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
  }, [enabled, scopeKey, filialKey, opts.branchId, opts.consolidated, opts.filialBranchIds, commitRows]);

  const invalidate = useCallback(() => {
    invalidateInventoryGridSessionCache(opts.branchId, opts.consolidated);
  }, [opts.branchId, opts.consolidated]);

  const patchRow = useCallback(
    (product: Product) => {
      if (!enabled) return;
      // Cancel any in-flight soft refresh that would overwrite this confirmed row.
      generationRef.current++;
      pinProductRow(pinnedRowsRef.current, product);
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
