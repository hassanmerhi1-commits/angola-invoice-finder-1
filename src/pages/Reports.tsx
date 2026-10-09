import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { exportReportExcelMulti } from '@/lib/reportExport';
import { ReportsPeriodProvider, useReportsPeriod } from '@/contexts/ReportsPeriodContext';
import { ReportsSnapshot, type SnapshotDoor } from '@/components/reports/ReportsSnapshot';
import { useReportExportMeta } from '@/hooks/useReportExportMeta';
import { buildIncomeStatement } from '@/lib/reports/incomeStatement';

const TAB_TO_DOOR: Record<string, SnapshotDoor> = {
  overview: null,
  home: null,
  sales: 'vendas',
  'daily-detail': 'vendas',
  receivables: 'receber',
  'client-statement': 'receber',
  payables: 'pagar',
  'supplier-statement': 'pagar',
  inventory: 'stock',
  'stock-valuation': 'stock',
  'stock-movements': 'stock',
  'stock-adjustments': 'stock',
  'dead-stock': 'stock',
  ops: 'stock',
  vat: 'iva',
  financial: 'fecho',
  'income-statement': 'fecho',
  'balance-sheet': 'fecho',
  'trial-balance': 'books',
  'cash-flow': 'books',
  purchases: 'books',
  profit: 'books',
  profitability: 'books',
  statistics: 'books',
  monthly: 'books',
  daily: 'books',
  books: 'books',
};

const DOOR_TO_TAB: Record<Exclude<SnapshotDoor, null>, string> = {
  vendas: 'sales',
  receber: 'receivables',
  pagar: 'payables',
  stock: 'stock-valuation',
  fecho: 'income-statement',
  iva: 'vat',
  books: 'trial-balance',
};

function resolveDoor(value: string | undefined): SnapshotDoor {
  if (!value) return null;
  if (value in TAB_TO_DOOR) return TAB_TO_DOOR[value];
  return null;
}

export default function Reports() {
  return (
    <ReportsPeriodProvider>
      <ReportsInner />
    </ReportsPeriodProvider>
  );
}

function ReportsInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { apiBranchId, dateFrom, dateTo, periodLabel, branchLabel } = useReportsPeriod();
  const { preview } = useReportExportMeta();
  const [door, setDoor] = useState<SnapshotDoor>(null);
  const [monthEndExporting, setMonthEndExporting] = useState(false);

  useEffect(() => {
    const stateTab = (location.state as { reportsTab?: string } | null)?.reportsTab;
    const queryTab = new URLSearchParams(location.search).get('tab') ?? undefined;
    setDoor(resolveDoor(stateTab || queryTab || undefined));
  }, [location.state, location.search]);

  const openDoor = (next: SnapshotDoor) => {
    setDoor(next);
    navigate('/reports', {
      replace: true,
      state: { reportsTab: next ? DOOR_TO_TAB[next] : 'home' },
    });
  };

  const handleMonthEndPack = async () => {
    setMonthEndExporting(true);
    const packFrom = dateFrom;
    const packTo = dateTo;
    const year = Number(packTo.slice(0, 4)) || new Date().getFullYear();
    const month = Number(packTo.slice(5, 7)) || new Date().getMonth() + 1;
    const prevAsOf = (() => {
      const d = new Date(`${packTo}T12:00:00`);
      d.setFullYear(d.getFullYear() - 1);
      return format(d, 'yyyy-MM-dd');
    })();

    let salesMonth = 0;
    let receivable = 0;
    let payable = 0;
    let avgMargin = 0;
    try {
      const kpis = await api.dashboard.kpis(apiBranchId);
      const data = kpis.data as {
        monthSales?: { total?: number };
        openAR?: { total?: number };
        openAP?: { total?: number };
        avgMargin?: number;
      } | undefined;
      salesMonth = Number(data?.monthSales?.total) || 0;
      receivable = Number(data?.openAR?.total) || 0;
      payable = Number(data?.openAP?.total) || 0;
      avgMargin = Number(data?.avgMargin) || 0;
    } catch {
      /* demo / offline */
    }

    const overviewSheet = [
      { Metric: t.reportsCenterUi.quickStats.salesMonth, Value: salesMonth },
      { Metric: t.reportsCenterUi.quickStats.receivable, Value: receivable },
      { Metric: t.reportsCenterUi.quickStats.payable, Value: payable },
      { Metric: t.reportsCenterUi.quickStats.avgMargin, Value: `${avgMargin.toFixed(1)}%` },
      { Metric: t.reportsUi.dateFrom, Value: packFrom },
      { Metric: t.reportsUi.dateTo, Value: packTo },
      { Metric: t.salesAnalysisUi.branch, Value: branchLabel },
      { Metric: 'Note', Value: t.reportsCenterUi.monthEndPackDesc },
    ];

    let trialSheet: Record<string, unknown>[] = [{ Note: 'Trial balance unavailable' }];
    let incomeSheet: Record<string, unknown>[] = [{ Note: 'Income statement unavailable' }];
    let balanceSheet: Record<string, unknown>[] = [{ Note: 'Balance sheet unavailable' }];
    let vatSheet: Record<string, unknown>[] = [{ Note: 'VAT report unavailable' }];
    let arSheet: Record<string, unknown>[] = [{ Note: 'Receivables unavailable' }];
    let apSheet: Record<string, unknown>[] = [{ Note: 'Payables unavailable' }];

    try {
      const tb = await api.chartOfAccounts.getTrialBalance(packFrom, packTo, apiBranchId);
      if (tb.data?.length) {
        const rows = tb.data.filter((row: { is_header?: boolean }) => !row.is_header);
        trialSheet = rows.map((row: Record<string, unknown>) => ({
          Code: row.code,
          Name: row.name,
          Type: row.account_type,
          Opening: Number(row.opening_balance) || 0,
          Debits: Number(row.total_debits) || 0,
          Credits: Number(row.total_credits) || 0,
          Closing: Number(row.closing_balance) || 0,
        }));
        const built = buildIncomeStatement(rows, t.incomeStatementUi);
        incomeSheet = built.lineItems.map((li) => ({
          Code: li.code,
          Description: li.description,
          Value: li.value,
        }));
      }
    } catch (e) {
      console.warn('[Reports] month-end trial balance skipped:', e);
    }

    try {
      const bs = await api.chartOfAccounts.getBalanceSheet(packTo, prevAsOf);
      const rows = Array.isArray(bs.data?.rows) ? bs.data.rows : [];
      if (rows.length) {
        balanceSheet = rows
          .filter((row: { is_header?: boolean }) => !row.is_header)
          .map((row: Record<string, unknown>) => ({
            Code: row.code,
            Name: row.name,
            Type: row.account_type,
            Current: Number(row.current_balance) || 0,
            Previous: Number(row.previous_balance) || 0,
          }));
      }
    } catch (e) {
      console.warn('[Reports] month-end balance sheet skipped:', e);
    }

    try {
      const iva = await api.tax.ivaReport(year, month);
      const lines = Array.isArray(iva.data?.lines) ? iva.data.lines : [];
      if (lines.length) {
        vatSheet = lines.map((l: Record<string, unknown>) => ({
          Direction: l.direction,
          Code: l.tax_code,
          Rate: l.tax_rate,
          Base: Number(l.total_base) || 0,
          Tax: Number(l.total_tax) || 0,
        }));
        vatSheet.push({
          Direction: 'net',
          Code: '',
          Rate: '',
          Base: '',
          Tax: Number(iva.data?.ivaPayable ?? Number(iva.data?.outputTax || 0) - Number(iva.data?.inputTax || 0)),
        });
      } else {
        vatSheet = [
          { Metric: 'Output VAT', Value: Number(iva.data?.outputTax) || 0 },
          { Metric: 'Input VAT', Value: Number(iva.data?.inputTax) || 0 },
          { Metric: 'Net payable', Value: Number(iva.data?.ivaPayable) || 0 },
        ];
      }
    } catch (e) {
      console.warn('[Reports] month-end VAT skipped:', e);
    }

    try {
      const ar = await api.payments.receivablesAging(apiBranchId);
      arSheet = (Array.isArray(ar.data) ? ar.data : []).map((row: Record<string, unknown>) => ({
        Client: row.client_name || row.entity_name,
        NIF: row.client_nif,
        Remaining: Number(row.remaining_amount) || 0,
        Due: row.due_date || row.dueDate,
        Document: row.document_number,
      }));
      if (!arSheet.length) arSheet = [{ Note: 'No open receivables' }];
    } catch (e) {
      console.warn('[Reports] month-end AR skipped:', e);
    }

    try {
      const ap = await api.payments.payablesAging(apiBranchId);
      apSheet = (Array.isArray(ap.data) ? ap.data : []).map((row: Record<string, unknown>) => ({
        Supplier: row.supplier_name || row.entity_name,
        NIF: row.supplier_nif,
        Remaining: Number(row.remaining_amount) || 0,
        Due: row.due_date || row.dueDate,
        Document: row.document_number,
      }));
      if (!apSheet.length) apSheet = [{ Note: 'No open payables' }];
    } catch (e) {
      console.warn('[Reports] month-end AP skipped:', e);
    }

    try {
      await exportReportExcelMulti(
        [
          { name: 'Overview', data: overviewSheet },
          { name: 'Income Statement', data: incomeSheet },
          { name: 'Balance Sheet', data: balanceSheet },
          { name: 'Trial Balance', data: trialSheet },
          { name: 'VAT', data: vatSheet },
          { name: 'Receivables', data: arSheet },
          { name: 'Payables', data: apSheet },
        ],
        `MonthEnd_${packFrom}_${packTo}`,
        preview(t.reportsCenterUi.monthEndPack, { subtitle: periodLabel }),
      );
    } catch (e) {
      console.error('[Reports] month-end pack failed:', e);
    } finally {
      setMonthEndExporting(false);
    }
  };

  return (
    <ReportsSnapshot
      door={door}
      onDoor={openDoor}
      onMonthEndPack={() => void handleMonthEndPack()}
      monthEndExporting={monthEndExporting}
    />
  );
}
