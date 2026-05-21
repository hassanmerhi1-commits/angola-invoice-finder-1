import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Plus, Search, Edit2, Trash2, RefreshCw, FileText,
  Calendar, Eye, Printer, Download, CheckCircle, XCircle,
  Filter, ChevronLeft, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Account } from '@/types/accounting';
import { api } from '@/lib/api/client';
import { subscribeSupplierReturnsChanged } from '@/lib/supplierReturnSync';
import { useTrialBalance } from '@/hooks/useChartOfAccounts';
import { useSales } from '@/hooks/useERP';

function mapJournalLineFromApi(l: Record<string, unknown>, entryId: string) {
  const debit = Number(l.debit_amount ?? l.debitAmount ?? l.debit ?? 0);
  const credit = Number(l.credit_amount ?? l.creditAmount ?? l.credit ?? 0);
  const accountCode = String(l.account_code ?? l.accountCode ?? '');
  return {
    id: String(l.id ?? `${entryId}_${accountCode}_${debit}_${credit}`),
    accountCode,
    accountName: String(l.account_name ?? l.accountName ?? ''),
    description: String(l.description ?? ''),
    debit,
    credit,
  };
}

const COA_STORAGE_KEY = 'kwanzaerp_chart_of_accounts';

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(COA_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Mock journal entries for display types
interface DisplayEntry {
  id: string;
  entryNumber: string;
  date: string;
  type: string;
  currency: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  isPosted: boolean;
  createdBy: string;
  lines: { id: string; accountCode: string; accountName: string; description: string; debit: number; credit: number }[];
}

const ENTRY_TYPES = [
  { value: 'venda', labelKey: 'sale', color: 'text-blue-600' },
  { value: 'sale', labelKey: 'sale', color: 'text-blue-600' },
  { value: 'compra', labelKey: 'purchase', color: 'text-orange-600' },
  { value: 'purchase_invoice', labelKey: 'purchase', color: 'text-orange-600' },
  { value: 'credit_note', labelKey: 'creditNote', color: 'text-rose-600' },
  { value: 'debit_note', labelKey: 'debitNote', color: 'text-rose-700' },
  { value: 'recibo', labelKey: 'receipt', color: 'text-green-600' },
  { value: 'payment_receipt', labelKey: 'receipt', color: 'text-green-600' },
  { value: 'pagamento', labelKey: 'payment', color: 'text-red-600' },
  { value: 'payment_out', labelKey: 'payment', color: 'text-red-600' },
  { value: 'ajuste', labelKey: 'adjustment', color: 'text-purple-600' },
  { value: 'adjustment', labelKey: 'adjustment', color: 'text-purple-600' },
  { value: 'abertura', labelKey: 'opening', color: 'text-muted-foreground' },
  { value: 'fecho', labelKey: 'closing', color: 'text-muted-foreground' },
  { value: 'manual', labelKey: 'manual', color: 'text-amber-600' },
];

const FILTER_ENTRY_TYPES = [
  { value: 'venda', labelKey: 'sale' },
  { value: 'compra', labelKey: 'purchase' },
  { value: 'purchase_invoice', labelKey: 'purchase' },
  { value: 'credit_note', labelKey: 'creditNote' },
  { value: 'debit_note', labelKey: 'debitNote' },
  { value: 'recibo', labelKey: 'receipt' },
  { value: 'pagamento', labelKey: 'payment' },
  { value: 'ajuste', labelKey: 'adjustment' },
  { value: 'manual', labelKey: 'manual' },
];

function resolveEntryType(type: string) {
  return (
    ENTRY_TYPES.find((entry) => entry.value === type)
    || { value: type, labelKey: 'manual', color: 'text-muted-foreground' }
  );
}

function useJournalEntries(
  branchId: string | undefined,
  ui: { systemUser: string; salesOfMerchandise: string }
) {
  const [entries, setEntries] = useState<DisplayEntry[]>([]);

  const loadAll = useCallback(async () => {
    const allEntries: DisplayEntry[] = [];

    try {
      // Load all entries from Express DB; filter by branch including legacy rows with null branch_id
      const response = await api.journalEntries.list();
      if (response.error) {
        console.warn('[Journals] Failed to load journal entries:', response.error);
      }
      const rows = Array.isArray(response.data) ? response.data : [];
      const journalEntries = branchId
        ? rows.filter(
            (je: Record<string, unknown>) =>
              String(je.branch_id ?? je.branchId) === branchId,
          )
        : rows;
      for (const je of journalEntries) {
        allEntries.push({
          id: je.id,
          entryNumber: je.entry_number || je.entryNumber,
          date: je.entry_date || je.entryDate || je.created_at || je.createdAt,
          type: je.reference_type || je.referenceType || 'manual',
          currency: 'AOA',
          description: je.description,
          totalDebit: Number(je.total_debit || je.totalDebit || 0),
          totalCredit: Number(je.total_credit || je.totalCredit || 0),
          isPosted: true,
          createdBy: je.created_by || je.createdBy || ui.systemUser,
          lines: (je.lines || []).map((l: Record<string, unknown>) =>
            mapJournalLineFromApi(l, je.id),
          ),
        });
      }
    } catch {
      // Fallback: localStorage
      try {
        const raw = localStorage.getItem('kwanzaerp_journal_entries');
        const journalEntries = raw ? JSON.parse(raw) : [];
      for (const je of journalEntries) {
          if (branchId && je.branchId !== branchId) continue;
          allEntries.push({
            id: je.id,
            entryNumber: je.entryNumber,
            date: je.entryDate || je.createdAt,
            type: je.referenceType || 'manual',
            currency: 'AOA',
            description: je.description,
            totalDebit: je.totalDebit,
            totalCredit: je.totalCredit,
            isPosted: true,
            createdBy: je.createdBy || ui.systemUser,
            lines: (je.lines || []).map((l: any) => ({
              id: `${je.id}_${l.accountCode}_${l.debit}_${l.credit}`,
              accountCode: l.accountCode || '',
              accountName: l.accountName || '',
              description: l.description || '',
              debit: l.debit,
              credit: l.credit,
            })),
          });
        }
      } catch { /* ignore */ }
    }

    if (!window.electronAPI?.isElectron) {
      try {
        const salesData = localStorage.getItem('kwanzaerp_sales');
        const sales = salesData ? JSON.parse(salesData) : [];
        const existingIds = new Set(allEntries.map(e => e.id));
        
        for (let idx = 0; idx < Math.min(sales.length, 50); idx++) {
          const sale = sales[idx];
          const id = `sale_je_${sale.id || idx}`;
          if (existingIds.has(id)) continue;
          
          allEntries.push({
            id,
            entryNumber: `VD-${String(idx + 1).padStart(4, '0')}`,
            date: sale.createdAt || new Date().toISOString(),
            type: 'venda',
            currency: 'AOA',
            description: `Venda ${sale.invoiceNumber || ''}`.trim(),
            totalDebit: sale.total || 0,
            totalCredit: sale.total || 0,
            isPosted: true,
            createdBy: sale.cashierName || ui.systemUser,
            lines: [
              { id: `${id}_1`, accountCode: '4.1.1', accountName: 'Caixa', description: 'Recebimento', debit: sale.total || 0, credit: 0 },
              { id: `${id}_2`, accountCode: '7.1.1', accountName: ui.salesOfMerchandise, description: sale.invoiceNumber || '', debit: 0, credit: (sale.subtotal || sale.total || 0) },
              ...(sale.taxAmount ? [{ id: `${id}_3`, accountCode: '2.4.3', accountName: 'IVA a Pagar', description: 'IVA', debit: 0, credit: sale.taxAmount }] : []),
            ],
          });
        }
      } catch { /* ignore */ }
    }

    allEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEntries(allEntries);
  }, [branchId, ui.salesOfMerchandise, ui.systemUser]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => subscribeSupplierReturnsChanged(() => { void loadAll(); }), [loadAll]);

  return { entries, refetch: loadAll };
}

// ============= NEW ENTRY LINE INTERFACE =============
interface NewEntryLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: string;
  credit: string;
}

function JournalsTrialBalancePanel() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const monthStart = new Date();
  monthStart.setDate(1);
  const [startDate, setStartDate] = useState(monthStart.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const { data, isLoading, error, refetch, totals } = useTrialBalance(startDate, endDate);

  const rows = data.filter(r => !r.is_header && (Number(r.total_debits) > 0 || Number(r.total_credits) > 0));

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{t.common.from}:</span>
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-7 text-xs w-32" />
        <span className="text-xs text-muted-foreground">{t.common.to}:</span>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-7 text-xs w-32" />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={refetch}>
          <RefreshCw className="w-3 h-3 mr-1" /> {t.common.refresh}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex-1 overflow-auto border rounded-lg">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">{t.journalsUi.account}</th>
                <th className="px-3 py-2 text-left">{t.common.name}</th>
                <th className="px-3 py-2 text-right">{t.journalsUi.debit}</th>
                <th className="px-3 py-2 text-right">{t.journalsUi.credit}</th>
                <th className="px-3 py-2 text-right">{t.chartOfAccountsUi.colBalance}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-mono">{row.code}</td>
                  <td className="px-3 py-1.5">{row.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-green-600">
                    {Number(row.total_debits) > 0 ? Number(row.total_debits).toLocaleString(uiLocale) : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-red-600">
                    {Number(row.total_credits) > 0 ? Number(row.total_credits).toLocaleString(uiLocale) : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{Number(row.closing_balance).toLocaleString(uiLocale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/80 border-t font-bold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>{t.common.total}</td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{totals.debits.toLocaleString(uiLocale)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{totals.credits.toLocaleString(uiLocale)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.noEntriesFound}</p>
        )}
      </div>
    </div>
  );
}

function JournalsAuditPanel() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.audit.list({ limit: 200 });
      setRows(res.data || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeSupplierReturnsChanged(() => { void load(); }), [load]);

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={load}>
          <RefreshCw className="w-3 h-3 mr-1" /> {t.common.refresh}
        </Button>
      </div>
      <div className="flex-1 overflow-auto border rounded-lg">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">{t.common.date}</th>
                <th className="px-3 py-2 text-left">{t.common.type}</th>
                <th className="px-3 py-2 text-left">{t.common.description}</th>
                <th className="px-3 py-2 text-left">{t.common.user}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {new Date(row.created_at || row.timestamp || '').toLocaleString(uiLocale)}
                  </td>
                  <td className="px-3 py-1.5 font-mono">{row.table_name || row.entity_type || '—'}</td>
                  <td className="px-3 py-1.5">{row.description || row.action || '—'}</td>
                  <td className="px-3 py-1.5">{row.user_name || row.userName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rows.length === 0 && (
          <p className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.auditHintDesc}</p>
        )}
      </div>
    </div>
  );
}

function JournalsCashiersPanel({ branchId }: { branchId?: string }) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { sales } = useSales(branchId);

  const cashierRows = useMemo(() => {
    const map = new Map<string, { name: string; sales: number; count: number }>();
    for (const sale of sales) {
      if (sale.status && sale.status !== 'completed') continue;
      const key = sale.cashierId || sale.cashierName || t.journalsUi.systemUser;
      const label = sale.cashierName || key;
      const prev = map.get(key) || { name: label, sales: 0, count: 0 };
      prev.sales += Number(sale.total) || 0;
      prev.count += 1;
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [sales, t.journalsUi.systemUser]);

  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 border-b sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">{t.common.user}</th>
              <th className="px-3 py-2 text-right">{t.journalsUi.cashierSalesCount}</th>
              <th className="px-3 py-2 text-right">{t.journalsUi.cashierSalesTotal}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {cashierRows.map(row => (
              <tr key={row.name}>
                <td className="px-3 py-1.5">{row.name}</td>
                <td className="px-3 py-1.5 text-right font-mono">{row.count}</td>
                <td className="px-3 py-1.5 text-right font-mono">{row.sales.toLocaleString(uiLocale)} Kz</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cashierRows.length === 0 && (
          <p className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.cashiersHintDesc}</p>
        )}
      </div>
    </div>
  );
}

function createEmptyLine(): NewEntryLine {
  return {
    id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    accountCode: '',
    accountName: '',
    description: '',
    debit: '',
    credit: '',
  };
}

export default function Journals() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { currentBranch, apiBranchId } = useBranchScope();
  const { entries, refetch } = useJournalEntries(apiBranchId, {
    systemUser: t.journalsUi.systemUser,
    salesOfMerchandise: t.journalsUi.salesOfMerchandise,
  });

  const [activeTab, setActiveTab] = useState('diarios');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewEntryOpen, setViewEntryOpen] = useState(false);

  // New entry dialog state
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [newEntryDate, setNewEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [newEntryType, setNewEntryType] = useState('ajuste');
  const [newEntryDescription, setNewEntryDescription] = useState('');
  const [newEntryLines, setNewEntryLines] = useState<NewEntryLine[]>([createEmptyLine(), createEmptyLine()]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  // Load accounts for the picker
  useEffect(() => {
    if (newEntryOpen) {
      const accts = loadAccounts().filter(a => a.is_active && !a.is_header);
      setAccounts(accts);
    }
  }, [newEntryOpen]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesSearch = !searchTerm ||
        e.entryNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType =
        filterType === 'all'
        || e.type === filterType
        || (filterType === 'compra' && e.type === 'purchase_invoice')
        || (filterType === 'venda' && e.type === 'sale')
        || (filterType === 'recibo' && e.type === 'payment_receipt')
        || (filterType === 'pagamento' && e.type === 'payment_out');
      const matchesDateFrom = !dateFrom || e.date >= dateFrom;
      const matchesDateTo = !dateTo || e.date <= dateTo + 'T23:59:59';
      return matchesSearch && matchesType && matchesDateFrom && matchesDateTo;
    });
  }, [entries, searchTerm, filterType, dateFrom, dateTo]);

  // Totals
  const totals = useMemo(() => {
    return filteredEntries.reduce((acc, e) => ({
      debit: acc.debit + e.totalDebit,
      credit: acc.credit + e.totalCredit,
    }), { debit: 0, credit: 0 });
  }, [filteredEntries]);

  const selectedEntry = entries.find(e => e.id === selectedEntryId);

  // New entry line calculations
  const newEntryTotalDebit = newEntryLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const newEntryTotalCredit = newEntryLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(newEntryTotalDebit - newEntryTotalCredit) < 0.01;
  const difference = newEntryTotalDebit - newEntryTotalCredit;

  // Filtered accounts for picker
  const filteredAccounts = useMemo(() => {
    if (!accountSearch) return accounts.slice(0, 30);
    const term = accountSearch.toLowerCase();
    return accounts.filter(a => 
      a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)
    ).slice(0, 30);
  }, [accounts, accountSearch]);

  // Reset new entry form
  function resetNewEntry() {
    setNewEntryDate(new Date().toISOString().split('T')[0]);
    setNewEntryType('ajuste');
    setNewEntryDescription('');
    setNewEntryLines([createEmptyLine(), createEmptyLine()]);
    setAccountSearch('');
    setActiveLineId(null);
  }

  function openNewEntry() {
    resetNewEntry();
    setNewEntryOpen(true);
  }

  function updateLine(lineId: string, field: keyof NewEntryLine, value: string) {
    setNewEntryLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const updated = { ...l, [field]: value };
      // When entering debit, clear credit and vice versa
      if (field === 'debit' && parseFloat(value) > 0) {
        updated.credit = '';
      } else if (field === 'credit' && parseFloat(value) > 0) {
        updated.debit = '';
      }
      return updated;
    }));
  }

  function selectAccount(lineId: string, account: Account) {
    setNewEntryLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      return { ...l, accountCode: account.code, accountName: account.name };
    }));
    setActiveLineId(null);
    setAccountSearch('');
  }

  function removeLine(lineId: string) {
    if (newEntryLines.length <= 2) {
      toast.error(t.journalsUi.minTwoLines);
      return;
    }
    setNewEntryLines(prev => prev.filter(l => l.id !== lineId));
  }

  function addLine() {
    setNewEntryLines(prev => [...prev, createEmptyLine()]);
  }

  // Auto-fill last line to balance
  function autoBalance() {
    if (newEntryLines.length < 2) return;
    const lastLine = newEntryLines[newEntryLines.length - 1];
    const otherLines = newEntryLines.slice(0, -1);
    const otherDebit = otherLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const otherCredit = otherLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    const diff = otherDebit - otherCredit;

    setNewEntryLines(prev => prev.map((l, i) => {
      if (i !== prev.length - 1) return l;
      if (diff > 0) {
        return { ...l, credit: diff.toFixed(2), debit: '' };
      } else if (diff < 0) {
        return { ...l, debit: Math.abs(diff).toFixed(2), credit: '' };
      }
      return l;
    }));
  }

  // Save journal entry
  async function saveNewEntry() {
    // Validate
    if (!newEntryDescription.trim()) {
      toast.error(t.journalsUi.fillEntryDescription);
      return;
    }

    const validLines = newEntryLines.filter(l => l.accountCode && (parseFloat(l.debit) || parseFloat(l.credit)));
    if (validLines.length < 2) {
      toast.error(t.journalsUi.minTwoLinesWithAccountAndAmount);
      return;
    }

    if (!isBalanced) {
      toast.error(t.journalsUi.entryNotBalanced.replace('{amount}', Math.abs(difference).toLocaleString(uiLocale)));
      return;
    }

    // Create journal entry via API
    let createdEntry: any;
    try {
      const lines = validLines.map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        description: line.description || newEntryDescription,
        debit: parseFloat(line.debit) || 0,
        credit: parseFloat(line.credit) || 0,
      }));
      
      const docId = `manual_${Date.now()}`;
      const response = await api.transactions.process({
        transactionType: 'adjustment',
        documentId: docId,
        documentNumber: `JE-${String(Date.now()).slice(-6)}`,
        branchId: currentBranch?.id || '',
        branchName: currentBranch?.name || '',
        userId: user?.id || '',
        userName: user?.name || 'Sistema',
        date: newEntryDate,
        description: newEntryDescription,
        journalLines: lines,
      });
      
      if (response.error || (response.data && response.data.success === false)) {
        throw new Error(response.error || response.data?.errors?.join?.('; ') || 'Failed to post journal');
      }
      createdEntry = response.data || { entryNumber: `JE-${Date.now()}` };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.journalsUi.entryCreateFailed);
      return;
    }

    toast.success(t.journalsUi.entryCreated.replace('{number}', createdEntry.entryNumber), {
      description: t.journalsUi.entryCreatedDesc
        .replace('{debit}', newEntryTotalDebit.toLocaleString(uiLocale))
        .replace('{credit}', newEntryTotalCredit.toLocaleString(uiLocale)),
    });

    setNewEntryOpen(false);
    await refetch();
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b flex-wrap">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={openNewEntry}>
          <Plus className="w-3 h-3" /> {t.journalsUi.newEntry}
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedEntry}
          onClick={() => { setViewEntryOpen(true); }}>
          <Eye className="w-3 h-3" /> {t.common.view}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        {/* Date filters */}
        <span className="text-xs text-muted-foreground">{t.common.from}:</span>
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-7 text-xs w-32" />
        <span className="text-xs text-muted-foreground">{t.common.to}:</span>
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-7 text-xs w-32" />
        <div className="w-px h-5 bg-border mx-1" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder={t.common.type} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {FILTER_ENTRY_TYPES.map((ft) => (
              <SelectItem key={ft.value} value={ft.value}>
                {t.journalsUi.entryTypes[ft.labelKey as keyof typeof t.journalsUi.entryTypes] as string}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={refetch}><RefreshCw className="w-3 h-3" /></Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder={t.common.search} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-40" />
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          {[
            { key: 'diarios', labelKey: 'tabJournals' },
            { key: 'balancete', labelKey: 'tabTrialBalance' },
            { key: 'auditoria', labelKey: 'tabAudit' },
            { key: 'cashiers', labelKey: 'tabCashiers' },
          ].map((tab) => {
            return (
              <TabsTrigger key={tab.key} value={tab.key}
                className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5">
                {t.journalsUi[tab.labelKey as keyof typeof t.journalsUi] as string}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="diarios" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.common.date}</th>
                <th className="px-3 py-2 text-left font-semibold w-16">{t.common.type}</th>
                <th className="px-3 py-2 text-center font-semibold w-12">{t.common.currency}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.journalsUi.entryNo}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.common.description}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.journalsUi.debit}</th>
                <th className="px-3 py-2 text-right font-semibold w-28">{t.journalsUi.credit}</th>
                <th className="px-3 py-2 text-left font-semibold w-20">{t.common.user}</th>
                <th className="px-3 py-2 text-center font-semibold w-12">{t.common.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredEntries.map(entry => {
                const typeConfig = resolveEntryType(entry.type);
                return (
                  <tr key={entry.id}
                    className={cn("cursor-pointer hover:bg-accent/50 transition-colors",
                      selectedEntryId === entry.id && "bg-primary/15")}
                    onClick={() => setSelectedEntryId(entry.id)}
                    onDoubleClick={() => { setSelectedEntryId(entry.id); setViewEntryOpen(true); }}>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {new Date(entry.date).toLocaleDateString(uiLocale)}
                    </td>
                    <td className={cn("px-3 py-1.5 font-medium", typeConfig?.color)}>
                      {typeConfig
                        ? (t.journalsUi.entryTypes[typeConfig.labelKey as keyof typeof t.journalsUi.entryTypes] as string)
                        : entry.type}
                    </td>
                    <td className="px-3 py-1.5 text-center text-muted-foreground">{entry.currency}</td>
                    <td className="px-3 py-1.5 font-mono">{entry.entryNumber}</td>
                    <td className="px-3 py-1.5">{entry.description}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{entry.totalDebit.toLocaleString(uiLocale)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{entry.totalCredit.toLocaleString(uiLocale)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{entry.createdBy}</td>
                    <td className="px-3 py-1.5 text-center">
                      {entry.isPosted ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 inline" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-muted-foreground inline" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/80 border-t-2 border-primary/30">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={5}>{t.journalsUi.totalEntries.replace('{count}', String(filteredEntries.length))}</td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{totals.debit.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{totals.credit.toLocaleString(uiLocale)} Kz</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          {filteredEntries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.noEntriesFound}</div>
          )}
        </TabsContent>

        <TabsContent value="balancete" className="flex-1 m-0 overflow-hidden">
          <JournalsTrialBalancePanel />
        </TabsContent>

        <TabsContent value="auditoria" className="flex-1 m-0 overflow-hidden">
          <JournalsAuditPanel />
        </TabsContent>

        <TabsContent value="cashiers" className="flex-1 m-0 overflow-hidden">
          <JournalsCashiersPanel branchId={currentBranch?.id} />
        </TabsContent>
      </Tabs>

      {/* View Entry Dialog */}
      <Dialog open={viewEntryOpen} onOpenChange={setViewEntryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.journalsUi.entryTitle.replace('{number}', selectedEntry?.entryNumber || '')}</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">{t.common.date}:</span> {new Date(selectedEntry.date).toLocaleDateString(uiLocale)}</div>
                <div><span className="text-muted-foreground">{t.common.type}:</span> {(() => {
                  const et = resolveEntryType(selectedEntry.type);
                  return t.journalsUi.entryTypes[et.labelKey as keyof typeof t.journalsUi.entryTypes] as string;
                })()}</div>
                <div><span className="text-muted-foreground">{t.common.user}:</span> {selectedEntry.createdBy}</div>
              </div>
              <div className="text-sm"><span className="text-muted-foreground">{t.common.description}:</span> {selectedEntry.description}</div>
              <table className="w-full text-xs border">
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
                  {selectedEntry.lines.map(line => (
                    <tr key={line.id}>
                      <td className="px-3 py-1.5 font-mono">{line.accountCode}</td>
                      <td className="px-3 py-1.5">{line.accountName}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{line.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{line.debit ? line.debit.toLocaleString(uiLocale) : ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{line.credit ? line.credit.toLocaleString(uiLocale) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/60 font-bold">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>{t.common.total}</td>
                    <td className="px-3 py-2 text-right font-mono">{selectedEntry.totalDebit.toLocaleString(uiLocale)}</td>
                    <td className="px-3 py-2 text-right font-mono">{selectedEntry.totalCredit.toLocaleString(uiLocale)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============= NEW ENTRY DIALOG ============= */}
      <Dialog open={newEntryOpen} onOpenChange={setNewEntryOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t.journalsUi.newManualEntry}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Header fields */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">{t.common.date}</Label>
                <Input type="date" value={newEntryDate} onChange={e => setNewEntryDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t.common.type}</Label>
                <Select value={newEntryType} onValueChange={setNewEntryType}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTRY_TYPES.map(et => (
                      <SelectItem key={et.value} value={et.value}>
                        {t.journalsUi.entryTypes[et.labelKey as keyof typeof t.journalsUi.entryTypes] as string}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t.journalsUi.branch}</Label>
                <Input value={currentBranch?.name || t.branchUi.headOffice} disabled className="h-8 text-sm bg-muted" />
              </div>
            </div>

            <div>
              <Label className="text-xs">{t.common.description}</Label>
              <Textarea
                value={newEntryDescription}
                onChange={e => setNewEntryDescription(e.target.value)}
                placeholder={t.journalsUi.entryDescriptionPlaceholder}
                className="min-h-[40px] text-sm resize-none"
              />
            </div>

            {/* Lines table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold">{t.journalsUi.entryLines}</Label>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={autoBalance}>
                    {t.journalsUi.autoBalance}
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={addLine}>
                    <Plus className="w-3 h-3" /> {t.journalsUi.line}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-2 py-1.5 text-left w-28">{t.journalsUi.account}</th>
                      <th className="px-2 py-1.5 text-left">{t.journalsUi.accountName}</th>
                      <th className="px-2 py-1.5 text-left w-40">{t.common.description}</th>
                      <th className="px-2 py-1.5 text-right w-28">{t.journalsUi.debit}</th>
                      <th className="px-2 py-1.5 text-right w-28">{t.journalsUi.credit}</th>
                      <th className="px-2 py-1.5 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {newEntryLines.map((line) => (
                      <tr key={line.id} className="group">
                        <td className="px-1 py-1 relative">
                          <Input
                            value={line.accountCode}
                            placeholder={t.journalsUi.accountCodeExample}
                            className="h-7 text-xs font-mono"
                            onFocus={() => { setActiveLineId(line.id); setAccountSearch(''); }}
                            onChange={e => {
                              updateLine(line.id, 'accountCode', e.target.value);
                              setAccountSearch(e.target.value);
                              setActiveLineId(line.id);
                            }}
                          />
                          {/* Account picker dropdown */}
                          {activeLineId === line.id && (
                            <div className="absolute top-full left-0 z-50 w-72 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto mt-1">
                              <div className="p-1">
                                <Input
                                  placeholder={t.journalsUi.searchAccountPlaceholder}
                                  value={accountSearch}
                                  onChange={e => setAccountSearch(e.target.value)}
                                  className="h-6 text-xs mb-1"
                                  autoFocus
                                />
                              </div>
                              {filteredAccounts.length === 0 ? (
                                <div className="px-2 py-3 text-center text-muted-foreground text-xs">
                                  {t.journalsUi.noAccountsFound}
                                </div>
                              ) : (
                                filteredAccounts.map(acct => (
                                  <button
                                    key={acct.id}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-accent/50 flex items-center gap-2 rounded-sm"
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      selectAccount(line.id, acct);
                                    }}
                                  >
                                    <span className="font-mono text-primary w-14 shrink-0">{acct.code}</span>
                                    <span className="truncate">{acct.name}</span>
                                    <span className="ml-auto text-muted-foreground">
                                      {(acct.current_balance || 0).toLocaleString(uiLocale)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            value={line.accountName}
                            disabled
                            className="h-7 text-xs bg-muted/30"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            value={line.description}
                            placeholder={t.journalsUi.lineDescriptionPlaceholder}
                            onChange={e => updateLine(line.id, 'description', e.target.value)}
                            className="h-7 text-xs"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.debit}
                            placeholder="0.00"
                            onChange={e => updateLine(line.id, 'debit', e.target.value)}
                            className="h-7 text-xs text-right font-mono"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.credit}
                            placeholder="0.00"
                            onChange={e => updateLine(line.id, 'credit', e.target.value)}
                            className="h-7 text-xs text-right font-mono"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/60">
                    <tr className="font-bold text-xs">
                      <td className="px-2 py-2" colSpan={3}>
                        {t.common.total}
                        {!isBalanced && newEntryTotalDebit + newEntryTotalCredit > 0 && (
                          <span className="ml-2 text-destructive font-normal">
                            {t.journalsUi.differenceLabel
                              .replace('{amount}', Math.abs(difference).toLocaleString(uiLocale))
                              .replace('{side}', difference > 0 ? t.journalsUi.debitSide : t.journalsUi.creditSide)}
                          </span>
                        )}
                        {isBalanced && newEntryTotalDebit > 0 && (
                          <span className="ml-2 text-green-600 font-normal">{t.journalsUi.balanced}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{newEntryTotalDebit.toLocaleString(uiLocale)}</td>
                      <td className="px-2 py-2 text-right font-mono">{newEntryTotalCredit.toLocaleString(uiLocale)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setNewEntryOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={saveNewEntry}
              disabled={!isBalanced || newEntryTotalDebit === 0 || !newEntryDescription.trim()}
              className="gap-1"
            >
              <CheckCircle className="w-4 h-4" /> {t.journalsUi.postEntry}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
