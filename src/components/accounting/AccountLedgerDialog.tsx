import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Download, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Account } from '@/types/accounting';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';

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
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLedger = async () => {
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
  };

  useEffect(() => {
    if (open && account) {
      setSearchTerm('');
      fetchLedger();
    }
  }, [open, account?.id]);

  const filtered = entries.filter(e => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (e.description || '').toLowerCase().includes(s)
      || (e.journal_description || '').toLowerCase().includes(s)
      || (e.entry_number || '').toLowerCase().includes(s)
      || (e.reference_type || '').toLowerCase().includes(s);
  });

  // Running balance
  const reversedForBalance = [...filtered].reverse();
  let runningBalance = Number(account?.opening_balance) || 0;
  const balanceMap = new Map<string, number>();
  const isDebitNature = account?.account_nature === 'debit';

  reversedForBalance.forEach(e => {
    const debit = Number(e.debit_amount) || 0;
    const credit = Number(e.credit_amount) || 0;
    if (isDebitNature) {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }
    balanceMap.set(e.id, runningBalance);
  });

  const totalDebit = filtered.reduce((s, e) => s + (Number(e.debit_amount) || 0), 0);
  const totalCredit = filtered.reduce((s, e) => s + (Number(e.credit_amount) || 0), 0);
  const finalBalance = balanceMap.size > 0 ? balanceMap.get(filtered[filtered.length - 1]?.id) || 0 : (Number(account?.opening_balance) || 0);

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString(locale); } catch { return d; }
  };

  const refTypeLabels: Record<string, string> = {
    sale: t.ledgerUi.refSale,
    purchase: t.ledgerUi.refPurchase,
    payment: t.ledgerUi.refPayment,
    receipt: t.ledgerUi.refReceipt,
    transfer: t.ledgerUi.refTransfer,
    expense: t.ledgerUi.refExpense,
    manual: t.ledgerUi.refManual,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-muted-foreground">{account?.code}</span>
            <span>{account?.name}</span>
            <Badge variant="outline" className="text-[10px]">{account?.account_type}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder={t.ledgerUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-8 text-xs pl-8" />
          </div>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-xs w-36" placeholder={t.ledgerUi.startDate} />
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-8 text-xs w-36" placeholder={t.ledgerUi.endDate} />
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={fetchLedger}>
            <RefreshCw className="w-3 h-3" /> {t.ledgerUi.filter}
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t.ledgerUi.openingBalance}</div>
            <div className="text-sm font-mono font-bold">{(Number(account?.opening_balance) || 0).toLocaleString(locale)} Kz</div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t.ledgerUi.totalDebit}</div>
            <div className="text-sm font-mono font-bold text-green-600">{totalDebit.toLocaleString(locale)} Kz</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t.ledgerUi.totalCredit}</div>
            <div className="text-sm font-mono font-bold text-red-600">{totalCredit.toLocaleString(locale)} Kz</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-2 text-center">
            <div className="text-[10px] text-muted-foreground">{t.ledgerUi.currentBalance}</div>
            <div className={cn("text-sm font-mono font-bold", finalBalance >= 0 ? "text-foreground" : "text-destructive")}>{finalBalance.toLocaleString(locale)} Kz</div>
          </div>
        </div>

        {/* Ledger table */}
        <div className="flex-1 overflow-auto border rounded-lg">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {entries.length === 0 ? t.ledgerUi.noMovements : t.ledgerUi.noSearchResults}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/60 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold w-24">{t.ledgerUi.date}</th>
                  <th className="px-3 py-2 text-left font-semibold w-28">{t.ledgerUi.journalNo}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.ledgerUi.description}</th>
                  <th className="px-3 py-2 text-center font-semibold w-24">{t.ledgerUi.type}</th>
                  <th className="px-3 py-2 text-right font-semibold w-28">{t.ledgerUi.debit}</th>
                  <th className="px-3 py-2 text-right font-semibold w-28">{t.ledgerUi.credit}</th>
                  <th className="px-3 py-2 text-right font-semibold w-28">{t.ledgerUi.balance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map(entry => {
                  const debit = Number(entry.debit_amount) || 0;
                  const credit = Number(entry.credit_amount) || 0;
                  const bal = balanceMap.get(entry.id) || 0;

                  return (
                    <tr key={entry.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmtDate(entry.entry_date)}</td>
                      <td className="px-3 py-1.5 font-mono">{entry.entry_number}</td>
                      <td className="px-3 py-1.5">{entry.description || entry.journal_description}</td>
                      <td className="px-3 py-1.5 text-center">
                        {entry.reference_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {refTypeLabels[entry.reference_type] || entry.reference_type}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {debit > 0 ? debit.toLocaleString(locale) : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {credit > 0 ? credit.toLocaleString(locale) : ''}
                      </td>
                      <td className={cn("px-3 py-1.5 text-right font-mono font-medium", bal >= 0 ? "text-foreground" : "text-destructive")}>
                        {bal.toLocaleString(locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/80 border-t-2 font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan={4}>{t.ledgerUi.totalMovements.replace('{count}', String(filtered.length))}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-600">{totalDebit.toLocaleString(locale)} Kz</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{totalCredit.toLocaleString(locale)} Kz</td>
                  <td className={cn("px-3 py-2 text-right font-mono", finalBalance >= 0 ? "text-foreground" : "text-destructive")}>{finalBalance.toLocaleString(locale)} Kz</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
