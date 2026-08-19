import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useProducts } from '@/hooks/useERP';
import { ShoppingCart, Loader2, Truck, Package, Tags, Calendar } from 'lucide-react';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';
import { api } from '@/lib/api/client';
import { unwrapListPayload } from '@/lib/listCache';
import { useTranslation } from '@/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { buildPurchasesPivot, type PurchasesPivotContext } from '@/lib/reports/purchasesPivot';
import PurchasesPivotView from '@/components/reports/PurchasesPivotView';
import { ReportPicker, type ReportOption } from '@/components/reports/ReportPicker';

export default function PurchasesAnalysisReport({
  view,
  onViewChange,
}: {
  view?: string;
  onViewChange?: (value: string) => void;
} = {}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { products } = useProducts(apiBranchId, { light: true });
  const { dateFrom, dateTo, setDateFrom, setDateTo, shared } = useSharedReportFilters();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [internalViewTab, setInternalViewTab] = useState('summary');
  const viewTab = view ?? internalViewTab;
  const setViewTab = onViewChange ?? setInternalViewTab;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await api.purchaseInvoices.list(apiBranchId ? { branchId: apiBranchId } : undefined);
      if (!cancelled) {
        const { items } = unwrapListPayload(res.data);
        setPurchases(items);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBranchId]);

  const filtered = useMemo(() => {
    const inRange = (raw?: string) => {
      const d = raw ? String(raw).slice(0, 10) : '';
      return !!d && d >= dateFrom && d <= dateTo;
    };
    return purchases.filter((p) => String(p.status || '') !== 'draft' && inRange(p.date || p.createdAt));
  }, [purchases, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, p) => ({
        base: acc.base + Number(p.subtotal || 0),
        iva: acc.iva + Number(p.ivaTotal || 0),
        total: acc.total + Number(p.total || 0),
        count: acc.count + 1,
      }),
      { base: 0, iva: 0, total: 0, count: 0 },
    );
  }, [filtered]);

  const categoryOf = useCallback(
    (productId: string | undefined, fallback: string) => {
      if (!productId) return fallback;
      return products.find((p) => p.id === productId)?.category || fallback;
    },
    [products],
  );

  const pivotCtx = useMemo<PurchasesPivotContext>(
    () => ({
      productCategory: categoryOf,
      labels: { unknown: t.common.unknown, noCategory: t.salesAnalysisUi.noCategory },
    }),
    [categoryOf, t.common.unknown, t.salesAnalysisUi.noCategory],
  );

  const supplierPivot = useMemo(() => buildPurchasesPivot(filtered, 'supplier', pivotCtx), [filtered, pivotCtx]);
  const productPivot = useMemo(() => buildPurchasesPivot(filtered, 'product', pivotCtx), [filtered, pivotCtx]);
  const categoryPivot = useMemo(() => buildPurchasesPivot(filtered, 'category', pivotCtx), [filtered, pivotCtx]);
  const monthPivot = useMemo(() => buildPurchasesPivot(filtered, 'month', pivotCtx), [filtered, pivotCtx]);

  const monthChart = useMemo(
    () => monthPivot.rows.map((r) => ({ label: r.label, total: r.total })),
    [monthPivot],
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const periodSuffix = `${dateFrom}_${dateTo}`;
  const periodLabel = `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`;

  const viewOptions: ReportOption[] = [
    { value: 'summary', label: t.purchasesReportUi.tabSummary, icon: Calendar },
    { value: 'suppliers', label: t.purchasesReportUi.bySupplier, icon: Truck },
    { value: 'products', label: t.purchasesReportUi.byProduct, icon: Package },
    { value: 'categories', label: t.purchasesReportUi.byCategory, icon: Tags },
    { value: 'months', label: t.purchasesReportUi.byMonth, icon: Calendar },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            {t.purchasesReportUi.title}
          </CardTitle>
          <CardDescription>{t.purchasesReportUi.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {!shared && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>{t.reportsUi.dateFrom}</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>{t.reportsUi.dateTo}</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t.common.loading}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t.purchasesReportUi.totalSpend}</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t.purchasesReportUi.netBase}</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.base)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t.vatReportUi.inputVat}</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.iva)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t.purchasesReportUi.invoices}</p>
                <p className="text-2xl font-bold">{totals.count}</p>
              </CardContent>
            </Card>
          </div>

          <ReportPicker options={viewOptions} value={viewTab} onChange={setViewTab} />

          <div>
            {viewTab === 'summary' && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t.purchasesReportUi.byMonth}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthChart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Bar dataKey="total" name={t.purchasesReportUi.totalSpend} fill="#8b5cf6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {viewTab === 'suppliers' && (
              <PurchasesPivotView
                dimensionLabel={t.purchasesReportUi.supplier}
                rows={supplierPivot.rows}
                totals={supplierPivot.totals}
                totalInvoices={totals.count}
                fileName={`Compras_Fornecedor_${periodSuffix}`}
                subtitle={periodLabel}
              />
            )}

            {viewTab === 'products' && (
              <PurchasesPivotView
                dimensionLabel={t.purchasesReportUi.product}
                rows={productPivot.rows}
                totals={productPivot.totals}
                totalInvoices={totals.count}
                fileName={`Compras_Produto_${periodSuffix}`}
                subtitle={periodLabel}
              />
            )}

            {viewTab === 'categories' && (
              <PurchasesPivotView
                dimensionLabel={t.purchasesReportUi.category}
                rows={categoryPivot.rows}
                totals={categoryPivot.totals}
                totalInvoices={totals.count}
                fileName={`Compras_Categoria_${periodSuffix}`}
                subtitle={periodLabel}
              />
            )}

            {viewTab === 'months' && (
              <PurchasesPivotView
                dimensionLabel={t.purchasesReportUi.month}
                rows={monthPivot.rows}
                totals={monthPivot.totals}
                totalInvoices={totals.count}
                fileName={`Compras_Mes_${periodSuffix}`}
                showChart={false}
                subtitle={periodLabel}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
