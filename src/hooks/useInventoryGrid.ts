import { useCallback, useEffect, useRef, useState, startTransition } from 'react';
import { Product } from '@/types/erp';
import {
  fetchInventoryGrid,
  invalidateInventoryGridCache,
  readInventoryGridCache,
} from '@/lib/inventoryGrid';

export function useInventoryGrid(opts: {
  branchId?: string;
  consolidated: boolean;
}) {
  const scopeKey = opts.consolidated ? 'hq' : String(opts.branchId || '').trim();
  const [rows, setRows] = useState<Product[]>(() =>
    readInventoryGridCache(opts.branchId, opts.consolidated) ?? [],
  );
  const [loading, setLoading] = useState(() => rows.length === 0);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
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
  }, [opts.branchId, opts.consolidated, rows.length]);

  useEffect(() => {
    const gen = ++generationRef.current;
    const cached = readInventoryGridCache(opts.branchId, opts.consolidated);
    if (cached?.length) {
      startTransition(() => setRows(cached));
      setLoading(false);
    } else {
      setLoading(true);
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
  }, [scopeKey, opts.branchId, opts.consolidated]);

  const invalidate = useCallback(() => {
    invalidateInventoryGridCache(opts.branchId, opts.consolidated);
  }, [opts.branchId, opts.consolidated]);

  return { rows, loading, refresh, invalidate };
}
