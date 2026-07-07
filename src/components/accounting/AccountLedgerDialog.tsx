import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw,
  Download,
  Search,
  Printer,
  FileText,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { Account } from '@/types/accounting';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { resolveAccountDisplayName, resolveAccountTypeLabel } from '@/lib/chartOfAccountsDisplay';
import { exportToExcel } from '@/lib/excel';
import { printHtml } from '@/lib/printHtml';
import { toast } from 'sonner';
import { NEXOR_PILL_BTN, NEXOR_PILL_BTN_PRIMARY } from '@/lib/nexorToolbarStyles';
import { NEXOR_STAT_CARD } from '@/lib/nexorToneStyles';

interface LedgerEntry {
  id: string;
  journal_entry_id: string;
  account_id: string;
  description: string;
  debit_amount: number;
  credit_amount: number;
  entry_number: string;
  entry_date: string;
  journal_description: string;
  reference_type: string;
  reference_id: string;
  is_posted: boolean;
}

interface Props {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AccountLedgerDialog({ account, open, onOpenChange }: Props) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const refTypeLabels: Record<string, string> = useMemo(() => ({
    sale: t.ledgerUi.refSale,
    purchase: t.ledgerUi.refPurchase,
    purchase_invoice: t.ledgerUi.refPurchase,
    credit_note: t.ledgerUi.refCreditNote,
    payment: t.ledgerUi.refPayment,
    payment_receipt: t.ledgerUi.refReceipt,
    payment_out: t.ledgerUi.refPayment,
    receipt: t.ledgerUi.refReceipt,
    transfer: t.ledgerUi.refTransfer,
    expense: t.ledgerUi.refExpense,
    adjustment: t.ledgerUi.refManual,
    manual: t.ledgerUi.refManual,
  }), [t]);

  const fetchLedger = useCallback(async () => {
    if (!account) return;
    setIsLoading(true);
    try {
      const res = await api.chartOfAccounts.getLedger(account.id, startDate || undefined, endDate || undefined);
      setEntries(res.data || []);
    } catch (e) {
      console.error('Failed to fetch ledger:', e);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [account, startDate, endDate]);

  useEffect(() => {
    if (open && account) {
      setSearchTerm('');
      setTypeFilter('all');
      void fetchLedger();
    }
  }, [open, account?.id, fetchLedger]);

  const filtered = useMemo(() => entries.filter((e) => {
    if (typeFilter !== 'all' && e.reference_type !== typeFilter) return false;
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    const debit = String(Number(e.debit_amount) || 0);
    const credit = String(Number(e.credit_amount) || 0);
    return (e.description || '').toLowerCase().includes(s)
      || (e.journal_description || '').toLowerCase().includes(s)
      || (e.entry_number || '').toLowerCase().includes(s)
      || (e.reference_type || '').toLowerCase().includes(s)
      || (refTypeLabels[e.reference_type] || '').toLowerCase().includes(s)
      || debit.includes(s)
      || credit.includes(s);
  }), [entries, searchTerm, typeFilter, refTypeLabels]);

  const isDebitNature = account?.account_nature === 'debit';
  const openingBalance = Number(account?.opening_balance) || 0;

  const { balanceMap, totalDebit, totalCredit, finalBalance } = useMemo(() => {
    const reversedForBalance = [...filtered].reverse();
    let runningBalance = openingBalance;
    const map = new Map<string, number>();

    reversedForBalance.forEach((e) => {
      const debit = Number(e.debit_amount) || 0;
      const credit = Number(e.credit_amount) || 0;
      if (isDebitNature) {
        runningBalance += debit - credit;
      } else {
        runningBalance += credit - debit;
      }
      map.set(e.id, runningBalance);
    });

    const debitTotal = filtered.reduce((s, e) => s + (Number(e.debit_amount) || 0), 0);
    const creditTotal = filtered.reduce((s, e) => s + (Number(e.credit_amount) || 0), 0);
    const closing = map.size > 0
      ? map.get(filtered[filtered.length - 1]?.id) || 0
      : openingBalance;

    return {
      balanceMap: map,
      totalDebit: debitTotal,
      totalCredit: creditTotal,
      finalBalance: closing,
    };
  }, [filtered, openingBalance, isDebitNature]);

  const availableTypes = useMemo(() => {
    const types = new Set(entries.map((e) => e.reference_type).filter(Boolean));
    return Array.from(types).sort();
  }, [entries]);

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString(locale); } catch { return d; }
  };

  const fmtMoney = (n: number) => `${n.toLocaleString(locale)} Kz`;

  const accountLabel = account
    ? `${account.code} — ${resolveAccountDisplayName(account, language, t)}`
    : '';

  const periodLabel = startDate && endDate
    ? `${fmtDate(startDate)} — ${fmtDate(endDate)}`
    : startDate
      ? `${fmtDate(startDate)} —`
      : endDate
        ? `— ${fmtDate(endDate)}`
        : t.ledgerUi.allDates;

  const exportRows = useMemo(() => filtered.map((entry) => {
    const debit = Number(entry.debit_amount) || 0;
    const credit = Number(entry.credit_amount) || 0;
    const bal = balanceMap.get(entry.id) || 0;
    return {
      [t.ledgerUi.date]: fmtDate(entry.entry_date),
      [t.ledgerUi.journalNo]: entry.entry_number,
      [t.ledgerUi.description]: entry.description || entry.journal_description,
      [t.ledgerUi.type]: refTypeLabels[entry.reference_type] || entry.reference_type || '',
      [t.ledgerUi.debit]: debit > 0 ? debit : '',
      [t.ledgerUi.credit]: credit > 0 ? credit : '',
      [t.ledgerUi.balance]: bal,
    };
  }), [filtered, balanceMap, refTypeLabels, t, locale]);

  const exportFilename = account
    ? `Extrato_${account.code}_${new Date().toISOString().slice(0, 10)}`
    : `extrato_${new Date().toISOString().slice(0, 10)}`;

  const buildLedgerHtml = () => {
    const rows = filtered.map((entry) => {
      const debit = Number(entry.debit_amount) || 0;
      const credit = Number(entry.credit_amount) || 0;
      const bal = balanceMap.get(entry.id) || 0;
      const typeLabel = refTypeLabels[entry.reference_type] || entry.reference_type || '';
      return `<tr>
        <td>${fmtDate(entry.entry_date)}</td>
        <td class="mono">${entry.entry_number}</td>
        <td>${(entry.description || entry.journal_description || '').replace(/</g, '&lt;')}</td>
        <td class="center">${typeLabel}</td>
        <td class="right mono">${debit > 0 ? debit.toLocaleString(locale) : ''}</td>
        <td class="right mono">${credit > 0 ? credit.toLocaleString(locale) : ''}</td>
        <td class="right mono">${bal.toLocaleString(locale)}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${accountLabel}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .meta { color: #555; margin-bottom: 16px; font-size: 11px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
        .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center; }
        .card .label { font-size: 10px; color: #666; }
        .card .value { font-size: 13px; font-weight: bold; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; }
        th { background: #f3f4f6; text-align: left; }
        .right { text-align: right; }
        .center { text-align: center; }
        .mono { font-family: Consolas, monospace; }
        tfoot td { font-weight: bold; background: #f9fafb; }
      </style></head><body>
      <h1>${accountLabel}</h1>
      <div class="meta">
        ${t.ledgerUi.generatedAt}: ${new Date().toLocaleString(locale)}<br>
        ${t.ledgerUi.period}: ${periodLabel}
      </div>
      <div class="summary">
        <div class="card"><div class="label">${t.ledgerUi.openingBalance}</div><div class="value">${openingBalance.toLocaleString(locale)} Kz</div></div>
        <div class="card"><div class="label">${t.ledgerUi.totalDebit}</div><div class="value">${totalDebit.toLocaleString(locale)} Kz</div></div>
        <div class="card"><div class="label">${t.ledgerUi.totalCredit}</div><div class="value">${totalCredit.toLocaleString(locale)} Kz</div></div>
        <div class="card"><div class="label">${t.ledgerUi.currentBalance}</div><div class="value">${finalBalance.toLocaleString(locale)} Kz</div></div>
      </div>
      <table>
        <thead><tr>
          <th>${t.ledgerUi.date}</th>
          <th>${t.ledgerUi.journalNo}</th>
          <th>${t.ledgerUi.description}</th>
          <th>${t.ledgerUi.type}</th>
          <th class="right">${t.ledgerUi.debit}</th>
          <th class="right">${t.ledgerUi.credit}</th>
          <th class="right">${t.ledgerUi.balance}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="4">${t.ledgerUi.totalMovements.replace('{count}', String(filtered.length))}</td>
          <td class="right mono">${totalDebit.toLocaleString(locale)} Kz</td>
          <td class="right mono">${totalCredit.toLocaleString(locale)} Kz</td>
          <td class="right mono">${finalBalance.toLocaleString(locale)} Kz</td>
        </tr></tfoot>
      </table>
    </body></html>`;
  };

  const handlePrint = async () => {
    if (!filtered.length) {
      toast.error(t.ledgerUi.exportEmpty);
      return;
    }
    try {
      await printHtml(buildLedgerHtml(), { direct: true });
    } catch {
      const win = window.open('', '_blank');
      if (!win) {
        toast.error(t.ledgerUi.printBlocked);
        return;
      }
      win.document.write(buildLedgerHtml());
      win.document.close();
      win.focus();
      win.print();
    }
  };

  const handleExportPdf = async () => {
    if (!filtered.length) {
      toast.error(t.ledgerUi.exportEmpty);
      return;
    }
    try {
      await printHtml(buildLedgerHtml(), { direct: true });
      toast.success(t.ledgerUi.exportSuccess);
    } catch {
      toast.error(t.ledgerUi.printBlocked);
    }
  };

  const handleExportExcel = () => {
    if (!exportRows.length) {
      toast.error(t.ledgerUi.exportEmpty);
      return;
    }
    exportToExcel(exportRows, exportFilename);
    toast.success(t.ledgerUi.exportSuccess);
  };

  const handleOpenReport = (tab: string) => {
    onOpenChange(false);
    navigate(`/reports?tab=${encodeURIComponent(tab)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[95vh] h-[90vh] flex flex-col gap-4 p-4 sm:p-6 bg-slate-50/40">
        <DialogHeader className="shrink-0 space-y-0">
          <DialogTitle className="flex items-center gap-3 flex-wrap text-slate-800">
            <span className="inline-flex items-center rounded-lg bg-indigo-50 border border-indigo-200/70 px-2.5 py-1 font-mono text-sm font-semibold text-indigo-700">
              {account?.code}
            </span>
            <span className="text-lg font-semibold tracking-tight">
              {account ? resolveAccountDisplayName(account, language, t) : ''}
            </span>
            <Badge variant="outline" className="rounded-lg border-slate-200/80 bg-white/90 text-[10px] font-medium text-slate-600">
              {account ? resolveAccountTypeLabel(account.account_type, t) : ''}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Actions toolbar */}
        <div className="flex items-center gap-2 flex-wrap shrink-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 shadow-sm">
          <Button variant="outline" size="sm" className={NEXOR_PILL_BTN} onClick={() => void handlePrint()} disabled={!filtered.length}>
            <Printer className="w-3.5 h-3.5 text-slate-500" /> {t.ledgerUi.print}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={NEXOR_PILL_BTN}>
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600" /> {t.ledgerUi.reports}
                <ChevronDown className="w-3 h-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-xl">
              <DropdownMenuItem onClick={() => handleOpenReport('trial-balance')}>
                {t.ledgerUi.reportTrialBalance}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleOpenReport('cash-flow')}>
                {t.ledgerUi.reportCashFlow}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { onOpenChange(false); navigate('/journals'); }}>
                {t.ledgerUi.reportJournals}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className={NEXOR_PILL_BTN} onClick={handleExportExcel} disabled={!filtered.length}>
            <Download className="w-3.5 h-3.5 text-emerald-600" /> {t.ledgerUi.exportExcel}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_PILL_BTN_PRIMARY} onClick={() => void handleExportPdf()} disabled={!filtered.length}>
            <FileText className="w-3.5 h-3.5" /> {t.ledgerUi.exportPdf}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className={NEXOR_PILL_BTN} onClick={() => void fetchLedger()} disabled={isLoading}>
            <RefreshCw className={cn('w-3.5 h-3.5 text-slate-500', isLoading && 'animate-spin')} /> {t.ledgerUi.filter}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap shrink-0 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2.5 shadow-sm">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder={t.ledgerUi.searchPlaceholder}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 text-sm pl-9 rounded-lg border-slate-200/80 bg-white"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-sm w-44 rounded-lg border-slate-200/80 bg-white">
              <SelectValue placeholder={t.ledgerUi.filterByType} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">{t.ledgerUi.filterByType}</SelectItem>
              {availableTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {refTypeLabels[type] || type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm w-40 rounded-lg border-slate-200/80 bg-white" />
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm w-40 rounded-lg border-slate-200/80 bg-white" />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
          <div className={cn(NEXOR_STAT_CARD, 'rounded-xl p-3 text-center')}>
            <div className="text-[11px] font-medium text-slate-500">{t.ledgerUi.openingBalance}</div>
            <div className="text-base font-mono font-bold text-slate-800 mt-0.5">{fmtMoney(openingBalance)}</div>
          </div>
          <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-3 text-center shadow-sm">
            <div className="text-[11px] font-medium text-emerald-700/80">{t.ledgerUi.totalDebit}</div>
            <div className="text-base font-mono font-bold text-emerald-700 mt-0.5">{fmtMoney(totalDebit)}</div>
          </div>
          <div className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-3 text-center shadow-sm">
            <div className="text-[11px] font-medium text-rose-700/80">{t.ledgerUi.totalCredit}</div>
            <div className="text-base font-mono font-bold text-rose-600 mt-0.5">{fmtMoney(totalCredit)}</div>
          </div>
          <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/50 p-3 text-center shadow-sm">
            <div className="text-[11px] font-medium text-indigo-700/80">{t.ledgerUi.currentBalance}</div>
            <div className={cn('text-base font-mono font-bold mt-0.5', finalBalance >= 0 ? 'text-indigo-900' : 'text-destructive')}>
              {fmtMoney(finalBalance)}
            </div>
          </div>
        </div>

        {/* Ledger table */}
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200/80 bg-white shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {entries.length === 0 ? t.ledgerUi.noMovements : t.ledgerUi.noSearchResults}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/90 border-b border-slate-200/80 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold w-28">{t.ledgerUi.date}</th>
                  <th className="px-3 py-2.5 text-left font-semibold w-32">{t.ledgerUi.journalNo}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">{t.ledgerUi.description}</th>
                  <th className="px-3 py-2.5 text-center font-semibold w-28">{t.ledgerUi.type}</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">{t.ledgerUi.debit}</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">{t.ledgerUi.credit}</th>
                  <th className="px-3 py-2.5 text-right font-semibold w-32">{t.ledgerUi.balance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((entry) => {
                  const debit = Number(entry.debit_amount) || 0;
                  const credit = Number(entry.credit_amount) || 0;
                  const bal = balanceMap.get(entry.id) || 0;

                  return (
                    <tr key={entry.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-2 font-mono text-muted-foreground">{fmtDate(entry.entry_date)}</td>
                      <td className="px-3 py-2 font-mono">{entry.entry_number}</td>
                      <td className="px-3 py-2">{entry.description || entry.journal_description}</td>
                      <td className="px-3 py-2 text-center">
                        {entry.reference_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {refTypeLabels[entry.reference_type] || entry.reference_type}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {debit > 0 ? debit.toLocaleString(locale) : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {credit > 0 ? credit.toLocaleString(locale) : ''}
                      </td>
                      <td className={cn('px-3 py-2 text-right font-mono font-medium', bal >= 0 ? 'text-foreground' : 'text-destructive')}>
                        {bal.toLocaleString(locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50/95 border-t-2 border-slate-200/80 font-bold sticky bottom-0">
                <tr>
                  <td className="px-3 py-2.5" colSpan={4}>{t.ledgerUi.totalMovements.replace('{count}', String(filtered.length))}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-green-600">{totalDebit.toLocaleString(locale)} Kz</td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-600">{totalCredit.toLocaleString(locale)} Kz</td>
                  <td className={cn('px-3 py-2.5 text-right font-mono', finalBalance >= 0 ? 'text-foreground' : 'text-destructive')}>
                    {finalBalance.toLocaleString(locale)} Kz
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
