import { useMemo, useCallback } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useProducts } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import type { ProductMeta, SalesPivotContext } from '@/lib/reports/salesPivot';

/**
 * Builds the shared context (product metadata + branch name resolver + i18n
 * labels) consumed by `buildSalesPivot`. Reused by every sales-derived report
 * so the grouping logic stays consistent.
 */
export function useSalesPivotContext(apiBranchId?: string): SalesPivotContext {
  const { t } = useTranslation();
  const { branches, currentBranch } = useBranchScope();
  const { products } = useProducts(apiBranchId);

  const productMeta = useMemo(() => {
    const m = new Map<string, ProductMeta>();
    products.forEach((p) =>
      m.set(p.id, {
        category: p.category || t.salesAnalysisUi.noCategory,
        supplierName: p.supplierName || t.salesAnalysisUi.noSupplier,
        cost: p.avgCost || p.cost || 0,
      }),
    );
    return m;
  }, [products, t.salesAnalysisUi.noCategory, t.salesAnalysisUi.noSupplier]);

  const branchName = useCallback(
    (id: string) => branches.find((b) => b.id === id)?.name || currentBranch?.name || t.common.unknown,
    [branches, currentBranch, t.common.unknown],
  );

  return useMemo(
    () => ({
      productMeta,
      branchName,
      labels: {
        noCategory: t.salesAnalysisUi.noCategory,
        noSupplier: t.salesAnalysisUi.noSupplier,
        finalConsumer: t.reportsUi.finalConsumer,
        unknownUser: t.salesAnalysisUi.unknownUser,
      },
    }),
    [
      productMeta,
      branchName,
      t.salesAnalysisUi.noCategory,
      t.salesAnalysisUi.noSupplier,
      t.reportsUi.finalConsumer,
      t.salesAnalysisUi.unknownUser,
    ],
  );
}
