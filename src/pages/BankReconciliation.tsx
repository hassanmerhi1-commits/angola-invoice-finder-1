import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { getBankAccounts, getBankTransactions } from '@/lib/accountingStorage';
import { api } from '@/lib/api/client';
import { BankAccount, BankTransaction } from '@/types/accounting';
import { format } from 'date-fns';
import { enUS, pt } from 'date-fns/locale';
import { useTranslation } from '@/i18n';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, CheckCircle2, AlertTriangle, XCircle, ArrowRightLeft,
  FileSpreadsheet, Search, Download, Link2, Unlink, Scale,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { autoMatchStatements, parseBankCsv, parseBankOfx, type MatchRule } from '@/lib/bankMatchRules';

// ==================== TYPES ====================

interface BankStatementRow {
  id: string;
  date: string;
  description: string;
  reference?: string;
  amount: number;
  direction: 'in' | 'out';
  balance?: number;
  matched: boolean;
  matchedTransactionId?: string;
  matchConfidence?: number;
}

interface ReconciliationSummary {
  statementRows: number;
  matched: number;
  unmatched: number;
  systemOnly: number;
  statementBalance: number;
  systemBalance: number;
  difference: number;
}

const RECON_STORAGE_KEY = 'kwanzaerp_bank_reconciliations';

// ==================== COMPONENT ====================

export default function BankReconciliation() {
  const { t, language } = useTranslation();
  const { listBranchId } = useBranchScope();
  const { user } = useAuth();
  const { toast } = useToast();

  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [statementRows, setStatementRows] = useState<BankStatementRow[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeTab, setActiveTab] = useState('unmatched');
  const [matchRules, setMatchRules] = useState<MatchRule[]>([]);
  const [ruleName, setRuleName] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleField, setRuleField] = useState<'description' | 'reference'>('description');
  const [savingRule, setSavingRule] = useState(false);
  const [reconHydrated, setReconHydrated] = useState(false);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [allTransactions, setAllTransactions] = useState<BankTransaction[]>([]);
  const [glBalance, setGlBalance] = useState<number | null>(null);
  const [glStatus, setGlStatus] = useState<'idle' | 'loading' | 'ok' | 'missing' | 'error'>('idle');

  // Restore last in-progress reconciliation for this account (server first, local fallback).
  useEffect(() => {
    let cancelled = false;
    setReconHydrated(false);
    if (!selectedAccountId) {
      setStatementRows([]);
      setReconHydrated(true);
      return;
    }

    const readLocal = (): BankStatementRow[] => {
      try {
        const raw = localStorage.getItem(RECON_STORAGE_KEY);
        const store = raw ? JSON.parse(raw) as Record<string, { statementRows?: BankStatementRow[] }> : {};
        const saved = store[selectedAccountId];
        return Array.isArray(saved?.statementRows) ? saved.statementRows : [];
      } catch {
        return [];
      }
    };

    (async () => {
      const localRows = readLocal();
      try {
        const res = await api.bankReconciliations.get(selectedAccountId);
        if (cancelled) return;
        const serverRows = Array.isArray(res.data?.statementRows) ? res.data.statementRows as BankStatementRow[] : [];
        if (serverRows.length > 0) {
          setStatementRows(serverRows);
        } else if (localRows.length > 0) {
          setStatementRows(localRows);
          // Migrate local → server once.
          void api.bankReconciliations.save(selectedAccountId, {
            statementRows: localRows,
            branchId: listBranchId || undefined,
          });
        } else {
          setStatementRows([]);
        }
      } catch {
        if (!cancelled) setStatementRows(localRows);
      } finally {
        if (!cancelled) setReconHydrated(true);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedAccountId, listBranchId]);

  // Persist statement rows: localStorage immediately, server debounced.
  useEffect(() => {
    if (!reconHydrated || !selectedAccountId) return;
    try {
      const raw = localStorage.getItem(RECON_STORAGE_KEY);
      const store = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (!statementRows.length) {
        delete store[selectedAccountId];
      } else {
        store[selectedAccountId] = {
          statementRows,
          updatedAt: new Date().toISOString(),
        };
      }
      localStorage.setItem(RECON_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // ignore quota / private mode
    }

    const timer = window.setTimeout(() => {
      void api.bankReconciliations.save(selectedAccountId, {
        statementRows,
        branchId: listBranchId || undefined,
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [statementRows, selectedAccountId, reconHydrated, listBranchId]);

  useEffect(() => {
    getBankAccounts(listBranchId).then(setAccounts);
    getBankTransactions().then(setAllTransactions);
  }, [listBranchId]);

  const loadMatchRules = useCallback(async () => {
    try {
      const res = await api.bankMatchRules.list();
      if (Array.isArray(res.data)) {
        setMatchRules(
          res.data.map((r) => ({
            id: r.id,
            name: r.name,
            pattern: r.pattern,
            matchField: r.matchField === 'reference' ? 'reference' : 'description',
            priority: Number(r.priority) || 100,
            isActive: r.isActive !== false,
          })),
        );
      }
    } catch {
      // table may not exist yet on older servers
    }
  }, []);

  useEffect(() => {
    void loadMatchRules();
  }, [loadMatchRules]);

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  useEffect(() => {
    let cancelled = false;
    const code = String(selectedAccount?.glAccountCode || '').trim();
    if (!selectedAccountId || !code) {
      setGlBalance(null);
      setGlStatus(selectedAccountId ? 'missing' : 'idle');
      return;
    }
    setGlStatus('loading');
    (async () => {
      try {
        const listRes = await api.chartOfAccounts.list();
        const rows = Array.isArray(listRes.data) ? listRes.data : [];
        const account = rows.find((r: any) => String(r.code || '').trim() === code);
        if (!account?.id) {
          if (!cancelled) {
            setGlBalance(null);
            setGlStatus('missing');
          }
          return;
        }
        const balRes = await api.chartOfAccounts.getBalance(String(account.id));
        const bal = Number(
          balRes.data?.current_balance ?? balRes.data?.currentBalance ?? balRes.data?.balance ?? NaN,
        );
        if (!cancelled) {
          if (Number.isFinite(bal)) {
            setGlBalance(bal);
            setGlStatus('ok');
          } else {
            setGlBalance(null);
            setGlStatus('error');
          }
        }
      } catch {
        if (!cancelled) {
          setGlBalance(null);
          setGlStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedAccountId, selectedAccount?.glAccountCode]);

  const accountTransactions = useMemo(() => {
    if (!selectedAccountId) return [];
    let txns = allTransactions.filter(t => t.bankAccountId === selectedAccountId);
    if (dateFrom) txns = txns.filter(t => t.transactionDate >= dateFrom);
    if (dateTo) txns = txns.filter(t => t.transactionDate <= dateTo);
    return txns.sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());
  }, [allTransactions, selectedAccountId, dateFrom, dateTo]);

  const matchedTxnIds = useMemo(
    () => new Set(statementRows.filter(r => r.matchedTransactionId).map(r => r.matchedTransactionId!)),
    [statementRows]
  );

  const unmatchedSystemTxns = useMemo(
    () => accountTransactions.filter(t => !matchedTxnIds.has(t.id)),
    [accountTransactions, matchedTxnIds]
  );

  const summary: ReconciliationSummary = useMemo(() => {
    const matched = statementRows.filter(r => r.matched).length;
    const lastRow = statementRows[statementRows.length - 1];
    const statementBalance = lastRow?.balance ?? statementRows.reduce((s, r) => s + (r.direction === 'in' ? r.amount : -r.amount), 0);
    const systemBalance = selectedAccount?.currentBalance ?? 0;

    return {
      statementRows: statementRows.length,
      matched,
      unmatched: statementRows.length - matched,
      systemOnly: unmatchedSystemTxns.length,
      statementBalance,
      systemBalance,
      difference: systemBalance - statementBalance,
    };
  }, [statementRows, selectedAccount, unmatchedSystemTxns]);

  // ==================== IMPORT EXCEL ====================

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const isOfx = /\.(ofx|qfx)$/i.test(file.name) || /ofx/i.test(file.type || '');

    const finish = (rows: BankStatementRow[]) => {
      setStatementRows(rows);
      toast({
        title: t.bankReconciliationUi.statementImported,
        description: t.bankReconciliationUi.linesLoaded.replace('{count}', String(rows.length)),
      });
      setImportDialogOpen(false);
    };

    const fail = () => {
      toast({
        title: t.bankReconciliationUi.importError,
        description: t.bankReconciliationUi.fileFormatNotRecognized,
        variant: 'destructive',
      });
    };

    if (isCsv || isOfx) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const text = String(evt.target?.result || '');
          const parsed = (isOfx ? parseBankOfx(text) : parseBankCsv(text)).map((r) => ({
            ...r,
            matched: false,
          })) as BankStatementRow[];
          if (!parsed.length) {
            fail();
            return;
          }
          finish(parsed);
        } catch {
          fail();
        }
      };
      reader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<any>(ws);

        const rows: BankStatementRow[] = json.map((row: any, i: number) => {
          const rawDate = row['Data'] || row['Date'] || row['data'] || row['date'] || '';
          // NOTE: keep Portuguese column names here for import compatibility.
          const desc = row['Description'] || row['Descricao'] || row['description'] || row['Movimento'] || row['Desc'] || row['desc'] || row['Descricao/Description'] || row['description/descricao'] || row['description/Descrição'] || row['Descrição'] || '';
          const ref = row['Reference'] || row['Ref'] || row['ref'] || row['Referencia'] || row['reference'] || row['Referência'] || '';
          const credit = parseFloat(row['Credit'] || row['credito'] || row['credit'] || row['Crédito'] || 0);
          const debit = parseFloat(row['Debit'] || row['debito'] || row['debit'] || row['Débito'] || 0);
          const amount = row['Valor'] || row['Amount'] || row['amount'];
          const balance = parseFloat(row['Saldo'] || row['Balance'] || row['saldo'] || row['balance'] || 0);

          let finalAmount = 0;
          let direction: 'in' | 'out' = 'in';

          if (amount !== undefined) {
            finalAmount = Math.abs(parseFloat(amount));
            direction = parseFloat(amount) >= 0 ? 'in' : 'out';
          } else if (credit > 0) {
            finalAmount = credit;
            direction = 'in';
          } else if (debit > 0) {
            finalAmount = debit;
            direction = 'out';
          }

          // Parse date
          let dateStr = '';
          if (typeof rawDate === 'number') {
            const d = XLSX.SSF.parse_date_code(rawDate);
            dateStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          } else if (rawDate) {
            dateStr = rawDate;
          }

          return {
            id: `stmt_${i}_${Date.now()}`,
            date: dateStr,
            description: String(desc),
            reference: ref ? String(ref) : undefined,
            amount: finalAmount,
            direction,
            balance: balance || undefined,
            matched: false,
          };
        });

        finish(rows);
      } catch {
        fail();
      }
    };
    reader.readAsArrayBuffer(file);
  }, [toast, t]);

  // ==================== AUTO-MATCH ====================

  const autoMatch = useCallback(() => {
    if (!accountTransactions.length || !statementRows.length) return;

    const { rows: updated, matchCount } = autoMatchStatements(
      statementRows,
      accountTransactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        direction: t.direction,
        transactionDate: t.transactionDate,
        bankReference: t.bankReference,
        description: t.description,
      })),
      { matchedIds: new Set(matchedTxnIds), minScore: 50, rules: matchRules },
    );

    setStatementRows(updated as BankStatementRow[]);
    toast({
      title: t.bankReconciliationUi.autoReconciliation,
      description: t.bankReconciliationUi.autoReconciledCount.replace('{count}', String(matchCount)),
    });
  }, [accountTransactions, statementRows, matchedTxnIds, matchRules, toast, t]);

  const addMatchRule = async () => {
    if (!ruleName.trim() || !rulePattern.trim()) {
      toast({ title: t.bankReconciliationUi.importError, description: 'Name and pattern are required', variant: 'destructive' });
      return;
    }
    setSavingRule(true);
    try {
      const res = await api.bankMatchRules.create({
        name: ruleName.trim(),
        pattern: rulePattern.trim(),
        matchField: ruleField,
        priority: 100,
        isActive: true,
      });
      if (res.error) throw new Error(res.error);
      setRuleName('');
      setRulePattern('');
      await loadMatchRules();
      toast({ title: t.bankReconciliationUi.reconciled, description: 'Match rule saved' });
    } catch (e: any) {
      toast({ title: t.bankReconciliationUi.importError, description: e?.message || 'Failed to save rule', variant: 'destructive' });
    } finally {
      setSavingRule(false);
    }
  };

  const removeMatchRule = async (id: string) => {
    setSavingRule(true);
    try {
      const res = await api.bankMatchRules.remove(id);
      if (res.error) throw new Error(res.error);
      await loadMatchRules();
    } catch (e: any) {
      toast({ title: t.bankReconciliationUi.importError, description: e?.message || 'Failed to delete rule', variant: 'destructive' });
    } finally {
      setSavingRule(false);
    }
  };

  // ==================== MANUAL MATCH ====================

  const [manualMatchRow, setManualMatchRow] = useState<BankStatementRow | null>(null);

  const handleManualMatch = (row: BankStatementRow, txnId: string) => {
    setStatementRows(prev => prev.map(r =>
      r.id === row.id ? { ...r, matched: true, matchedTransactionId: txnId, matchConfidence: 100 } : r
    ));
    setManualMatchRow(null);
    toast({ title: t.bankReconciliationUi.reconciled, description: t.bankReconciliationUi.manuallyReconciled });
  };

  const handleUnmatch = (rowId: string) => {
    setStatementRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, matched: false, matchedTransactionId: undefined, matchConfidence: undefined } : r
    ));
  };

  // ==================== FILTERED ROWS ====================

  const filteredStatementRows = useMemo(() => {
    let rows = statementRows;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r => r.description.toLowerCase().includes(term) || r.reference?.toLowerCase().includes(term));
    }
    if (activeTab === 'unmatched') return rows.filter(r => !r.matched);
    if (activeTab === 'matched') return rows.filter(r => r.matched);
    return rows;
  }, [statementRows, searchTerm, activeTab]);

  const getCurrencySymbol = (currency?: string) => {
    switch (currency) { case 'USD': return '$'; case 'EUR': return '€'; default: return 'Kz'; }
  };

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.bankReconciliationUi.title}</h1>
          <p className="text-muted-foreground">{t.bankReconciliationUi.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportDialogOpen(true)} className="gap-2">
            <Upload className="w-4 h-4" />
            {t.bankReconciliationUi.importStatement}
          </Button>
          {statementRows.length > 0 && (
            <>
              <Button onClick={autoMatch} className="gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                {t.bankReconciliationUi.autoReconcile}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStatementRows([]);
                  toast({
                    title: t.bankReconciliationUi.title,
                    description: language === 'pt' ? 'Extracto limpo' : 'Statement cleared',
                  });
                }}
              >
                {language === 'pt' ? 'Limpar' : 'Clear'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Account Selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label>{t.bankReconciliationUi.bankAccount}</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder={t.bankReconciliationUi.selectAccountPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.bankName.split(' - ')[0]} — {acc.accountNumber} ({acc.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.bankReconciliationUi.dateFrom}</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t.bankReconciliationUi.dateTo}</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank operational balance vs GL (COA leaf) */}
      {selectedAccount && (
        <Card className={
          glStatus === 'ok' && glBalance != null && Math.abs((selectedAccount.currentBalance || 0) - glBalance) < 0.01
            ? 'border-emerald-500'
            : glStatus === 'ok' && glBalance != null
              ? 'border-destructive'
              : undefined
        }>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.bankReconciliationUi.bankVsGlTitle}</CardTitle>
            <CardDescription>
              {selectedAccount.glAccountCode
                ? `${t.bankReconciliationUi.glAccount}: ${selectedAccount.glAccountCode}`
                : t.bankReconciliationUi.noGlLink}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t.bankReconciliationUi.bankBalance}</div>
                <div className="text-xl font-bold">
                  {getCurrencySymbol(selectedAccount.currency)}{' '}
                  {(selectedAccount.currentBalance || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t.bankReconciliationUi.glBalance}</div>
                <div className="text-xl font-bold">
                  {glStatus === 'loading' && '…'}
                  {glStatus === 'missing' && '—'}
                  {glStatus === 'error' && t.bankReconciliationUi.glLoadError}
                  {glStatus === 'ok' && glBalance != null && (
                    <>
                      {getCurrencySymbol(selectedAccount.currency)}{' '}
                      {glBalance.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t.bankReconciliationUi.difference}</div>
                {glStatus === 'ok' && glBalance != null ? (
                  <>
                    <div className={`text-xl font-bold ${
                      Math.abs((selectedAccount.currentBalance || 0) - glBalance) < 0.01
                        ? 'text-emerald-600'
                        : 'text-destructive'
                    }`}>
                      {getCurrencySymbol(selectedAccount.currency)}{' '}
                      {Math.abs((selectedAccount.currentBalance || 0) - glBalance).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {Math.abs((selectedAccount.currentBalance || 0) - glBalance) < 0.01
                        ? t.bankReconciliationUi.bankGlOk
                        : t.bankReconciliationUi.bankGlDiff}
                    </div>
                  </>
                ) : (
                  <div className="text-xl font-bold text-muted-foreground">—</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {statementRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <FileSpreadsheet className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
              <div className="text-2xl font-bold">{summary.statementRows}</div>
              <div className="text-xs text-muted-foreground">{t.bankReconciliationUi.statementLines}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 mb-1" />
              <div className="text-2xl font-bold text-emerald-600">{summary.matched}</div>
              <div className="text-xs text-muted-foreground">{t.bankReconciliationUi.matched}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <AlertTriangle className="w-6 h-6 mx-auto text-orange-500 mb-1" />
              <div className="text-2xl font-bold text-orange-600">{summary.unmatched}</div>
              <div className="text-xs text-muted-foreground">{t.bankReconciliationUi.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <XCircle className="w-6 h-6 mx-auto text-destructive mb-1" />
              <div className="text-2xl font-bold">{summary.systemOnly}</div>
              <div className="text-xs text-muted-foreground">{t.bankReconciliationUi.systemOnly}</div>
            </CardContent>
          </Card>
          <Card className={Math.abs(summary.difference) < 0.01 ? 'border-emerald-500' : 'border-destructive'}>
            <CardContent className="pt-4 text-center">
              <Scale className="w-6 h-6 mx-auto mb-1" />
              <div className={`text-2xl font-bold ${Math.abs(summary.difference) < 0.01 ? 'text-emerald-600' : 'text-destructive'}`}>
                {getCurrencySymbol(selectedAccount?.currency)} {Math.abs(summary.difference).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-muted-foreground">
                {Math.abs(summary.difference) < 0.01 ? t.bankReconciliationUi.reconciledOk : t.bankReconciliationUi.difference}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      {selectedAccountId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t.bankReconciliationUi.transactionsTitle}</CardTitle>
                <CardDescription>
                  {statementRows.length > 0
                    ? t.bankReconciliationUi.compareStatementVsSystem
                    : t.bankReconciliationUi.importToStart}
                </CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.bankReconciliationUi.searchPlaceholder}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {statementRows.length > 0 ? (
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="all">
                    {t.bankReconciliationUi.tabAll.replace('{count}', String(statementRows.length))}
                  </TabsTrigger>
                  <TabsTrigger value="unmatched">
                    {t.bankReconciliationUi.tabPending.replace('{count}', String(statementRows.filter(r => !r.matched).length))}
                  </TabsTrigger>
                  <TabsTrigger value="matched">
                    {t.bankReconciliationUi.tabMatched.replace('{count}', String(statementRows.filter(r => r.matched).length))}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={activeTab} className="mt-4">
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">{t.bankReconciliationUi.colStatus}</TableHead>
                          <TableHead>{t.bankReconciliationUi.colDate}</TableHead>
                          <TableHead>{t.bankReconciliationUi.colDescription}</TableHead>
                          <TableHead>{t.bankReconciliationUi.colReference}</TableHead>
                          <TableHead className="text-right">{t.bankReconciliationUi.colAmount}</TableHead>
                          <TableHead className="text-right">{t.bankReconciliationUi.colBalance}</TableHead>
                          <TableHead className="w-28">{t.bankReconciliationUi.colAction}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredStatementRows.map(row => (
                          <TableRow key={row.id} className={row.matched ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}>
                            <TableCell>
                              {row.matched ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <AlertTriangle className="w-5 h-5 text-orange-500" />
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{row.date}</TableCell>
                            <TableCell className="text-sm max-w-48 truncate">{row.description}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{row.reference || t.common.dash}</TableCell>
                            <TableCell className={`text-right font-medium ${row.direction === 'in' ? 'text-emerald-600' : 'text-destructive'}`}>
                              {row.direction === 'in' ? '+' : '-'}{row.amount.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {row.balance?.toLocaleString(uiLocale, { minimumFractionDigits: 2 }) || t.common.dash}
                            </TableCell>
                            <TableCell>
                              {row.matched ? (
                                <Button variant="ghost" size="sm" onClick={() => handleUnmatch(row.id)}>
                                  <Unlink className="w-4 h-4 mr-1" />
                                  {t.bankReconciliationUi.undo}
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" onClick={() => setManualMatchRow(row)}>
                                  <Link2 className="w-4 h-4 mr-1" />
                                  {t.bankReconciliationUi.reconcile}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredStatementRows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                              {t.bankReconciliationUi.noneForTab
                                .replace('{kind}', activeTab === 'unmatched'
                                  ? t.bankReconciliationUi.kindPendingLower
                                  : activeTab === 'matched'
                                    ? t.bankReconciliationUi.kindMatchedLower
                                    : '')}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            ) : (
              // Show system transactions when no statement imported
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.bankReconciliationUi.colDate}</TableHead>
                      <TableHead>{t.bankReconciliationUi.colDescription}</TableHead>
                      <TableHead>{t.bankReconciliationUi.colReference}</TableHead>
                      <TableHead className="text-right">{t.bankReconciliationUi.colAmount}</TableHead>
                      <TableHead className="text-right">{t.bankReconciliationUi.colBalance}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountTransactions.map(txn => (
                      <TableRow key={txn.id}>
                        <TableCell className="whitespace-nowrap text-sm">{txn.transactionDate}</TableCell>
                        <TableCell className="text-sm">{txn.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{txn.referenceNumber || t.common.dash}</TableCell>
                        <TableCell className={`text-right font-medium ${txn.direction === 'in' ? 'text-emerald-600' : 'text-destructive'}`}>
                          {txn.direction === 'in' ? '+' : '-'}{txn.amount.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-sm">{txn.balanceAfter.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}</TableCell>
                      </TableRow>
                    ))}
                    {accountTransactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {t.bankReconciliationUi.noSystemTransactions}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedAccountId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Scale className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t.bankReconciliationUi.pickAccountTitle}</h3>
            <p className="text-muted-foreground">{t.bankReconciliationUi.pickAccountDescription}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Match rules</CardTitle>
          <CardDescription>
            Optional regex boosts for auto-reconcile (description or reference). Active rules: {matchRules.filter((r) => r.isActive).length}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4 items-end">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Salary credit" />
            </div>
            <div className="space-y-1.5">
              <Label>Pattern (regex)</Label>
              <Input value={rulePattern} onChange={(e) => setRulePattern(e.target.value)} placeholder="SALAR|FOLHA" />
            </div>
            <div className="space-y-1.5">
              <Label>Field</Label>
              <Select value={ruleField} onValueChange={(v) => setRuleField(v as 'description' | 'reference')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="description">Description</SelectItem>
                  <SelectItem value="reference">Reference</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void addMatchRule()} disabled={savingRule}>
              Add rule
            </Button>
          </div>
          {matchRules.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="font-mono text-xs">{rule.pattern}</TableCell>
                    <TableCell>{rule.matchField}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={savingRule}
                        onClick={() => void removeMatchRule(rule.id)}
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              {t.bankReconciliationUi.importDialogTitle}
            </DialogTitle>
            <DialogDescription>
              {t.bankReconciliationUi.importDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
              <Label htmlFor="statement-file" className="cursor-pointer">
                <span className="text-primary font-medium">{t.bankReconciliationUi.clickToSelect}</span>
                <span className="text-muted-foreground"> {t.bankReconciliationUi.orDragFile}</span>
              </Label>
              <Input
                id="statement-file"
                type="file"
                accept=".xlsx,.xls,.csv,.ofx,.qfx"
                className="hidden"
                onChange={handleFileUpload}
              />
              <p className="text-xs text-muted-foreground mt-2">
                {t.bankReconciliationUi.supportsFormats}
              </p>
            </div>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <p className="text-sm font-medium mb-2">{t.bankReconciliationUi.expectedColumns}</p>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>{t.bankReconciliationUi.colDateBullet}</span>
                  <span>{t.bankReconciliationUi.colDescriptionBullet}</span>
                  <span>{t.bankReconciliationUi.colCreditBullet}</span>
                  <span>{t.bankReconciliationUi.colDebitBullet}</span>
                  <span>{t.bankReconciliationUi.colReferenceBullet}</span>
                  <span>{t.bankReconciliationUi.colBalanceBullet}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Match Dialog */}
      <Dialog open={!!manualMatchRow} onOpenChange={() => setManualMatchRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.bankReconciliationUi.manualMatchTitle}</DialogTitle>
            <DialogDescription>
              {t.bankReconciliationUi.manualMatchDescription}
            </DialogDescription>
          </DialogHeader>
          {manualMatchRow && (
            <div className="space-y-4">
              {/* Statement row info */}
              <Card className="bg-primary/5">
                <CardContent className="pt-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{manualMatchRow.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {manualMatchRow.date} • {t.bankReconciliationUi.refShort}: {manualMatchRow.reference || t.common.dash}
                      </p>
                    </div>
                    <span className={`text-lg font-bold ${manualMatchRow.direction === 'in' ? 'text-emerald-600' : 'text-destructive'}`}>
                      {manualMatchRow.direction === 'in' ? '+' : '-'}{manualMatchRow.amount.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* System transactions to match against */}
              <ScrollArea className="max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.bankReconciliationUi.colDate}</TableHead>
                      <TableHead>{t.bankReconciliationUi.colDescription}</TableHead>
                      <TableHead className="text-right">{t.bankReconciliationUi.colAmount}</TableHead>
                      <TableHead className="w-24">{t.bankReconciliationUi.colAction}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmatchedSystemTxns.map(txn => (
                      <TableRow key={txn.id}>
                        <TableCell className="text-sm">{txn.transactionDate}</TableCell>
                        <TableCell className="text-sm">{txn.description}</TableCell>
                        <TableCell className={`text-right font-medium ${txn.direction === 'in' ? 'text-emerald-600' : 'text-destructive'}`}>
                          {txn.direction === 'in' ? '+' : '-'}{txn.amount.toLocaleString(uiLocale, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" onClick={() => handleManualMatch(manualMatchRow, txn.id)}>
                            <Link2 className="w-4 h-4 mr-1" />
                            {t.bankReconciliationUi.reconcile}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {unmatchedSystemTxns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                          {t.bankReconciliationUi.noTransactionsToMatch}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
