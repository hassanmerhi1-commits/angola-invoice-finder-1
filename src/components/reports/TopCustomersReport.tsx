import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts } from '@/hooks/useERP';
import { Download, Users, Trophy } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { exportToExcel } from '@/lib/excel';
import { useTranslation } from '@/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface CustomerRow {
  key: string;
  name: string;
  nif: string;
  revenue: number;
  base: number;
  cost: number;
  profit: number;
  margin: number;
  invoices: number;
  items: number;
}

export default function TopCustomersReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId, { light: true });

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => m.set(p.id, p.avgCost || p.cost || 0));
    return m;
  }, [products]);

  const ranking = useMemo((): CustomerRow[] => {
    const inRange = (raw?: string) => {
      const d = raw ? String(raw).slice(0, 10) : '';
      return !!d && d >= dateFrom && d <= dateTo;
    };
    const map: Record<string, CustomerRow> = {};
    sales
      .filter((s) => s.status === 'completed' && inRange(s.createdAt))
      .forEach((s) => {
        const name = (s.customerName || '').trim() || t.reportsUi.finalConsumer;
        const nif = (s.customerNif || '').trim();
        const key = nif || name.toLowerCase();
        if (!map[key]) {
          map[key] = { key, name, nif, revenue: 0, base: 0, cost: 0, profit: 0, margin: 0, invoices: 0, items: 0 };
        }
        const row = map[key];
        row.revenue += Number(s.total || 0);
        row.base += Number(s.subtotal || 0);
        row.invoices += 1;
        s.items.forEach((item) => {
          const c = costMap.get(item.productId) || 0;
          row.cost += c * Number(item.quantity || 0);
          row.items += Number(item.quantity || 0);
        });
      });
    return Object.values(map)
      .map((r) => {
        const profit = r.base - r.cost;
        return { ...r, profit, margin: r.base > 0 ? (profit / r.base) * 100 : 0 };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, costMap, dateFrom, dateTo, t.reportsUi.finalConsumer]);

  const chartData = useMemo(
    () => ranking.slice(0, 10).map((r) => ({ name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name, revenue: r.revenue })),
    [ranking],
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const handleExport = () => {
    const rows = ranking.map((r, i) => ({
      '#': i + 1,
      [t.reportsUi.client]: r.name,
      [t.reportsUi.nif]: r.nif,
      [t.topCustomersUi.invoices]: r.invoices,
      [t.salesAnalysisUi.colRevenue]: r.revenue,
      [t.salesAnalysisUi.colProfit]: r.profit,
      [t.salesAnalysisUi.colMarginPercent]: r.margin.toFixed(2),
    }));
    exportToExcel(rows, `TopCustomers_${dateFrom}_${dateTo}`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                {t.topCustomersUi.title}
              </CardTitle>
              <CardDescription>{t.topCustomersUi.description}</CardDescription>
            </div>
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              {t.reportsUi.exportExcel}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            {t.topCustomersUi.top10}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={120} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="revenue" name={t.salesAnalysisUi.colRevenue} fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.topCustomersUi.ranking}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t.reportsUi.client}</TableHead>
                <TableHead>{t.reportsUi.nif}</TableHead>
                <TableHead className="text-right">{t.topCustomersUi.invoices}</TableHead>
                <TableHead className="text-right">{t.salesAnalysisUi.colRevenue}</TableHead>
                <TableHead className="text-right">{t.salesAnalysisUi.colProfit}</TableHead>
                <TableHead className="text-right">{t.salesAnalysisUi.colMargin}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t.common.noResults}
                  </TableCell>
                </TableRow>
              ) : (
                ranking.map((r, i) => (
                  <TableRow key={r.key}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.nif || '—'}</TableCell>
                    <TableCell className="text-right">{r.invoices}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(r.revenue)}</TableCell>
                    <TableCell className={`text-right ${r.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {formatCurrency(r.profit)}
                    </TableCell>
                    <TableCell className={`text-right ${r.margin >= 20 ? 'text-green-500' : 'text-orange-500'}`}>
                      {r.margin.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
