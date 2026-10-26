/**
 * Demonstração de Resultados — Angola PGC (classe 6 proveitos, classes 2 e 7 custos).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { printReport, saveReportPdf } from '@/lib/reportExport';
import { openExportPreview } from '@/lib/printPreview';
import { api } from '@/lib/api/client';
import { useSharedReportFilters } from '@/contexts/ReportsPeriodContext';
import { useReportExportMeta } from '@/hooks/useReportExportMeta';
import { buildIncomeStatement, type IncomeStatementLine, type TbRow } from '@/lib/reports/incomeStatement';
import { downloadIncomeStatementExcel } from '@/lib/reports/incomeStatementExcel';
import { buildIncomeStatementPrintHtml } from '@/lib/reports/incomeStatementPrint';
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
    branchLabel,
    periodLabel,
  } = filters;
  const { preview, companyName } = useReportExportMeta();

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

  const formatPct = (part: number, base: number) => {
    if (Math.abs(base) < 0.005) return '—';
    return `${((part / base) * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  };

  const formatVariancePct = (currentValue: number, previousValue: number) => {
    if (Math.abs(previousValue) < 0.005) return '—';
    const pct = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
    const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
    return `${sign}${Math.abs(pct).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  };

  const openLedger = (code: string) => {
    if (!code) return;
    navigate('/chart-of-accounts', { state: { openLedgerCode: code } });
  };

  const periodText = t.incomeStatementUi.periodLabel.replace('{from}', startDate).replace('{to}', endDate);
  const exportMeta = preview(t.incomeStatementUi.title, {
    subtitle: periodText,
    periodLabel: periodLabel || periodText,
  });

  const printMeta = {
    title: t.incomeStatementUi.title,
    subtitle: periodText,
    companyName: companyName || exportMeta.companyName,
    periodLabel: periodLabel || periodText,
    branchLabel: branchLabel || exportMeta.branchLabel,
    generatedAt: exportMeta.generatedAt,
    valuesInKz: t.incomeStatementUi.valuesInKz,
    sourceNote: t.incomeStatementUi.sourceNote,
    colCode: t.incomeStatementUi.colCode,
    colDescription: t.incomeStatementUi.colDescription,
    colValue: t.incomeStatementUi.colValueKz,
    colPrevious: previous ? t.incomeStatementUi.colYearAgo : undefined,
    colVariance: previous ? t.incomeStatementUi.colVariance : undefined,
    colVariancePct: previous ? t.incomeStatementUi.colVariancePct : undefined,
  };

  const printHtml = buildIncomeStatementPrintHtml({
    lines: current.lineItems,
    previousByKey: previous ? prevByDesc : undefined,
    meta: printMeta,
    locale,
  });

  const handlePrint = async () => {
    await printReport(printHtml);
  };

  const handlePdf = async () => {
    await saveReportPdf(printHtml, `DR_${startDate}_${endDate}`);
  };

  const handleExcel = async () => {
    const action = await openExportPreview({ html: printHtml, kind: 'excel' });
    if (action === 'cancel') return;
    downloadIncomeStatementExcel({
      lines: current.lineItems,
      previousByKey: previous ? prevByDesc : undefined,
      filename: `DR_${startDate}_${endDate}`,
      meta: {
        ...printMeta,
        sheetName: t.incomeStatementUi.sheetName,
        labelCompany: t.incomeStatementUi.labelCompany,
        labelPeriod: t.incomeStatementUi.labelPeriod,
        labelBranch: t.incomeStatementUi.labelBranch,
        labelGenerated: t.incomeStatementUi.labelGenerated,
      },
    });
  };

  const rowClass = (li: IncomeStatementLine) => {
    if (li.isHeader) {
      return 'bg-slate-800 text-[11px] font-semibold uppercase tracking-[0.14em] text-white';
    }
    if (li.isTotal) {
      return cn(
        'border-t-2 border-slate-900 font-semibold [border-bottom:3px_double_#0f172a]',
        current.netProfit >= 0 ? 'bg-emerald-50 text-emerald-950' : 'bg-rose-50 text-rose-950',
      );
    }
    if (li.isSubtotal) {
      return 'border-t border-slate-300 bg-slate-50 font-semibold';
    }
    return li.code ? 'hover:bg-slate-50 cursor-pointer' : '';
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

      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-slate-50/90 px-6 py-5">
          <div className="min-w-0">
            {companyName ? (
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{companyName}</p>
            ) : null}
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{t.incomeStatementUi.title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {[periodText, branchLabel, t.incomeStatementUi.valuesInKz].filter(Boolean).join(' · ')}
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

        <div className="border-b px-6 py-4">
          <ReportStatStrip
            columns="grid-cols-2 lg:grid-cols-4"
            items={[
              { label: t.incomeStatementUi.kpiRevenue, value: formatMoney(current.totalRevenue) },
              { label: t.incomeStatementUi.kpiExpenses, value: formatMoney(current.totalExpenses) },
              {
                label: t.incomeStatementUi.kpiNet,
                value: formatMoney(current.netProfit),
                className: current.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700',
              },
              {
                label: t.incomeStatementUi.netMargin,
                value: formatPct(current.netProfit, current.totalRevenue),
                hint: `${t.incomeStatementUi.grossMargin} ${formatPct(current.grossProfit, current.totalRevenue)}`,
              },
            ]}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-900 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="w-16 px-6 py-2.5 text-left font-medium">{t.incomeStatementUi.colCode}</th>
                <th className="px-3 py-2.5 text-left font-medium">{t.incomeStatementUi.colDescription}</th>
                {previous && (
                  <th className="w-36 px-4 py-2.5 text-right font-medium">{t.incomeStatementUi.colYearAgo}</th>
                )}
                <th className="w-40 px-6 py-2.5 text-right font-medium">{t.incomeStatementUi.colValueKz}</th>
                {previous && (
                  <th className="w-32 px-4 py-2.5 text-right font-medium">{t.incomeStatementUi.colVariance}</th>
                )}
                {previous && (
                  <th className="w-24 px-6 py-2.5 text-right font-medium">{t.incomeStatementUi.colVariancePct}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {current.lineItems.map((li, idx) => {
                const prevVal = prevByDesc.get(li.description + '|' + li.code) || 0;
                const delta = li.value - prevVal;
                return (
                  <tr
                    key={`${li.code}-${idx}`}
                    className={rowClass(li)}
                    onClick={() => li.code && openLedger(li.code)}
                    title={li.code ? t.reportsCenterUi.drillToLedger : undefined}
                  >
                    {li.isHeader ? (
                      <td className="px-6 py-2" colSpan={previous ? 6 : 3}>
                        {li.description}
                      </td>
                    ) : (
                      <>
                        <td className="px-6 py-1.5 font-mono text-xs text-slate-400">{li.code}</td>
                        <td className={cn('px-3 py-1.5', li.indent ? 'pl-8' : '')}>{li.description}</td>
                        {previous && (
                          <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">
                            {formatMoney(prevVal)}
                          </td>
                        )}
                        <td className="px-6 py-1.5 text-right tabular-nums">{formatMoney(li.value)}</td>
                        {previous && (
                          <td className={cn(
                            'px-4 py-1.5 text-right tabular-nums text-xs',
                            delta >= 0 ? 'text-emerald-700' : 'text-rose-700',
                          )}>
                            {formatMoney(delta)}
                          </td>
                        )}
                        {previous && (
                          <td className={cn(
                            'px-6 py-1.5 text-right tabular-nums text-xs',
                            delta >= 0 ? 'text-emerald-700' : 'text-rose-700',
                          )}>
                            {formatVariancePct(li.value, prevVal)}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="border-t px-6 py-3 text-[11px] leading-relaxed text-slate-500">
          {t.incomeStatementUi.sourceNote}
        </p>
      </div>
    </div>
  );
}
