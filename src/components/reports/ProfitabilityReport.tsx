import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales } from '@/hooks/useERP';
import { PieChart, TrendingUp, TrendingDown, Package, Tags, Users, Truck } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
         PieChart as RechartsPie, Pie, Cell, Legend } from 'recharts';
import { useTranslation } from '@/i18n';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import PivotReportView from '@/components/reports/PivotReportView';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function ProfitabilityReport({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
} = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { branches, currentBranch, apiBranchId, canPickBranch } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const pivotCtx = useSalesPivotContext(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [internalViewTab, setInternalViewTab] = useState('summary');
  const viewTab = view ?? internalViewTab;
  const setViewTab = onViewChange ?? setInternalViewTab;

  useEffect(() => {
    if (!canPickBranch && currentBranch?.id) setSelectedBranch(currentBranch.id);
  }, [canPickBranch, currentBranch?.id]);

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const saleDate = sale.createdAt.split('T')[0];
      const matchesDate = saleDate >= dateFrom && saleDate <= dateTo;
      const matchesBranch = selectedBranch === 'all' || sale.branchId === selectedBranch;
      return matchesDate && matchesBranch && sale.status === 'completed';
    });
  }, [sales, dateFrom, dateTo, selectedBranch]);

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

  const categoryChart = useMemo(
    () => categoryPivot.rows.slice(0, 8).map((r) => ({ name: r.label, profit: r.profit, margin: r.marginPct })),
    [categoryPivot],
  );

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
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="w-5 h-5" />
            {t.profitUi.title}
          </CardTitle>
          <CardDescription>{t.profitUi.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div>
              <Label>{t.salesAnalysisUi.branch}</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
                <SelectTrigger>
                  <SelectValue placeholder={t.common.all} />
                </SelectTrigger>
                <SelectContent>
                  {canPickBranch && <SelectItem value="all">{t.salesAnalysisUi.allBranches}</SelectItem>}
                  {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.profitUi.totalRevenue}</p>
            <p className="text-2xl font-bold">{formatCurrency(summary.totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.profitUi.totalCost}</p>
            <p className="text-2xl font-bold text-orange-500">{formatCurrency(summary.totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              {summary.grossProfit >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <p className="text-sm text-muted-foreground">{t.profitUi.grossProfit}</p>
            </div>
            <p className={`text-2xl font-bold ${summary.grossProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(summary.grossProfit)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t.profitUi.avgMargin}</p>
            <p className={`text-2xl font-bold ${summary.avgMargin >= 20 ? 'text-green-500' : 'text-orange-500'}`}>
              {summary.avgMargin.toFixed(1)}%
            </p>
            <div className="flex gap-4 mt-2 text-xs">
              <span className="text-green-500">{t.profitUi.profitable.replace('{count}', String(summary.profitable))}</span>
              <span className="text-red-500">{t.profitUi.unprofitable.replace('{count}', String(summary.unprofitable))}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sub-report selector */}
      {!onViewChange && <ReportPicker options={viewOptions} value={viewTab} onChange={setViewTab} />}

      <div className="space-y-4">
        {viewTab === 'summary' && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.profitUi.profitByCategory}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Bar dataKey="profit" name={t.profitUi.profit} fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.profitUi.marginDistribution}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie>
                      <Pie
                        data={categoryChart}
                        dataKey="profit"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, margin }) => `${name} (${Number(margin).toFixed(0)}%)`}
                      >
                        {categoryChart.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                    </RechartsPie>
                  </ResponsiveContainer>
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
