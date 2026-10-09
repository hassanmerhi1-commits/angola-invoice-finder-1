import { useState, useMemo } from 'react';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { PieChart, Package, Tags, Users, Truck } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { mergeNetReportSales } from '@/lib/reports/netSales';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import PivotReportView from '@/components/reports/PivotReportView';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import { ReportStatStrip } from '@/components/reports/ReportStatStrip';
import { ReportToolbar } from '@/components/reports/ReportToolbar';
import { ReportTruncationBanner } from '@/components/reports/ReportTruncationBanner';
import { useReportSales } from '@/hooks/useReportSales';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';

export default function ProfitabilityReport({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
} = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const filters = useSharedReportFilters();
  const { dateFrom, dateTo, setDateFrom, setDateTo, branchFilter } = filters;
  const { selectedBranch } = branchFilter;
  const { sales, truncated } = useReportSales();
  const pivotCtx = useSalesPivotContext(filters.apiBranchId);
  const [internalViewTab, setInternalViewTab] = useState('summary');
  const viewTab = view ?? internalViewTab;
  const setViewTab = onViewChange ?? setInternalViewTab;

  const reportBranchId = selectedBranch === 'all' ? undefined : selectedBranch;
  const { creditNotes } = useReportCreditNotes(reportBranchId, { dateFrom, dateTo });

  const filteredSales = useMemo(
    () =>
      mergeNetReportSales(sales, creditNotes, {
        dateFrom,
        dateTo,
        branchId: reportBranchId,
      }),
    [sales, creditNotes, dateFrom, dateTo, reportBranchId],
  );

  const itemPivot = useMemo(() => buildSalesPivot(filteredSales, 'item', pivotCtx), [filteredSales, pivotCtx]);
  const categoryPivot = useMemo(() => buildSalesPivot(filteredSales, 'category', pivotCtx), [filteredSales, pivotCtx]);
  const customerPivot = useMemo(() => buildSalesPivot(filteredSales, 'customer', pivotCtx), [filteredSales, pivotCtx]);
  const supplierPivot = useMemo(() => buildSalesPivot(filteredSales, 'supplier', pivotCtx), [filteredSales, pivotCtx]);

  const summary = useMemo(() => {
    const totalRevenue = itemPivot.totals.base;
    const totalCost = itemPivot.totals.cost;
    const grossProfit = itemPivot.totals.profit;
    const avgMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const profitable = itemPivot.rows.filter((r) => r.profit > 0).length;
    const unprofitable = itemPivot.rows.filter((r) => r.profit < 0).length;
    return { totalRevenue, totalCost, grossProfit, avgMargin, profitable, unprofitable };
  }, [itemPivot]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const periodSuffix = `${dateFrom}_${dateTo}`;
  const periodLabel = `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`;

  const viewOptions: ReportOption[] = [
    { value: 'summary', label: t.salesAnalysisUi.tabSummary, icon: PieChart },
    { value: 'item', label: t.salesAnalysisUi.tabByItem, icon: Package },
    { value: 'category', label: t.salesAnalysisUi.tabByCategory, icon: Tags },
    { value: 'customer', label: t.salesAnalysisUi.tabByCustomer, icon: Users },
    { value: 'supplier', label: t.salesAnalysisUi.tabBySupplier, icon: Truck },
  ];

  return (
    <div className="space-y-3">
      <ReportTruncationBanner truncated={truncated} />
      <ReportToolbar
        title={
          <>
            <PieChart className="w-5 h-5" />
            {t.profitUi.title}
          </>
        }
        description={t.profitUi.description}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        branchFilter={branchFilter}
      />

      <ReportStatStrip
        columns="xl:grid-cols-4"
        items={[
          { label: t.profitUi.totalRevenue, value: formatCurrency(summary.totalRevenue) },
          { label: t.profitUi.totalCost, value: formatCurrency(summary.totalCost), className: 'text-orange-600' },
          {
            label: t.profitUi.grossProfit,
            value: formatCurrency(summary.grossProfit),
            className: summary.grossProfit >= 0 ? 'text-green-600' : 'text-red-600',
          },
          {
            label: t.profitUi.avgMargin,
            value: `${summary.avgMargin.toFixed(1)}%`,
            className: summary.avgMargin >= 20 ? 'text-green-600' : 'text-orange-600',
            hint: `${t.profitUi.profitable.replace('{count}', String(summary.profitable))} · ${t.profitUi.unprofitable.replace('{count}', String(summary.unprofitable))}`,
          },
        ]}
      />

      {/* Sub-report selector */}
      <ReportPicker options={viewOptions} value={viewTab} onChange={setViewTab} />

      <div className="space-y-4">
        {viewTab === 'summary' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.category}
            rows={categoryPivot.rows}
            totals={categoryPivot.totals}
            fileName={`Rentabilidade_Resumo_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'item' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.product}
            rows={itemPivot.rows}
            totals={itemPivot.totals}
            fileName={`Rentabilidade_Item_${periodSuffix}`}
            subtitle={periodLabel}
            enableGrouping
          />
        )}

        {viewTab === 'category' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.category}
            rows={categoryPivot.rows}
            totals={categoryPivot.totals}
            fileName={`Rentabilidade_Categoria_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'customer' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.client}
            rows={customerPivot.rows}
            totals={customerPivot.totals}
            fileName={`Rentabilidade_Cliente_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'supplier' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.supplier}
            rows={supplierPivot.rows}
            totals={supplierPivot.totals}
            fileName={`Rentabilidade_Fornecedor_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}
      </div>
    </div>
  );
}
