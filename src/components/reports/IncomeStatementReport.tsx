/**
 * Demonstração de Resultados (Income Statement / P&L)
 * Built from posted journal trial balance — not sales heuristics.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Printer, FileSpreadsheet, FileDown, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { buildLineItemsTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';
import { useReportExportMeta } from '@/hooks/useReportExportMeta';
import { buildIncomeStatement, type TbRow } from '@/lib/reports/incomeStatement';

export default function IncomeStatementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const navigate = useNavigate();
  const filters = useSharedReportFilters();
  const {
    dateFrom: startDate,
    dateTo: endDate,
    setDateFrom: setStartDate,
    setDateTo: setEndDate,
    comparePrevious,
    yearAgoPeriod,
    apiBranchId,
    shared,
  } = filters;
  const { preview } = useReportExportMeta();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TbRow[]>([]);
  const [prevRows, setPrevRows] = useState<TbRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.chartOfAccounts.getTrialBalance(startDate, endDate, apiBranchId || undefined);
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          setRows([]);
        } else {
          setRows(Array.isArray(res.data) ? res.data : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load P&L');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, apiBranchId]);

  useEffect(() => {
    if (!comparePrevious || !yearAgoPeriod) {
      setPrevRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.chartOfAccounts.getTrialBalance(
          yearAgoPeriod.dateFrom,
          yearAgoPeriod.dateTo,
          apiBranchId || undefined,
        );
        if (!cancelled) setPrevRows(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!cancelled) setPrevRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [comparePrevious, yearAgoPeriod, apiBranchId]);

  const current = buildIncomeStatement(rows, t.incomeStatementUi);
  const previous = comparePrevious ? buildIncomeStatement(prevRows, t.incomeStatementUi) : null;
  const prevByDesc = new Map((previous?.lineItems || []).map((li) => [li.description + '|' + li.code, li.value]));

  const formatMoney = (value: number) => {
    const formatted = Math.abs(value).toLocaleString(locale, { minimumFractionDigits: 2 });
    return value < 0 ? `(${formatted})` : formatted;
  };

  const openLedger = (code: string) => {
    if (!code) return;
    navigate('/chart-of-accounts', { state: { openLedgerCode: code } });
  };

  const exportMeta = preview(t.incomeStatementUi.title, {
    subtitle: t.incomeStatementUi.periodLabel.replace('{from}', startDate).replace('{to}', endDate),
  });

  const handlePrint = async () => {
    const html = buildLineItemsTableHtml(
      current.lineItems.map((li) => ({
        code: li.code,
        description: li.description,
        value: formatMoney(li.value),
        value2: previous ? formatMoney(prevByDesc.get(li.description + '|' + li.code) || 0) : undefined,
        isSubtotal: li.isSubtotal,
        isTotal: li.isTotal,
        indent: li.indent,
      })),
      {
        ...exportMeta,
        colCode: t.incomeStatementUi.colCode,
        colDescription: t.incomeStatementUi.colDescription,
        colValue: t.incomeStatementUi.colValueKz,
        colValue2: previous ? t.incomeStatementUi.colYearAgo : undefined,
      },
    );
    await printReport(html);
  };

  const handlePdf = async () => {
    const html = buildLineItemsTableHtml(
      current.lineItems.map((li) => ({
        code: li.code,
        description: li.description,
        value: formatMoney(li.value),
        value2: previous ? formatMoney(prevByDesc.get(li.description + '|' + li.code) || 0) : undefined,
        isSubtotal: li.isSubtotal,
        isTotal: li.isTotal,
        indent: li.indent,
      })),
      {
        ...exportMeta,
        colCode: t.incomeStatementUi.colCode,
        colDescription: t.incomeStatementUi.colDescription,
        colValue: t.incomeStatementUi.colValueKz,
        colValue2: previous ? t.incomeStatementUi.colYearAgo : undefined,
      },
    );
    await saveReportPdf(html, `DR_${startDate}_${endDate}`);
  };

  const handleExcel = async () => {
    const data = current.lineItems.map((li) => {
      const row: Record<string, unknown> = {
        [t.incomeStatementUi.colCode]: li.code,
        [t.incomeStatementUi.colDescription]: li.description,
        [t.incomeStatementUi.colValueKz]: li.value,
      };
      if (previous) {
        row[t.incomeStatementUi.colYearAgo] = prevByDesc.get(li.description + '|' + li.code) || 0;
      }
      return row;
    });
    await exportReportExcel(data, `DR_${startDate}_${endDate}`, exportMeta);
  };

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t.incomeStatementUi.fromGlTitle}</AlertTitle>
        <AlertDescription>
          {t.incomeStatementUi.fromGlHint}{' '}
          {t.reportsCenterUi.drillToLedger}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="flex items-center gap-2">
            {current.netProfit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {t.incomeStatementUi.title}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void handlePrint()}>
              <Printer className="h-4 w-4 mr-1" />
              {t.reportsUi.print}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleExcel()}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handlePdf()}>
              <FileDown className="h-4 w-4 mr-1" />
              {t.reportsUi.savePdf}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!shared && (
            <div className="flex flex-wrap gap-4">
              <div>
                <Label>{t.reportsUi.dateFrom}</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>{t.reportsUi.dateTo}</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          )}

          {loading && <p className="text-sm text-muted-foreground">{t.common.loading}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Separator />

          {previous && (
            <div className="flex justify-end gap-8 text-xs text-muted-foreground font-medium px-1">
              <span className="w-32 text-right">{t.reportsCenterUi.yearAgoCol}</span>
              <span className="w-32 text-right">{t.incomeStatementUi.colValueKz}</span>
            </div>
          )}

          <div className="space-y-1 font-mono text-sm">
            {current.lineItems.map((li, idx) => {
              const prevVal = prevByDesc.get(li.description + '|' + li.code);
              return (
                <div
                  key={`${li.code}-${idx}`}
                  className={`flex justify-between gap-4 py-1 ${li.isTotal ? 'font-bold text-base border-t pt-2' : ''} ${li.isSubtotal ? 'font-semibold' : ''} ${li.code ? 'cursor-pointer hover:bg-muted/40 rounded px-1' : 'px-1'}`}
                  style={{ paddingLeft: (li.indent || 0) * 16 }}
                  onClick={() => li.code && openLedger(li.code)}
                  title={li.code ? t.reportsCenterUi.drillToLedger : undefined}
                >
                  <span>
                    {li.code ? `${li.code} ` : ''}
                    {li.description}
                  </span>
                  <span className="flex gap-8">
                    {previous && (
                      <span className="w-32 text-right text-muted-foreground">{formatMoney(prevVal || 0)}</span>
                    )}
                    <span className="w-32 text-right">{formatMoney(li.value)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
