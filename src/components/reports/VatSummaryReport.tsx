import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales } from '@/hooks/useERP';
import { Download, Receipt, ArrowDownCircle, ArrowUpCircle, Scale, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { exportReportExcel } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { unwrapListPayload } from '@/lib/listCache';
import { useTranslation } from '@/i18n';

interface RateBucket {
  rate: number;
  base: number;
  tax: number;
}

export default function VatSummaryReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);

  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const inRange = (raw?: string) => {
    if (!raw) return false;
    const d = String(raw).slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  };

  // Output VAT (IVA on sales) broken down by rate
  const output = useMemo(() => {
    const buckets: Record<string, RateBucket> = {};
    let base = 0;
    let tax = 0;
    sales
      .filter((s) => s.status === 'completed' && inRange(s.createdAt))
      .forEach((s) => {
        s.items.forEach((item) => {
          const rate = Number(item.taxRate || 0);
          const key = rate.toFixed(2);
          if (!buckets[key]) buckets[key] = { rate, base: 0, tax: 0 };
          buckets[key].base += Number(item.subtotal || 0);
          buckets[key].tax += Number(item.taxAmount || 0);
          base += Number(item.subtotal || 0);
          tax += Number(item.taxAmount || 0);
        });
      });
    return {
      buckets: Object.values(buckets).sort((a, b) => b.rate - a.rate),
      base,
      tax,
    };
  }, [sales, dateFrom, dateTo]);

  // Input VAT (deductible IVA on purchases)
  const input = useMemo(() => {
    let base = 0;
    let tax = 0;
    purchases
      .filter((p) => String(p.status || '') !== 'draft' && inRange(p.date || p.createdAt))
      .forEach((p) => {
        base += Number(p.subtotal || 0);
        tax += Number(p.ivaTotal || 0);
      });
    return { base, tax };
  }, [purchases, dateFrom, dateTo]);

  const netPayable = output.tax - input.tax;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  const handleExport = async () => {
    const rows: Record<string, unknown>[] = output.buckets.map((b) => ({
      [t.vatReportUi.section]: t.vatReportUi.outputVat,
      [t.vatReportUi.rate]: `${b.rate}%`,
      [t.vatReportUi.taxableBase]: b.base,
      [t.vatReportUi.taxAmount]: b.tax,
    }));
    rows.push({
      [t.vatReportUi.section]: t.vatReportUi.inputVat,
      [t.vatReportUi.rate]: '-',
      [t.vatReportUi.taxableBase]: input.base,
      [t.vatReportUi.taxAmount]: input.tax,
    });
    rows.push({
      [t.vatReportUi.section]: t.vatReportUi.netVat,
      [t.vatReportUi.rate]: '-',
      [t.vatReportUi.taxableBase]: '',
      [t.vatReportUi.taxAmount]: netPayable,
    });
    try {
      await exportReportExcel(rows, `IVA_${dateFrom}_${dateTo}`, {
        title: t.vatReportUi.title,
        subtitle: `${t.reportsUi.dateFrom}: ${dateFrom} — ${t.reportsUi.dateTo}: ${dateTo}`,
      });
    } catch (e) {
      console.error('[VatSummaryReport] excel export failed:', e);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                {t.vatReportUi.title}
              </CardTitle>
              <CardDescription>{t.vatReportUi.description}</CardDescription>
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
                <p className="text-2xl font-bold text-blue-500">{formatCurrency(output.tax)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t.vatReportUi.taxableBase}: {formatCurrency(output.base)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDownCircle className="w-4 h-4 text-orange-500" />
                  <p className="text-sm text-muted-foreground">{t.vatReportUi.inputVat}</p>
                </div>
                <p className="text-2xl font-bold text-orange-500">{formatCurrency(input.tax)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t.vatReportUi.taxableBase}: {formatCurrency(input.base)}
                </p>
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

          <Card>
            <CardHeader>
              <CardTitle>{t.vatReportUi.outputByRate}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.vatReportUi.rate}</TableHead>
                    <TableHead className="text-right">{t.vatReportUi.taxableBase}</TableHead>
                    <TableHead className="text-right">{t.vatReportUi.taxAmount}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {output.buckets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        {t.common.noResults}
                      </TableCell>
                    </TableRow>
                  ) : (
                    output.buckets.map((b) => (
                      <TableRow key={b.rate}>
                        <TableCell className="font-medium">{b.rate}%</TableCell>
                        <TableCell className="text-right">{formatCurrency(b.base)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(b.tax)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {output.buckets.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-bold">{t.common.total}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(output.base)}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(output.tax)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
