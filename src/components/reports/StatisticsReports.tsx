import { useMemo, useState } from 'react';
import { Trophy, Users, Package, Truck, User } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { mergeNetReportSales } from '@/lib/reports/netSales';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import PivotReportView from '@/components/reports/PivotReportView';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import { ReportToolbar } from '@/components/reports/ReportToolbar';
import { ReportTruncationBanner } from '@/components/reports/ReportTruncationBanner';
import { useReportSales } from '@/hooks/useReportSales';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';

export default function StatisticsReports({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const filters = useSharedReportFilters();
  const { dateFrom, dateTo, setDateFrom, setDateTo, branchFilter } = filters;
  const { selectedBranch } = branchFilter;
  const { sales, truncated } = useReportSales();
  const pivotCtx = useSalesPivotContext(filters.apiBranchId);

  const [internalTab, setInternalTab] = useState('top-customers');
  const tab = view ?? internalTab;
  const setTab = onViewChange ?? setInternalTab;

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

  const customerPivot = useMemo(() => buildSalesPivot(filteredSales, 'customer', pivotCtx), [filteredSales, pivotCtx]);
  const productPivot = useMemo(() => buildSalesPivot(filteredSales, 'item', pivotCtx), [filteredSales, pivotCtx]);
  const supplierPivot = useMemo(() => buildSalesPivot(filteredSales, 'supplier', pivotCtx), [filteredSales, pivotCtx]);
  const userPivot = useMemo(() => buildSalesPivot(filteredSales, 'user', pivotCtx), [filteredSales, pivotCtx]);

  const periodSuffix = `${dateFrom}_${dateTo}`;
  const periodLabel = `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`;

  const options: ReportOption[] = [
    { value: 'top-customers', label: t.statisticsUi.topCustomers, icon: Users },
    { value: 'top-products', label: t.statisticsUi.topProducts, icon: Package },
    { value: 'top-suppliers', label: t.statisticsUi.topSuppliers, icon: Truck },
    { value: 'top-users', label: t.statisticsUi.topUsers, icon: User },
  ];

  return (
    <div className="space-y-6">
      <ReportTruncationBanner truncated={truncated} />
      <ReportToolbar
        title={
          <>
            <Trophy className="w-5 h-5 text-amber-500" />
            {t.statisticsUi.title}
          </>
        }
        description={t.statisticsUi.description}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        branchFilter={branchFilter}
      />

      <ReportPicker options={options} value={tab} onChange={setTab} />

      <div>
        {tab === 'top-customers' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.client}
            rows={customerPivot.rows}
            totals={customerPivot.totals}
            fileName={`TopClientes_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {tab === 'top-products' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.product}
            rows={productPivot.rows}
            totals={productPivot.totals}
            fileName={`TopProdutos_${periodSuffix}`}
            subtitle={periodLabel}
            enableGrouping
          />
        )}

        {tab === 'top-suppliers' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.supplier}
            rows={supplierPivot.rows}
            totals={supplierPivot.totals}
            fileName={`TopFornecedores_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {tab === 'top-users' && (
          <PivotReportView
            dimensionLabel={t.salesAnalysisUi.colUser}
            rows={userPivot.rows}
            totals={userPivot.totals}
            fileName={`TopVendedores_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}
      </div>
    </div>
  );
}
