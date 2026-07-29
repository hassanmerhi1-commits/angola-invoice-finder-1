import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { useReportCreditNotes } from '@/hooks/useReportCreditNotes';
import { useSales } from '@/hooks/useERP';
import { Trophy, Users, Package, Truck, User } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { useTranslation } from '@/i18n';
import { buildSalesPivot } from '@/lib/reports/salesPivot';
import { mergeNetReportSales } from '@/lib/reports/netSales';
import { useSalesPivotContext } from '@/components/reports/useSalesPivotContext';
import PivotReportView from '@/components/reports/PivotReportView';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';

export default function StatisticsReports({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { apiBranchId } = useBranchScope();
  const { branches, currentBranch, canPickBranch, selectedBranch, setSelectedBranch } = useSyncedBranchFilter();
  const { sales } = useSales(apiBranchId, { light: false });
  const pivotCtx = useSalesPivotContext(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
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

      {!onViewChange && <ReportPicker options={options} value={tab} onChange={setTab} />}

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
