/**
 * Demonstração de Resultados — Angola PGC (classe 6 proveitos, classe 7 custos).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { buildLineItemsTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';
import { useReportExportMeta } from '@/hooks/useReportExportMeta';
import { buildIncomeStatement, type IncomeStatementLine, type TbRow } from '@/lib/reports/incomeStatement';
import { ReportStatStrip } from '@/components/reports/ReportStatStrip';
import { cn } from '@/lib/utils';

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
    const formatted = Math.abs(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return value < 0 ? `(${formatted})` : formatted;
  };

  const openLedger = (code: string) => {
    if (!code) return;
    navigate('/chart-of-accounts', { state: { openLedgerCode: code } });
  };

  const exportItems = current.lineItems.map((li) => ({
    code: li.code,
    description: li.description,
    value: li.isHeader ? '' : formatMoney(li.value),
    value2: previous && !li.isHeader ? formatMoney(prevByDesc.get(li.description + '|' + li.code) || 0) : undefined,
    isHeader: li.isHeader,
    isSubtotal: li.isSubtotal,
    isTotal: li.isTotal,
    indent: li.indent,
  }));

  const exportMeta = preview(t.incomeStatementUi.title, {
    subtitle: t.incomeStatementUi.periodLabel.replace('{from}', startDate).replace('{to}', endDate),
  });

  const exportOpts = {
    ...exportMeta,
    colCode: t.incomeStatementUi.colCode,
    colDescription: t.incomeStatementUi.colDescription,
    colValue: t.incomeStatementUi.colValueKz,
    colValue2: previous ? t.incomeStatementUi.colYearAgo : undefined,
  };

  const handlePrint = async () => {
    await printReport(buildLineItemsTableHtml(exportItems, exportOpts));
  };

  const handlePdf = async () => {
    await saveReportPdf(buildLineItemsTableHtml(exportItems, exportOpts), `DR_${startDate}_${endDate}`);
  };

  const handleExcel = async () => {
    const data = current.lineItems
      .filter((li) => !li.isHeader)
      .map((li) => {
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

  const rowClass = (li: IncomeStatementLine) => {
    if (li.isHeader) {
      return 'bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600';
    }
    if (li.isTotal) {
      return cn(
        'font-semibold border-t-2',
        current.netProfit >= 0 ? 'bg-emerald-50 text-emerald-950' : 'bg-rose-50 text-rose-950',
      );
    }
    if (li.isSubtotal) {
      return 'bg-muted/50 font-semibold border-t';
    }
    return li.code ? 'hover:bg-muted/40 cursor-pointer' : '';
  };

  return (
    <div className="space-y-3">
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

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t.incomeStatementUi.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.incomeStatementUi.periodLabel.replace('{from}', startDate).replace('{to}', endDate)}
            </p>
          </div>
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
        </div>

        <div className="border-b px-5 py-3">
          <ReportStatStrip
            columns="grid-cols-3"
            items={[
              { label: t.incomeStatementUi.kpiRevenue, value: formatMoney(current.totalRevenue) },
              { label: t.incomeStatementUi.kpiExpenses, value: formatMoney(current.totalExpenses) },
              {
                label: t.incomeStatementUi.kpiNet,
                value: formatMoney(current.netProfit),
                className: current.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700',
              },
            ]}
          />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-16 px-5 py-2 text-left font-medium">{t.incomeStatementUi.colCode}</th>
              <th className="px-3 py-2 text-left font-medium">{t.incomeStatementUi.colDescription}</th>
              {previous && (
                <th className="w-36 px-4 py-2 text-right font-medium">{t.incomeStatementUi.colYearAgo}</th>
              )}
              <th className="w-40 px-5 py-2 text-right font-medium">{t.incomeStatementUi.colValueKz}</th>
            </tr>
          </thead>
          <tbody>
            {current.lineItems.map((li, idx) => {
              const prevVal = prevByDesc.get(li.description + '|' + li.code);
              return (
                <tr
                  key={`${li.code}-${idx}`}
                  className={rowClass(li)}
                  onClick={() => li.code && openLedger(li.code)}
                  title={li.code ? t.reportsCenterUi.drillToLedger : undefined}
                >
                  <td className="px-5 py-1.5 font-mono text-xs text-muted-foreground">{li.isHeader ? '' : li.code}</td>
                  <td className="px-3 py-1.5">{li.description}</td>
                  {previous && (
                    <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                      {li.isHeader ? '' : formatMoney(prevVal || 0)}
                    </td>
                  )}
                  <td className="px-5 py-1.5 text-right tabular-nums">
                    {li.isHeader ? '' : formatMoney(li.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
          {t.incomeStatementUi.sourceNote}
        </p>
      </div>
    </div>
  );
}
