import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { resolveAccountDisplayName } from '@/lib/chartOfAccountsDisplay';
import { api } from '@/lib/api/client';
import {
  buildJournalDetailRows,
  formatJournalDateTime,
  formatJournalEntryDate,
  mapJournalEntryFromApi,
  type JournalDisplayEntry,
  type JournalDisplayLabels,
} from '@/lib/journalEntryDisplay';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  entry: JournalDisplayEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryTypeLabel: string;
  entryTypeColor?: string;
};

function resolveEntryTypeColor(type: string): string {
  const map: Record<string, string> = {
    sale: 'text-blue-600',
    venda: 'text-blue-600',
    purchase: 'text-orange-600',
    purchase_invoice: 'text-orange-600',
    credit_note: 'text-rose-600',
    debit_note: 'text-rose-700',
    receipt: 'text-green-600',
    payment_receipt: 'text-green-600',
    payment: 'text-red-600',
    payment_out: 'text-red-600',
    adjustment: 'text-purple-600',
    transfer: 'text-cyan-600',
    manual: 'text-amber-600',
  };
  return map[type] || 'text-muted-foreground';
}

export function JournalEntryDetailDialog({
  entry,
  open,
  onOpenChange,
  entryTypeLabel,
  entryTypeColor,
}: Props) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [detail, setDetail] = useState<JournalDisplayEntry | null>(entry);
  const [loading, setLoading] = useState(false);

  const labels: JournalDisplayLabels = useMemo(() => ({
    systemUser: t.journalsUi.systemUser,
    paymentCash: t.chartsUi.methodCash,
    paymentCard: t.chartsUi.methodCard,
    paymentTransfer: t.chartsUi.methodTransfer,
    paymentCheque: t.supplierStatementUi.methodCheque,
    paymentMixed: t.chartsUi.methodMixed,
    paymentCredit: t.posUi.credit,
    paymentMobile: t.chartsUi.methodMobile ?? 'Mobile',
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
    if (!open || !entry?.id) {
      setDetail(entry);
      return;
    }
    setDetail(entry);
    let cancelled = false;
    setLoading(true);
    void api.journalEntries.get(entry.id).then((res) => {
      if (cancelled) return;
      if (res.data && !res.error) {
        setDetail(mapJournalEntryFromApi(res.data as Record<string, unknown>, labels));
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, entry?.id, labels]);

  const display = detail || entry;
  const detailRows = display ? buildJournalDetailRows(display, labels, uiLocale) : [];
  const typeColor = entryTypeColor || (display ? resolveEntryTypeColor(display.type) : '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{t.journalsUi.entryTitle.replace('{number}', display?.entryNumber || '')}</span>
            {display && (
              <Badge variant="outline" className={cn('text-xs font-normal', typeColor)}>
                {entryTypeLabel}
              </Badge>
            )}
            {display?.isPosted && (
              <Badge variant="secondary" className="text-xs gap-1">
                <CheckCircle className="w-3 h-3 text-green-600" />
                {t.journalsUi.posted}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && !display?.context?.items?.length && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t.common.loading}
          </div>
        )}

        {display && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[minmax(6rem,32%)_1fr] gap-x-4 gap-y-2 text-sm rounded-lg border bg-muted/30 p-4">
              <dt className="text-muted-foreground">{t.journalsUi.detailAccountingDate}</dt>
              <dd>{formatJournalEntryDate(display, uiLocale)}</dd>
              <dt className="text-muted-foreground">{t.journalsUi.detailPostedAt}</dt>
              <dd>{formatJournalDateTime(display, uiLocale)}</dd>
              <dt className="text-muted-foreground">{t.common.user}</dt>
              <dd>{display.createdBy}</dd>
              {display.branchName && (
                <>
                  <dt className="text-muted-foreground">{t.journalsUi.branch}</dt>
                  <dd>{display.branchName}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{t.common.description}</dt>
              <dd>
                <div className="font-medium">{display.readableTitle}</div>
                {display.readableSubtitle && (
                  <div className="text-xs text-muted-foreground mt-0.5">{display.readableSubtitle}</div>
                )}
              </dd>
            </dl>

            {detailRows.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {t.journalsUi.detailSourceDocument}
                </h4>
                <dl className="grid grid-cols-[minmax(6rem,32%)_1fr] gap-x-4 gap-y-2 text-sm rounded-lg border p-4">
                  {detailRows.map((row) => (
                    <div key={row.label} className="contents">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {display.context?.items && display.context.items.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {t.journalsUi.detailLineItems}
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="px-3 py-2 text-left">{t.common.name}</th>
                        <th className="px-3 py-2 text-left">SKU</th>
                        <th className="px-3 py-2 text-right">{t.common.quantity}</th>
                        <th className="px-3 py-2 text-right">{t.journalsUi.detailUnitPrice}</th>
                        <th className="px-3 py-2 text-right">{t.common.subtotal}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {display.context.items.map((item, idx) => (
                        <tr key={`${item.sku}_${idx}`}>
                          <td className="px-3 py-1.5">{item.name}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{item.sku || '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{item.quantity ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {item.unitPrice != null && item.unitPrice > 0
                              ? item.unitPrice.toLocaleString(uiLocale)
                              : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {item.subtotal != null && item.subtotal > 0
                              ? item.subtotal.toLocaleString(uiLocale)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {t.journalsUi.entryLines}
              </h4>
              <table className="w-full text-xs border rounded-lg overflow-hidden">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 text-left">{t.journalsUi.account}</th>
                    <th className="px-3 py-2 text-left">{t.common.name}</th>
                    <th className="px-3 py-2 text-left">{t.common.description}</th>
                    <th className="px-3 py-2 text-right">{t.journalsUi.debit}</th>
                    <th className="px-3 py-2 text-right">{t.journalsUi.credit}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {display.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-1.5 font-mono">{line.accountCode}</td>
                      <td className="px-3 py-1.5">
                        {resolveAccountDisplayName(
                          { code: line.accountCode, name: line.accountName },
                          language,
                          t,
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{line.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-green-700">
                        {line.debit ? line.debit.toLocaleString(uiLocale) : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-red-700">
                        {line.credit ? line.credit.toLocaleString(uiLocale) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/60 font-bold">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>{t.common.total}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">
                      {display.totalDebit.toLocaleString(uiLocale)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-700">
                      {display.totalCredit.toLocaleString(uiLocale)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
