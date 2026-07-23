import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { branchIdsEquivalent } from '@/lib/branchAccess';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus, Search, Edit2, Trash2, RefreshCw, FileText,
  Calendar, Eye, Printer, Download, CheckCircle, XCircle,
  Filter, ChevronLeft, ChevronRight, ExternalLink, Undo2,
} from 'lucide-react';
import { mapAuditLogRow, type AuditLogRow } from '@/lib/auditLogDisplay';
import {
  formatJournalDateTime,
  mapJournalEntryFromApi,
  type JournalDisplayEntry,
  type JournalDisplayLabels,
} from '@/lib/journalEntryDisplay';
import { JournalEntryDetailDialog } from '@/components/accounting/JournalEntryDetailDialog';
import { cn, generateId } from '@/lib/utils';
import { format } from 'date-fns';
import { Account } from '@/types/accounting';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList, unwrapListPayload } from '@/lib/listCache';
import { subscribeSupplierReturnsChanged } from '@/lib/supplierReturnSync';
import { DatePickerButton, localISODate } from '@/components/ui/DatePickerButton';
import {
  isBeforeToday,
} from '@/lib/workingDayAccess';

// Journal entry row for list + detail
const ENTRY_TYPES = [
  { value: 'venda', labelKey: 'sale', color: 'text-blue-600' },
  { value: 'sale', labelKey: 'sale', color: 'text-blue-600' },
  { value: 'cogs', labelKey: 'cogs', color: 'text-slate-600' },
  { value: 'compra', labelKey: 'purchase', color: 'text-orange-600' },
  { value: 'purchase_invoice', labelKey: 'purchase', color: 'text-orange-600' },
  { value: 'credit_note', labelKey: 'creditNote', color: 'text-rose-600' },
  { value: 'debit_note', labelKey: 'debitNote', color: 'text-rose-700' },
  { value: 'recibo', labelKey: 'receipt', color: 'text-green-600' },
  { value: 'payment_receipt', labelKey: 'receipt', color: 'text-green-600' },
  { value: 'receipt', labelKey: 'receipt', color: 'text-green-600' },
  { value: 'pagamento', labelKey: 'payment', color: 'text-red-600' },
  { value: 'payment_out', labelKey: 'payment', color: 'text-red-600' },
  { value: 'payment', labelKey: 'payment', color: 'text-red-600' },
  { value: 'expense', labelKey: 'adjustment', color: 'text-amber-700' },
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

const EDITABLE_JOURNAL_TYPES = new Set([
  'adjustment', 'ajuste', 'manual', 'journal', 'je', '',
]);

function isEditableJournalEntry(entry: JournalDisplayEntry | null | undefined): boolean {
  if (!entry) return false;
  if (String(entry.description || '').includes('[REVERSED]')) return false;
  const ref = String(entry.referenceType || entry.type || '').trim().toLowerCase();
  if (ref === 'journal_reversal') return false;
  return EDITABLE_JOURNAL_TYPES.has(ref);
}

function canReverseJournalEntry(entry: JournalDisplayEntry | null | undefined): boolean {
  if (!entry) return false;
  if (String(entry.description || '').includes('[REVERSED]')) return false;
  const ref = String(entry.referenceType || entry.type || '').trim().toLowerCase();
  return ref !== 'journal_reversal';
}

function useJournalEntries(branchId: string | undefined, labels: JournalDisplayLabels) {
  const cacheKey = `journalEntries:${branchId ?? 'all'}`;
  const [entries, setEntries] = useState<JournalDisplayEntry[]>(
    () => getCachedList<JournalDisplayEntry[]>(cacheKey) ?? [],
  );

  const loadAll = useCallback(async () => {
    const allEntries: JournalDisplayEntry[] = [];

    try {
      const response = await api.journalEntries.list({
        ...(branchId ? { branchId } : {}),
        limit: 200,
        offset: 0,
      });
      if (response.error) {
        console.warn('[Journals] Failed to load journal entries:', response.error);
      }
      const { items: rows } = unwrapListPayload<Record<string, unknown>>(response.data);
      const journalEntries = branchId
        ? rows.filter((je: Record<string, unknown>) =>
            branchIdsEquivalent(String(je.branch_id ?? je.branchId), branchId),
          )
        : rows;
      for (const je of journalEntries) {
        allEntries.push(mapJournalEntryFromApi(je as Record<string, unknown>, labels));
      }
    } catch {
      // Fallback: localStorage
      try {
        const raw = localStorage.getItem('kwanzaerp_journal_entries');
        const journalEntries = raw ? JSON.parse(raw) : [];
      for (const je of journalEntries) {
          if (branchId && !branchIdsEquivalent(je.branchId, branchId)) continue;
          allEntries.push(mapJournalEntryFromApi({
            id: je.id,
            entry_number: je.entryNumber,
            entry_date: je.entryDate,
            created_at: je.createdAt,
            reference_type: je.referenceType,
            description: je.description,
            total_debit: je.totalDebit,
            total_credit: je.totalCredit,
            branch_name: je.branchName,
            created_by: je.createdBy,
            lines: je.lines,
          } as Record<string, unknown>, labels));
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
          if (branchId && !branchIdsEquivalent(sale.branchId ?? sale.branch_id, branchId)) continue;
          const id = `sale_je_${sale.id || idx}`;
          if (existingIds.has(id)) continue;
          
          const inv = sale.invoiceNumber || '';
          const cust = sale.customerName || sale.customer_name || '';
          allEntries.push(mapJournalEntryFromApi({
            id,
            entry_number: `VD-${String(idx + 1).padStart(4, '0')}`,
            entry_date: sale.createdAt,
            created_at: sale.createdAt,
            reference_type: 'sale',
            description: `Venda ${inv}`.trim(),
            total_debit: sale.total,
            total_credit: sale.total,
            branch_name: sale.branchName,
            created_by: sale.cashierName,
            context: {
              documentNumber: inv,
              customerName: cust,
              paymentMethod: sale.paymentMethod || sale.payment_method,
              total: sale.total,
            },
            lines: [
              { account_code: '451', account_name: 'Caixa', description: 'Recebimento', debit_amount: sale.total, credit_amount: 0 },
              { account_code: '613', account_name: labels.salesOfMerchandise, description: inv, debit_amount: 0, credit_amount: sale.subtotal || sale.total },
              ...(sale.taxAmount ? [{ account_code: '3452', account_name: 'IVA Liquidado', description: 'IVA', debit_amount: 0, credit_amount: sale.taxAmount }] : []),
            ],
          } as Record<string, unknown>, labels));
        }
      } catch { /* ignore */ }
    }

    allEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const key = `journalEntries:${branchId ?? 'all'}`;
    if (allEntries.length === 0 && (getCachedList<JournalDisplayEntry[]>(key)?.length ?? 0) > 0) {
      return;
    }
    setEntries(allEntries);
    setCachedList(key, allEntries);
  }, [branchId, labels]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const onScope = () => { void loadAll(); };
    window.addEventListener('nexor:branch-scope-changed', onScope);
    return () => window.removeEventListener('nexor:branch-scope-changed', onScope);
  }, [loadAll]);

  useEffect(() => subscribeSupplierReturnsChanged(() => { void loadAll(); }), [loadAll]);

  return { entries, refetch: loadAll };
}

// ============= NEW ENTRY LINE INTERFACE =============
interface NewEntryLine {
  id: string;
  accountCode: string;
  accountName: string;
  accountBalance: number | null;
  description: string;
  debit: string;
  credit: string;
}

function JournalsTrialBalancePanel({ branchId }: { branchId?: string }) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const monthStart = new Date();
  monthStart.setDate(1);
  const [startDate, setStartDate] = useState(monthStart.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const { data, isLoading, error, refetch, totals } = useTrialBalance(startDate, endDate, branchId);

  const rows = data.filter(r => !r.is_header && (Number(r.total_debits) > 0 || Number(r.total_credits) > 0));

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{t.common.from}:</span>
        <DatePickerButton
          value={startDate}
          onChange={setStartDate}
          placeholder={t.common.from}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
        <span className="text-xs text-muted-foreground">{t.common.to}:</span>
        <DatePickerButton
          value={endDate}
          onChange={setEndDate}
          placeholder={t.common.to}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
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

const JOURNALS_AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'actionCreate',
  update: 'actionUpdate',
  delete: 'actionDelete',
  login: 'actionLogin',
  logout: 'actionLogout',
  login_failed: 'actionLoginFailed',
  password_change: 'actionPasswordChange',
  password_reset: 'actionPasswordReset',
  print: 'actionPrint',
  export: 'actionExport',
  issue: 'actionCreate',
  agt_transmit: 'actionSendAgt',
  saft_export: 'actionExport',
  void: 'actionVoid',
  convert: 'actionConvert',
};

function JournalsAuditPanel() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.audit.list({ limit: 200 });
      const raw = Array.isArray(res.data) ? res.data : [];
      setRows(raw.map((row) => mapAuditLogRow(row as Record<string, unknown>)));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeSupplierReturnsChanged(() => { void load(); }), [load]);

  const formatAction = (action: string) => {
    const labelKey = JOURNALS_AUDIT_ACTION_LABELS[action];
    if (labelKey) {
      return t.auditTrailUi[labelKey];
    }
    return action;
  };

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t.journalsUi.auditHintDesc}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate('/audit-trail')}>
            <ExternalLink className="w-3 h-3 mr-1" /> {t.journalsUi.openFullAudit}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={load}>
            <RefreshCw className="w-3 h-3 mr-1" /> {t.common.refresh}
          </Button>
        </div>
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
                <th className="px-3 py-2 text-left">{t.auditTrailUi.colAction}</th>
                <th className="px-3 py-2 text-left">{t.auditTrailUi.colModule}</th>
                <th className="px-3 py-2 text-left">{t.common.description}</th>
                <th className="px-3 py-2 text-left">{t.common.user}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString(uiLocale)}
                  </td>
                  <td className="px-3 py-1.5">{formatAction(row.action)}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{row.tableName}</td>
                  <td className="px-3 py-1.5">{row.description}</td>
                  <td className="px-3 py-1.5">{row.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rows.length === 0 && (
          <p className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.auditEmpty}</p>
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

function createEmptyLine(description = ''): NewEntryLine {
  return {
    id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    accountCode: '',
    accountName: '',
    accountBalance: null,
    description,
    debit: '',
    credit: '',
  };
}

export default function Journals() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canBackdatePost = hasPermission('backdate_post');
  const canEditHistorical = hasPermission('edit_historical');
  const { currentBranch, listBranchId, isConsolidatedView } = useBranchScope();

  const journalLabels = useMemo<JournalDisplayLabels>(() => ({
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

  const { entries, refetch } = useJournalEntries(listBranchId, journalLabels);
  const { accounts: chartAccounts, refetch: refetchChartAccounts } = useChartOfAccounts();
  const pickerAccounts = useMemo(
    () => chartAccounts.filter(a => a.is_active && !a.is_header),
    [chartAccounts],
  );
  const accountsByCode = useMemo(
    () => new Map(pickerAccounts.map(a => [a.code, a])),
    [pickerAccounts],
  );

  const [activeTab, setActiveTab] = useState('diarios');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(() => localISODate());
  const [dateTo, setDateTo] = useState(() => localISODate());
  const [filterType, setFilterType] = useState('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [viewEntryOpen, setViewEntryOpen] = useState(false);

  // New / edit entry dialog state
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryNumber, setEditingEntryNumber] = useState<string>('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [reversingEntry, setReversingEntry] = useState(false);
  const [newEntryDate, setNewEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [newEntryType, setNewEntryType] = useState('ajuste');
  const [newEntryLines, setNewEntryLines] = useState<NewEntryLine[]>([createEmptyLine(), createEmptyLine()]);
  const [accountSearch, setAccountSearch] = useState('');
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  useEffect(() => {
    if (newEntryOpen) {
      void refetchChartAccounts({ force: true });
    }
  }, [newEntryOpen, refetchChartAccounts]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const haystack = [
        e.entryNumber,
        e.description,
        e.readableTitle,
        e.readableSubtitle,
        e.customerName,
        e.contextSummary,
        e.branchName,
        e.createdBy,
      ].join(' ').toLowerCase();
      const matchesSearch = !searchTerm || haystack.includes(searchTerm.toLowerCase());
      const matchesType =
        filterType === 'all'
        || e.type === filterType
        || e.referenceType === filterType
        || (filterType === 'ajuste' && (e.type === 'adjustment' || e.referenceType === 'adjustment'))
        || (filterType === 'adjustment' && (e.type === 'adjustment' || e.referenceType === 'adjustment' || e.type === 'ajuste'))
        || (filterType === 'compra' && e.type === 'purchase_invoice')
        || (filterType === 'venda' && (e.type === 'sale' || e.type === 'cogs' || e.referenceType === 'sale'))
        || (filterType === 'recibo' && (e.type === 'payment_receipt' || e.type === 'receipt' || e.referenceType === 'receipt'))
        || (filterType === 'pagamento' && (e.type === 'payment_out' || e.type === 'payment' || e.referenceType === 'payment'));
      const sortDate = e.entryDate || e.createdAt;
      const day = String(sortDate || '').slice(0, 10);
      const matchesDateFrom = !dateFrom || day >= dateFrom;
      const matchesDateTo = !dateTo || day <= dateTo;
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
    if (!accountSearch) return pickerAccounts.slice(0, 50);
    const term = accountSearch.toLowerCase();
    return pickerAccounts.filter(a =>
      a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term)
    ).slice(0, 50);
  }, [pickerAccounts, accountSearch]);

  // Reset new entry form
  // When true, user edited the balancing (last) line amounts — stop overwriting credit/debit.
  const lastLineManualRef = useRef(false);

  function balanceLastLine(lines: NewEntryLine[]): NewEntryLine[] {
    if (lines.length < 2 || lastLineManualRef.current) return lines;
    const otherLines = lines.slice(0, -1);
    const otherDebit = otherLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const otherCredit = otherLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    const diff = otherDebit - otherCredit;
    return lines.map((l, i) => {
      if (i !== lines.length - 1) return l;
      if (diff > 0.009) return { ...l, credit: diff.toFixed(2), debit: '' };
      if (diff < -0.009) return { ...l, debit: Math.abs(diff).toFixed(2), credit: '' };
      return { ...l, debit: '', credit: '' };
    });
  }

  function resetNewEntry() {
    lastLineManualRef.current = false;
    setEditingEntryId(null);
    setEditingEntryNumber('');
    setNewEntryDate(localISODate());
    setNewEntryType('ajuste');
    setNewEntryLines([createEmptyLine(), createEmptyLine()]);
    setAccountSearch('');
    setActiveLineId(null);
  }

  function handleNewEntryDateChange(isoDate: string) {
    if (!canBackdatePost && isBeforeToday(isoDate)) {
      toast.error(t.journalsUi.cannotBackdate);
      setNewEntryDate(localISODate());
      return;
    }
    setNewEntryDate(isoDate);
  }

  /** Line description is the journal entry title/name (no separate header description field). */
  function entryTitleFromLines(lines: NewEntryLine[] = newEntryLines): string {
    for (const line of lines) {
      const text = String(line.description || '').trim();
      if (text) return text;
    }
    return '';
  }

  function openNewEntry() {
    resetNewEntry();
    setNewEntryOpen(true);
  }

  async function openEditEntry(entry?: JournalDisplayEntry | null) {
    const target = entry || selectedEntry;
    if (!target) return;
    if (!isEditableJournalEntry(target)) {
      toast.error(t.journalsUi.cannotEditSystemEntry);
      return;
    }
    const entryDay = String(target.entryDate || '').slice(0, 10);
    if (isBeforeToday(entryDay) && !canEditHistorical) {
      toast.error(t.journalsUi.cannotEditHistorical);
      return;
    }

    lastLineManualRef.current = true;
    setEditingEntryId(target.id);
    setEditingEntryNumber(target.entryNumber || '');
    setNewEntryDate(entryDay || localISODate());
    const typeRaw = String(target.referenceType || target.type || 'ajuste').toLowerCase();
    setNewEntryType(
      typeRaw === 'manual' ? 'manual'
        : typeRaw === 'adjustment' || typeRaw === 'ajuste' ? 'ajuste'
          : 'ajuste',
    );
    setAccountSearch('');
    setActiveLineId(null);
    setNewEntryOpen(true);

    let lines = target.lines || [];
    if (lines.length < 2) {
      const res = await api.journalEntries.get(target.id);
      if (res.error || !res.data) {
        toast.error(res.error || t.journalsUi.entryLoadFailed);
        setNewEntryOpen(false);
        return;
      }
      const mapped = mapJournalEntryFromApi(res.data as Record<string, unknown>, journalLabels);
      lines = mapped.lines || [];
      if (mapped.entryDate) setNewEntryDate(String(mapped.entryDate).slice(0, 10));
    }

    const mappedLines: NewEntryLine[] = lines.map((line) => ({
      id: generateId(),
      accountCode: line.accountCode || '',
      accountName: line.accountName || '',
      accountBalance: accountsByCode.get(line.accountCode)?.current_balance != null
        ? Number(accountsByCode.get(line.accountCode)!.current_balance) || 0
        : null,
      description: line.description || target.description || '',
      debit: line.debit ? String(line.debit) : '',
      credit: line.credit ? String(line.credit) : '',
    }));
    setNewEntryLines(
      mappedLines.length >= 2
        ? mappedLines
        : [...mappedLines, ...Array.from({ length: 2 - mappedLines.length }, () => createEmptyLine())],
    );
    void refetchChartAccounts({ force: true });
  }

  function updateLine(lineId: string, field: keyof NewEntryLine, value: string) {
    setNewEntryLines(prev => {
      const lastId = prev[prev.length - 1]?.id;
      const firstId = prev[0]?.id;
      if (lineId === lastId && (field === 'debit' || field === 'credit')) {
        lastLineManualRef.current = true;
      }
      let next = prev.map(l => {
        if (l.id !== lineId) return l;
        const updated = { ...l, [field]: value };
        if (field === 'accountCode') {
          const match = accountsByCode.get(value.trim());
          if (match) {
            updated.accountName = match.name;
            updated.accountBalance = Number(match.current_balance) || 0;
          } else if (!value.trim()) {
            updated.accountName = '';
            updated.accountBalance = null;
          }
        }
        // Same line is either debit or credit, not both
        if (field === 'debit' && parseFloat(value) > 0) {
          updated.credit = '';
        } else if (field === 'credit' && parseFloat(value) > 0) {
          updated.debit = '';
        }
        return updated;
      });
      // First-line description is the entry title — keep all lines in sync.
      if (field === 'description' && lineId === firstId) {
        next = next.map(l => ({ ...l, description: value }));
      }
      // Typing debit on line 1 auto-fills credit on the last line (still editable).
      if (field === 'debit' || field === 'credit') {
        return balanceLastLine(next);
      }
      return next;
    });
  }

  function selectAccount(lineId: string, account: Account) {
    setNewEntryLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      return {
        ...l,
        accountCode: account.code,
        accountName: account.name,
        accountBalance: Number(account.current_balance) || 0,
      };
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
    setNewEntryLines(prev => [...prev, createEmptyLine(String(prev[0]?.description || ''))]);
  }

  // Auto-fill last line to balance (button re-enables auto-fill after manual edits)
  function autoBalance() {
    lastLineManualRef.current = false;
    setNewEntryLines(prev => balanceLastLine(prev));
  }

  // Save journal entry (create or update)
  async function saveNewEntry() {
    const entryTitle = entryTitleFromLines();
    if (!entryTitle) {
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

    if (isBeforeToday(newEntryDate) && !canBackdatePost) {
      toast.error(t.journalsUi.cannotBackdate);
      return;
    }
    if (editingEntryId) {
      const original = entries.find((e) => e.id === editingEntryId);
      const originalDay = String(original?.entryDate || newEntryDate).slice(0, 10);
      if (isBeforeToday(originalDay) && !canEditHistorical) {
        toast.error(t.journalsUi.cannotEditHistorical);
        return;
      }
    }

    const lines = validLines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      description: String(line.description || '').trim() || entryTitle,
      debit: parseFloat(line.debit) || 0,
      credit: parseFloat(line.credit) || 0,
    }));

    setSavingEntry(true);
    try {
      if (editingEntryId) {
        const response = await api.journalEntries.update(editingEntryId, {
          description: entryTitle,
          entryDate: newEntryDate,
          lines,
        });
        if (response.error || !response.data) {
          throw new Error(response.error || 'Failed to update journal');
        }
        const number = response.data.entry_number || response.data.entryNumber || editingEntryNumber;
        toast.success(t.journalsUi.entryUpdated.replace('{number}', number), {
          description: t.journalsUi.entryCreatedDesc
            .replace('{debit}', newEntryTotalDebit.toLocaleString(uiLocale))
            .replace('{credit}', newEntryTotalCredit.toLocaleString(uiLocale)),
        });
      } else {
        const docId = generateId();
        const silentBranchId = currentBranch?.id || listBranchId || '';
        const response = await api.transactions.process({
          transactionType: 'adjustment',
          documentId: docId,
          documentNumber: `JE-${String(Date.now()).slice(-6)}`,
          branchId: silentBranchId,
          branchName: currentBranch?.name || '',
          userId: user?.id || '',
          userName: user?.name || 'Sistema',
          date: newEntryDate,
          description: entryTitle,
          journalLines: lines,
        });

        if (response.error || (response.data && response.data.success === false)) {
          throw new Error(response.error || response.data?.errors?.join?.('; ') || 'Failed to post journal');
        }
        const createdEntry = response.data || { entryNumber: `JE-${Date.now()}` };
        toast.success(
          t.journalsUi.entryCreated.replace(
            '{number}',
            createdEntry.entryNumber || createdEntry.entry_number || '',
          ),
          {
            description: t.journalsUi.entryCreatedDesc
              .replace('{debit}', newEntryTotalDebit.toLocaleString(uiLocale))
              .replace('{credit}', newEntryTotalCredit.toLocaleString(uiLocale)),
          },
        );
      }

      setNewEntryOpen(false);
      resetNewEntry();
      await refetch();
      void refetchChartAccounts({ force: true });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (editingEntryId ? t.journalsUi.entryUpdateFailed : t.journalsUi.entryCreateFailed),
      );
    } finally {
      setSavingEntry(false);
    }
  }

  async function reverseSelectedEntry() {
    if (!selectedEntry || !canReverseJournalEntry(selectedEntry)) return;
    const entryDay = String(selectedEntry.entryDate || '').slice(0, 10);
    if (isBeforeToday(entryDay) && !canEditHistorical) {
      toast.error(t.journalsUi.cannotEditHistorical);
      return;
    }
    const number = selectedEntry.entryNumber || selectedEntry.id;
    if (!window.confirm(t.journalsUi.reverseConfirm.replace('{number}', number))) return;

    setReversingEntry(true);
    try {
      const response = await api.journalEntries.reverse(selectedEntry.id, {
        createdBy: user?.id || undefined,
      });
      if (response.error) throw new Error(response.error);
      if (response.data?.alreadyReversed) {
        toast.message(t.journalsUi.reverseAlreadyDone.replace('{number}', number));
      } else {
        toast.success(
          t.journalsUi.reverseSuccess
            .replace('{number}', number)
            .replace('{reverse}', response.data?.reverseEntryId || ''),
        );
      }
      await refetch();
      void refetchChartAccounts({ force: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.journalsUi.reverseFailed);
    } finally {
      setReversingEntry(false);
    }
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={
            !selectedEntry
            || !isEditableJournalEntry(selectedEntry)
            || (isBeforeToday(selectedEntry.entryDate) && !canEditHistorical)
          }
          onClick={() => { void openEditEntry(selectedEntry); }}
          title={
            selectedEntry && !isEditableJournalEntry(selectedEntry)
              ? t.journalsUi.cannotEditSystemEntry
              : selectedEntry && isBeforeToday(selectedEntry.entryDate) && !canEditHistorical
                ? t.journalsUi.cannotEditHistorical
                : undefined
          }
        >
          <Edit2 className="w-3 h-3" /> {t.common.edit}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={
            !selectedEntry
            || !canReverseJournalEntry(selectedEntry)
            || reversingEntry
            || (isBeforeToday(selectedEntry.entryDate) && !canEditHistorical)
          }
          onClick={() => { void reverseSelectedEntry(); }}
          title={
            selectedEntry && isBeforeToday(selectedEntry.entryDate) && !canEditHistorical
              ? t.journalsUi.cannotEditHistorical
              : t.journalsUi.reverseHint
          }
        >
          <Undo2 className="w-3 h-3" /> {t.journalsUi.reverseEntry}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <span className="text-xs text-muted-foreground">{t.common.from}:</span>
        <DatePickerButton
          value={dateFrom}
          onChange={setDateFrom}
          placeholder={t.common.from}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
        <span className="text-xs text-muted-foreground">{t.common.to}:</span>
        <DatePickerButton
          value={dateTo}
          onChange={setDateTo}
          placeholder={t.common.to}
          locale={language === 'pt' ? 'pt' : 'en'}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => {
            const today = localISODate();
            setDateFrom(today);
            setDateTo(today);
          }}
        >
          {t.journalsUi.todayOnly}
        </Button>
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
                <th className="px-3 py-2 text-left font-semibold w-36">{t.journalsUi.colDateTime}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.journalsUi.colBranch}</th>
                <th className="px-3 py-2 text-left font-semibold w-16">{t.common.type}</th>
                <th className="px-3 py-2 text-left font-semibold w-24">{t.journalsUi.entryNo}</th>
                <th className="px-3 py-2 text-left font-semibold w-32">{t.journalsUi.colCustomer}</th>
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
                const typeLabel = typeConfig
                  ? (t.journalsUi.entryTypes[typeConfig.labelKey as keyof typeof t.journalsUi.entryTypes] as string)
                  : entry.type;
                return (
                  <tr key={entry.id}
                    className={cn("cursor-pointer hover:bg-accent/50 transition-colors",
                      selectedEntryId === entry.id && "nexor-row-selected")}
                    onClick={() => setSelectedEntryId(entry.id)}
                    onDoubleClick={() => { setSelectedEntryId(entry.id); setViewEntryOpen(true); }}>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      {formatJournalDateTime(entry, uiLocale)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[8rem]" title={entry.branchName}>
                      {entry.branchName || '—'}
                    </td>
                    <td className={cn("px-3 py-1.5 font-medium whitespace-nowrap", typeConfig?.color)}>
                      {typeLabel}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{entry.entryNumber}</td>
                    <td className="px-3 py-1.5 truncate max-w-[8rem]" title={entry.customerName}>
                      {entry.customerName}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{entry.readableTitle}</div>
                      {entry.readableSubtitle && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-md" title={entry.readableSubtitle}>
                          {entry.readableSubtitle}
                        </div>
                      )}
                    </td>
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
                <td className="px-3 py-2" colSpan={6}>{t.journalsUi.totalEntries.replace('{count}', String(filteredEntries.length))}</td>
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
          <JournalsTrialBalancePanel branchId={listBranchId} />
        </TabsContent>

        <TabsContent value="auditoria" className="flex-1 m-0 overflow-hidden">
          <JournalsAuditPanel />
        </TabsContent>

        <TabsContent value="cashiers" className="flex-1 m-0 overflow-hidden">
          <JournalsCashiersPanel branchId={listBranchId} />
        </TabsContent>
      </Tabs>

      {/* View Entry Dialog */}
      <JournalEntryDetailDialog
        entry={selectedEntry ?? null}
        open={viewEntryOpen}
        onOpenChange={setViewEntryOpen}
        entryTypeLabel={selectedEntry ? (() => {
          const et = resolveEntryType(selectedEntry.type);
          return t.journalsUi.entryTypes[et.labelKey as keyof typeof t.journalsUi.entryTypes] as string;
        })() : ''}
        entryTypeColor={selectedEntry ? resolveEntryType(selectedEntry.type).color : undefined}
      />

      {/* ============= NEW / EDIT ENTRY DIALOG ============= */}
      <Dialog open={newEntryOpen} onOpenChange={(open) => {
        setNewEntryOpen(open);
        if (!open) resetNewEntry();
      }}>
        <DialogContent className="max-w-[96vw] w-[96vw] max-h-[94vh] h-[90vh] flex flex-col gap-0 p-0 overflow-hidden sm:rounded-xl">
          <DialogHeader className="shrink-0 space-y-1 border-b bg-muted/30 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-10">
              <div className="space-y-1">
                <DialogTitle className="flex items-center gap-2 text-xl">
                  {editingEntryId ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                  {editingEntryId
                    ? t.journalsUi.editManualEntry.replace('{number}', editingEntryNumber || '')
                    : t.journalsUi.newManualEntry}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {editingEntryId ? t.journalsUi.editManualEntryHint : t.journalsUi.newManualEntryHint}
                </DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono text-xs px-2.5 py-1',
                    isBalanced && newEntryTotalDebit > 0
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border-amber-300 bg-amber-50 text-amber-900',
                  )}
                >
                  {isBalanced && newEntryTotalDebit > 0
                    ? t.journalsUi.balanced
                    : t.journalsUi.entryNotBalanced.replace(
                        '{amount}',
                        Math.abs(difference).toLocaleString(uiLocale),
                      )}
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  {t.journalsUi.debit}: {newEntryTotalDebit.toLocaleString(uiLocale)} Kz
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  {t.journalsUi.credit}: {newEntryTotalCredit.toLocaleString(uiLocale)} Kz
                </Badge>
              </div>
            </div>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 sm:px-6">
            <div className="shrink-0 rounded-lg border bg-card p-4 shadow-sm">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <Label className="text-sm font-medium">{t.common.date}</Label>
                  <div className="mt-1.5">
                    <DatePickerButton
                      value={newEntryDate}
                      onChange={handleNewEntryDateChange}
                      placeholder={t.common.date}
                      locale={language === 'pt' ? 'pt' : 'en'}
                      buttonClassName="h-10 w-full min-w-0"
                      disableBeforeToday={!canBackdatePost}
                    />
                    {!canBackdatePost && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{t.journalsUi.dateLockedToToday}</p>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">{t.common.type}</Label>
                  <Select value={newEntryType} onValueChange={setNewEntryType}>
                    <SelectTrigger className="mt-1.5 h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ENTRY_TYPES.map(et => (
                        <SelectItem key={et.value} value={et.value}>
                          {t.journalsUi.entryTypes[et.labelKey as keyof typeof t.journalsUi.entryTypes] as string}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{t.journalsUi.entryLines}</p>
                  <p className="text-xs text-muted-foreground">{t.journalsUi.entryLinesHint}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1" onClick={autoBalance}>
                    {t.journalsUi.autoBalance}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1" onClick={addLine}>
                    <Plus className="h-4 w-4" /> {t.journalsUi.line}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                    <tr className="border-b">
                      <th className="px-3 py-2.5 text-left w-32 font-semibold">{t.journalsUi.account}</th>
                      <th className="px-3 py-2.5 text-left min-w-[200px] font-semibold">{t.journalsUi.accountName}</th>
                      <th className="px-3 py-2.5 text-left min-w-[180px] font-semibold">{t.common.description}</th>
                      <th className="px-3 py-2.5 text-right w-36 font-semibold">{t.journalsUi.debit}</th>
                      <th className="px-3 py-2.5 text-right w-36 font-semibold">{t.journalsUi.credit}</th>
                      <th className="px-2 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {newEntryLines.map((line) => (
                      <tr key={line.id} className="group hover:bg-muted/20">
                        <td className="px-2 py-2 relative align-top">
                          <Input
                            value={line.accountCode}
                            placeholder={t.journalsUi.accountCodeExample}
                            className="h-9 font-mono"
                            onFocus={() => { setActiveLineId(line.id); setAccountSearch(''); }}
                            onChange={e => {
                              updateLine(line.id, 'accountCode', e.target.value);
                              setAccountSearch(e.target.value);
                              setActiveLineId(line.id);
                            }}
                          />
                          {activeLineId === line.id && (
                            <div className="absolute top-full left-0 z-50 mt-1 w-96 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-lg">
                              <div className="sticky top-0 border-b bg-popover p-2 space-y-2">
                                <Input
                                  placeholder={t.journalsUi.searchAccountPlaceholder}
                                  value={accountSearch}
                                  onChange={e => setAccountSearch(e.target.value)}
                                  className="h-8"
                                  autoFocus
                                />
                                <div className="flex gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  <span className="w-16 shrink-0">{t.journalsUi.account}</span>
                                  <span className="min-w-0 flex-1">{t.journalsUi.accountName}</span>
                                  <span className="w-24 shrink-0 text-right">{t.chartOfAccountsUi.colBalance}</span>
                                </div>
                              </div>
                              {filteredAccounts.length === 0 ? (
                                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                  {t.journalsUi.noAccountsFound}
                                </div>
                              ) : (
                                filteredAccounts.map(acct => (
                                  <button
                                    key={acct.id}
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      selectAccount(line.id, acct);
                                    }}
                                  >
                                    <span className="w-16 shrink-0 font-mono text-primary">{acct.code}</span>
                                    <span className="min-w-0 flex-1 truncate">{acct.name}</span>
                                    <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                      {Number(acct.current_balance || 0).toLocaleString(uiLocale)} Kz
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            value={line.accountName}
                            disabled
                            className="h-9 bg-muted/40"
                          />
                          {line.accountCode && line.accountBalance != null && (
                            <p className="mt-1 text-xs font-medium text-primary tabular-nums">
                              {t.journalsUi.accountCurrentBalance
                                .replace('{amount}', Number(line.accountBalance).toLocaleString(uiLocale))}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            value={line.description}
                            placeholder={t.journalsUi.entryDescriptionPlaceholder}
                            onChange={e => updateLine(line.id, 'description', e.target.value)}
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.debit}
                            placeholder="0.00"
                            onChange={e => updateLine(line.id, 'debit', e.target.value)}
                            className="h-9 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.credit}
                            placeholder="0.00"
                            onChange={e => updateLine(line.id, 'credit', e.target.value)}
                            className="h-9 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-1 py-2 align-top">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-60 hover:opacity-100"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="shrink-0 border-t bg-muted/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">{t.common.total}</span>
                  <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                    <span>
                      {t.journalsUi.debit}: <strong>{newEntryTotalDebit.toLocaleString(uiLocale)}</strong> Kz
                    </span>
                    <span>
                      {t.journalsUi.credit}: <strong>{newEntryTotalCredit.toLocaleString(uiLocale)}</strong> Kz
                    </span>
                    {!isBalanced && newEntryTotalDebit + newEntryTotalCredit > 0 && (
                      <span className="text-destructive font-sans font-medium">
                        {t.journalsUi.differenceLabel
                          .replace('{amount}', Math.abs(difference).toLocaleString(uiLocale))
                          .replace('{side}', difference > 0 ? t.journalsUi.debitSide : t.journalsUi.creditSide)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-muted/20 px-5 py-4 sm:px-6">
            <Button variant="outline" size="lg" onClick={() => setNewEntryOpen(false)} disabled={savingEntry}>
              {t.common.cancel}
            </Button>
            <Button
              size="lg"
              onClick={() => { void saveNewEntry(); }}
              disabled={savingEntry || !isBalanced || newEntryTotalDebit === 0 || !entryTitleFromLines()}
              className="gap-2 min-w-[160px]"
            >
              <CheckCircle className="h-4 w-4" />
              {editingEntryId ? t.journalsUi.saveEntry : t.journalsUi.postEntry}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
