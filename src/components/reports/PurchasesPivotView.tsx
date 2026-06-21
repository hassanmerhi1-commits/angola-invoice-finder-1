import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Printer, FileDown } from 'lucide-react';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { useTranslation } from '@/i18n';
import type { PurchaseRow, PurchaseTotals } from '@/lib/reports/purchasesPivot';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PurchasesPivotViewProps {
  dimensionLabel: string;
  rows: PurchaseRow[];
  totals: PurchaseTotals;
  fileName: string;
  /** Distinct invoice count for the footer (groupings may double count). */
  totalInvoices?: number;
  showChart?: boolean;
  /** Optional subtitle (e.g. the period) shown on the printed/PDF header. */
  subtitle?: string;
}

export default function PurchasesPivotView({
  dimensionLabel,
  rows,
  totals,
  fileName,
  totalInvoices,
  showChart = true,
  subtitle,
}: PurchasesPivotViewProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { companyName } = useCompanyLogo();

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

  const fmt2 = (n: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

  const buildPrintHtml = () => {
    const body = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.label)}</td>
          <td class="r">${fmt2(r.qty)}</td>
          <td class="r">${r.invoices}</td>
          <td class="r">${fmt2(r.total)}</td>
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
        @media print { body { padding: 0; } @page { size: A4 portrait; margin: 12mm; } }
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
              <th class="r">${escapeHtml(t.purchasesReportUi.qty)}</th>
              <th class="r">${escapeHtml(t.purchasesReportUi.invoices)}</th>
              <th class="r">${escapeHtml(t.purchasesReportUi.totalSpend)}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr>
              <td>${escapeHtml(t.common.total)}</td>
              <td class="r">${fmt2(totals.qty)}</td>
              <td class="r">${totalInvoices ?? totals.invoices}</td>
              <td class="r">${fmt2(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </body></html>`;
  };

  const handlePrint = async () => {
    try {
      await printHtml(buildPrintHtml());
    } catch (e) {
      console.error('[PurchasesPivotView] print failed:', e);
    }
  };

  const handleSavePdf = async () => {
    const html = buildPrintHtml();
    try {
      const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
      if (el?.isElectron && el?.pdf?.saveHtml) {
        await el.pdf.saveHtml(html, { filename: `${fileName}.pdf` });
        return;
      }
      await printHtml(html, { direct: true });
    } catch (e) {
      console.error('[PurchasesPivotView] save pdf failed:', e);
    }
  };

  const chartData = useMemo(
    () =>
      rows
        .slice(0, 12)
        .map((r) => ({ name: r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label, total: r.total })),
    [rows],
  );

  const handleExport = () => {
    const data = rows.map((r) => ({
      [dimensionLabel]: r.label,
      [t.purchasesReportUi.qty]: Number(r.qty.toFixed(2)),
      [t.purchasesReportUi.invoices]: r.invoices,
      [t.purchasesReportUi.totalSpend]: Number(r.total.toFixed(2)),
    }));
    exportToExcel(data, fileName);
  };

  return (
    <div className="space-y-4">
      {showChart && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.purchasesReportUi.totalSpend}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={140} />
                  <Tooltip formatter={(value: number) => fmt(value)} />
                  <Bar dataKey="total" name={t.purchasesReportUi.totalSpend} fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-base">{dimensionLabel}</CardTitle>
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
                  <TableHead>{dimensionLabel}</TableHead>
                  <TableHead className="text-right">{t.purchasesReportUi.qty}</TableHead>
                  <TableHead className="text-right">{t.purchasesReportUi.invoices}</TableHead>
                  <TableHead className="text-right">{t.purchasesReportUi.totalSpend}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      {t.common.noResults}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-right">{fmt(r.qty)}</TableCell>
                        <TableCell className="text-right">{r.invoices}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(r.total)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>{t.common.total}</TableCell>
                      <TableCell className="text-right">{fmt(totals.qty)}</TableCell>
                      <TableCell className="text-right">{totalInvoices ?? totals.invoices}</TableCell>
                      <TableCell className="text-right">{fmt(totals.total)}</TableCell>
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
