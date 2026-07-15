import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Tags, Printer, FileDown } from 'lucide-react';
import { useProducts } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { useTranslation } from '@/i18n';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface CategoryRow {
  category: string;
  count: number;
  qty: number;
  costValue: number;
  saleValue: number;
  potentialProfit: number;
  marginPct: number;
}

export default function StockByCategoryReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { products } = useProducts(apiBranchId, { light: true });
  const { companyName } = useCompanyLogo();

  const { rows, totals } = useMemo(() => {
    const map = new Map<string, CategoryRow>();
    products.forEach((p) => {
      const category = p.category || t.salesAnalysisUi.noCategory;
      const stock = Number(p.stock || 0);
      const cost = Number(p.cost || 0);
      const price = Number(p.price || 0);
      const entry =
        map.get(category) ||
        { category, count: 0, qty: 0, costValue: 0, saleValue: 0, potentialProfit: 0, marginPct: 0 };
      entry.count += 1;
      entry.qty += stock;
      entry.costValue += stock * cost;
      entry.saleValue += stock * price;
      entry.potentialProfit += stock * (price - cost);
      map.set(category, entry);
    });

    const list = Array.from(map.values())
      .map((r) => ({ ...r, marginPct: r.saleValue > 0 ? (r.potentialProfit / r.saleValue) * 100 : 0 }))
      .sort((a, b) => b.costValue - a.costValue);

    const tot = list.reduce(
      (acc, r) => ({
        count: acc.count + r.count,
        qty: acc.qty + r.qty,
        costValue: acc.costValue + r.costValue,
        saleValue: acc.saleValue + r.saleValue,
        potentialProfit: acc.potentialProfit + r.potentialProfit,
      }),
      { count: 0, qty: 0, costValue: 0, saleValue: 0, potentialProfit: 0 },
    );

    return { rows: list, totals: tot };
  }, [products, t.salesAnalysisUi.noCategory]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

  const chartData = useMemo(
    () =>
      rows
        .slice(0, 12)
        .map((r) => ({ name: r.category.length > 18 ? `${r.category.slice(0, 17)}…` : r.category, value: r.costValue })),
    [rows],
  );

  const handleExport = () => {
    const data = rows.map((r) => ({
      [t.stockValuationUi.category]: r.category,
      [t.stockValuationUi.products]: r.count,
      [t.stockValuationUi.stock]: Number(r.qty.toFixed(2)),
      [t.stockValuationUi.costValue]: Number(r.costValue.toFixed(2)),
      [t.stockValuationUi.saleValue]: Number(r.saleValue.toFixed(2)),
      [t.stockValuationUi.potentialProfit]: Number(r.potentialProfit.toFixed(2)),
      [t.stockValuationUi.marginPercent]: Number(r.marginPct.toFixed(2)),
    }));
    exportToExcel(data, `Stock_Categoria_${new Date().toISOString().slice(0, 10)}`);
  };

  const totalMargin = totals.saleValue > 0 ? (totals.potentialProfit / totals.saleValue) * 100 : 0;

  const buildPrintHtml = () => {
    const body = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.category)}</td>
          <td class="r">${r.count}</td>
          <td class="r">${fmt(r.qty)}</td>
          <td class="r">${fmt(r.costValue)}</td>
          <td class="r">${fmt(r.saleValue)}</td>
          <td class="r">${fmt(r.potentialProfit)}</td>
          <td class="r">${r.marginPct.toFixed(1)}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(t.stockValuationUi.byCategory)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; padding: 16px; }
        .rpt-head { text-align: center; margin-bottom: 14px; }
        .rpt-head h1 { font-size: 15pt; margin: 0; }
        .rpt-head h2 { font-size: 11pt; margin: 4px 0; font-weight: normal; }
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
          <h2>${escapeHtml(t.stockValuationUi.byCategory)}</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t.stockValuationUi.category)}</th>
              <th class="r">${escapeHtml(t.stockValuationUi.products)}</th>
              <th class="r">${escapeHtml(t.stockValuationUi.stock)}</th>
              <th class="r">${escapeHtml(t.stockValuationUi.costValue)}</th>
              <th class="r">${escapeHtml(t.stockValuationUi.saleValue)}</th>
              <th class="r">${escapeHtml(t.stockValuationUi.potentialProfit)}</th>
              <th class="r">%</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t.stockValuationUi.totals)}</td>
              <td class="r">${totals.count}</td>
              <td class="r">${fmt(totals.qty)}</td>
              <td class="r">${fmt(totals.costValue)}</td>
              <td class="r">${fmt(totals.saleValue)}</td>
              <td class="r">${fmt(totals.potentialProfit)}</td>
              <td class="r">${totalMargin.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </body></html>`;
  };

  const handlePrint = async () => {
    try {
      await printHtml(buildPrintHtml());
    } catch (e) {
      console.error('[StockByCategoryReport] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    try {
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (el?.isElectron && el?.pdf?.saveHtml) {
        await el.pdf.saveHtml(html, { filename: `stock-categoria_${new Date().toISOString().slice(0, 10)}.pdf`, landscape: true });
        return;
      }
      await printHtml(html, { direct: true });
    } catch (e) {
      console.error('[StockByCategoryReport] save pdf failed:', e);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.stockValuationUi.totalCostValue}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={140} />
                <Tooltip formatter={(value: number) => fmt(value)} />
                <Bar dataKey="value" name={t.stockValuationUi.costValue} fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="w-4 h-4" />
              {t.stockValuationUi.byCategory}
            </CardTitle>
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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.stockValuationUi.category}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.products}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.stock}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.costValue}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.saleValue}</TableHead>
                  <TableHead className="text-right">{t.stockValuationUi.potentialProfit}</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r) => (
                      <TableRow key={r.category}>
                        <TableCell className="font-medium">{r.category}</TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right">{fmt(r.qty)}</TableCell>
                        <TableCell className="text-right">{fmt(r.costValue)}</TableCell>
                        <TableCell className="text-right text-blue-600">{fmt(r.saleValue)}</TableCell>
                        <TableCell className={`text-right ${r.potentialProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(r.potentialProfit)}
                        </TableCell>
                        <TableCell className={`text-right ${r.marginPct >= 20 ? 'text-green-600' : 'text-orange-600'}`}>
                          {r.marginPct.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>{t.stockValuationUi.totals}</TableCell>
                      <TableCell className="text-right">{totals.count}</TableCell>
                      <TableCell className="text-right">{fmt(totals.qty)}</TableCell>
                      <TableCell className="text-right">{fmt(totals.costValue)}</TableCell>
                      <TableCell className="text-right text-blue-600">{fmt(totals.saleValue)}</TableCell>
                      <TableCell className="text-right text-green-600">{fmt(totals.potentialProfit)}</TableCell>
                      <TableCell className="text-right">{totalMargin.toFixed(1)}</TableCell>
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
