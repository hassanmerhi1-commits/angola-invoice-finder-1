import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Download, Receipt, ArrowDownCircle, ArrowUpCircle, Scale, Loader2, ExternalLink, FileCode } from 'lucide-react';
import { exportReportExcel, printReport, saveReportPdf, buildDataTableHtml } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';

type IvaLine = {
  direction: string;
  tax_code: string;
  tax_rate: number | string;
  total_base: number | string;
  total_tax: number | string;
  document_count?: number | string;
};

type IvaReport = {
  lines: IvaLine[];
  outputTax: number;
  inputTax: number;
  ivaPayable: number;
};

const EMPTY: IvaReport = { lines: [], outputTax: 0, inputTax: 0, ivaPayable: 0 };

/** Fiscal IVA from tax_summaries / v_iva_monthly — same source as Tax Management. */
export default function VatSummaryReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const filters = useSharedReportFilters();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [report, setReport] = useState<IvaReport>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!filters.shared) return;
    const y = Number(filters.dateTo.slice(0, 4));
    const m = Number(filters.dateTo.slice(5, 7));
    if (y) setYear(y);
    if (m) setMonth(m);
  }, [filters.shared, filters.dateTo]);

  const years = useMemo(() => Array.from({ length: 6 }, (_, i) => now.getFullYear() - i), [now]);
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i + 1,
        label: new Date(2024, i, 1).toLocaleString(locale, { month: 'long' }),
      })),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.tax.ivaReport(year, month);
        if (cancelled) return;
        const data = res.data || EMPTY;
        setReport({
          lines: Array.isArray(data.lines) ? data.lines : [],
          outputTax: Number(data.outputTax || 0),
          inputTax: Number(data.inputTax || 0),
          ivaPayable: Number(data.ivaPayable ?? Number(data.outputTax || 0) - Number(data.inputTax || 0)),
        });
      } catch {
        if (!cancelled) setReport(EMPTY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const outputLines = useMemo(
    () => report.lines.filter((l) => String(l.direction).toLowerCase() === 'output'),
    [report.lines],
  );
  const inputLines = useMemo(
    () => report.lines.filter((l) => String(l.direction).toLowerCase() === 'input'),
    [report.lines],
  );
  const netPayable = report.ivaPayable;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const periodLabel = `${months.find((m) => m.value === month)?.label || month} ${year}`;

  const excelRows = useMemo(() => {
    const rows: Record<string, unknown>[] = [];
    for (const l of outputLines) {
      rows.push({
        [t.vatReportUi.section]: t.vatReportUi.outputVat,
        [t.vatReportUi.rate]: `${Number(l.tax_rate)}%`,
        Code: l.tax_code,
        [t.vatReportUi.taxableBase]: Number(l.total_base || 0),
        [t.vatReportUi.taxAmount]: Number(l.total_tax || 0),
      });
    }
    for (const l of inputLines) {
      rows.push({
        [t.vatReportUi.section]: t.vatReportUi.inputVat,
        [t.vatReportUi.rate]: `${Number(l.tax_rate)}%`,
        Code: l.tax_code,
        [t.vatReportUi.taxableBase]: Number(l.total_base || 0),
        [t.vatReportUi.taxAmount]: Number(l.total_tax || 0),
      });
    }
    rows.push({
      [t.vatReportUi.section]: t.vatReportUi.netVat,
      [t.vatReportUi.rate]: '-',
      Code: '',
      [t.vatReportUi.taxableBase]: '',
      [t.vatReportUi.taxAmount]: netPayable,
    });
    return rows;
  }, [outputLines, inputLines, netPayable, t.vatReportUi]);

  const handleExport = async () => {
    try {
      await exportReportExcel(excelRows, `IVA_${year}_${String(month).padStart(2, '0')}`, {
        title: t.vatReportUi.title,
        subtitle: periodLabel,
      });
    } catch (e) {
      console.error('[VatSummaryReport] excel export failed:', e);
    }
  };

  const handlePrint = () => {
    const html = buildDataTableHtml(excelRows, { title: t.vatReportUi.title, subtitle: periodLabel });
    printReport(html);
  };

  const handlePdf = async () => {
    try {
      const html = buildDataTableHtml(excelRows, { title: t.vatReportUi.title, subtitle: periodLabel });
      await saveReportPdf(html, `IVA_${year}_${String(month).padStart(2, '0')}.pdf`);
    } catch (e) {
      console.error('[VatSummaryReport] save pdf failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                {t.vatReportUi.title}
              </CardTitle>
              <CardDescription>{t.vatReportUi.fiscalDescription}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/tax-management">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t.vatReportUi.openTaxManagement}
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/fiscal-documents" state={{ openSaft: true }}>
                  <FileCode className="w-4 h-4 mr-2" />
                  {t.vatReportUi.openSaft}
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                {t.reportsUi.print}
              </Button>
              <Button variant="outline" size="sm" onClick={handlePdf}>
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                {t.reportsUi.exportExcel}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>{t.vatReportUi.year}</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.vatReportUi.month}</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t.common.loading}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowUpCircle className="w-4 h-4 text-blue-500" />
                  <p className="text-sm text-muted-foreground">{t.vatReportUi.outputVat}</p>
                </div>
                <p className="text-2xl font-bold text-blue-500">{formatCurrency(report.outputTax)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDownCircle className="w-4 h-4 text-orange-500" />
                  <p className="text-sm text-muted-foreground">{t.vatReportUi.inputVat}</p>
                </div>
                <p className="text-2xl font-bold text-orange-500">{formatCurrency(report.inputTax)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Scale className="w-4 h-4" />
                  <p className="text-sm text-muted-foreground">
                    {netPayable >= 0 ? t.vatReportUi.netPayable : t.vatReportUi.netCredit}
                  </p>
                </div>
                <p className={`text-2xl font-bold ${netPayable >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {formatCurrency(Math.abs(netPayable))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t.vatReportUi.netHint}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t.vatReportUi.outputByRate}</CardTitle>
              </CardHeader>
              <CardContent>
                <RateTable
                  lines={outputLines}
                  formatCurrency={formatCurrency}
                  emptyLabel={t.common.noResults}
                  rateLabel={t.vatReportUi.rate}
                  baseLabel={t.vatReportUi.taxableBase}
                  taxLabel={t.vatReportUi.taxAmount}
                  totalLabel={t.common.total}
                  totalTax={report.outputTax}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t.vatReportUi.inputByRate}</CardTitle>
              </CardHeader>
              <CardContent>
                <RateTable
                  lines={inputLines}
                  formatCurrency={formatCurrency}
                  emptyLabel={t.common.noResults}
                  rateLabel={t.vatReportUi.rate}
                  baseLabel={t.vatReportUi.taxableBase}
                  taxLabel={t.vatReportUi.taxAmount}
                  totalLabel={t.common.total}
                  totalTax={report.inputTax}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function RateTable({
  lines,
  formatCurrency,
  emptyLabel,
  rateLabel,
  baseLabel,
  taxLabel,
  totalLabel,
  totalTax,
}: {
  lines: IvaLine[];
  formatCurrency: (n: number) => string;
  emptyLabel: string;
  rateLabel: string;
  baseLabel: string;
  taxLabel: string;
  totalLabel: string;
  totalTax: number;
}) {
  const baseSum = lines.reduce((s, l) => s + Number(l.total_base || 0), 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{rateLabel}</TableHead>
          <TableHead>Code</TableHead>
          <TableHead className="text-right">{baseLabel}</TableHead>
          <TableHead className="text-right">{taxLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
              {emptyLabel}
            </TableCell>
          </TableRow>
        ) : (
          lines.map((l, i) => (
            <TableRow key={`${l.tax_code}-${l.tax_rate}-${i}`}>
              <TableCell className="font-medium">{Number(l.tax_rate)}%</TableCell>
              <TableCell>{l.tax_code}</TableCell>
              <TableCell className="text-right">{formatCurrency(Number(l.total_base || 0))}</TableCell>
              <TableCell className="text-right">{formatCurrency(Number(l.total_tax || 0))}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
      {lines.length > 0 && (
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="font-bold">
              {totalLabel}
            </TableCell>
            <TableCell className="text-right font-bold">{formatCurrency(baseSum)}</TableCell>
            <TableCell className="text-right font-bold">{formatCurrency(totalTax)}</TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
