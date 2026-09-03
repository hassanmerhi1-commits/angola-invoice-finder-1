import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { unwrapListPayload } from '@/lib/listCache';
import {
  mapJournalEntryFromApi,
  type JournalDisplayEntry,
  type JournalDisplayLabels,
} from '@/lib/journalEntryDisplay';
import { formatDisplayDate } from '@/lib/formatDisplayDate';

const TrialBalanceReport = lazy(() => import('@/components/reports/TrialBalanceReport'));
const CashFlowReport = lazy(() => import('@/components/reports/CashFlowReport'));

export type LedgerReportKind = 'trial-balance' | 'cash-flow' | 'journals';

function ReportFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

function AccountJournalsPanel({
  accountCode,
  dateFrom,
  dateTo,
  onOpenJournal,
}: {
  accountCode: string;
  dateFrom: string;
  dateTo: string;
  onOpenJournal: (entry: JournalDisplayEntry) => void;
}) {
  const { t, language } = useTranslation();
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<JournalDisplayEntry[]>([]);

  const labels = useMemo<JournalDisplayLabels>(() => ({
    systemUser: t.journalsUi.systemUser,
    salesOfMerchandise: t.journalsUi.salesOfMerchandise,
    paymentCash: t.chartsUi.methodCash,
    paymentCard: t.chartsUi.methodCard,
    paymentTransfer: t.chartsUi.methodTransfer,
    paymentCheque: t.supplierStatementUi.methodCheque,
    paymentMixed: t.chartsUi.methodMixed,
    paymentCredit: t.posUi.credit,
    paymentMobile: 'Mobile',
    fieldInvoice: t.journalsUi.detailInvoice,
    fieldCustomer: t.journalsUi.detailCustomer,
    fieldSupplier: t.journalsUi.detailSupplier,
    fieldPayment: t.journalsUi.detailPayment,
    fieldProducts: t.journalsUi.detailProducts,
    fieldBranch: t.journalsUi.branch,
    fieldRelatedDoc: t.journalsUi.detailRelatedDoc,
    fieldDirectionIn: t.journalsUi.detailStockIn,
    fieldDirectionOut: t.journalsUi.detailStockOut,
    cogsEntry: t.journalsUi.cogsEntry,
    walkInCustomer: t.journalsUi.walkInCustomer,
    descSale: t.journalsUi.descSale,
    descPurchase: t.journalsUi.descPurchase,
    descReceipt: t.journalsUi.descReceipt,
    descPayment: t.journalsUi.descPayment,
    descAdjustment: t.journalsUi.descAdjustment,
    descExpense: t.journalsUi.descExpense,
    descCreditNote: t.journalsUi.descCreditNote,
    descDebitNote: t.journalsUi.descDebitNote,
    descTransfer: t.journalsUi.descTransfer,
    fieldReason: t.journalsUi.detailReason,
    fieldNotes: t.journalsUi.detailNotes,
    fieldReference: t.journalsUi.detailReference,
    fieldDocTotal: t.journalsUi.detailDocTotal,
    fieldInvoiceType: t.auditTrailUi.fieldInvoiceType,
    fieldNif: t.journalsUi.detailNif,
  }), [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await api.journalEntries.list({
          accountCode,
          startDate: from || undefined,
          endDate: to || undefined,
          q: debouncedQ || undefined,
          limit: 500,
          includeContext: true,
        });
        if (cancelled) return;
        if (response.error) {
          setItems([]);
          return;
        }
        const payload = unwrapListPayload<Record<string, unknown>>(response.data);
        setItems(payload.items.map((je) => mapJournalEntryFromApi(je, labels)));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountCode, from, to, debouncedQ, labels]);

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.common.search}
            className="h-8 text-sm pl-8"
          />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-sm w-36" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm w-36" />
      </div>
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center py-16 text-sm text-muted-foreground">{t.journalsUi.noEntriesFound}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t.ledgerUi.date}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.ledgerUi.journalNo}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.ledgerUi.description}</th>
                <th className="px-3 py-2 text-right font-semibold">{t.ledgerUi.debit}</th>
                <th className="px-3 py-2 text-right font-semibold">{t.ledgerUi.credit}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((entry) => (
                <tr key={entry.id} className="hover:bg-accent/40">
                  <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                    {formatDisplayDate(entry.entryDate, language === 'pt' ? 'pt-AO' : 'en-GB')}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-indigo-700"
                      onClick={() => onOpenJournal(entry)}
                    >
                      {entry.entryNumber}
                    </Button>
                  </td>
                  <td className="px-3 py-2">
                    <div>{entry.readableTitle}</div>
                    {entry.readableSubtitle ? (
                      <div className="text-xs text-muted-foreground">{entry.readableSubtitle}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {entry.totalDebit ? entry.totalDebit.toLocaleString(language === 'pt' ? 'pt-AO' : 'en-GB') : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {entry.totalCredit ? entry.totalCredit.toLocaleString(language === 'pt' ? 'pt-AO' : 'en-GB') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function LedgerReportDialog({
  open,
  onOpenChange,
  kind,
  accountCode,
  dateFrom,
  dateTo,
  onOpenJournal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LedgerReportKind | null;
  accountCode: string;
  dateFrom: string;
  dateTo: string;
  onOpenJournal: (entry: JournalDisplayEntry) => void;
}) {
  const { t } = useTranslation();
  const title =
    kind === 'cash-flow' ? t.ledgerUi.reportCashFlow
      : kind === 'journals' ? t.ledgerUi.reportJournals
        : t.ledgerUi.reportTrialBalance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] h-[88vh] flex flex-col gap-3 p-4 sm:p-6 overflow-hidden z-[70]">
        <DialogHeader className="shrink-0 space-y-1">
          <DialogTitle>{title}</DialogTitle>
          {accountCode ? (
            <p className="text-xs text-muted-foreground font-mono">
              {accountCode}
              {dateFrom && dateTo ? ` · ${dateFrom} – ${dateTo}` : ''}
            </p>
          ) : null}
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          {open && kind === 'trial-balance' && (
            <Suspense fallback={<ReportFallback />}>
              <TrialBalanceReport
                highlightAccountCode={accountCode}
                defaultDateFrom={dateFrom}
                defaultDateTo={dateTo}
              />
            </Suspense>
          )}
          {open && kind === 'cash-flow' && (
            <Suspense fallback={<ReportFallback />}>
              <CashFlowReport defaultDateFrom={dateFrom} defaultDateTo={dateTo} />
            </Suspense>
          )}
          {open && kind === 'journals' && accountCode && (
            <AccountJournalsPanel
              accountCode={accountCode}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onOpenJournal={onOpenJournal}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
