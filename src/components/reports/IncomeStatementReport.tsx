/**
 * Demonstração de Resultados (Income Statement / P&L)
 * Built from posted journal trial balance — not sales heuristics.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Download, Printer, FileSpreadsheet, FileDown, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { buildLineItemsTableHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';
import { api } from '@/lib/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface LineItem {
  code: string;
  description: string;
  value: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
}

type TbRow = {
  code?: string;
  name?: string;
  account_type?: string;
  account_nature?: string;
  total_debits?: number;
  total_credits?: number;
  closing_balance?: number;
};

function periodMovement(row: TbRow): number {
  const debits = Number(row.total_debits || 0);
  const credits = Number(row.total_credits || 0);
  const nature = String(row.account_nature || '').toLowerCase();
  // P&L uses period activity: revenue (credit nature) = credits - debits; expense = debits - credits
  if (nature === 'credit') return credits - debits;
  return debits - credits;
}

function sumByPrefix(rows: TbRow[], prefixes: string[]): number {
  return rows.reduce((sum, row) => {
    const code = String(row.code || '').trim();
    if (!code) return sum;
    if (prefixes.some((p) => code === p || code.startsWith(p))) {
      return sum + periodMovement(row);
    }
    return sum;
  }, 0);
}

export default function IncomeStatementReport() {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();

  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMonth(0, 1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TbRow[]>([]);

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

  const salesOfGoods = sumByPrefix(rows, ['71']);
  const services = sumByPrefix(rows, ['72']);
  const otherIncome = sumByPrefix(rows, ['73', '74', '75']);
  const operatingIncome = salesOfGoods + services + otherIncome;

  const cogs = sumByPrefix(rows, ['61']);
  const grossProfit = operatingIncome - cogs;

  const externalSupplies = sumByPrefix(rows, ['62']);
  const personnel = sumByPrefix(rows, ['63']);
  const depreciation = sumByPrefix(rows, ['64']);
  const otherOpex = sumByPrefix(rows, ['65', '66', '67', '68']);
  const totalOperatingExpenses = externalSupplies + personnel + depreciation + otherOpex;

  const operatingProfit = grossProfit - totalOperatingExpenses;

  const financialIncome = sumByPrefix(rows, ['78']);
  const financialExpenses = sumByPrefix(rows, ['69']);
  const financialResult = financialIncome - financialExpenses;

  const profitBeforeTax = operatingProfit + financialResult;
  const incomeTax = sumByPrefix(rows, ['81']);
  const netProfit = profitBeforeTax - incomeTax;

  const formatMoney = (value: number) => {
    const formatted = Math.abs(value).toLocaleString(locale, { minimumFractionDigits: 2 });
    return value < 0 ? `(${formatted})` : formatted;
  };

  const lineItems: LineItem[] = [
    { code: '71', description: t.incomeStatementUi.salesOfGoods, value: salesOfGoods },
    { code: '72', description: t.incomeStatementUi.servicesProvided, value: services },
    { code: '73', description: t.incomeStatementUi.otherOperatingIncome, value: otherIncome },
    { code: '', description: t.incomeStatementUi.operatingIncome, value: operatingIncome, isSubtotal: true },

    { code: '61', description: t.incomeStatementUi.costOfGoodsSold, value: -cogs, indent: 1 },
    { code: '', description: t.incomeStatementUi.grossResult, value: grossProfit, isSubtotal: true },

    { code: '62', description: t.incomeStatementUi.externalSuppliesServices, value: -externalSupplies, indent: 1 },
    { code: '63', description: t.incomeStatementUi.personnelExpenses, value: -personnel, indent: 1 },
    { code: '64', description: t.incomeStatementUi.depreciationAmortization, value: -depreciation, indent: 1 },
    { code: '65', description: t.incomeStatementUi.otherOperatingExpenses, value: -otherOpex, indent: 1 },
    { code: '', description: t.incomeStatementUi.totalOperatingExpenses, value: -totalOperatingExpenses, isSubtotal: true },

    { code: '', description: t.incomeStatementUi.operatingResult, value: operatingProfit, isSubtotal: true },

    { code: '78', description: t.incomeStatementUi.financialIncome, value: financialIncome, indent: 1 },
    { code: '69', description: t.incomeStatementUi.financialExpenses, value: -financialExpenses, indent: 1 },
    { code: '', description: t.incomeStatementUi.financialResult, value: financialResult, isSubtotal: true },

    { code: '', description: t.incomeStatementUi.resultBeforeTax, value: profitBeforeTax, isSubtotal: true },
    { code: '81', description: t.incomeStatementUi.incomeTax, value: -incomeTax, indent: 1 },
    { code: '', description: t.incomeStatementUi.netResult, value: netProfit, isTotal: true },
  ];

  const exportRows = lineItems.map((li) => ({
    code: li.code,
    description: li.description,
    value: li.value,
  }));

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t.incomeStatementUi?.fromGlTitle || 'From posted journals'}</AlertTitle>
        <AlertDescription>
          {t.incomeStatementUi?.fromGlHint
            || 'Built from trial-balance period activity (classes 6/7/8). Empty periods show zeros until journals exist.'}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="flex items-center gap-2">
            {netProfit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            {t.incomeStatementUi.title}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => printReport(t.incomeStatementUi.title, buildLineItemsTableHtml(exportRows, locale))}>
              <Printer className="h-4 w-4 mr-1" />
              {t.common?.print || 'Print'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportReportExcel(t.incomeStatementUi.title, exportRows)}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => saveReportPdf(t.incomeStatementUi.title, buildLineItemsTableHtml(exportRows, locale))}>
              <FileDown className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <Label>{t.common?.from || 'From'}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>{t.common?.to || 'To'}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {loading && <p className="text-sm text-muted-foreground">…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Separator />

          <div className="space-y-1 font-mono text-sm">
            {lineItems.map((li, idx) => (
              <div
                key={`${li.code}-${idx}`}
                className={`flex justify-between gap-4 py-1 ${li.isTotal ? 'font-bold text-base border-t pt-2' : ''} ${li.isSubtotal ? 'font-semibold' : ''}`}
                style={{ paddingLeft: (li.indent || 0) * 16 }}
              >
                <span>
                  {li.code ? `${li.code} ` : ''}
                  {li.description}
                </span>
                <span>{formatMoney(li.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
