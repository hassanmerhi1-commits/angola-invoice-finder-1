import { useCallback, useEffect, useMemo } from 'react';
import { useProducts } from '@/hooks/useERP';
import { useInventoryGrid } from '@/hooks/useInventoryGrid';
import { useBranchScope } from '@/hooks/useBranchScope';
import { normalizeIsMain } from '@/lib/branchAccess';
import { PRODUCTS_CHANGED_EVENT, SALES_CHANGED_EVENT } from '@/lib/storage';
import { Product } from '@/types/erp';
import {
  buildSellingPriceBySku,
  withSellingPriceFromMap,
} from '@/lib/productDedupe';
import { readSellingPriceHintsSession } from '@/lib/sellingPriceHints';
import { invalidateInventoryGridCache } from '@/lib/inventoryGrid';

/**
 * POS — one products list per branch (+ main catalog prices when on a filial).
 * Uses the same inventory-grid API as Inventário so LAN clients see the same rows.
 */
export function usePosProducts() {
  const {
    currentBranch,
    branches,
    listBranchId,
    apiBranchId,
    userBranch,
  } = useBranchScope();

  const branchId =
    currentBranch?.id ||
    listBranchId ||
    apiBranchId ||
    userBranch?.id;

  const mainBranch = useMemo(
    () => branches.find((b) => normalizeIsMain(b.isMain)) ?? branches[0] ?? null,
    [branches],
  );

  const needsCatalogPrices = Boolean(
    branchId && mainBranch?.id && branchId !== mainBranch.id,
  );

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

  const { products: catalogProducts = [], refreshProducts: refreshCatalog } = useProducts(
    mainBranch?.id,
    { light: true, enabled: needsCatalogPrices },
  );

  const products = useMemo(() => {
    const hints = readSellingPriceHintsSession();
    const priceBySku = buildSellingPriceBySku(
      [...branchProducts, ...catalogProducts],
      hints,
    );
    return branchProducts.map((row) => withSellingPriceFromMap(row, priceBySku));
  }, [branchProducts, catalogProducts]);

  useEffect(() => {
    if (!branchId) return;
    invalidateInventoryGridCache(branchId, false);
    void refreshBranch();
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh when warehouse changes

  const refreshProducts = useCallback(async () => {
    await refreshBranch();
    if (needsCatalogPrices) await refreshCatalog();
  }, [refreshBranch, refreshCatalog, needsCatalogPrices]);

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
    currentBranch: currentBranch ?? userBranch,
  };
}
