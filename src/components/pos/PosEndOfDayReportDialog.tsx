import { useEffect, useMemo, useState } from 'react';
import { Sale, Branch, User, CreditNote } from '@/types/erp';
import type { CaixaSession, Expense } from '@/types/accounting';
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
import { Badge } from '@/components/ui/badge';
import { Printer, FileText, DoorClosed, Wallet, Scale, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';
import { format } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { mapSaleRow } from '@/hooks/useERP';
import { toast } from 'sonner';
import {
  filterShiftCashRefunds,
  filterShiftCashExpenses,
  todayLocalDate,
  shiftBusinessDate,
  withRecoveredShiftStart,
  selectEndOfDaySales,
  normalizePosPaymentMethod,
} from '@/lib/posShiftSales';

interface CaixaGlReconciliation {
  caixaAccountCode: string;
  caixaAccountName: string;
  erpCashSalesTotal: number;
  erpCashRefundsTotal?: number;
  erpNetCashTotal?: number;
  glCashSaleDebits: number;
  glCashRefundCredits?: number;
  glNetCashSales?: number;
  glNetMovement: number;
  balanced: boolean;
  variances: {
    sessionCashVsErpSales: number;
    sessionNetVsErpNet?: number;
    sessionCashVsGlDebits: number;
    erpSalesVsGlDebits: number;
    erpRefundsVsGlCredits?: number;
    erpNetVsGlNet?: number;
  };
}

interface PosEndOfDayReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sales: Sale[];
  creditNotes?: CreditNote[];
  expenses?: Expense[];
  cashier: User | null;
  branch: Branch | null;
  caixaName?: string;
  session?: CaixaSession | null;
  onCloseCaixa?: (countedCash: number, notes?: string) => void | Promise<void>;
}

export function PosEndOfDayReportDialog({
  open,
  onOpenChange,
  sales,
  creditNotes = [],
  expenses = [],
  cashier,
  branch,
  caixaName,
  session,
  onCloseCaixa,
}: PosEndOfDayReportDialogProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const company = getCompanySettings();
  const today = todayLocalDate();
  const reportDay = shiftBusinessDate(session, today);
  const reportDayDate = useMemo(() => new Date(`${reportDay}T12:00:00`), [reportDay]);
  const [countedCash, setCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [glRecon, setGlRecon] = useState<CaixaGlReconciliation | null>(null);
  const [glLoading, setGlLoading] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [fetchedSales, setFetchedSales] = useState<Sale[] | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCountedCash('');
      setCloseNotes('');
      setGlRecon(null);
      setGlError(null);
      setFetchedSales(null);
      setSalesLoading(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !branch?.id || !reportDay) return;
    let cancelled = false;
    setSalesLoading(true);
    void api.sales
      .list(branch.id, {
        light: true,
        dateFrom: reportDay,
        dateTo: reportDay,
        limit: 5000,
      })
      .then((res) => {
        if (cancelled) return;
        if (res.data === undefined) {
          setFetchedSales(null);
          return;
        }
        const rows = (Array.isArray(res.data) ? res.data : []).map(mapSaleRow);
        setFetchedSales(rows);
      })
      .catch(() => {
        if (!cancelled) setFetchedSales(null);
      })
      .finally(() => {
        if (!cancelled) setSalesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, branch?.id, reportDay]);

  useEffect(() => {
    if (!open || !branch?.id) return;
    let cancelled = false;
    setGlLoading(true);
    setGlError(null);
    void api.caixa
      .reconciliation({
        branchId: branch.id,
        date: reportDay,
        session: session
          ? {
              openingBalance: session.openingBalance,
              totalIn: session.totalIn,
              totalOut: session.totalOut,
              salesTotal: session.salesTotal,
              expensesTotal: session.expensesTotal,
              openedAt: session.openedAt,
            }
          : undefined,
      }, { timeoutMs: 8000 })
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data) {
          setGlError(res.error || t.posUi.caixa.glUnavailable);
          setGlRecon(null);
          return;
        }
        setGlRecon(res.data as CaixaGlReconciliation);
      })
      .catch(() => {
        if (!cancelled) {
          setGlError(t.posUi.caixa.glUnavailable);
          setGlRecon(null);
        }
      })
      .finally(() => {
        if (!cancelled) setGlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, branch?.id, session, reportDay, t.posUi.caixa.glUnavailable]);

  const reportSales = fetchedSales ?? sales;

  const effectiveSession = useMemo(
    () => (session ? withRecoveredShiftStart(session, reportSales, null, reportDay) : null),
    [session, reportSales, reportDay],
  );

  const cashierSales = useMemo(() => {
    const rows = selectEndOfDaySales(
      reportSales,
      cashier,
      effectiveSession || session,
      reportDay,
    ).rows;
    return [...rows].reverse();
  }, [reportSales, cashier, reportDay, session, effectiveSession]);

  const shiftOpenedLabel = useMemo(() => {
    const openedAt = effectiveSession?.openedAt || session?.openedAt;
    if (!openedAt) return null;
    const opened = new Date(openedAt);
    if (!Number.isFinite(opened.getTime())) return null;
    return t.posUi.endOfDayShiftSince.replace(
      '{time}',
      opened.toLocaleString(locale, { hour: '2-digit', minute: '2-digit' }),
    );
  }, [effectiveSession?.openedAt, session?.openedAt, locale, t.posUi.endOfDayShiftSince]);

  const shiftCashRefunds = useMemo(
    () => filterShiftCashRefunds(creditNotes, reportSales, cashier, effectiveSession || session, reportDay),
    [creditNotes, reportSales, cashier, session, effectiveSession, reportDay],
  );

  // All cashiers on this caixa — used only to peel refunds out of session.totalOut
  // so another cashier's refund does not land as "manual cash out" on this report.
  const allCaixaCashRefundsTotal = useMemo(
    () => filterShiftCashRefunds(creditNotes, reportSales, null, effectiveSession || session, reportDay)
      .reduce((sum, note) => sum + note.total, 0),
    [creditNotes, reportSales, session, effectiveSession, reportDay],
  );

  // Caixa expenses are shared (payment picks a cash box, not a cashier).
  // Show them once as info — do not fold into each cashier's net or expected drawer.
  const shiftCaixaExpenses = useMemo(
    () => filterShiftCashExpenses(expenses, effectiveSession || session, reportSales, null, session?.caixaId, reportDay),
    [expenses, session, effectiveSession, reportSales, reportDay],
  );

  const totals = useMemo(() => {
    const byPayment: Record<string, number> = { cash: 0, card: 0, transfer: 0, mixed: 0, credit: 0 };
    let subtotal = 0;
    let tax = 0;
    let total = 0;
    for (const sale of cashierSales) {
      subtotal += sale.subtotal;
      tax += sale.taxAmount;
      total += sale.total;
      const key = normalizePosPaymentMethod(sale.paymentMethod);
      byPayment[key] = (byPayment[key] || 0) + sale.total;
    }
    const cashRefundsTotal = shiftCashRefunds.reduce((sum, note) => sum + note.total, 0);
    const cashExpensesTotal = shiftCaixaExpenses.reduce((sum, exp) => sum + exp.totalAmount, 0);
    // If invoices did not load, still show cash the register already booked.
    if (cashierSales.length === 0) {
      const sessionCash = Math.max(
        Number(session?.salesTotal || 0),
        Number(glRecon?.erpCashSalesTotal || 0),
        Number(glRecon?.erpNetCashTotal || 0),
      );
      if (sessionCash > 0) {
        byPayment.cash = sessionCash;
        total = sessionCash;
      }
    }
    const netCash = (byPayment.cash || 0) - cashRefundsTotal;
    return {
      byPayment,
      subtotal,
      tax,
      total,
      count: cashierSales.length,
      cashRefundsTotal,
      cashExpensesTotal,
      netCash,
      refundCount: shiftCashRefunds.length,
      expenseCount: shiftCaixaExpenses.length,
    };
  }, [cashierSales, shiftCashRefunds, shiftCaixaExpenses, session, glRecon]);

  const buildPrintHtml = () => {
    const money = (value: number) => `${value.toLocaleString(locale)} Kz`;
    const row = (label: string, value: string) =>
      `<div class="row"><span class="lbl">${label}</span><span class="amt">${value}</span></div>`;
    const expenseLabel = t.posUi.endOfDaySharedCaixaExpensesPrint.replace(
      '{count}',
      String(totals.expenseCount),
    );
    return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${t.posUi.endOfDayTitle}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 4px; color: #111; width: 72mm; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  .meta { color: #444; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin: 4px 0; }
  .lbl { flex: 1 1 auto; min-width: 0; word-break: break-word; }
  .amt { flex: 0 0 auto; white-space: nowrap; text-align: right; }
  .grand { font-size: 14px; font-weight: bold; margin-top: 8px; padding-top: 6px; border-top: 1px dashed #111; }
</style></head><body>
  <h1>${t.posUi.endOfDayTitle}</h1>
  <div class="meta">
    <div>${company.tradeName || company.name}</div>
    <div>${branch?.name || ''}</div>
    ${caixaName ? `<div>${t.posUi.endOfDayCashier}: <strong>${caixaName}</strong></div>` : ''}
    <div>${cashier?.name || cashier?.username || '—'}</div>
    <div>${t.posUi.endOfDayDate}: <strong>${format(reportDayDate, 'dd/MM/yyyy')}</strong></div>
    ${shiftOpenedLabel ? `<div>${shiftOpenedLabel}</div>` : ''}
  </div>
  <div class="totals">
    ${row(t.posUi.endOfDaySalesCount, String(totals.count))}
    ${row(t.pos.cash, money(totals.byPayment.cash || 0))}
    ${totals.cashRefundsTotal > 0 ? row(t.posUi.endOfDayCashRefunds.replace('{count}', String(totals.refundCount)), `-${money(totals.cashRefundsTotal)}`) : ''}
    ${totals.cashExpensesTotal > 0 ? row(expenseLabel, `-${money(totals.cashExpensesTotal)}`) : ''}
    ${totals.cashRefundsTotal > 0 ? row(t.posUi.endOfDayNetCash, money(totals.netCash)) : ''}
    ${row(t.pos.card, money(totals.byPayment.card || 0))}
    ${row(t.pos.transfer, money(totals.byPayment.transfer || 0))}
    ${(totals.byPayment.mixed || 0) > 0 ? row(t.pos.mixed, money(totals.byPayment.mixed || 0)) : ''}
    ${(totals.byPayment.credit || 0) > 0 ? row(t.pos.credit, money(totals.byPayment.credit || 0)) : ''}
    <div class="row grand"><span class="lbl">${t.common.total}</span><span class="amt">${money(totals.total)}</span></div>
  </div>
</body></html>`;
  };

  const handlePrint = async () => {
    await printHtml(buildPrintHtml());
  };

  // Drawer math is per cashier (this cashier's sales/refunds).
  // Expenses stay caixa-shared and are listed separately — not deducted here —
  // otherwise every cashier on the same cash box loses the same expense twice.
  const drawer = useMemo(() => {
    const opening = session?.openingBalance || 0;
    const cashSales = totals.byPayment.cash || 0;
    const cashRefunds = totals.cashRefundsTotal;
    const cashExpenses = 0;
    const sharedExpenses = totals.cashExpensesTotal;
    // Non-sale inflows the session recorded (manual deposits / reforços).
    const sessionSalesCash = Math.min(session?.salesTotal || 0, session?.totalIn || 0);
    const manualIn = Math.max(0, (session?.totalIn || 0) - sessionSalesCash);
    const manualOut = Math.max(
      0,
      (session?.totalOut || 0) - (session?.expensesTotal || 0) - allCaixaCashRefundsTotal,
    );
    const cashIn = cashSales + manualIn;
    const expected = opening + cashIn - cashRefunds - manualOut;
    return { opening, cashSales, cashRefunds, cashExpenses, sharedExpenses, manualIn, manualOut, cashIn, expected };
  }, [session, totals, allCaixaCashRefundsTotal]);
  const expectedCash = drawer.expected;
  const counted = parseFloat(countedCash);
  const countedValue = Number.isFinite(counted) ? counted : 0;
  const difference = countedValue - expectedCash;

  const handleCloseCaixa = async () => {
    if (!session || !onCloseCaixa) return;
    setClosing(true);
    try {
      await onCloseCaixa(countedValue, closeNotes.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      console.error('[PosEndOfDay] close caixa failed:', err);
      // Keep dialog open so the cashier can retry — reopen with old city cash is worse.
      toast.error(t.posUi.caixa.closeError);
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
            {format(reportDayDate, 'PPP', { locale: dfLocale })}
          </Badge>
          {shiftOpenedLabel && (
            <Badge variant="secondary" className="text-xs">
              {shiftOpenedLabel}
            </Badge>
          )}
        </div>

        <div className="rounded-md border p-3 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t.posUi.endOfDaySalesCount}</span>
            <span className="font-semibold tabular-nums">{totals.count}</span>
          </div>
          <div className="flex items-center justify-between text-base">
            <span className="font-semibold">{t.common.total}</span>
            <span className="font-mono font-bold tabular-nums">{totals.total.toLocaleString(locale)} Kz</span>
          </div>
          {salesLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t.posUi.caixa.glLoading}
            </div>
          )}
          {cashierSales.length === 0 && totals.total <= 0 && !salesLoading && (
            <p className="text-xs text-muted-foreground pt-1">
              {!session ? t.posUi.endOfDayNoOpenShift : t.posUi.endOfDayNoSales}
            </p>
          )}
        </div>

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

        {(totals.cashRefundsTotal > 0 || totals.cashExpensesTotal > 0) && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1 text-sm">
            {totals.cashRefundsTotal > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  {t.posUi.endOfDayCashRefunds.replace('{count}', String(totals.refundCount))}
                </span>
                <span className="font-mono font-semibold text-amber-700">
                  -{totals.cashRefundsTotal.toLocaleString(locale)} Kz
                </span>
              </div>
            )}
            {totals.cashExpensesTotal > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {t.posUi.endOfDaySharedCaixaExpenses.replace('{count}', String(totals.expenseCount))}
                  </span>
                  <span className="font-mono font-semibold text-amber-700">
                    -{totals.cashExpensesTotal.toLocaleString(locale)} Kz
                  </span>
                </div>
                <ul className="space-y-0.5 pt-1">
                  {shiftCaixaExpenses.map((exp) => (
                    <li
                      key={exp.id}
                      className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                    >
                      <span className="truncate">
                        {exp.description || exp.expenseNumber || exp.id}
                      </span>
                      <span className="font-mono tabular-nums shrink-0">
                        {exp.totalAmount.toLocaleString(locale)} Kz
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {totals.cashRefundsTotal > 0 && (
              <div className="flex items-center justify-between font-medium pt-1 border-t border-amber-500/20">
                <span>{t.posUi.endOfDayNetCash}</span>
                <span className="font-mono">{totals.netCash.toLocaleString(locale)} Kz</span>
              </div>
            )}
            {totals.cashExpensesTotal > 0 && (
              <p className="text-xs text-muted-foreground pt-1">{t.posUi.endOfDaySharedCaixaExpensesHint}</p>
            )}
          </div>
        )}

        {session && onCloseCaixa && (
          <div className="rounded-md border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="w-4 h-4" />
              {t.posUi.caixa.reconcileTitle}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">{t.posUi.caixa.openingBalanceLabel}</span>
              <span className="text-right font-mono">{drawer.opening.toLocaleString(locale)} Kz</span>
              <span className="text-muted-foreground">{t.posUi.caixa.cashInLabel}</span>
              <span className="text-right font-mono">{drawer.cashIn.toLocaleString(locale)} Kz</span>
              {drawer.cashRefunds > 0 && (
                <>
                  <span className="text-muted-foreground pl-2">{t.posUi.caixa.cashOutRefundsLabel}</span>
                  <span className="text-right font-mono text-amber-700">
                    -{drawer.cashRefunds.toLocaleString(locale)} Kz
                  </span>
                </>
              )}
              {drawer.sharedExpenses > 0 && (
                <>
                  <span className="text-muted-foreground pl-2">{t.posUi.caixa.sharedExpensesLabel}</span>
                  <span className="text-right font-mono text-muted-foreground">
                    (-{drawer.sharedExpenses.toLocaleString(locale)} Kz)
                  </span>
                </>
              )}
              {drawer.manualOut > 0 && (
                <>
                  <span className="text-muted-foreground">{t.posUi.caixa.cashOutLabel}</span>
                  <span className="text-right font-mono">-{drawer.manualOut.toLocaleString(locale)} Kz</span>
                </>
              )}
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

            <div className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Scale className="w-4 h-4" />
                {glRecon
                  ? t.posUi.caixa.glReconcileTitle.replace('{code}', glRecon.caixaAccountCode)
                  : t.posUi.caixa.glReconcileTitle.replace('{code}', '451')}
              </div>
              {glLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t.posUi.caixa.glLoading}
                </div>
              )}
              {glError && !glLoading && (
                <p className="text-xs text-destructive">{glError}</p>
              )}
              {glRecon && !glLoading && (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">{t.posUi.caixa.cashInLabel}</span>
                    <span className="text-right font-mono">{session.totalIn.toLocaleString(locale)} Kz</span>
                    <span className="text-muted-foreground">{t.posUi.caixa.glCashSalesLabel}</span>
                    <span className="text-right font-mono">
                      {glRecon.erpCashSalesTotal.toLocaleString(locale)} Kz
                    </span>
                    {(glRecon.erpCashRefundsTotal ?? 0) > 0 && (
                      <>
                        <span className="text-muted-foreground">{t.posUi.caixa.glCashRefundsLabel}</span>
                        <span className="text-right font-mono text-amber-700">
                          -{(glRecon.erpCashRefundsTotal ?? 0).toLocaleString(locale)} Kz
                        </span>
                        <span className="text-muted-foreground">{t.posUi.caixa.glNetCashLabel}</span>
                        <span className="text-right font-mono font-semibold">
                          {(glRecon.erpNetCashTotal ?? glRecon.erpCashSalesTotal).toLocaleString(locale)} Kz
                        </span>
                      </>
                    )}
                    <span className="text-muted-foreground">{t.posUi.caixa.glSaleDebitsLabel}</span>
                    <span className="text-right font-mono">
                      {glRecon.glCashSaleDebits.toLocaleString(locale)} Kz
                    </span>
                    <span className="text-muted-foreground">{t.posUi.caixa.glNetMovementLabel}</span>
                    <span className="text-right font-mono">
                      {glRecon.glNetMovement.toLocaleString(locale)} Kz
                    </span>
                  </div>
                  <div
                    className={cn(
                      'text-xs font-medium rounded px-2 py-1.5',
                      glRecon.balanced
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-amber-500/15 text-amber-600',
                    )}
                  >
                    {glRecon.balanced ? t.posUi.caixa.glBalanced : t.posUi.caixa.glMismatch}
                    {!glRecon.balanced && (
                      <div className="mt-1 font-mono text-[11px] space-y-0.5">
                        {Math.abs(glRecon.variances.sessionNetVsErpNet ?? glRecon.variances.sessionCashVsErpSales) > 0.01 && (
                          <div>
                            {t.posUi.caixa.varianceLabel} (turno vs ERP):{' '}
                            {(glRecon.variances.sessionNetVsErpNet ?? glRecon.variances.sessionCashVsErpSales).toLocaleString(locale)} Kz
                          </div>
                        )}
                        {Math.abs(glRecon.variances.erpRefundsVsGlCredits ?? 0) > 0.01 && (
                          <div>
                            {t.posUi.caixa.varianceRefundsLabel}:{' '}
                            {(glRecon.variances.erpRefundsVsGlCredits ?? 0).toLocaleString(locale)} Kz
                          </div>
                        )}
                        {Math.abs(glRecon.variances.erpSalesVsGlDebits) > 0.01 && (
                          <div>
                            {t.posUi.caixa.varianceLabel} (ERP vs 451):{' '}
                            {glRecon.variances.erpSalesVsGlDebits.toLocaleString(locale)} Kz
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

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
              {closing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <DoorClosed className="w-4 h-4 mr-2" />
              )}
              {t.posUi.caixa.closeButton}
            </Button>
          </div>
        )}

        <Button className="w-full" disabled={salesLoading} onClick={() => void handlePrint()}>
          {salesLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Printer className="w-4 h-4 mr-2" />
          )}
          {t.posUi.endOfDayPrint}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
