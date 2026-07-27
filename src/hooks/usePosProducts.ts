import { useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useERP';
import { useInventoryGrid } from '@/hooks/useInventoryGrid';
import { useBranchScope } from '@/hooks/useBranchScope';
import { resolveUserBranch } from '@/lib/branchAccess';
import { PRODUCTS_CHANGED_EVENT, SALES_CHANGED_EVENT } from '@/lib/storage';
import { Branch, Product } from '@/types/erp';
import {
  buildSellingPriceBySku,
  withSellingPriceFromMap,
} from '@/lib/productDedupe';
import { readSellingPriceHintsSession } from '@/lib/sellingPriceHints';

function synthesizeBranch(id: string, nameHint?: string): Branch {
  const label = String(nameHint || id).trim() || id;
  return {
    id,
    name: label,
    code: label.slice(0, 8).toUpperCase() || id.slice(0, 8),
    address: '',
    phone: '',
    isMain: false,
    priceLevel: 1,
    createdAt: '',
  };
}

/**
 * POS — one products list per branch.
 * Inventory-grid already returns sellingPrices for filials; no second sede catalog fetch.
 * Caixa branch is auto-resolved (no picker).
 */
export function usePosProducts() {
  const { user } = useAuth();
  const {
    currentBranch,
    branches,
    allBranches,
    listBranchId,
    apiBranchId,
    userBranch,
  } = useBranchScope();

  const catalog = allBranches.length > 0 ? allBranches : branches;

  const resolvedBranch = useMemo((): Branch | null => {
    if (currentBranch) return currentBranch;
    if (userBranch) return userBranch;
    const rawId =
      String(listBranchId || apiBranchId || user?.branchId || '').trim();
    if (!rawId) return null;
    return resolveUserBranch(catalog, rawId) || synthesizeBranch(rawId);
  }, [currentBranch, userBranch, listBranchId, apiBranchId, user?.branchId, catalog]);

  const branchId = resolvedBranch?.id;

  const {
    rows: branchProducts = [],
    loading: branchLoading,
    refresh: refreshBranch,
    patchRow: patchBranchRow,
  } = useInventoryGrid({
    branchId,
    consolidated: false,
    enabled: !!branchId,
  });

  const products = useMemo(() => {
    const hints = readSellingPriceHintsSession();
    const priceBySku = buildSellingPriceBySku(branchProducts, hints);
    return branchProducts.map((row) => withSellingPriceFromMap(row, priceBySku));
  }, [branchProducts]);

  const refreshProducts = useCallback(async () => {
    await refreshBranch();
  }, [refreshBranch]);

  /** Immediate stock/qty update on the grid before the server round-trip. */
  const applySoldQuantities = useCallback(
    (sold: Array<{ product: Product; quantity: number }>) => {
      for (const { product, quantity } of sold) {
        const nextStock = Math.max(0, (Number(product.stock) || 0) - quantity);
        patchBranchRow({ ...product, stock: nextStock });
      }
    },
    [patchBranchRow],
  );

  useEffect(() => {
    const onStockChanged = () => {
      void refreshProducts();
    };
    window.addEventListener(SALES_CHANGED_EVENT, onStockChanged);
    window.addEventListener(PRODUCTS_CHANGED_EVENT, onStockChanged);
    return () => {
      window.removeEventListener(SALES_CHANGED_EVENT, onStockChanged);
      window.removeEventListener(PRODUCTS_CHANGED_EVENT, onStockChanged);
    };
  }, [refreshProducts]);

  return {
    products,
    loading: branchLoading,
    branchId,
    refreshProducts,
    applySoldQuantities,
    currentBranch: resolvedBranch,
  };
}
