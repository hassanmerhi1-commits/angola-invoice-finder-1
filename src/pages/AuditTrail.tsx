import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Shield, Search, FileText, User, Download, LogIn, LogOut, Edit,
  CheckCircle, XCircle, AlertTriangle, Printer, RefreshCw, ArrowRightLeft,
  Eye, RotateCcw, Clock, Send, Package
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { mapAuditLogRow, type AuditLogRow } from '@/lib/auditLogDisplay';
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel';
import { DatePickerButton } from '@/components/ui/DatePickerButton';
import { localISODate } from '@/lib/workingDayAccess';
import { useBranchContext } from '@/contexts/BranchContext';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { exportReportExcel } from '@/lib/reportExport';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';

export type AuditEntry = AuditLogRow & { workstationId?: string };

const PAGE_SIZE = 200;
const EXPORT_LIMIT = 5000;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISODate(d);
}

function mapBackendAuditRow(row: Record<string, unknown>): AuditEntry {
  const mapped = mapAuditLogRow(row);
  return {
    ...mapped,
    workstationId: row.workstation_id ? String(row.workstation_id) : undefined,
  };
}

const ACTION_CONFIG: Record<string, { icon: typeof FileText; labelKey: string; color: string }> = {
  create: { icon: FileText, labelKey: 'actionCreate', color: 'text-green-600' },
  update: { icon: Edit, labelKey: 'actionUpdate', color: 'text-blue-600' },
  delete: { icon: XCircle, labelKey: 'actionDelete', color: 'text-destructive' },
  status_change: { icon: AlertTriangle, labelKey: 'actionStatusChange', color: 'text-amber-600' },
  approve: { icon: CheckCircle, labelKey: 'actionApprove', color: 'text-green-600' },
  reject: { icon: XCircle, labelKey: 'actionReject', color: 'text-destructive' },
  void: { icon: XCircle, labelKey: 'actionVoid', color: 'text-destructive' },
  convert: { icon: ArrowRightLeft, labelKey: 'actionConvert', color: 'text-blue-600' },
  print: { icon: Printer, labelKey: 'actionPrint', color: 'text-muted-foreground' },
  export: { icon: Download, labelKey: 'actionExport', color: 'text-muted-foreground' },
  login: { icon: LogIn, labelKey: 'actionLogin', color: 'text-green-600' },
  login_failed: { icon: AlertTriangle, labelKey: 'actionLoginFailed', color: 'text-destructive' },
  login_locked: { icon: AlertTriangle, labelKey: 'actionLoginLocked', color: 'text-destructive' },
  logout: { icon: LogOut, labelKey: 'actionLogout', color: 'text-muted-foreground' },
  password_change: { icon: Edit, labelKey: 'actionPasswordChange', color: 'text-blue-600' },
  password_reset: { icon: Edit, labelKey: 'actionPasswordReset', color: 'text-amber-600' },
  issue: { icon: FileText, labelKey: 'actionCreate', color: 'text-green-600' },
  agt_transmit: { icon: Send, labelKey: 'actionSendAgt', color: 'text-blue-600' },
  saft_export: { icon: Download, labelKey: 'actionExport', color: 'text-muted-foreground' },
  restore: { icon: RotateCcw, labelKey: 'actionRestore', color: 'text-amber-600' },
  transfer: { icon: ArrowRightLeft, labelKey: 'actionTransfer', color: 'text-blue-600' },
  receive: { icon: Package, labelKey: 'actionReceive', color: 'text-blue-600' },
  close: { icon: CheckCircle, labelKey: 'actionClose', color: 'text-green-600' },
  authorize: { icon: CheckCircle, labelKey: 'actionAuthorize', color: 'text-green-600' },
  authorize_failed: { icon: AlertTriangle, labelKey: 'actionAuthorizeFailed', color: 'text-destructive' },
};

const MODULE_LABELS: Record<string, string> = {
  sales: 'moduleSales',
  products: 'moduleProducts',
  clients: 'moduleClients',
  suppliers: 'moduleSuppliers',
  purchase_orders: 'modulePurchaseOrders',
  purchase_invoices: 'modulePurchaseInvoices',
  payments: 'modulePayments',
  stock: 'moduleStock',
  hr: 'moduleHr',
  production: 'moduleProduction',
  accounting: 'moduleAccounting',
  system: 'moduleSystem',
  users: 'moduleUsers',
  invoices: 'moduleInvoices',
  proformas: 'moduleFiscal',
  backup: 'moduleBackup',
  fiscal: 'moduleFiscal',
  expenses: 'moduleExpenses',
  bank: 'moduleBank',
  warehouses: 'moduleWarehouses',
  categories: 'moduleCategories',
  tax_codes: 'moduleTax',
  daily_reports: 'moduleDailyReports',
  budgets: 'moduleBudgets',
  cost_centers: 'moduleCostCenters',
  supplier_returns: 'moduleSuppliers',
  stock_transfers: 'moduleStock',
  bank_reconciliations: 'moduleBank',
  bank_transactions: 'moduleBank',
};

function defaultStats() {
  return { total: 0, today: 0, creates: 0, updates: 0, voids: 0, logins: 0 };
}

export default function AuditTrail() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canViewAudit = hasPermission('reports_audit');
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { branches } = useBranchContext();
  const { companyName } = useCompanyLogo();

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

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [filterTable, setFilterTable] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterBranch, setFilterBranch] = useState('all');
  const [startDate, setStartDate] = useState(() => daysAgoISO(29));
  const [endDate, setEndDate] = useState(() => localISODate());
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [facetUsers, setFacetUsers] = useState<string[]>([]);
  const [facetTables, setFacetTables] = useState<string[]>([]);
  const [stats, setStats] = useState(defaultStats);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(searchTerm.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      map.set(String(b.id), formatBranchDisplayName(b));
    }
    return map;
  }, [branches]);

  const moduleLabel = useCallback((tableOrModule: string) => {
    const key = MODULE_LABELS[tableOrModule];
    if (key) return t.auditTrailUi[key as keyof typeof t.auditTrailUi] || tableOrModule;
    return tableOrModule;
  }, [t]);

  const listParams = useCallback((extra?: { limit?: number; offset?: number }) => ({
    startDate,
    endDate,
    branchId: filterBranch !== 'all' ? filterBranch : undefined,
    action: filterAction !== 'all' ? filterAction : undefined,
    tableName: filterTable !== 'all' ? filterTable : undefined,
    userName: filterUser !== 'all' ? filterUser : undefined,
    q: debouncedQ || undefined,
    limit: extra?.limit ?? PAGE_SIZE,
    offset: extra?.offset ?? 0,
  }), [startDate, endDate, filterBranch, filterAction, filterTable, filterUser, debouncedQ]);

  useEffect(() => {
    if (!canViewAudit) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = listParams({ limit: PAGE_SIZE, offset: 0 });
    const facetParams = {
      startDate: params.startDate,
      endDate: params.endDate,
      branchId: params.branchId,
    };
    Promise.all([
      api.audit.list(params),
      api.audit.stats({
        startDate: params.startDate,
        endDate: params.endDate,
        branchId: params.branchId,
        action: params.action,
        tableName: params.tableName,
        userName: params.userName,
        q: params.q,
      }),
      api.audit.facets(facetParams),
    ])
      .then(([listRes, statsRes, facetsRes]) => {
        if (cancelled) return;
        if (listRes.error) throw new Error(listRes.error);
        const rows = Array.isArray(listRes.data) ? listRes.data : [];
        setAuditEntries(rows.map((row) => mapBackendAuditRow(row as Record<string, unknown>)));
        setTotal(Number((listRes as { total?: number }).total ?? rows.length));
        if (statsRes.data && !statsRes.error) {
          setStats({
            total: Number(statsRes.data.total || 0),
            today: Number(statsRes.data.today || 0),
            creates: Number(statsRes.data.creates || 0),
            updates: Number(statsRes.data.updates || 0),
            voids: Number(statsRes.data.voids || 0),
            logins: Number(statsRes.data.logins || 0),
          });
        }
        if (facetsRes.data && !facetsRes.error) {
          setFacetUsers(facetsRes.data.users || []);
          setFacetTables(facetsRes.data.tables || []);
        }
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setAuditEntries([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [listParams, refreshKey, canViewAudit]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api.audit.list(listParams({ limit: PAGE_SIZE, offset: auditEntries.length }));
      if (res.error) throw new Error(res.error);
      const rows = Array.isArray(res.data) ? res.data : [];
      setAuditEntries((prev) => [
        ...prev,
        ...rows.map((row) => mapBackendAuditRow(row as Record<string, unknown>)),
      ]);
      setTotal(Number((res as { total?: number }).total ?? auditEntries.length + rows.length));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const groupedByDate = useMemo(() => {
    const groups: Record<string, AuditEntry[]> = {};
    auditEntries.forEach((entry) => {
      const dateKey = new Date(entry.createdAt).toLocaleDateString(uiLocale);
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    });
    return Object.entries(groups);
  }, [auditEntries, uiLocale]);

  const exportAudit = async () => {
    setExporting(true);
    try {
      const res = await api.audit.list(listParams({ limit: EXPORT_LIMIT, offset: 0 }));
      if (res.error) throw new Error(res.error);
      const rows = Array.isArray(res.data) ? res.data : [];
      const mapped = rows.map((row) => mapBackendAuditRow(row as Record<string, unknown>));
      if (!mapped.length) {
        toast.error(t.auditTrailUi.empty);
        return;
      }
      const exportRows = mapped.map((entry) => ({
        [t.auditTrailUi.colTime]: new Date(entry.createdAt).toLocaleString(uiLocale),
        [t.auditTrailUi.colAction]: ACTION_CONFIG[entry.action]?.labelKey
          ? t.auditTrailUi[ACTION_CONFIG[entry.action].labelKey as keyof typeof t.auditTrailUi]
          : entry.action,
        [t.auditTrailUi.colModule]: moduleLabel(entry.module),
        [t.auditTrailUi.colBranch]: entry.branchId ? (branchNameById.get(entry.branchId) || entry.branchId) : '',
        [t.auditTrailUi.colUser]: entry.userName,
        [t.auditTrailUi.colDescription]: entry.description,
      }));
      const branchLabel = filterBranch === 'all'
        ? t.auditTrailUi.allBranches
        : (branchNameById.get(filterBranch) || filterBranch);
      await exportReportExcel(exportRows, `audit_trail_${startDate}_${endDate}`, {
        title: t.auditTrailUi.title,
        companyName,
        periodLabel: `${startDate} – ${endDate}`,
        branchLabel,
        generatedAt: new Date().toLocaleString(uiLocale),
        landscape: true,
      });
      void api.audit.log({
        action: 'export',
        tableName: 'audit_log',
        description: t.auditTrailUi.auditExportedLog,
      });
      toast.success(t.auditTrailUi.auditExportedToast);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  if (!canViewAudit) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
        <Shield className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">{t.auditTrailUi.permissionDenied}</p>
      </div>
    );
  }

  const hasMore = auditEntries.length < total;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Shield className="w-5 h-5" /> {t.auditTrailUi.title}
            </h1>
            <p className="text-sm text-muted-foreground">{t.auditTrailUi.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw className="w-3.5 h-3.5" /> {t.auditTrailUi.refresh}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void exportAudit()} disabled={exporting}>
              <Download className="w-3.5 h-3.5" /> {t.auditTrailUi.export}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2 px-4 pt-3">
        {[
          { label: t.auditTrailUi.statsTotal, value: stats.total, icon: Shield },
          { label: t.auditTrailUi.statsToday, value: stats.today, icon: Clock },
          { label: t.auditTrailUi.statsCreates, value: stats.creates, icon: FileText },
          { label: t.auditTrailUi.statsUpdates, value: stats.updates, icon: Edit },
          { label: t.auditTrailUi.statsVoids, value: stats.voids, icon: XCircle },
          { label: t.auditTrailUi.statsLogins, value: stats.logins, icon: LogIn },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="py-2 px-3 flex items-center gap-2">
              <s.icon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <DatePickerButton
          value={startDate}
          onChange={setStartDate}
          locale={language === 'pt' ? 'pt' : 'en'}
          placeholder={t.auditTrailUi.dateFrom}
        />
        <DatePickerButton
          value={endDate}
          onChange={setEndDate}
          locale={language === 'pt' ? 'pt' : 'en'}
          placeholder={t.auditTrailUi.dateTo}
          minDate={startDate}
        />
        <Select value={filterBranch} onValueChange={setFilterBranch}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterBranch} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allBranches}</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{formatBranchDisplayName(b)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder={t.auditTrailUi.searchPlaceholder} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-8 text-sm pl-8" />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterAction} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allActions}</SelectItem>
            {Object.entries(ACTION_CONFIG).map(([key, c]) => (
              <SelectItem key={key} value={key}>{t.auditTrailUi[c.labelKey as keyof typeof t.auditTrailUi]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterTable} onValueChange={setFilterTable}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterModule} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allModules}</SelectItem>
            {facetTables.map((table) => (
              <SelectItem key={table} value={table}>
                {moduleLabel(table)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterUser} onValueChange={setFilterUser}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterUser} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allUsers}</SelectItem>
            {facetUsers.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {t.auditTrailUi.showingCount
            .replace('{shown}', String(auditEntries.length))
            .replace('{total}', String(total))}
        </Badge>
      </div>

      {total > EXPORT_LIMIT && (
        <p className="px-4 pb-2 text-xs text-amber-700">
          {t.auditTrailUi.truncatedHint.replace('{limit}', String(EXPORT_LIMIT))}
        </p>
      )}

      <div className="flex-1 overflow-auto px-4 pb-4">
        {loading && (
          <div className="text-center py-12 text-muted-foreground text-sm">{t.auditTrailUi.refresh}…</div>
        )}
        {loadError && !loading && (
          <div className="text-center py-8 text-destructive text-sm">{loadError}</div>
        )}
        {!loading && !loadError && groupedByDate.map(([date, entries]) => (
          <div key={date} className="mb-4">
            <div className="flex items-center gap-2 mb-1.5 sticky top-0 bg-background z-10 py-1">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">{date}</span>
              <Badge variant="secondary" className="text-[9px]">{entries.length}</Badge>
              <Separator className="flex-1" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t.auditTrailUi.colTime}</TableHead>
                  <TableHead className="w-24">{t.auditTrailUi.colAction}</TableHead>
                  <TableHead className="w-28">{t.auditTrailUi.colModule}</TableHead>
                  <TableHead className="w-28">{t.auditTrailUi.colBranch}</TableHead>
                  <TableHead className="w-24">{t.auditTrailUi.colUser}</TableHead>
                  <TableHead>{t.auditTrailUi.colDescription}</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const config = ACTION_CONFIG[entry.action] || { icon: FileText, labelKey: '', color: 'text-muted-foreground' };
                  const Icon = config.icon;
                  return (
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => {
                        setSelectedEntry(entry);
                        void api.audit.get(entry.id).then((res) => {
                          if (res.data && !res.error) {
                            setSelectedEntry(mapBackendAuditRow(res.data as Record<string, unknown>));
                          }
                        });
                      }}
                    >
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleTimeString(uiLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                          <span className="text-xs">
                            {config.labelKey ? t.auditTrailUi[config.labelKey as keyof typeof t.auditTrailUi] : entry.action}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {moduleLabel(entry.module)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.branchId ? (branchNameById.get(entry.branchId) || entry.branchId) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3 text-muted-foreground" />
                          {entry.userName}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{entry.description}</TableCell>
                      <TableCell>
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ))}

        {!loading && hasMore && (
          <div className="flex justify-center py-3">
            <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? t.auditTrailUi.refresh : t.auditTrailUi.loadMore}
            </Button>
          </div>
        )}

        {!loading && auditEntries.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t.auditTrailUi.empty}</p>
          </div>
        )}
      </div>

      <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" /> {t.auditTrailUi.detailTitle}
            </DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailId}:</span><p className="font-mono text-xs">{selectedEntry.id}</p></div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailDateTime}:</span><p className="text-xs">{new Date(selectedEntry.createdAt).toLocaleString(uiLocale)}</p></div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailAction}:</span>
                  <Badge className="text-[10px] mt-0.5">
                    {ACTION_CONFIG[selectedEntry.action]?.labelKey
                      ? t.auditTrailUi[ACTION_CONFIG[selectedEntry.action].labelKey as keyof typeof t.auditTrailUi]
                      : selectedEntry.action}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailModule}:</span>
                  <Badge variant="outline" className="text-[10px] mt-0.5">
                    {moduleLabel(selectedEntry.module)}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailUser}:</span><p className="text-xs">{selectedEntry.userName}</p></div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailUserId}:</span><p className="font-mono text-xs">{selectedEntry.userId || '-'}</p></div>
                {selectedEntry.branchId && (
                  <div>
                    <span className="text-muted-foreground text-xs">{t.auditTrailUi.colBranch}:</span>
                    <p className="text-xs">{branchNameById.get(selectedEntry.branchId) || selectedEntry.branchId}</p>
                  </div>
                )}
              </div>
              <Separator />
              <div>
                <span className="text-muted-foreground text-xs">{t.auditTrailUi.detailDescription}:</span>
                <p className="text-sm mt-1">{selectedEntry.description}</p>
              </div>
              {(selectedEntry.details || selectedEntry.newValues || selectedEntry.oldValues || selectedEntry.metadata) && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground text-xs">{t.auditTrailUi.detailAdditionalData}:</span>
                    <div className="mt-1">
                      <AuditDetailPanel
                        details={selectedEntry.details}
                        oldValues={selectedEntry.oldValues}
                        newValues={selectedEntry.newValues}
                        metadata={selectedEntry.metadata}
                        labels={auditDetailLabels}
                        locale={uiLocale}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
