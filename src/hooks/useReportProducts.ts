import { useEffect, useMemo, useState } from 'react';
import type { Product } from '@/types/erp';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useInventoryGrid } from '@/hooks/useInventoryGrid';
import { useReportsPeriodOptional } from '@/contexts/ReportsPeriodContext';
import { isConsolidatedBranchScope } from '@/lib/branchAccess';
import { normalizeProductSkuKey } from '@/lib/productDedupe';

/** Resolve a sale / purchase / movement line to its product: exact row id, then canonical SKU. */
export type ReportProductLookup = (
  productId?: string | null,
  sku?: string | null,
) => Product | undefined;

/**
 * Branch the report is scoped to: the Reports bar inside /reports, the top-nav scope elsewhere.
 * `undefined` means all branches (Sede / head office).
 */
export function useReportBranchId(): string | undefined {
  const period = useReportsPeriodOptional();
  const { apiBranchId } = useBranchScope();
  return period ? period.apiBranchId : apiBranchId;
}

/**
 * Products for reports with stock and cost from the movement ledger — the same rows as the
 * Inventory page. `/products?light=1` only carries the cached `products.stock` of rows owned by
 * the branch (0 for catalog rows) and collapses each SKU to one row id at head office, which left
 * Sede stock reports empty and filial sale lines without a cost.
 */
export function useReportProducts(branchId: string | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  const { canSwitchBranch, allBranches, branches, userBranch } = useBranchScope();
  const scopeBranches = allBranches.length > 0 ? allBranches : branches;

  // Until branches load, Sede is not recognised as head office and would load as one warehouse.
  const branchesKnown = !canSwitchBranch || scopeBranches.length > 0;
  const [branchWaitExpired, setBranchWaitExpired] = useState(false);
  useEffect(() => {
    if (branchesKnown) return;
    const timer = setTimeout(() => setBranchWaitExpired(true), 3000);
    return () => clearTimeout(timer);
  }, [branchesKnown]);
  const ready = branchesKnown || branchWaitExpired;

  const consolidated =
    canSwitchBranch && (!branchId || isConsolidatedBranchScope(true, branchId, scopeBranches));
  const gridBranchId = consolidated ? undefined : (branchId || userBranch?.id || undefined);
  const filialBranchIds = useMemo(
    () => scopeBranches.map((b) => b.id).filter(Boolean),
    [scopeBranches],
  );

  const grid = useInventoryGrid({
    branchId: gridBranchId,
    consolidated,
    filialBranchIds,
    enabled: enabled && ready && (consolidated || !!gridBranchId),
  });

  const lookup = useMemo<ReportProductLookup>(() => {
    const byId = new Map<string, Product>();
    const bySku = new Map<string, Product>();
    for (const p of grid.rows) {
      if (p.id) byId.set(String(p.id), p);
      const key = normalizeProductSkuKey(p.sku);
      if (key && !bySku.has(key)) bySku.set(key, p);
    }
    return (productId, sku) => {
      const hit = productId ? byId.get(String(productId)) : undefined;
      if (hit) return hit;
      const key = normalizeProductSkuKey(sku);
      return key ? bySku.get(key) : undefined;
    };
  }, [grid.rows]);

  return {
    products: grid.rows,
    loading: enabled && (grid.loading || !ready),
    error: grid.error,
    refresh: grid.refresh,
    lookup,
    consolidated,
  };
}

/** Weighted average cost when known, else the last cost on the row. */
export function reportUnitCost(p: Pick<Product, 'avgCost' | 'cost'> | undefined): number {
  if (!p) return 0;
  const avg = Number(p.avgCost);
  if (Number.isFinite(avg) && avg > 0) return avg;
  return Number(p.cost) || 0;
}
