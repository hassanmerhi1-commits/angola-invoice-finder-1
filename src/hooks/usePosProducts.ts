import { useMemo } from 'react';
import { useProducts } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { normalizeIsMain } from '@/lib/branchAccess';
import {
  buildSellingPriceBySku,
  withSellingPriceFromMap,
} from '@/lib/productDedupe';
import { readSellingPriceHintsSession } from '@/lib/sellingPriceHints';

/**
 * POS — one products list per branch (+ main catalog prices when on a filial).
 * No inventory-grid calls (they were blocking SQLite and tripping health checks).
 */
export function usePosProducts() {
  const { currentBranch, branches } = useBranchScope();
  const branchId = currentBranch?.id;

  const mainBranch = useMemo(
    () => branches.find((b) => normalizeIsMain(b.isMain)) ?? branches[0] ?? null,
    [branches],
  );

  const needsCatalogPrices = Boolean(
    branchId && mainBranch?.id && branchId !== mainBranch.id,
  );

  const {
    products: branchProducts = [],
    loading: branchLoading,
    refreshProducts: refreshBranch,
  } = useProducts(branchId, { light: true });

  const { products: catalogProducts = [], refreshProducts: refreshCatalog } = useProducts(
    mainBranch?.id,
    { light: true, enabled: needsCatalogPrices },
  );

  const products = useMemo(() => {
    if (!branchProducts.length) return [];
    const hints = readSellingPriceHintsSession();
    const priceBySku = buildSellingPriceBySku(
      [...branchProducts, ...catalogProducts],
      hints,
    );
    return branchProducts.map((row) => withSellingPriceFromMap(row, priceBySku));
  }, [branchProducts, catalogProducts]);

  const refreshProducts = () => {
    refreshBranch();
    if (needsCatalogPrices) refreshCatalog();
  };

  return {
    products,
    loading: branchLoading,
    refreshProducts,
    currentBranch,
  };
}
