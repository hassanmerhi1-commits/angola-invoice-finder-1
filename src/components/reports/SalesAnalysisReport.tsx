import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { Download, TrendingUp, Calendar, Package, Tags, Building2, Users, Truck, User, FileText } from 'lucide-react';
import { exportReportExcel } from '@/lib/reportExport';
import { useTranslation } from '@/i18n';
import SalesByProductReport from '@/components/reports/SalesByProductReport';
import PivotReportView from '@/components/reports/PivotReportView';
import { DailySalesDetailReport } from '@/components/reports/DailySalesDetailReport';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { mergeNetReportSales } from '@/lib/reports/netSales';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import { ReportStatStrip } from '@/components/reports/ReportStatStrip';
import { ReportTruncationBanner } from '@/components/reports/ReportTruncationBanner';
import { useReportSales } from '@/hooks/useReportSales';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';
import { useReportExportMeta } from '@/hooks/useReportExportMeta';

export default function SalesAnalysisReport({
  view,
  onViewChange,
  hidePicker = false,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
  hidePicker?: boolean;
} = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const filters = useSharedReportFilters();
  const { dateFrom, dateTo, comparePrevious, branchFilter, previousPeriod } = filters;
  const { selectedBranch, currentBranch } = branchFilter;
  const { sales, truncated } = useReportSales();
  const pivotCtx = useSalesPivotContext(filters.apiBranchId);
  const { preview } = useReportExportMeta();

  const [internalViewTab, setInternalViewTab] = useState('summary');
  const viewTab = view ?? internalViewTab;
  const setViewTab = onViewChange ?? setInternalViewTab;
  const [dailyOpen, setDailyOpen] = useState(false);

  const reportBranchId = selectedBranch === 'all' ? undefined : selectedBranch;

  const cnDateFrom = comparePrevious && previousPeriod ? previousPeriod.dateFrom : dateFrom;
  const { creditNotes } = useReportCreditNotes(reportBranchId, { dateFrom: cnDateFrom, dateTo });

  const filteredSales = useMemo(
    () =>
      mergeNetReportSales(sales, creditNotes, {
        dateFrom,
        dateTo,
        branchId: reportBranchId,
      }),
    [sales, creditNotes, dateFrom, dateTo, reportBranchId],
  );

  const prevFilteredSales = useMemo(() => {
    if (!comparePrevious || !previousPeriod) return [];
    return mergeNetReportSales(sales, creditNotes, {
      dateFrom: previousPeriod.dateFrom,
      dateTo: previousPeriod.dateTo,
      branchId: reportBranchId,
    });
  }, [comparePrevious, previousPeriod, sales, creditNotes, reportBranchId]);

  const clientSummary = useMemo(() => {
    const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0);
    const totalTransactions = filteredSales.length;
    const totalItems = filteredSales.reduce((sum, s) => sum + s.items.reduce((is, i) => is + i.quantity, 0), 0);
    const totalTax = filteredSales.reduce((sum, s) => sum + s.taxAmount, 0);
    const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const byPaymentMethod = {
      cash: filteredSales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0),
      card: filteredSales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0),
      transfer: filteredSales.filter((s) => s.paymentMethod === 'transfer').reduce((sum, s) => sum + s.total, 0),
    };
    return { totalRevenue, totalTransactions, totalItems, totalTax, avgTicket, byPaymentMethod };
  }, [filteredSales]);

  const summaryStats = clientSummary;

  const revenueDeltaPct = useMemo(() => {
    if (!comparePrevious) return null;
    const prevRevenue = prevFilteredSales.reduce((sum, s) => sum + s.total, 0);
    if (Math.abs(prevRevenue) < 0.01) return summaryStats.totalRevenue === 0 ? 0 : 100;
    return ((summaryStats.totalRevenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
  }, [comparePrevious, prevFilteredSales, summaryStats.totalRevenue]);

  const itemPivot = useMemo(() => buildSalesPivot(filteredSales, 'item', pivotCtx), [filteredSales, pivotCtx]);
  const categoryPivot = useMemo(() => buildSalesPivot(filteredSales, 'category', pivotCtx), [filteredSales, pivotCtx]);
  const customerPivot = useMemo(() => buildSalesPivot(filteredSales, 'customer', pivotCtx), [filteredSales, pivotCtx]);
  const supplierPivot = useMemo(() => buildSalesPivot(filteredSales, 'supplier', pivotCtx), [filteredSales, pivotCtx]);
  const warehousePivot = useMemo(() => buildSalesPivot(filteredSales, 'warehouse', pivotCtx), [filteredSales, pivotCtx]);
  const userPivot = useMemo(() => buildSalesPivot(filteredSales, 'user', pivotCtx), [filteredSales, pivotCtx]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const periodSuffix = `${dateFrom}_${dateTo}`;
  const periodLabel = `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`;

  const handleExportSummary = async () => {
    const data = filteredSales.map((s) => ({
      [t.reportsCenterUi.colDoc]: s.invoiceNumber,
      [t.reportsUi.dateFrom]: String(s.createdAt || '').slice(0, 10),
      [t.reportsCenterUi.colWho]: s.customerName || '',
      [t.reportsCenterUi.colAmount]: s.total,
    }));
    try {
      await exportReportExcel(data, `Vendas_Resumo_${dateFrom}_${dateTo}`, {
        ...preview(t.salesAnalysisUi.tabSummary),
        subtitle: periodLabel,
      });
    } catch (e) {
      console.error('[SalesAnalysisReport] excel export failed:', e);
    }
  };

  const viewOptions: ReportOption[] = [
    { value: 'summary', label: t.salesAnalysisUi.tabSummary, icon: Calendar },
    { value: 'item', label: t.salesAnalysisUi.tabByItem, icon: Package },
    { value: 'category', label: t.salesAnalysisUi.tabByCategory, icon: Tags },
    { value: 'customer', label: t.salesAnalysisUi.tabByCustomer, icon: Users },
    { value: 'supplier', label: t.salesAnalysisUi.tabBySupplier, icon: Truck },
    { value: 'warehouse', label: t.salesAnalysisUi.tabByBranch, icon: Building2 },
    { value: 'user', label: t.salesAnalysisUi.tabByUser, icon: User },
    { value: 'detailed', label: t.salesAnalysisUi.tabDetailed, icon: FileText },
    { value: 'daily', label: t.reportsCenterUi.tabDailyDetail, icon: Calendar },
  ];

  const statBoxes = [
    {
      label: t.salesAnalysisUi.totalRevenue,
      value: formatCurrency(summaryStats.totalRevenue),
      hint: comparePrevious && revenueDeltaPct != null
        ? t.reportsCenterUi.revenueDelta.replace('{pct}', `${revenueDeltaPct >= 0 ? '+' : ''}${revenueDeltaPct.toFixed(1)}`)
        : undefined,
    },
    { label: t.salesAnalysisUi.transactions, value: String(summaryStats.totalTransactions) },
    { label: t.salesAnalysisUi.itemsSold, value: String(summaryStats.totalItems) },
    { label: t.salesAnalysisUi.taxCollected, value: formatCurrency(summaryStats.totalTax) },
    { label: t.salesAnalysisUi.avgTicket, value: formatCurrency(summaryStats.avgTicket) },
    { label: t.chartsUi.methodCash, value: formatCurrency(summaryStats.byPaymentMethod.cash) },
    { label: t.chartsUi.methodCard, value: formatCurrency(summaryStats.byPaymentMethod.card) },
    { label: t.chartsUi.methodTransfer, value: formatCurrency(summaryStats.byPaymentMethod.transfer) },
  ];

  return (
    <div className="space-y-3">
      <ReportTruncationBanner truncated={truncated} />
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          {t.salesAnalysisUi.title}
        </h2>
        <Button variant="outline" size="sm" onClick={handleExportSummary}>
          <Download className="w-4 h-4 mr-1" />
          {t.common.export}
        </Button>
      </div>

      <ReportStatStrip items={statBoxes} />

      {!hidePicker && <ReportPicker options={viewOptions} value={viewTab} onChange={setViewTab} />}

      <div className="space-y-3">
        {viewTab === 'summary' && (
          filteredSales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{t.reportsCenterUi.snapshotEmpty}</p>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.reportsCenterUi.colDoc}</TableHead>
                    <TableHead>{t.reportsCenterUi.colWho}</TableHead>
                    <TableHead className="text-right">{t.reportsCenterUi.colAmount}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSales.slice(0, 80).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div>{s.invoiceNumber}</div>
                        <div className="text-xs text-muted-foreground">{String(s.createdAt || '').slice(0, 10)}</div>
                      </TableCell>
                      <TableCell>{s.customerName || '—'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(Number(s.total) || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        )}

        {viewTab === 'item' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.product}
            rows={itemPivot.rows}
            totals={itemPivot.totals}
            fileName={`Vendas_Item_${periodSuffix}`}
            subtitle={periodLabel}
            enableGrouping
          />
        )}

        {viewTab === 'category' && (
          <PivotReportView
            dimensionLabel={t.salesByProductUi.category}
            rows={categoryPivot.rows}
            totals={categoryPivot.totals}
            fileName={`Vendas_Categoria_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'customer' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.client}
            rows={customerPivot.rows}
            totals={customerPivot.totals}
            fileName={`Vendas_Cliente_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'supplier' && (
          <PivotReportView
            dimensionLabel={t.reportsUi.supplier}
            rows={supplierPivot.rows}
            totals={supplierPivot.totals}
            fileName={`Vendas_Fornecedor_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'warehouse' && (
          <PivotReportView
            dimensionLabel={t.salesAnalysisUi.branch}
            rows={warehousePivot.rows}
            totals={warehousePivot.totals}
            fileName={`Vendas_Armazem_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'user' && (
          <PivotReportView
            dimensionLabel={t.salesAnalysisUi.colUser}
            rows={userPivot.rows}
            totals={userPivot.totals}
            fileName={`Vendas_Utilizador_${periodSuffix}`}
            subtitle={periodLabel}
          />
        )}

        {viewTab === 'detailed' && (
          <SalesByProductReport embedded dateFrom={dateFrom} dateTo={dateTo} selectedBranch={selectedBranch} />
        )}

        {viewTab === 'daily' && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  {t.reportsUi.dailySalesDetailTitle}
                </CardTitle>
                <CardDescription>{t.reportsCenterUi.categories.sales.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setDailyOpen(true)}>
                  <FileText className="w-4 h-4 mr-2" />
                  {t.reportsCenterUi.viewReports}
                </Button>
              </CardContent>
            </Card>
            {dailyOpen && (
              <DailySalesDetailReport
                open={dailyOpen}
                onOpenChange={setDailyOpen}
                startDate={dateFrom}
                endDate={dateTo}
                branchId={selectedBranch === 'all' ? filters.apiBranchId : selectedBranch}
                branchName={currentBranch?.name}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
