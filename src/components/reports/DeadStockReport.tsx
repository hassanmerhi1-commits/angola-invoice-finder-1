import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Download, Package } from 'lucide-react';
import { REPORT_SALES_LIMIT } from '@/contexts/ReportsPeriodContext';
import { format, parseISO, subDays } from 'date-fns';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useProducts, useSales } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { exportReportExcel } from '@/lib/reportExport';

const DEAD_DAYS = 90;

type DeadReason = 'belowMin' | 'noSale90d' | 'both';

export default function DeadStockReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { products } = useProducts(apiBranchId, { light: true });
  const cutoff = useMemo(() => subDays(new Date(), DEAD_DAYS), []);
  const cutoffKey = format(cutoff, 'yyyy-MM-dd');
  const lookbackFrom = format(subDays(new Date(), 365), 'yyyy-MM-dd');
  const lookbackTo = format(new Date(), 'yyyy-MM-dd');
  const { sales } = useSales(apiBranchId, {
    light: false,
    dateFrom: lookbackFrom,
    dateTo: lookbackTo,
    limit: REPORT_SALES_LIMIT,
  });

  const lastSaleByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const sale of sales) {
      if (sale.status === 'voided') continue;
      const saleDate = String(sale.createdAt || '').slice(0, 10);
      if (!saleDate) continue;
      for (const item of sale.items || []) {
        if (!item.productId) continue;
        const prev = map.get(item.productId);
        if (!prev || saleDate > prev) map.set(item.productId, saleDate);
      }
    }
    return map;
  }, [sales]);

  const rows = useMemo(() => {
    return products
      .filter((p) => p.isActive !== false && Number(p.stock) > 0)
      .map((p) => {
        const minStock = Number(p.minStock) || 0;
        const belowMin = minStock > 0 && Number(p.stock) <= minStock;
        const lastSale = lastSaleByProduct.get(p.id);
        const noSale90d = !lastSale || lastSale < cutoffKey;
        if (!belowMin && !noSale90d) return null;
        const reason: DeadReason = belowMin && noSale90d ? 'both' : belowMin ? 'belowMin' : 'noSale90d';
        const unitCost =
          p.avgCost != null && Number.isFinite(Number(p.avgCost)) ? Number(p.avgCost) : Number(p.cost) || 0;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          stock: Number(p.stock) || 0,
          minStock,
          lastSale: lastSale || null,
          reason,
          costTied: (Number(p.stock) || 0) * unitCost,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.costTied - a!.costTied)) as Array<{
      id: string;
      sku: string;
      name: string;
      category: string;
      stock: number;
      minStock: number;
      lastSale: string | null;
      reason: DeadReason;
      costTied: number;
    }>;
  }, [products, lastSaleByProduct, cutoffKey]);

  const totalCost = rows.reduce((s, r) => s + r.costTied, 0);

  const formatMoney = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const reasonLabel = (r: DeadReason) => {
    if (r === 'both') return t.inventoryOpsUi.both;
    if (r === 'belowMin') return t.inventoryOpsUi.belowMin;
    return t.inventoryOpsUi.noSale90d;
  };

  const handleExport = async () => {
    const data = rows.map((r) => ({
      SKU: r.sku,
      [t.common.product]: r.name,
      [t.stockValuationUi.category]: r.category,
      [t.stockValuationUi.stock]: r.stock,
      [t.inventoryOpsUi.minStock]: r.minStock,
      [t.inventoryOpsUi.lastSale]: r.lastSale || t.inventoryOpsUi.neverSold,
      [t.inventoryOpsUi.reason]: reasonLabel(r.reason),
      [t.inventoryOpsUi.costTied]: Number(r.costTied.toFixed(2)),
    }));
    try {
      await exportReportExcel(data, `stock_parado_${format(new Date(), 'yyyyMMdd')}`, {
        title: t.inventoryOpsUi.title,
      });
    } catch (e) {
      console.error('[DeadStockReport] excel export failed:', e);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                {t.inventoryOpsUi.title}
              </CardTitle>
              <CardDescription>{t.inventoryOpsUi.description}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={rows.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              {t.reportsUi.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4" />
              {t.inventoryOpsUi.productsFlagged.replace('{count}', String(rows.length))}
            </span>
            <span>
              {t.inventoryOpsUi.costTied}: <strong className="text-foreground">{formatMoney(totalCost)}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">{t.inventoryOpsUi.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>SKU</TableHead>
                    <TableHead>{t.common.product}</TableHead>
                    <TableHead>{t.stockValuationUi.category}</TableHead>
                    <TableHead className="text-right">{t.stockValuationUi.stock}</TableHead>
                    <TableHead className="text-right">{t.inventoryOpsUi.minStock}</TableHead>
                    <TableHead>{t.inventoryOpsUi.lastSale}</TableHead>
                    <TableHead>{t.inventoryOpsUi.reason}</TableHead>
                    <TableHead className="text-right">{t.inventoryOpsUi.costTied}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.sku}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.category}</TableCell>
                      <TableCell className="text-right font-mono">{r.stock}</TableCell>
                      <TableCell className="text-right font-mono">{r.minStock || '—'}</TableCell>
                      <TableCell>
                        {r.lastSale
                          ? (() => {
                              try {
                                return format(parseISO(r.lastSale), 'dd/MM/yyyy');
                              } catch {
                                return r.lastSale;
                              }
                            })()
                          : t.inventoryOpsUi.neverSold}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.reason === 'both' ? 'destructive' : 'secondary'}>
                          {reasonLabel(r.reason)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(r.costTied)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
