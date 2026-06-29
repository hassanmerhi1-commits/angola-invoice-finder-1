import { useEffect, useMemo, useState } from 'react';
import { Sale, Branch, User } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Printer, FileText, DoorClosed, Wallet } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';

interface PosEndOfDayReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: Sale[];
  cashier: User | null;
  branch: Branch | null;
  session?: CaixaSession | null;
  onCloseCaixa?: (countedCash: number, notes?: string) => void | Promise<void>;
}

function saleLocalDate(createdAt: string) {
  const d = new Date(createdAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocalDate() {
  return saleLocalDate(new Date().toISOString());
}

export function PosEndOfDayReportDialog({
  open,
  onOpenChange,
  sales,
  cashier,
  branch,
  session,
  onCloseCaixa,
}: PosEndOfDayReportDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const company = getCompanySettings();
  const today = todayLocalDate();
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setCountedCash('');
      setCloseNotes('');
    }
  }, [open]);

  const cashierSales = useMemo(() => {
    if (!cashier) return [];
    return sales
      .filter((sale) => {
        const sameDay = saleLocalDate(sale.createdAt) === today;
        const sameCashier =
          sale.cashierId === cashier.id
          || sale.cashierName === cashier.name
          || sale.cashierName === cashier.username;
        return sameDay && sameCashier;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [sales, cashier, today]);

  const totals = useMemo(() => {
    const byPayment: Record<string, number> = { cash: 0, card: 0, transfer: 0, mixed: 0 };
    let subtotal = 0;
    let tax = 0;
    let total = 0;
    for (const sale of cashierSales) {
      subtotal += sale.subtotal;
      tax += sale.taxAmount;
      total += sale.total;
      const key = sale.paymentMethod || 'cash';
      byPayment[key] = (byPayment[key] || 0) + sale.total;
    }
    return { byPayment, subtotal, tax, total, count: cashierSales.length };
  }, [cashierSales]);

  const buildPrintHtml = () => {
    const rows = cashierSales
      .map(
        (sale) => `
        <tr>
          <td>${sale.invoiceNumber}</td>
          <td>${new Date(sale.createdAt).toLocaleString(locale)}</td>
          <td style="text-align:right">${sale.total.toLocaleString(locale)} Kz</td>
          <td>${sale.paymentMethod}</td>
        </tr>`,
      )
      .join('');

    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${t.posUi.endOfDayTitle}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 16px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #999; padding: 6px 8px; }
  th { background: #e8f4fc; text-align: left; }
  .totals { margin-top: 16px; }
  .totals div { display: flex; justify-content: space-between; margin: 4px 0; }
  .grand { font-size: 16px; font-weight: bold; margin-top: 8px; }
</style></head><body>
  <h1>${t.posUi.endOfDayTitle}</h1>
  <div class="meta">
    <div>${company.tradeName || company.name}</div>
    <div>${branch?.name || ''}</div>
    <div>${t.posUi.endOfDayCashier}: <strong>${cashier?.name || cashier?.username || '—'}</strong></div>
    <div>${t.posUi.endOfDayDate}: <strong>${format(new Date(), 'PPP', { locale: dfLocale })}</strong></div>
  </div>
  <table>
    <thead><tr><th>${t.posUi.endOfDayInvoice}</th><th>${t.posUi.endOfDayTime}</th><th>${t.common.total}</th><th>${t.receiptUi.payment}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" style="text-align:center">${t.posUi.endOfDayNoSales}</td></tr>`}</tbody>
  </table>
  <div class="totals">
    <div><span>${t.posUi.endOfDaySalesCount}</span><span>${totals.count}</span></div>
    <div><span>${t.pos.cash}</span><span>${(totals.byPayment.cash || 0).toLocaleString(locale)} Kz</span></div>
    <div><span>${t.pos.card}</span><span>${(totals.byPayment.card || 0).toLocaleString(locale)} Kz</span></div>
    <div><span>${t.pos.transfer}</span><span>${(totals.byPayment.transfer || 0).toLocaleString(locale)} Kz</span></div>
    <div class="grand"><span>${t.common.total}</span><span>${totals.total.toLocaleString(locale)} Kz</span></div>
  </div>
</body></html>`;
  };

  const handlePrint = async () => {
    await printHtml(buildPrintHtml());
  };

  const expectedCash = session
    ? session.openingBalance + session.totalIn - session.totalOut
    : 0;
  const counted = parseFloat(countedCash);
  const countedValue = Number.isFinite(counted) ? counted : 0;
  const difference = countedValue - expectedCash;

  const handleCloseCaixa = async () => {
    if (!session || !onCloseCaixa) return;
    setClosing(true);
    try {
      await onCloseCaixa(countedValue, closeNotes.trim() || undefined);
      onOpenChange(false);
    } finally {
      setClosing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t.posUi.endOfDayTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{branch?.name || '—'}</Badge>
          <Badge variant="outline">
            {t.posUi.endOfDayCashier}: {cashier?.name || cashier?.username || '—'}
          </Badge>
          <Badge variant="outline">
            {format(new Date(), 'PPP', { locale: dfLocale })}
          </Badge>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.posUi.endOfDayInvoice}</TableHead>
              <TableHead>{t.posUi.endOfDayTime}</TableHead>
              <TableHead className="text-right">{t.common.total}</TableHead>
              <TableHead>{t.receiptUi.payment}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashierSales.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t.posUi.endOfDayNoSales}
                </TableCell>
              </TableRow>
            ) : (
              cashierSales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="font-mono text-xs">{sale.invoiceNumber}</TableCell>
                  <TableCell>{new Date(sale.createdAt).toLocaleString(locale)}</TableCell>
                  <TableCell className="text-right font-mono">{sale.total.toLocaleString(locale)} Kz</TableCell>
                  <TableCell className="uppercase text-xs">{sale.paymentMethod}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {cashierSales.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">
                  {t.posUi.endOfDaySalesCount}: {totals.count}
                </TableCell>
                <TableCell className="text-right font-bold">
                  {totals.total.toLocaleString(locale)} Kz
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">{t.pos.cash}</div>
            <div className="font-mono font-semibold">{(totals.byPayment.cash || 0).toLocaleString(locale)} Kz</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">{t.pos.card}</div>
            <div className="font-mono font-semibold">{(totals.byPayment.card || 0).toLocaleString(locale)} Kz</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">{t.pos.transfer}</div>
            <div className="font-mono font-semibold">{(totals.byPayment.transfer || 0).toLocaleString(locale)} Kz</div>
          </div>
        </div>

        {session && onCloseCaixa && (
          <div className="rounded-md border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="w-4 h-4" />
              {t.posUi.caixa.reconcileTitle}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">{t.posUi.caixa.openingBalanceLabel}</span>
              <span className="text-right font-mono">{session.openingBalance.toLocaleString(locale)} Kz</span>
              <span className="text-muted-foreground">{t.posUi.caixa.cashInLabel}</span>
              <span className="text-right font-mono">{session.totalIn.toLocaleString(locale)} Kz</span>
              <span className="text-muted-foreground">{t.posUi.caixa.cashOutLabel}</span>
              <span className="text-right font-mono">{session.totalOut.toLocaleString(locale)} Kz</span>
              <span className="font-semibold">{t.posUi.caixa.expectedCashLabel}</span>
              <span className="text-right font-mono font-semibold">{expectedCash.toLocaleString(locale)} Kz</span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-counted-cash">{t.posUi.caixa.countedCashLabel}</Label>
              <Input
                id="pos-counted-cash"
                type="number"
                min={0}
                step="0.01"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="0"
              />
            </div>

            {countedCash !== '' && (
              <div
                className={`flex items-center justify-between text-sm font-semibold rounded px-2 py-1.5 ${
                  difference === 0
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : 'bg-amber-500/15 text-amber-600'
                }`}
              >
                <span>
                  {difference === 0
                    ? t.posUi.caixa.balanced
                    : difference > 0
                      ? t.posUi.caixa.over
                      : t.posUi.caixa.short}
                </span>
                <span className="font-mono">{Math.abs(difference).toLocaleString(locale)} Kz</span>
              </div>
            )}

            <Textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder={t.posUi.caixa.closeNotesPlaceholder}
              rows={2}
            />

            <Button
              variant="destructive"
              className="w-full"
              disabled={closing || countedCash === ''}
              onClick={() => void handleCloseCaixa()}
            >
              <DoorClosed className="w-4 h-4 mr-2" />
              {t.posUi.caixa.closeButton}
            </Button>
          </div>
        )}

        <Button className="w-full" onClick={() => void handlePrint()}>
          <Printer className="w-4 h-4 mr-2" />
          {t.posUi.endOfDayPrint}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
