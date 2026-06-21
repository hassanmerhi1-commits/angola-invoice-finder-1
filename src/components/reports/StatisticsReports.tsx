import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales } from '@/hooks/useERP';
import { Trophy, Users, Package, Truck, User } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useTranslation } from '@/i18n';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import PivotReportView from '@/components/reports/PivotReportView';

const SUB_TABS = new Set(['top-customers', 'top-products', 'top-suppliers', 'top-users']);

export default function StatisticsReports({ initialTab }: { initialTab?: string }) {
  const { t } = useTranslation();
  const { branches, currentBranch, apiBranchId, canPickBranch } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const pivotCtx = useSalesPivotContext(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [tab, setTab] = useState(initialTab && SUB_TABS.has(initialTab) ? initialTab : 'top-customers');

  useEffect(() => {
    if (initialTab && SUB_TABS.has(initialTab)) setTab(initialTab);
  }, [initialTab]);

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

  const customerPivot = useMemo(() => buildSalesPivot(filteredSales, 'customer', pivotCtx), [filteredSales, pivotCtx]);
  const productPivot = useMemo(() => buildSalesPivot(filteredSales, 'item', pivotCtx), [filteredSales, pivotCtx]);
  const supplierPivot = useMemo(() => buildSalesPivot(filteredSales, 'supplier', pivotCtx), [filteredSales, pivotCtx]);
  const userPivot = useMemo(() => buildSalesPivot(filteredSales, 'user', pivotCtx), [filteredSales, pivotCtx]);

  const periodSuffix = `${dateFrom}_${dateTo}`;
  const periodLabel = `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            {t.statisticsUi.title}
          </CardTitle>
          <CardDescription>{t.statisticsUi.description}</CardDescription>
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="top-customers">
            <Users className="w-4 h-4 mr-2" />
            {t.statisticsUi.topCustomers}
          </TabsTrigger>
          <TabsTrigger value="top-products">
            <Package className="w-4 h-4 mr-2" />
            {t.statisticsUi.topProducts}
          </TabsTrigger>
          <TabsTrigger value="top-suppliers">
            <Truck className="w-4 h-4 mr-2" />
            {t.statisticsUi.topSuppliers}
          </TabsTrigger>
          <TabsTrigger value="top-users">
            <User className="w-4 h-4 mr-2" />
            {t.statisticsUi.topUsers}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="top-customers" className="mt-4">
          <PivotReportView
            dimensionLabel={t.reportsUi.client}
            rows={customerPivot.rows}
            totals={customerPivot.totals}
            fileName={`TopClientes_${periodSuffix}`}
            subtitle={periodLabel}
          />
        </TabsContent>

        <TabsContent value="top-products" className="mt-4">
          <PivotReportView
            dimensionLabel={t.salesByProductUi.product}
            rows={productPivot.rows}
            totals={productPivot.totals}
            fileName={`TopProdutos_${periodSuffix}`}
            subtitle={periodLabel}
            enableGrouping
          />
        </TabsContent>

        <TabsContent value="top-suppliers" className="mt-4">
          <PivotReportView
            dimensionLabel={t.reportsUi.supplier}
            rows={supplierPivot.rows}
            totals={supplierPivot.totals}
            fileName={`TopFornecedores_${periodSuffix}`}
            subtitle={periodLabel}
          />
        </TabsContent>

        <TabsContent value="top-users" className="mt-4">
          <PivotReportView
            dimensionLabel={t.salesAnalysisUi.colUser}
            rows={userPivot.rows}
            totals={userPivot.totals}
            fileName={`TopVendedores_${periodSuffix}`}
            subtitle={periodLabel}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
