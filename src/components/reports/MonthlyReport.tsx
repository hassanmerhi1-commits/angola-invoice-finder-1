import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { useSales, useProducts } from '@/hooks/useERP';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Calendar, Download, Printer, FileDown } from 'lucide-react';
import { format, startOfYear, endOfYear } from 'date-fns';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { unwrapListPayload } from '@/lib/listCache';
import { useTranslation } from '@/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface MonthRow {
  month: string;
  sales: number;
  cost: number;
  profit: number;
  purchases: number;
  net: number;
}

export default function MonthlyReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { branches, currentBranch, canPickBranch, selectedBranch, setSelectedBranch } = useSyncedBranchFilter();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId, { light: true });
  const { companyName } = useCompanyLogo();

  const [dateFrom, setDateFrom] = useState(format(startOfYear(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfYear(new Date()), 'yyyy-MM-dd'));
  const [purchases, setPurchases] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.purchaseInvoices.list(apiBranchId ? { branchId: apiBranchId } : undefined);
      if (!cancelled) {
        const { items } = unwrapListPayload(res.data);
        setPurchases(items);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBranchId]);

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => m.set(p.id, p.avgCost || p.cost || 0));
    return m;
  }, [products]);

  const { rows, totals } = useMemo(() => {
    const inRange = (raw?: string) => {
      const d = raw ? String(raw).slice(0, 10) : '';
      return !!d && d >= dateFrom && d <= dateTo;
    };
    const map = new Map<string, MonthRow>();
    const get = (month: string) =>
      map.get(month) || { month, sales: 0, cost: 0, profit: 0, purchases: 0, net: 0 };

    sales
      .filter(
        (s) =>
          s.status === 'completed' &&
          inRange(s.createdAt) &&
          (selectedBranch === 'all' || s.branchId === selectedBranch),
      )
      .forEach((s) => {
        const month = String(s.createdAt || '').slice(0, 7);
        if (!month) return;
        const row = get(month);
        row.sales += Number(s.subtotal || 0);
        s.items.forEach((item) => {
          row.cost += (costMap.get(item.productId) || 0) * Number(item.quantity || 0);
        });
        map.set(month, row);
      });

    purchases
      .filter((p) => String(p.status || '') !== 'draft' && inRange(p.date || p.createdAt))
      .forEach((p) => {
        const month = String(p.date || p.createdAt || '').slice(0, 7);
        if (!month) return;
        const row = get(month);
        row.purchases += Number(p.total || 0);
        map.set(month, row);
      });

    const list = Array.from(map.values())
      .map((r) => ({ ...r, profit: r.sales - r.cost, net: r.sales - r.purchases }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const tot = list.reduce(
      (acc, r) => ({
        sales: acc.sales + r.sales,
        cost: acc.cost + r.cost,
        profit: acc.profit + r.profit,
        purchases: acc.purchases + r.purchases,
        net: acc.net + r.net,
      }),
      { sales: 0, cost: 0, profit: 0, purchases: 0, net: 0 },
    );

    return { rows: list, totals: tot };
  }, [sales, purchases, costMap, dateFrom, dateTo, selectedBranch]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const chartData = useMemo(
    () => rows.map((r) => ({ name: r.month, sales: r.sales, purchases: r.purchases })),
    [rows],
  );

  const handleExport = () => {
    const data = rows.map((r) => ({
      [t.monthlyUi.month]: r.month,
      [t.monthlyUi.sales]: Number(r.sales.toFixed(2)),
      [t.monthlyUi.costOfSales]: Number(r.cost.toFixed(2)),
      [t.monthlyUi.grossProfit]: Number(r.profit.toFixed(2)),
      [t.monthlyUi.purchases]: Number(r.purchases.toFixed(2)),
      [t.monthlyUi.netCashFlow]: Number(r.net.toFixed(2)),
    }));
    exportToExcel(data, `Mensal_${dateFrom}_${dateTo}`);
  };

  const buildPrintHtml = () => {
    const body = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.month)}</td>
          <td class="r">${fmt(r.sales)}</td>
          <td class="r">${fmt(r.cost)}</td>
          <td class="r">${fmt(r.profit)}</td>
          <td class="r">${fmt(r.purchases)}</td>
          <td class="r">${fmt(r.net)}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(t.monthlyUi.title)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; padding: 16px; }
        .rpt-head { text-align: center; margin-bottom: 14px; }
        .rpt-head h1 { font-size: 15pt; margin: 0; }
        .rpt-head h2 { font-size: 11pt; margin: 4px 0; font-weight: normal; }
        .rpt-head p { font-size: 9pt; color: #444; margin: 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 3px 5px; }
        th { background: #f0f0f0; font-size: 8pt; }
        .r { text-align: right; }
        tfoot td { background: #f6f6f6; font-weight: bold; border-top: 2px solid #000; }
        @media print { body { padding: 0; } @page { size: A4 landscape; margin: 10mm; } }
      </style></head>
      <body>
        <div class="rpt-head">
          <h1>${escapeHtml(companyName)}</h1>
          <h2>${escapeHtml(t.monthlyUi.title)}</h2>
          <p>${escapeHtml(t.reportsUi.dateFrom)}: ${escapeHtml(dateFrom)} — ${escapeHtml(t.reportsUi.dateTo)}: ${escapeHtml(dateTo)}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t.monthlyUi.month)}</th>
              <th class="r">${escapeHtml(t.monthlyUi.sales)}</th>
              <th class="r">${escapeHtml(t.monthlyUi.costOfSales)}</th>
              <th class="r">${escapeHtml(t.monthlyUi.grossProfit)}</th>
              <th class="r">${escapeHtml(t.monthlyUi.purchases)}</th>
              <th class="r">${escapeHtml(t.monthlyUi.netCashFlow)}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t.common.total)}</td>
              <td class="r">${fmt(totals.sales)}</td>
              <td class="r">${fmt(totals.cost)}</td>
              <td class="r">${fmt(totals.profit)}</td>
              <td class="r">${fmt(totals.purchases)}</td>
              <td class="r">${fmt(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </body></html>`;
  };

  const handlePrint = async () => {
    try {
      await printHtml(buildPrintHtml());
    } catch (e) {
      console.error('[MonthlyReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    try {
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (el?.isElectron && el?.pdf?.saveHtml) {
        await el.pdf.saveHtml(html, { filename: `mensal_${dateFrom}_${dateTo}.pdf`, landscape: true });
        return;
      }
      await printHtml(html, { direct: true });
    } catch (e) {
      console.error('[MonthlyReport] save pdf failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                {t.monthlyUi.title}
              </CardTitle>
              <CardDescription>{t.monthlyUi.description}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                {t.reportsUi.exportExcel}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSavePdf}>
                <FileDown className="w-4 h-4 mr-2" />
                {t.reportsUi.savePdf}
              </Button>
            </div>
          </div>
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.monthlyUi.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="sales" name={t.monthlyUi.sales} fill="#3b82f6" />
                <Bar dataKey="purchases" name={t.monthlyUi.purchases} fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.monthlyUi.month}</TableHead>
                  <TableHead className="text-right">{t.monthlyUi.sales}</TableHead>
                  <TableHead className="text-right">{t.monthlyUi.costOfSales}</TableHead>
                  <TableHead className="text-right">{t.monthlyUi.grossProfit}</TableHead>
                  <TableHead className="text-right">{t.monthlyUi.purchases}</TableHead>
                  <TableHead className="text-right">{t.monthlyUi.netCashFlow}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r) => (
                      <TableRow key={r.month}>
                        <TableCell className="font-medium">{r.month}</TableCell>
                        <TableCell className="text-right">{fmt(r.sales)}</TableCell>
                        <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                        <TableCell className={`text-right ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(r.profit)}
                        </TableCell>
                        <TableCell className="text-right text-purple-600">{fmt(r.purchases)}</TableCell>
                        <TableCell className={`text-right ${r.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(r.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>{t.common.total}</TableCell>
                      <TableCell className="text-right">{fmt(totals.sales)}</TableCell>
                      <TableCell className="text-right">{fmt(totals.cost)}</TableCell>
                      <TableCell className="text-right">{fmt(totals.profit)}</TableCell>
                      <TableCell className="text-right text-purple-600">{fmt(totals.purchases)}</TableCell>
                      <TableCell className="text-right">{fmt(totals.net)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
