import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { TrendingUp, Clock, Truck, Package, DollarSign, Receipt, Loader2, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { useProducts } from '@/hooks/useERP';
import { useReportSales } from '@/hooks/useReportSales';
import { useReportsPeriod } from '@/contexts/ReportsPeriodContext';
import { ReportsPeriodBar } from '@/components/reports/ReportsPeriodBar';
import { ReportStatStrip } from '@/components/reports/ReportStatStrip';
import { NEXOR_STAT_CARD_TONE, type NexorTone } from '@/lib/nexorToneStyles';
import { cn } from '@/lib/utils';

const FinancialReports = lazy(() => import('@/components/reports/FinancialReports'));
const SalesAnalysisReport = lazy(() => import('@/components/reports/SalesAnalysisReport'));
const AccountsReceivableReport = lazy(() => import('@/components/reports/AccountsReceivableReport'));
const AccountsPayableReport = lazy(() => import('@/components/reports/AccountsPayableReport'));
const InventoryReports = lazy(() => import('@/components/reports/InventoryReports'));
const VatSummaryReport = lazy(() => import('@/components/reports/VatSummaryReport'));
const IncomeStatementReport = lazy(() => import('@/components/reports/IncomeStatementReport'));

export type SnapshotDoor = 'vendas' | 'receber' | 'pagar' | 'stock' | 'fecho' | 'iva' | 'books' | null;

type OpenRow = { id: string; name: string; total: number };

function kz(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);
}

function groupOpen(rows: Record<string, unknown>[], asOf: string, nameKeys: string[]): OpenRow[] {
  const by = new Map<string, OpenRow>();
  for (const row of rows) {
    const id = String(row.entity_id || row.client_id || row.supplier_id || '');
    const amount = Number(row.remaining_amount || 0);
    if (!id || amount <= 0.001) continue;
    const docDate = String(row.document_date || '').slice(0, 10);
    if (docDate && docDate > asOf) continue;
    const name = String(nameKeys.map((k) => row[k]).find(Boolean) || id);
    const prev = by.get(id);
    if (prev) {
      prev.total += amount;
    } else {
      by.set(id, { id, name, total: amount });
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

function ReportFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function ReportsSnapshot({
  door,
  onDoor,
  onMonthEndPack,
  monthEndExporting,
}: {
  door: SnapshotDoor;
  onDoor: (door: SnapshotDoor) => void;
  onMonthEndPack: () => void;
  monthEndExporting: boolean;
}) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId, dateTo } = useReportsPeriod();
  const { sales } = useReportSales();
  const { products } = useProducts(apiBranchId, { light: true });
  const [arRows, setArRows] = useState<Record<string, unknown>[]>([]);
  const [apRows, setApRows] = useState<Record<string, unknown>[]>([]);
  const [iva, setIva] = useState({ output: 0, input: 0, net: 0 });

  const year = Number(dateTo.slice(0, 4)) || new Date().getFullYear();
  const month = Number(dateTo.slice(5, 7)) || new Date().getMonth() + 1;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ar, ap, vat] = await Promise.all([
          api.payments.receivablesAging(apiBranchId),
          api.payments.payablesAging(apiBranchId),
          api.tax.ivaReport(year, month),
        ]);
        if (cancelled) return;
        setArRows(Array.isArray(ar.data) ? ar.data : []);
        setApRows(Array.isArray(ap.data) ? ap.data : []);
        const output = Number(vat.data?.outputTax || 0);
        const input = Number(vat.data?.inputTax || 0);
        setIva({
          output,
          input,
          net: Number(vat.data?.ivaPayable ?? output - input),
        });
      } catch {
        if (!cancelled) {
          setArRows([]);
          setApRows([]);
          setIva({ output: 0, input: 0, net: 0 });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBranchId, year, month]);

  const liveSales = useMemo(
    () => sales.filter((s) => s.status !== 'voided'),
    [sales],
  );
  const salesTotal = liveSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const receivables = useMemo(() => groupOpen(arRows, dateTo, ['client_name', 'entity_name']), [arRows, dateTo]);
  const payables = useMemo(() => groupOpen(apRows, dateTo, ['supplier_name', 'entity_name']), [apRows, dateTo]);
  const arTotal = receivables.reduce((sum, r) => sum + r.total, 0);
  const apTotal = payables.reduce((sum, r) => sum + r.total, 0);

  const stockRows = useMemo(() => {
    return products
      .map((p) => {
        const unitCost = p.avgCost != null && Number.isFinite(Number(p.avgCost)) ? Number(p.avgCost) : Number(p.cost) || 0;
        const qty = Number(p.stock) || 0;
        return { id: p.id, name: p.name, qty, value: qty * unitCost };
      })
      .filter((p) => p.qty > 0)
      .sort((a, b) => b.value - a.value);
  }, [products]);
  const stockTotal = stockRows.reduce((sum, r) => sum + r.value, 0);

  const cards = [
    {
      id: 'vendas' as const,
      title: t.reportsCenterUi.doorVendas,
      hint: t.reportsCenterUi.snapshotSalesCount.replace('{count}', String(liveSales.length)),
      amount: salesTotal,
      tone: 'sky' as NexorTone,
      icon: TrendingUp,
    },
    {
      id: 'receber' as const,
      title: t.reportsCenterUi.doorReceivable,
      hint: t.reportsCenterUi.snapshotPeopleCount.replace('{count}', String(receivables.length)),
      amount: arTotal,
      tone: 'amber' as NexorTone,
      icon: Clock,
    },
    {
      id: 'pagar' as const,
      title: t.reportsCenterUi.doorPayable,
      hint: t.reportsCenterUi.snapshotPeopleCount.replace('{count}', String(payables.length)),
      amount: apTotal,
      tone: 'rose' as NexorTone,
      icon: Truck,
    },
    {
      id: 'stock' as const,
      title: t.reportsCenterUi.doorStock,
      hint: t.reportsCenterUi.snapshotProductsCount.replace('{count}', String(stockRows.length)),
      amount: stockTotal,
      tone: 'emerald' as NexorTone,
      icon: Package,
    },
    {
      id: 'fecho' as const,
      title: t.reportsCenterUi.doorMonthEnd,
      hint: t.reportsCenterUi.doorMonthEndHint,
      amount: salesTotal,
      tone: 'indigo' as NexorTone,
      icon: DollarSign,
    },
    {
      id: 'iva' as const,
      title: t.reportsCenterUi.doorVat,
      hint: t.reportsCenterUi.snapshotVatPay,
      amount: iva.net,
      tone: 'slate' as NexorTone,
      icon: Receipt,
    },
  ];

  const selected = door === 'books' ? null : door ?? 'vendas';

  return (
    <div className="flex-1 flex flex-col h-full overflow-auto">
      <div className="flex flex-col gap-3 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.reportsCenterUi.title}</h1>
          <p className="text-muted-foreground">{t.reportsCenterUi.homeHint}</p>
        </div>
        <ReportsPeriodBar compact />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {cards.map((card) => {
            const Icon = card.icon;
            const active = selected === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onDoor(card.id)}
                className={cn(
                  'text-left rounded-lg border px-3 py-2.5 transition-shadow hover:shadow-sm',
                  NEXOR_STAT_CARD_TONE[card.tone],
                  active && 'ring-2 ring-primary ring-offset-1',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium opacity-80 truncate">{card.title}</p>
                  <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                </div>
                <p className="text-sm font-semibold tabular-nums mt-1">{kz(card.amount, locale)}</p>
                <p className="text-[11px] text-muted-foreground truncate">{card.hint}</p>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground w-fit underline-offset-2 hover:underline"
          onClick={() => onDoor('books')}
        >
          {t.reportsCenterUi.accountantLink}
        </button>
        {selected === 'vendas' && (
          <Suspense fallback={<ReportFallback />}>
            <SalesAnalysisReport />
          </Suspense>
        )}
        {selected === 'receber' && (
          <Suspense fallback={<ReportFallback />}>
            <AccountsReceivableReport />
          </Suspense>
        )}
        {selected === 'pagar' && (
          <Suspense fallback={<ReportFallback />}>
            <AccountsPayableReport />
          </Suspense>
        )}
        {selected === 'stock' && (
          <Suspense fallback={<ReportFallback />}>
            <InventoryReports />
          </Suspense>
        )}
        {selected === 'fecho' && (
          <div className="space-y-3">
            <ReportStatStrip
              columns="xl:grid-cols-3"
              items={[
                { label: t.reportsCenterUi.doorVendas, value: kz(salesTotal, locale) },
                { label: t.reportsCenterUi.doorReceivable, value: kz(arTotal, locale) },
                { label: t.reportsCenterUi.doorPayable, value: kz(apTotal, locale) },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={onMonthEndPack} disabled={monthEndExporting}>
                {monthEndExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Archive className="w-4 h-4 mr-2" />}
                {t.reportsCenterUi.monthEndPack}
              </Button>
              <p className="text-sm text-muted-foreground">{t.reportsCenterUi.monthEndPackDesc}</p>
            </div>
            <Suspense fallback={<ReportFallback />}>
              <IncomeStatementReport />
            </Suspense>
          </div>
        )}
        {selected === 'iva' && (
          <Suspense fallback={<ReportFallback />}>
            <VatSummaryReport />
          </Suspense>
        )}
        {door === 'books' && (
          <Suspense fallback={<ReportFallback />}>
            <FinancialReports />
          </Suspense>
        )}
      </div>
    </div>
  );
}
