import { useState, useMemo, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { resolveAccountDisplayName } from '@/lib/chartOfAccountsDisplay';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth, useSales } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { useChartOfAccounts, useTrialBalance } from '@/hooks/useChartOfAccounts';
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
  Plus, Search, Edit2, Trash2, RefreshCw,
  Eye, Download, CheckCircle, XCircle,
  ExternalLink, Undo2, Loader2,
} from 'lucide-react';
import { mapAuditLogRow, type AuditLogRow } from '@/lib/auditLogDisplay';
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel';
import {
  formatJournalDateTime,
  mapJournalEntryFromApi,
  type JournalDisplayEntry,
  type JournalDisplayLabels,
} from '@/lib/journalEntryDisplay';
import { JournalEntryDetailDialog } from '@/components/accounting/JournalEntryDetailDialog';
import { cn, generateId } from '@/lib/utils';
import { Account } from '@/types/accounting';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList, unwrapListPayload, markCachedListStale } from '@/lib/listCache';
import { useTableRefreshListener } from '@/hooks/useRealtimeSyncBridge';
import { subscribeSupplierReturnsChanged } from '@/lib/supplierReturnSync';
import { DatePickerButton, localISODate } from '@/components/ui/DatePickerButton';
import {
  isBeforeToday,
} from '@/lib/workingDayAccess';
import { exportReportExcel } from '@/lib/reportExport';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';

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
  { value: 'credit_note', labelKey: 'creditNote' },
  { value: 'debit_note', labelKey: 'debitNote' },
  { value: 'recibo', labelKey: 'receipt' },
  { value: 'pagamento', labelKey: 'payment' },
  { value: 'ajuste', labelKey: 'adjustment' },
  { value: 'manual', labelKey: 'manual' },
  { value: 'transfer', labelKey: 'transfer' },
  { value: 'expense', labelKey: 'expense' },
];

const CREATE_ENTRY_TYPES = [
  { value: 'ajuste', labelKey: 'adjustment' },
  { value: 'manual', labelKey: 'manual' },
];

const PAGE_SIZE = 200;
const EXPORT_LIMIT = 5000;

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

function useJournalEntries(
  branchId: string | undefined,
  labels: JournalDisplayLabels,
  dateFrom?: string,
  dateTo?: string,
  referenceType?: string,
  q?: string,
) {
  const cacheKey = `journalEntries:${branchId ?? 'all'}:${dateFrom ?? ''}:${dateTo ?? ''}:${referenceType || 'all'}:${q || ''}`;
  const [entries, setEntries] = useState<JournalDisplayEntry[]>(
    () => getCachedList<JournalDisplayEntry[]>(cacheKey) ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [periodTotals, setPeriodTotals] = useState({ debit: 0, credit: 0 });
  const [hasMore, setHasMore] = useState(false);

  const listParams = useCallback((offset: number, limit = PAGE_SIZE) => ({
    ...(branchId ? { branchId } : {}),
    ...(dateFrom ? { startDate: dateFrom } : {}),
    ...(dateTo ? { endDate: dateTo } : {}),
    ...(referenceType && referenceType !== 'all' ? { referenceType } : {}),
    ...(q ? { q } : {}),
    limit,
    offset,
    includeContext: true,
  }), [branchId, dateFrom, dateTo, referenceType, q]);

  const loadAll = useCallback(async (opts?: { force?: boolean }) => {
    const key = `journalEntries:${branchId ?? 'all'}:${dateFrom ?? ''}:${dateTo ?? ''}:${referenceType || 'all'}:${q || ''}`;
    const cached = getCachedList<JournalDisplayEntry[]>(key) ?? [];
    setEntries(cached);
    setIsLoading(cached.length === 0);

    try {
      const response = await api.journalEntries.list(listParams(0));
      if (response.error) {
        console.warn('[Journals] Failed to load journal entries:', response.error);
        setIsLoading(false);
        return;
      }
      const payload = unwrapListPayload<Record<string, unknown>>(response.data);
      const mapped = payload.items.map((je) => mapJournalEntryFromApi(je, labels));
      setEntries(mapped);
      setCachedList(key, mapped);
      setTotal(Number(payload.total ?? mapped.length));
      setPeriodTotals({
        debit: Number(payload.totals?.debit ?? 0),
        credit: Number(payload.totals?.credit ?? 0),
      });
      setHasMore(!!payload.hasMore || mapped.length < Number(payload.total ?? mapped.length));
    } catch (err) {
      console.warn('[Journals] Failed to load journal entries:', err);
    } finally {
      setIsLoading(false);
    }
  }, [branchId, labels, dateFrom, dateTo, referenceType, q, listParams]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const response = await api.journalEntries.list(listParams(entries.length));
      if (response.error) throw new Error(response.error);
      const payload = unwrapListPayload<Record<string, unknown>>(response.data);
      const mapped = payload.items.map((je) => mapJournalEntryFromApi(je, labels));
      setEntries((prev) => {
        const next = [...prev, ...mapped];
        setCachedList(cacheKey, next);
        return next;
      });
      setTotal(Number(payload.total ?? entries.length + mapped.length));
      if (payload.totals) {
        setPeriodTotals({
          debit: Number(payload.totals.debit ?? 0),
          credit: Number(payload.totals.credit ?? 0),
        });
      }
      setHasMore(!!payload.hasMore);
    } catch (err) {
      console.warn('[Journals] load more failed:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [listParams, entries.length, labels, cacheKey]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => subscribeSupplierReturnsChanged(() => { void loadAll({ force: true }); }), [loadAll]);

  const journalRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onJournalTableRefresh = useCallback(() => {
    markCachedListStale(cacheKey);
    if (journalRefreshTimer.current) clearTimeout(journalRefreshTimer.current);
    journalRefreshTimer.current = setTimeout(() => {
      journalRefreshTimer.current = null;
      void loadAll();
    }, 2500);
  }, [cacheKey, loadAll]);
  useTableRefreshListener(['journal_entries'], onJournalTableRefresh);
  useEffect(() => () => {
    if (journalRefreshTimer.current) clearTimeout(journalRefreshTimer.current);
  }, []);

  return {
    entries,
    refetch: () => loadAll({ force: true }),
    isLoading,
    loadingMore,
    loadMore,
    hasMore,
    total,
    periodTotals,
  };
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
  const [startDate, setStartDate] = useState(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    return localISODate(monthStart);
  });
  const [endDate, setEndDate] = useState(() => localISODate());
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
                  <td className="px-3 py-1.5">
                    {resolveAccountDisplayName({ code: row.code, name: row.name }, language, t)}
                  </td>
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
  approve: 'actionApprove',
  transfer: 'actionTransfer',
  receive: 'actionReceive',
  close: 'actionClose',
};

function JournalsAuditPanel() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const auditDetailLabels = useMemo(
    () => ({
      fieldInvoiceNumber: t.auditTrailUi.fieldInvoiceNumber,
      fieldInvoiceType: t.auditTrailUi.fieldInvoiceType,
      fieldPaymentMethod: t.auditTrailUi.fieldPaymentMethod,
      fieldTotal: t.auditTrailUi.fieldTotal,
      fieldItemCount: t.auditTrailUi.fieldItemCount,
      fieldProformaNumber: t.auditTrailUi.fieldProformaNumber,
      fieldProformaId: t.auditTrailUi.fieldProformaId,
      fieldEmpty: t.auditTrailUi.fieldEmpty,
      fieldName: t.auditTrailUi.fieldName,
      fieldSku: t.auditTrailUi.fieldSku,
      fieldPrice: t.auditTrailUi.fieldPrice,
      fieldCost: t.auditTrailUi.fieldCost,
      fieldStock: t.auditTrailUi.fieldStock,
      fieldTaxRate: t.auditTrailUi.fieldTaxRate,
      fieldVatOverride: t.auditTrailUi.fieldVatOverride,
      fieldCategory: t.auditTrailUi.fieldCategory,
      fieldBranchId: t.auditTrailUi.fieldBranchId,
      fieldIpAddress: t.auditTrailUi.fieldIpAddress,
      fieldWorkstation: t.auditTrailUi.fieldWorkstation,
      detailChanges: t.auditTrailUi.detailChanges,
      detailSnapshot: t.auditTrailUi.detailSnapshot,
      detailContext: t.auditTrailUi.detailContext,
      changeArrow: t.auditTrailUi.changeArrow,
      paymentCash: t.chartsUi.methodCash,
      paymentCard: t.chartsUi.methodCard,
      paymentTransfer: t.chartsUi.methodTransfer,
      paymentCheque: t.supplierStatementUi.methodCheque,
      paymentMixed: t.chartsUi.methodMixed,
      paymentCredit: t.posUi.credit,
      detailRawJson: t.auditTrailUi.detailRawJson,
    }),
    [t],
  );

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
      return t.auditTrailUi[labelKey as keyof typeof t.auditTrailUi];
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
                <tr
                  key={row.id}
                  className="hover:bg-accent/30 cursor-pointer"
                  onClick={() => {
                    setSelected(row);
                    void api.audit.get(row.id).then((res) => {
                      if (res.data && !res.error) {
                        setSelected(mapAuditLogRow(res.data as Record<string, unknown>));
                      }
                    });
                  }}
                >
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
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" /> {t.auditTrailUi.detailTitle}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground text-xs">{t.auditTrailUi.detailDateTime}:</span>
                  <p className="text-xs">{new Date(selected.createdAt).toLocaleString(uiLocale)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t.auditTrailUi.detailAction}:</span>
                  <p className="text-xs">{formatAction(selected.action)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t.auditTrailUi.detailUser}:</span>
                  <p className="text-xs">{selected.userName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">{t.auditTrailUi.colModule}:</span>
                  <p className="text-xs font-mono">{selected.tableName}</p>
                </div>
              </div>
              <p className="text-sm">{selected.description}</p>
              <AuditDetailPanel
                details={selected.details}
                oldValues={selected.oldValues}
                newValues={selected.newValues}
                metadata={selected.metadata}
                labels={auditDetailLabels}
                locale={uiLocale}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JournalsCashiersPanel({
  branchId,
  dateFrom,
  dateTo,
}: {
  branchId?: string;
  dateFrom: string;
  dateTo: string;
}) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { sales } = useSales(branchId, { dateFrom, dateTo, limit: 5000 });

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

const ACCOUNT_LIST_CAP = 800;
type JournalLineField = 'account' | 'description' | 'debit' | 'credit';
const JOURNAL_LINE_FIELDS: JournalLineField[] = ['account', 'description', 'debit', 'credit'];

function inputCaretAtStart(el: HTMLInputElement) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  return start == null || (start === 0 && end === 0);
}

function inputCaretAtEnd(el: HTMLInputElement) {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const len = el.value.length;
  return start == null || (start === len && end === len);
}

export default function Journals() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canBackdatePost = hasPermission('backdate_post');
  const canEditHistorical = hasPermission('edit_historical');
  const { currentBranch, listBranchId } = useBranchScope();
  const { companyName } = useCompanyLogo();

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

  const [activeTab, setActiveTab] = useState('diarios');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState(() => localISODate());
  const [dateTo, setDateTo] = useState(() => localISODate());
  const [filterType, setFilterType] = useState('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [exporting, setExporting] = useState(false);

  // New / edit entry dialog state — declare before CoA so we can defer the chart fetch.
  const [viewEntryOpen, setViewEntryOpen] = useState(false);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingEntryNumber, setEditingEntryNumber] = useState<string>('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [reversingEntry, setReversingEntry] = useState(false);
  const [newEntryDate, setNewEntryDate] = useState(() => localISODate());
  const [newEntryType, setNewEntryType] = useState('ajuste');
  const [newEntryLines, setNewEntryLines] = useState<NewEntryLine[]>([createEmptyLine(), createEmptyLine()]);
  const [accountSearch, setAccountSearch] = useState('');
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [accountHighlight, setAccountHighlight] = useState(0);
  const [accountBrowserOpen, setAccountBrowserOpen] = useState(false);
  const [accountMenuLineId, setAccountMenuLineId] = useState<string | null>(null);
  const lineFieldRefs = useRef<Record<string, Partial<Record<JournalLineField, HTMLInputElement | null>>>>({});
  const postButtonRef = useRef<HTMLButtonElement | null>(null);
  const accountSearchRef = useRef<HTMLInputElement | null>(null);
  const accountBlurTimer = useRef<number | null>(null);
  const skipAccountMenuUntilRef = useRef(0);

  const {
    entries,
    refetch,
    isLoading: listLoading,
    loadingMore,
    loadMore,
    hasMore,
    total,
    periodTotals,
  } = useJournalEntries(
    listBranchId,
    journalLabels,
    dateFrom,
    dateTo,
    filterType,
    debouncedQ,
  );
  // Defer CoA until the New/Edit dialog opens — list view does not need the full chart.
  const { accounts: chartAccounts, refetch: refetchChartAccounts } = useChartOfAccounts({
    enabled: newEntryOpen,
  });
  const pickerAccounts = useMemo(
    () => chartAccounts.filter(a => a.is_active && !a.is_header),
    [chartAccounts],
  );
  const accountsByCode = useMemo(
    () => new Map(pickerAccounts.map(a => [a.code, a])),
    [pickerAccounts],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(searchTerm.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setSelectedEntryId(null);
  }, [listBranchId, activeTab]);

  useEffect(() => {
    if (newEntryOpen) {
      // Soft refetch — cache is enough for account picker codes/names.
      void refetchChartAccounts();
    }
  }, [newEntryOpen, refetchChartAccounts]);

  const selectedEntry = entries.find(e => e.id === selectedEntryId);

  // New entry line calculations
  const newEntryTotalDebit = newEntryLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const newEntryTotalCredit = newEntryLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(newEntryTotalDebit - newEntryTotalCredit) < 0.01;
  const difference = newEntryTotalDebit - newEntryTotalCredit;

  // Filtered accounts for picker
  const filteredAccounts = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    if (!term) return pickerAccounts;
    return pickerAccounts.filter((a) => {
      const displayName = resolveAccountDisplayName(a, language, t);
      return (
        a.code.toLowerCase().includes(term)
        || a.name.toLowerCase().includes(term)
        || displayName.toLowerCase().includes(term)
      );
    });
  }, [pickerAccounts, accountSearch, language, t]);
  const visibleAccounts = filteredAccounts.slice(0, ACCOUNT_LIST_CAP);
  const typeaheadAccounts = filteredAccounts.slice(0, 50);

  useEffect(() => {
    setAccountHighlight(0);
  }, [accountSearch, activeLineId]);

  useEffect(() => {
    const selector = accountBrowserOpen
      ? `[data-journal-acct="${accountHighlight}"]`
      : `[data-journal-acct-type="${activeLineId}-${accountHighlight}"]`;
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [accountHighlight, accountBrowserOpen, activeLineId, visibleAccounts.length, typeaheadAccounts.length]);

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
    setAccountHighlight(0);
    setAccountBrowserOpen(false);
    setAccountMenuLineId(null);
    skipAccountMenuUntilRef.current = 0;
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

  useEffect(() => {
    const st = location.state as { openJournalCreate?: boolean; journalPreset?: string } | null;
    if (!st?.openJournalCreate) return;
    openNewEntry();
    if (st.journalPreset === 'credit' || st.journalPreset === 'debit') {
      setNewEntryType('manual');
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

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
    setAccountBrowserOpen(false);
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
      accountName: resolveAccountDisplayName(
        { code: line.accountCode || '', name: line.accountName || '' },
        language,
        t,
      ),
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
    void refetchChartAccounts();
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
            updated.accountName = resolveAccountDisplayName(match, language, t);
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

  function suppressAccountMenu() {
    skipAccountMenuUntilRef.current = Date.now() + 400;
    setAccountMenuLineId(null);
  }

  function selectAccount(lineId: string, account: Account, focusNext = true) {
    suppressAccountMenu();
    setNewEntryLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      return {
        ...l,
        accountCode: account.code,
        accountName: resolveAccountDisplayName(account, language, t),
        accountBalance: Number(account.current_balance) || 0,
      };
    }));
    setActiveLineId(lineId);
    setAccountSearch('');
    setAccountHighlight(0);
    setAccountBrowserOpen(false);
    if (focusNext) {
      window.requestAnimationFrame(() => focusLineField(lineId, 'description'));
    }
  }

  function removeLine(lineId: string) {
    if (newEntryLines.length <= 2) {
      toast.error(t.journalsUi.minTwoLines);
      return;
    }
    setNewEntryLines(prev => prev.filter(l => l.id !== lineId));
  }

  function addLine(): string {
    const line = createEmptyLine(String(newEntryLines[0]?.description || ''));
    setNewEntryLines(prev => [...prev, line]);
    return line.id;
  }

  function setLineFieldRef(lineId: string, field: JournalLineField, el: HTMLInputElement | null) {
    if (!lineFieldRefs.current[lineId]) lineFieldRefs.current[lineId] = {};
    lineFieldRefs.current[lineId][field] = el;
  }

  function focusLineField(lineId: string | undefined, field: JournalLineField) {
    if (!lineId) return;
    const tryFocus = (attempts: number) => {
      const el = lineFieldRefs.current[lineId]?.[field];
      if (el) {
        el.focus();
        el.select();
        return;
      }
      if (attempts > 0) window.requestAnimationFrame(() => tryFocus(attempts - 1));
    };
    window.requestAnimationFrame(() => tryFocus(8));
  }

  function goToLineField(idx: number, field: JournalLineField, extraLines: NewEntryLine[] = newEntryLines) {
    const pos = JOURNAL_LINE_FIELDS.indexOf(field);
    if (pos < 0) return;
    if (idx >= 0 && idx < extraLines.length) {
      focusLineField(extraLines[idx].id, JOURNAL_LINE_FIELDS[pos]);
    }
  }

  function moveJournalField(idx: number, field: JournalLineField, direction: 1 | -1) {
    const pos = JOURNAL_LINE_FIELDS.indexOf(field);
    const nextPos = pos + direction;
    if (nextPos >= 0 && nextPos < JOURNAL_LINE_FIELDS.length) {
      focusLineField(newEntryLines[idx]?.id, JOURNAL_LINE_FIELDS[nextPos]);
      return;
    }
    if (direction > 0) {
      if (idx < newEntryLines.length - 1) {
        focusLineField(newEntryLines[idx + 1].id, 'account');
        return;
      }
      const last = newEntryLines[idx];
      if (last && (last.accountCode || last.description || last.debit || last.credit)) {
        const id = addLine();
        focusLineField(id, 'account');
        return;
      }
      postButtonRef.current?.focus();
      return;
    }
    if (idx > 0) {
      focusLineField(newEntryLines[idx - 1].id, 'credit');
      return;
    }
  }

  function pickHighlightedAccount(lineId: string, fromModal = false): boolean {
    const list = fromModal ? visibleAccounts : typeaheadAccounts;
    const pick = list[accountHighlight] ?? list[0];
    if (!pick) return false;
    selectAccount(lineId, pick);
    return true;
  }

  function openAccountBrowser(lineId: string, seed = '') {
    setActiveLineId(lineId);
    setAccountMenuLineId(null);
    setAccountSearch(seed);
    setAccountHighlight(0);
    setAccountBrowserOpen(true);
  }

  useEffect(() => {
    if (!accountBrowserOpen) return;
    const timer = window.setTimeout(() => {
      accountSearchRef.current?.focus();
      accountSearchRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [accountBrowserOpen]);

  function closeAccountBrowser() {
    setAccountBrowserOpen(false);
    setAccountHighlight(0);
    setAccountMenuLineId(null);
  }

  function handleAccountListKeyDown(e: KeyboardEvent<HTMLInputElement>, lineId: string | null) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleAccounts.length === 0) return;
      setAccountHighlight((i) => Math.min(i + 1, visibleAccounts.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleAccounts.length === 0) return;
      setAccountHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (lineId) pickHighlightedAccount(lineId, true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAccountBrowser();
      suppressAccountMenu();
      if (lineId) focusLineField(lineId, 'account');
    }
  }

  function handleJournalLineKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    idx: number,
    line: NewEntryLine,
    field: JournalLineField,
  ) {
    const typeaheadOpen = field === 'account'
      && accountMenuLineId === line.id
      && !accountBrowserOpen
      && String(line.accountCode || '').trim().length > 0;

    if (e.key === 'F4' || (e.key === 'ArrowDown' && e.altKey && field === 'account')) {
      e.preventDefault();
      openAccountBrowser(line.id, line.accountCode);
      return;
    }

    if (typeaheadOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (typeaheadAccounts.length === 0) return;
        setAccountHighlight((i) => Math.min(i + 1, typeaheadAccounts.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (typeaheadAccounts.length === 0) return;
        setAccountHighlight((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!pickHighlightedAccount(line.id, false)) moveJournalField(idx, field, 1);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setActiveLineId(null);
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (field === 'account' && !e.shiftKey && typeaheadOpen && typeaheadAccounts.length > 0
        && String(line.accountCode || '').trim()) {
        pickHighlightedAccount(line.id, false);
        return;
      }
      if (field === 'account' && !e.shiftKey) {
        const exact = accountsByCode.get(String(line.accountCode || '').trim());
        if (exact) {
          selectAccount(line.id, exact);
          return;
        }
      }
      setActiveLineId(null);
      moveJournalField(idx, field, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (field === 'account') {
        const exact = accountsByCode.get(String(line.accountCode || '').trim());
        if (exact) {
          selectAccount(line.id, exact);
          return;
        }
        if (typeaheadAccounts.length > 0) {
          pickHighlightedAccount(line.id, false);
          return;
        }
        return;
      }
      moveJournalField(idx, field, 1);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < newEntryLines.length - 1) {
        goToLineField(idx + 1, field);
        return;
      }
      const last = newEntryLines[idx];
      if (last && (last.accountCode || last.description || last.debit || last.credit)) {
        const id = addLine();
        focusLineField(id, field);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) goToLineField(idx - 1, field);
      return;
    }

    if (e.key === 'ArrowRight' && inputCaretAtEnd(e.currentTarget)) {
      e.preventDefault();
      moveJournalField(idx, field, 1);
      return;
    }
    if (e.key === 'ArrowLeft' && inputCaretAtStart(e.currentTarget)) {
      e.preventDefault();
      moveJournalField(idx, field, -1);
    }
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
      // Optimistic: prepend/replace in list via refetch soft; don't yank full CoA over Tailscale.
      void refetch();
      void refetchChartAccounts();
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
      void refetch();
      void refetchChartAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.journalsUi.reverseFailed);
    } finally {
      setReversingEntry(false);
    }
  }

  async function exportJournals() {
    setExporting(true);
    try {
      const response = await api.journalEntries.list({
        ...(listBranchId ? { branchId: listBranchId } : {}),
        startDate: dateFrom,
        endDate: dateTo,
        ...(filterType !== 'all' ? { referenceType: filterType } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        limit: EXPORT_LIMIT,
        offset: 0,
        includeContext: true,
      });
      if (response.error) throw new Error(response.error);
      const payload = unwrapListPayload<Record<string, unknown>>(response.data);
      const mapped = payload.items.map((je) => mapJournalEntryFromApi(je, journalLabels));
      if (!mapped.length) {
        toast.error(t.journalsUi.noEntriesFound);
        return;
      }
      const rows = mapped.map((entry) => {
        const typeConfig = resolveEntryType(entry.type);
        const typeLabel = t.journalsUi.entryTypes[typeConfig.labelKey as keyof typeof t.journalsUi.entryTypes] as string;
        return {
          [t.journalsUi.colDateTime]: formatJournalDateTime(entry, uiLocale),
          [t.journalsUi.colBranch]: entry.branchName || '',
          [t.common.type]: typeLabel,
          [t.journalsUi.entryNo]: entry.entryNumber,
          [t.journalsUi.colCustomer]: entry.customerName || '',
          [t.common.description]: entry.readableTitle,
          [t.journalsUi.debit]: entry.totalDebit,
          [t.journalsUi.credit]: entry.totalCredit,
          [t.common.user]: entry.createdBy,
        };
      });
      await exportReportExcel(rows, `journals_${dateFrom}_${dateTo}`, {
        title: t.journalsUi.tabJournals,
        companyName,
        periodLabel: `${dateFrom} – ${dateTo}`,
        branchLabel: currentBranch?.name,
        generatedAt: new Date().toLocaleString(uiLocale),
        landscape: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.journalsUi.exportFailed);
    } finally {
      setExporting(false);
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
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => { void exportJournals(); }}
          disabled={exporting}
        >
          <Download className="w-3 h-3" /> {t.journalsUi.export}
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
          <div className="relative">
          {listLoading && entries.length > 0 && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 border-b bg-background/80 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t.common.loading}
            </div>
          )}
          <table className={cn('w-full text-xs', listLoading && entries.length > 0 && 'opacity-60 pointer-events-none')}>
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
              {entries.map(entry => {
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
                <td className="px-3 py-2" colSpan={6}>
                  {t.journalsUi.showingCount
                    .replace('{shown}', String(entries.length))
                    .replace('{total}', String(total))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-green-600">{periodTotals.debit.toLocaleString(uiLocale)} Kz</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{periodTotals.credit.toLocaleString(uiLocale)} Kz</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
          {listLoading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-70" />
              <p className="text-sm">{t.common.loading}</p>
            </div>
          )}
          {!listLoading && entries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">{t.journalsUi.noEntriesFound}</div>
          )}
          {!listLoading && hasMore && (
            <div className="flex justify-center py-3">
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? t.common.loading : t.journalsUi.loadMore}
              </Button>
            </div>
          )}
          </div>
        </TabsContent>

        <TabsContent value="balancete" className="flex-1 m-0 overflow-hidden">
          <JournalsTrialBalancePanel branchId={listBranchId} />
        </TabsContent>

        <TabsContent value="auditoria" className="flex-1 m-0 overflow-hidden">
          <JournalsAuditPanel />
        </TabsContent>

        <TabsContent value="cashiers" className="flex-1 m-0 overflow-hidden">
          <JournalsCashiersPanel branchId={listBranchId} dateFrom={dateFrom} dateTo={dateTo} />
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
        <DialogContent
          className="max-w-[96vw] w-[96vw] max-h-[94vh] h-[90vh] flex flex-col gap-0 p-0 overflow-hidden sm:rounded-xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusLineField(newEntryLines[0]?.id, 'account');
          }}
        >
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

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-3 sm:px-6">
            <div className="grid w-max max-w-full grid-cols-2 gap-x-4 gap-y-1">
              <Label className="text-sm font-medium">{t.common.date}</Label>
              <Label className="text-sm font-medium">{t.common.type}</Label>
              <div>
                <DatePickerButton
                  value={newEntryDate}
                  onChange={handleNewEntryDateChange}
                  placeholder={t.common.date}
                  locale={language === 'pt' ? 'pt' : 'en'}
                  buttonClassName="h-10 w-[11.5rem] min-w-[11.5rem] justify-start"
                  disableBeforeToday={!canBackdatePost}
                />
                {!canBackdatePost && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{t.journalsUi.dateLockedToToday}</p>
                )}
              </div>
              <div>
                <Select value={newEntryType} onValueChange={setNewEntryType}>
                  <SelectTrigger className="h-10 w-[14rem] min-w-[14rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREATE_ENTRY_TYPES.map(et => (
                      <SelectItem key={et.value} value={et.value}>
                        {t.journalsUi.entryTypes[et.labelKey as keyof typeof t.journalsUi.entryTypes] as string}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{t.journalsUi.entryLines}</p>
                  <p className="text-xs text-muted-foreground">{t.journalsUi.entryLinesHint}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1" tabIndex={-1} onClick={autoBalance}>
                    {t.journalsUi.autoBalance}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1" tabIndex={-1} onClick={addLine}>
                    <Plus className="h-4 w-4" /> {t.journalsUi.line}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                    <tr className="border-b">
                      <th className="px-3 py-2.5 text-left w-40 font-semibold">{t.journalsUi.account}</th>
                      <th className="px-3 py-2.5 text-left min-w-[200px] font-semibold">{t.journalsUi.accountName}</th>
                      <th className="px-3 py-2.5 text-left min-w-[180px] font-semibold">{t.common.description}</th>
                      <th className="px-3 py-2.5 text-right w-36 font-semibold">{t.journalsUi.debit}</th>
                      <th className="px-3 py-2.5 text-right w-36 font-semibold">{t.journalsUi.credit}</th>
                      <th className="px-2 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {newEntryLines.map((line, idx) => (
                      <tr
                        key={line.id}
                        className={cn(
                          'group',
                          activeLineId === line.id ? 'bg-primary/5' : 'hover:bg-muted/20',
                        )}
                      >
                        <td className="px-2 py-1.5 relative align-top">
                          <div className="flex items-center gap-1">
                            <Input
                              ref={(el) => setLineFieldRef(line.id, 'account', el)}
                              value={line.accountCode}
                              placeholder={t.journalsUi.accountCodeExample}
                              className="h-9 font-mono"
                              autoComplete="off"
                              onFocus={() => {
                                if (accountBlurTimer.current) {
                                  window.clearTimeout(accountBlurTimer.current);
                                  accountBlurTimer.current = null;
                                }
                                setActiveLineId(line.id);
                                if (Date.now() < skipAccountMenuUntilRef.current) {
                                  setAccountMenuLineId(null);
                                  return;
                                }
                                setAccountSearch(line.accountCode);
                                setAccountHighlight(0);
                                setAccountMenuLineId(line.id);
                              }}
                              onBlur={() => {
                                if (accountBrowserOpen) return;
                                accountBlurTimer.current = window.setTimeout(() => {
                                  setAccountMenuLineId((prev) => (prev === line.id ? null : prev));
                                }, 150);
                              }}
                              onChange={e => {
                                skipAccountMenuUntilRef.current = 0;
                                updateLine(line.id, 'accountCode', e.target.value);
                                setAccountSearch(e.target.value);
                                setActiveLineId(line.id);
                                setAccountMenuLineId(line.id);
                                setAccountHighlight(0);
                              }}
                              onKeyDown={(e) => handleJournalLineKeyDown(e, idx, line, 'account')}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              tabIndex={-1}
                              className="h-9 w-9 shrink-0"
                              title={`${t.journalsUi.openAccountList} (F4)`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => openAccountBrowser(line.id, line.accountCode)}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                          </div>
                          {accountMenuLineId === line.id
                            && !accountBrowserOpen
                            && String(line.accountCode || '').trim().length > 0
                            && typeof document !== 'undefined'
                            && createPortal(
                            (() => {
                              const box = lineFieldRefs.current[line.id]?.account?.getBoundingClientRect();
                              if (!box) return null;
                              return (
                            <div
                              className="fixed z-[120] max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg"
                              style={{
                                top: box.bottom + 4,
                                left: box.left,
                                width: Math.max(box.width + 36, 380),
                              }}
                            >
                              <div className="sticky top-0 border-b bg-popover px-3 py-2">
                                <div className="flex gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  <span className="w-16 shrink-0">{t.journalsUi.account}</span>
                                  <span className="min-w-0 flex-1">{t.journalsUi.accountName}</span>
                                  <span className="w-24 shrink-0 text-right">{t.chartOfAccountsUi.colBalance}</span>
                                </div>
                              </div>
                              {typeaheadAccounts.length === 0 ? (
                                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                                  {t.journalsUi.noAccountsFound}
                                </div>
                              ) : (
                                typeaheadAccounts.map((acct, acctIdx) => (
                                  <button
                                    key={acct.id}
                                    type="button"
                                    tabIndex={-1}
                                    data-journal-acct-type={`${line.id}-${acctIdx}`}
                                    className={cn(
                                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                                      acctIdx === accountHighlight ? 'bg-accent' : 'hover:bg-accent/50',
                                    )}
                                    onMouseEnter={() => setAccountHighlight(acctIdx)}
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      selectAccount(line.id, acct);
                                    }}
                                  >
                                    <span className="w-16 shrink-0 font-mono text-primary">{acct.code}</span>
                                    <span className="min-w-0 flex-1 truncate">
                                      {resolveAccountDisplayName(acct, language, t)}
                                    </span>
                                    <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                      {Number(acct.current_balance || 0).toLocaleString(uiLocale)} Kz
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                              );
                            })(),
                            document.body,
                          )}
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <Input
                            value={
                              line.accountCode
                                ? resolveAccountDisplayName(
                                  { code: line.accountCode, name: line.accountName },
                                  language,
                                  t,
                                )
                                : line.accountName
                            }
                            disabled
                            tabIndex={-1}
                            className="h-9 bg-muted/40"
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <Input
                            ref={(el) => setLineFieldRef(line.id, 'description', el)}
                            value={line.description}
                            placeholder={t.journalsUi.entryDescriptionPlaceholder}
                            onFocus={() => {
                              setActiveLineId(line.id);
                              setAccountMenuLineId(null);
                            }}
                            onChange={e => updateLine(line.id, 'description', e.target.value)}
                            onKeyDown={(e) => handleJournalLineKeyDown(e, idx, line, 'description')}
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <Input
                            ref={(el) => setLineFieldRef(line.id, 'debit', el)}
                            type="text"
                            inputMode="decimal"
                            value={line.debit}
                            placeholder="0.00"
                            onFocus={() => {
                              setActiveLineId(line.id);
                              setAccountMenuLineId(null);
                            }}
                            onChange={e => updateLine(line.id, 'debit', e.target.value)}
                            onKeyDown={(e) => handleJournalLineKeyDown(e, idx, line, 'debit')}
                            className="h-9 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <Input
                            ref={(el) => setLineFieldRef(line.id, 'credit', el)}
                            type="text"
                            inputMode="decimal"
                            value={line.credit}
                            placeholder="0.00"
                            onFocus={() => {
                              setActiveLineId(line.id);
                              setAccountMenuLineId(null);
                            }}
                            onChange={e => updateLine(line.id, 'credit', e.target.value)}
                            onKeyDown={(e) => handleJournalLineKeyDown(e, idx, line, 'credit')}
                            className="h-9 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-1 py-1.5 align-middle">
                          <Button
                            variant="ghost"
                            size="icon"
                            tabIndex={-1}
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
              ref={postButtonRef}
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

      <Dialog
        open={accountBrowserOpen}
        onOpenChange={(open) => {
          if (!open) closeAccountBrowser();
        }}
      >
        <DialogContent
          className="z-[110] flex h-[min(80vh,42rem)] w-[min(52rem,92vw)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            accountSearchRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            closeAccountBrowser();
            suppressAccountMenu();
            if (activeLineId) focusLineField(activeLineId, 'account');
          }}
        >
          <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 text-left">
            <DialogTitle>{t.journalsUi.accountListTitle}</DialogTitle>
            <DialogDescription>{t.journalsUi.accountListHint}</DialogDescription>
          </DialogHeader>
          <div className="shrink-0 px-4 pb-3">
            <Input
              ref={accountSearchRef}
              value={accountSearch}
              placeholder={t.journalsUi.searchAccountPlaceholder}
              className="h-10"
              autoComplete="off"
              onChange={(e) => {
                setAccountSearch(e.target.value);
                setAccountHighlight(0);
              }}
              onKeyDown={(e) => handleAccountListKeyDown(e, activeLineId)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleAccounts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t.journalsUi.noAccountsFound}
              </p>
            ) : (
              visibleAccounts.map((acct, acctIdx) => (
                <button
                  key={acct.id}
                  type="button"
                  tabIndex={-1}
                  data-journal-acct={String(acctIdx)}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-2 text-left text-sm border-b border-border/40',
                    acctIdx === accountHighlight ? 'bg-accent' : 'hover:bg-accent/40',
                  )}
                  onMouseEnter={() => setAccountHighlight(acctIdx)}
                  onClick={() => {
                    if (activeLineId) selectAccount(activeLineId, acct);
                  }}
                >
                  <span className="w-20 shrink-0 font-mono text-primary">{acct.code}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {resolveAccountDisplayName(acct, language, t)}
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {Number(acct.current_balance || 0).toLocaleString(uiLocale)} Kz
                  </span>
                </button>
              ))
            )}
          </div>
          <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
            {t.journalsUi.showingAccounts
              .replace('{shown}', String(visibleAccounts.length))
              .replace('{total}', String(filteredAccounts.length))}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
