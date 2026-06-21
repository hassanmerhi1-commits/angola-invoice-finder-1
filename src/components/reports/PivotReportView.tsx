import { Fragment, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Printer, FileDown, Search, Layers, ChevronRight, ChevronDown } from 'lucide-react';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { useTranslation } from '@/i18n';
import type { PivotRow, PivotTotals } from '@/lib/reports/salesPivot';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PivotReportViewProps {
  /** Column header for the dimension, e.g. "Product", "Category". */
  dimensionLabel: string;
  rows: PivotRow[];
  totals: PivotTotals;
  fileName: string;
  /** Hide the top chart (e.g. when too many rows). */
  showChart?: boolean;
  /** Optional subtitle (e.g. the period) shown on the printed/PDF header. */
  subtitle?: string;
  /** Allow collapsible "group by category" when rows carry a `group`. */
  enableGrouping?: boolean;
}

interface PivotGroup {
  name: string;
  rows: PivotRow[];
  subtotal: PivotTotals;
}

const sumTotals = (rows: PivotRow[]): PivotTotals =>
  rows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      base: acc.base + r.base,
      withVat: acc.withVat + r.withVat,
      cost: acc.cost + r.cost,
      profit: acc.profit + r.profit,
    }),
    { qty: 0, base: 0, withVat: 0, cost: 0, profit: 0 },
  );

export default function PivotReportView({
  dimensionLabel,
  rows,
  totals,
  fileName,
  showChart = true,
  subtitle,
  enableGrouping = false,
}: PivotReportViewProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { companyName } = useCompanyLogo();
  const [search, setSearch] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const canGroup = enableGrouping && rows.some((r) => r.group);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const groups = useMemo<PivotGroup[]>(() => {
    const map = new Map<string, PivotRow[]>();
    filteredRows.forEach((r) => {
      const name = r.group || dimensionLabel;
      const list = map.get(name) || [];
      list.push(r);
      map.set(name, list);
    });
    return Array.from(map.entries())
      .map(([name, rs]) => ({ name, rows: rs, subtotal: sumTotals(rs) }))
      .sort((a, b) => b.subtotal.base - a.subtotal.base);
  }, [filteredRows, dimensionLabel]);

  const toggleGroup = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const displayTotals = useMemo<PivotTotals>(() => {
    if (filteredRows === rows) return totals;
    return filteredRows.reduce(
      (acc, r) => ({
        qty: acc.qty + r.qty,
        base: acc.base + r.base,
        withVat: acc.withVat + r.withVat,
        cost: acc.cost + r.cost,
        profit: acc.profit + r.profit,
      }),
      { qty: 0, base: 0, withVat: 0, cost: 0, profit: 0 },
    );
  }, [filteredRows, rows, totals]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

  const fmt2 = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  const buildPrintHtml = () => {
    const totalMargin = displayTotals.base > 0 ? (displayTotals.profit / displayTotals.base) * 100 : 0;
    const body = filteredRows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.label)}</td>
          <td class="r">${fmt2(r.qty)}</td>
          <td class="r">${fmt2(r.base)}</td>
          <td class="r">${fmt2(r.withVat)}</td>
          <td class="r">${fmt2(r.cost)}</td>
          <td class="r">${fmt2(r.profit)}</td>
          <td class="r">${r.marginPct.toFixed(1)}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(dimensionLabel)}</title>
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
          <h2>${escapeHtml(dimensionLabel)}</h2>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(dimensionLabel)}</th>
              <th class="r">${escapeHtml(t.salesByProductUi.qty)}</th>
              <th class="r">${escapeHtml(t.salesByProductUi.totalExVat)}</th>
              <th class="r">${escapeHtml(t.salesByProductUi.totalIncVat)}</th>
              <th class="r">${escapeHtml(t.salesByProductUi.cost)}</th>
              <th class="r">${escapeHtml(t.salesByProductUi.profit)}</th>
              <th class="r">%</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t.common.total)}</td>
              <td class="r">${fmt2(displayTotals.qty)}</td>
              <td class="r">${fmt2(displayTotals.base)}</td>
              <td class="r">${fmt2(displayTotals.withVat)}</td>
              <td class="r">${fmt2(displayTotals.cost)}</td>
              <td class="r">${fmt2(displayTotals.profit)}</td>
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
      console.error('[PivotReportView] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    try {
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (el?.isElectron && el?.pdf?.saveHtml) {
        await el.pdf.saveHtml(html, { filename: `${fileName}.pdf`, landscape: true });
        return;
      }
      await printHtml(html, { direct: true });
    } catch (e) {
      console.error('[PivotReportView] save pdf failed:', e);
    }
  };

  const chartData = useMemo(
    () =>
      filteredRows
        .slice(0, 12)
        .map((r) => ({ name: r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label, base: r.base })),
    [filteredRows],
  );

  const handleExport = () => {
    const data = filteredRows.map((r) => ({
      ...(r.group ? { [t.salesByProductUi.category]: r.group } : {}),
      [dimensionLabel]: r.label,
      [t.salesByProductUi.qty]: r.qty,
      [t.salesByProductUi.totalExVat]: Number(r.base.toFixed(2)),
      [t.salesByProductUi.totalIncVat]: Number(r.withVat.toFixed(2)),
      [t.salesByProductUi.cost]: Number(r.cost.toFixed(2)),
      [t.salesByProductUi.profit]: Number(r.profit.toFixed(2)),
      [t.salesByProductUi.marginPct]: Number(r.marginPct.toFixed(2)),
    }));
    exportToExcel(data, fileName);
  };

  return (
    <div className="space-y-4">
      {showChart && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.salesByProductUi.totalExVat}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={140} />
                  <Tooltip formatter={(value: number) => fmt(value)} />
                  <Bar dataKey="base" name={t.salesByProductUi.totalExVat} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <CardTitle className="text-base">{dimensionLabel}</CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.common.search}
                  className="h-9 pl-8 w-40 sm:w-48"
                />
              </div>
              {canGroup && (
                <Button
                  variant={grouped ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setGrouped((g) => !g)}
                >
                  <Layers className="w-4 h-4 mr-2" />
                  {t.reportsUi.groupByCategory}
                </Button>
              )}
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
                  <TableHead>{dimensionLabel}</TableHead>
                  <TableHead className="text-right">{t.salesByProductUi.qty}</TableHead>
                  <TableHead className="text-right">{t.salesByProductUi.totalExVat}</TableHead>
                  <TableHead className="text-right">{t.salesByProductUi.totalIncVat}</TableHead>
                  <TableHead className="text-right">{t.salesByProductUi.cost}</TableHead>
                  <TableHead className="text-right">{t.salesByProductUi.profit}</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : grouped && canGroup ? (
                  <>
                    {groups.map((g) => {
                      const isCollapsed = collapsed.has(g.name);
                      const subMargin = g.subtotal.base > 0 ? (g.subtotal.profit / g.subtotal.base) * 100 : 0;
                      return (
                        <Fragment key={g.name}>
                          <TableRow
                            className="bg-muted/40 font-semibold cursor-pointer hover:bg-muted/60"
                            onClick={() => toggleGroup(g.name)}
                          >
                            <TableCell>
                              <span className="inline-flex items-center gap-1">
                                {isCollapsed ? (
                                  <ChevronRight className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                                {g.name}
                                <span className="text-muted-foreground font-normal">({g.rows.length})</span>
                              </span>
                            </TableCell>
                            <TableCell className="text-right">{fmt(g.subtotal.qty)}</TableCell>
                            <TableCell className="text-right">{fmt(g.subtotal.base)}</TableCell>
                            <TableCell className="text-right">{fmt(g.subtotal.withVat)}</TableCell>
                            <TableCell className="text-right">{fmt(g.subtotal.cost)}</TableCell>
                            <TableCell className="text-right">{fmt(g.subtotal.profit)}</TableCell>
                            <TableCell className="text-right">{subMargin.toFixed(1)}</TableCell>
                          </TableRow>
                          {!isCollapsed &&
                            g.rows.map((r) => (
                              <TableRow key={r.key}>
                                <TableCell className="font-medium pl-8">{r.label}</TableCell>
                                <TableCell className="text-right">{fmt(r.qty)}</TableCell>
                                <TableCell className="text-right">{fmt(r.base)}</TableCell>
                                <TableCell className="text-right">{fmt(r.withVat)}</TableCell>
                                <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                                <TableCell className={`text-right ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {fmt(r.profit)}
                                </TableCell>
                                <TableCell className={`text-right ${r.marginPct >= 10 ? 'text-green-600' : 'text-orange-600'}`}>
                                  {r.marginPct.toFixed(1)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </Fragment>
                      );
                    })}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>{t.common.total}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.qty)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.base)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.withVat)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.cost)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.profit)}</TableCell>
                      <TableCell className="text-right">
                        {displayTotals.base > 0 ? ((displayTotals.profit / displayTotals.base) * 100).toFixed(1) : '0.0'}
                      </TableCell>
                    </TableRow>
                  </>
                ) : (
                  <>
                    {filteredRows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right">{fmt(r.qty)}</TableCell>
                        <TableCell className="text-right">{fmt(r.base)}</TableCell>
                        <TableCell className="text-right">{fmt(r.withVat)}</TableCell>
                        <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                        <TableCell className={`text-right ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmt(r.profit)}
                        </TableCell>
                        <TableCell className={`text-right ${r.marginPct >= 10 ? 'text-green-600' : 'text-orange-600'}`}>
                          {r.marginPct.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>{t.common.total}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.qty)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.base)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.withVat)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.cost)}</TableCell>
                      <TableCell className="text-right">{fmt(displayTotals.profit)}</TableCell>
                      <TableCell className="text-right">
                        {displayTotals.base > 0 ? ((displayTotals.profit / displayTotals.base) * 100).toFixed(1) : '0.0'}
                      </TableCell>
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
