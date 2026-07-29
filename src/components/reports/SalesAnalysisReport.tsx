import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { useSales } from '@/hooks/useERP';
import { Download, TrendingUp, Calendar, Package, Tags, Building2, Users, Truck, User, FileText } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval,
         eachMonthOfInterval, isSameDay, isSameWeek, isSameMonth, getWeek, differenceInCalendarDays, subDays } from 'date-fns';
import { enUS, pt } from 'date-fns/locale';
import { exportReportExcel } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis } from 'recharts';
import { useTranslation } from '@/i18n';
import SalesByProductReport from '@/components/reports/SalesByProductReport';
import PivotReportView from '@/components/reports/PivotReportView';
import { DailySalesDetailReport } from '@/components/reports/DailySalesDetailReport';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { mergeNetReportSales } from '@/lib/reports/netSales';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';
import { ReportToolbar } from '@/components/reports/ReportToolbar';

export default function SalesAnalysisReport({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
} = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { apiBranchId } = useBranchScope();
  const branchFilter = useSyncedBranchFilter();
  const { selectedBranch, currentBranch } = branchFilter;
  const { sales } = useSales(apiBranchId, { light: false });
  const pivotCtx = useSalesPivotContext(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [comparePrevious, setComparePrevious] = useState(false);
  const [internalViewTab, setInternalViewTab] = useState('summary');
  const viewTab = view ?? internalViewTab;
  const setViewTab = onViewChange ?? setInternalViewTab;
  const [dailyOpen, setDailyOpen] = useState(false);
  const [apiSummary, setApiSummary] = useState<{
    revenue: number;
    tax: number;
    transactions: number;
    byPaymentMethod: Record<string, number>;
  } | null>(null);

  const reportBranchId = selectedBranch === 'all' ? undefined : selectedBranch;

  const prevPeriod = useMemo(() => {
    try {
      const from = parseISO(dateFrom);
      const to = parseISO(dateTo);
      const days = Math.max(1, differenceInCalendarDays(to, from) + 1);
      const prevTo = subDays(from, 1);
      const prevFrom = subDays(prevTo, days - 1);
      return {
        dateFrom: format(prevFrom, 'yyyy-MM-dd'),
        dateTo: format(prevTo, 'yyyy-MM-dd'),
      };
    } catch {
      return null;
    }
  }, [dateFrom, dateTo]);

  const cnDateFrom = comparePrevious && prevPeriod ? prevPeriod.dateFrom : dateFrom;
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
    if (!comparePrevious || !prevPeriod) return [];
    return mergeNetReportSales(sales, creditNotes, {
      dateFrom: prevPeriod.dateFrom,
      dateTo: prevPeriod.dateTo,
      branchId: reportBranchId,
    });
  }, [comparePrevious, prevPeriod, sales, creditNotes, reportBranchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.analytics.salesSummary({
          dateFrom,
          dateTo,
          branchId: reportBranchId,
        });
        if (cancelled || res.error || !res.data) {
          if (!cancelled) setApiSummary(null);
          return;
        }
        setApiSummary({
          revenue: Number(res.data.revenue) || 0,
          tax: Number(res.data.tax) || 0,
          transactions: Number(res.data.transactions) || 0,
          byPaymentMethod: res.data.byPaymentMethod || {},
        });
      } catch {
        if (!cancelled) setApiSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, reportBranchId]);

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

  // Prefer SQL aggregate for headline KPIs when available and no CN netting needed.
  const summaryStats = useMemo(() => {
    if (!apiSummary || creditNotes.length > 0) return clientSummary;
    const totalRevenue = apiSummary.revenue;
    const totalTransactions = apiSummary.transactions;
    const totalTax = apiSummary.tax;
    const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const byPaymentMethod = {
      cash: Number(apiSummary.byPaymentMethod.cash) || 0,
      card: Number(apiSummary.byPaymentMethod.card) || 0,
      transfer: Number(apiSummary.byPaymentMethod.transfer) || 0,
    };
    return {
      totalRevenue,
      totalTransactions,
      totalItems: clientSummary.totalItems,
      totalTax,
      avgTicket,
      byPaymentMethod,
    };
  }, [apiSummary, clientSummary, creditNotes.length]);

  const revenueDeltaPct = useMemo(() => {
    if (!comparePrevious) return null;
    const prevRevenue = prevFilteredSales.reduce((sum, s) => sum + s.total, 0);
    if (Math.abs(prevRevenue) < 0.01) return summaryStats.totalRevenue === 0 ? 0 : 100;
    return ((summaryStats.totalRevenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
  }, [comparePrevious, prevFilteredSales, summaryStats.totalRevenue]);

  const salesByDate = useMemo(() => {
    const interval = { start: parseISO(dateFrom), end: parseISO(dateTo) };
    let dates: Date[];
    if (groupBy === 'day') dates = eachDayOfInterval(interval);
    else if (groupBy === 'week') dates = eachWeekOfInterval(interval);
    else dates = eachMonthOfInterval(interval);

    return dates.map((date) => {
      const periodSales = filteredSales.filter((sale) => {
        const saleDate = parseISO(sale.createdAt);
        if (groupBy === 'day') return isSameDay(saleDate, date);
        if (groupBy === 'week') return isSameWeek(saleDate, date);
        return isSameMonth(saleDate, date);
      });
      return {
        date,
        label:
          groupBy === 'day'
            ? format(date, 'dd/MM', { locale: dfLocale })
            : groupBy === 'week'
              ? t.salesAnalysisUi.weekLabel.replace('{week}', String(getWeek(date)))
              : format(date, 'MMM/yy', { locale: dfLocale }),
        revenue: periodSales.reduce((sum, s) => sum + s.total, 0),
        transactions: periodSales.length,
      };
    });
  }, [filteredSales, dateFrom, dateTo, groupBy, dfLocale, t.salesAnalysisUi.weekLabel]);

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
    const data = salesByDate.map((d) => ({
      [t.salesAnalysisUi.colPeriod]: d.label,
      [t.salesAnalysisUi.colRevenue]: d.revenue,
      [t.salesAnalysisUi.colTransactions]: d.transactions,
    }));
    try {
      await exportReportExcel(data, `Vendas_Resumo_${dateFrom}_${dateTo}`, {
        title: t.salesAnalysisUi.tabSummary,
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

  return (
    <div className="space-y-6">
      <ReportToolbar
        title={
          <>
            <TrendingUp className="w-5 h-5" />
            {t.salesAnalysisUi.title}
          </>
        }
        description={t.salesAnalysisUi.description}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        branchFilter={branchFilter}
        comparePrevious={comparePrevious}
        onComparePreviousChange={setComparePrevious}
        extraFilters={
          <div>
            <Label>{t.salesAnalysisUi.groupBy}</Label>
            <Select value={groupBy} onValueChange={(v: 'day' | 'week' | 'month') => setGroupBy(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">{t.salesAnalysisUi.groupDay}</SelectItem>
                <SelectItem value="week">{t.salesAnalysisUi.groupWeek}</SelectItem>
                <SelectItem value="month">{t.salesAnalysisUi.groupMonth}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <Button variant="outline" onClick={handleExportSummary}>
          <Download className="w-4 h-4 mr-2" />
          {t.common.export}
        </Button>
      </ReportToolbar>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.totalRevenue}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.totalRevenue)}</p>
            {comparePrevious && revenueDeltaPct != null && (
              <p className={`text-xs mt-1 ${revenueDeltaPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {t.reportsCenterUi.revenueDelta.replace('{pct}', `${revenueDeltaPct >= 0 ? '+' : ''}${revenueDeltaPct.toFixed(1)}`)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.transactions}</p>
            <p className="text-2xl font-bold">{summaryStats.totalTransactions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.itemsSold}</p>
            <p className="text-2xl font-bold">{summaryStats.totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.taxCollected}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.totalTax)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.salesAnalysisUi.avgTicket}</p>
            <p className="text-2xl font-bold">{formatCurrency(summaryStats.avgTicket)}</p>
          </CardContent>
        </Card>
      </div>

      {!onViewChange && <ReportPicker options={viewOptions} value={viewTab} onChange={setViewTab} />}

      <div className="space-y-4">
        {viewTab === 'summary' && (
          <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.salesAnalysisUi.salesEvolution}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesByDate}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name={t.salesAnalysisUi.colRevenue} stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.salesAnalysisUi.byPaymentMethod}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-green-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCash}</p>
                  <p className="text-xl font-bold text-green-500">{formatCurrency(summaryStats.byPaymentMethod.cash)}</p>
                </div>
                <div className="p-4 bg-blue-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodCard}</p>
                  <p className="text-xl font-bold text-blue-500">{formatCurrency(summaryStats.byPaymentMethod.card)}</p>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.chartsUi.methodTransfer}</p>
                  <p className="text-xl font-bold text-purple-500">{formatCurrency(summaryStats.byPaymentMethod.transfer)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
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
                branchId={selectedBranch === 'all' ? apiBranchId : selectedBranch}
                branchName={currentBranch?.name}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
