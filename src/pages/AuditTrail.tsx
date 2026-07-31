import { useState, useMemo, useEffect } from 'react';
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
  Eye, Trash2, RotateCcw, Package, DollarSign, Clock, Send
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { mapAuditLogRow, type AuditLogRow } from '@/lib/auditLogDisplay';
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel';

export type AuditEntry = AuditLogRow & { workstationId?: string };

function mapBackendAuditRow(row: Record<string, unknown>): AuditEntry {
  const mapped = mapAuditLogRow(row);
  return {
    ...mapped,
    workstationId: row.workstation_id ? String(row.workstation_id) : undefined,
  };
}

async function loadAuditEntries(): Promise<AuditEntry[]> {
  const res = await api.audit.list({ limit: 500 });
  if (res.error) {
    throw new Error(res.error);
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows.map((row) => mapBackendAuditRow(row as Record<string, unknown>));
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
};

// Seed demo data removed — audit trail reads from backend audit_log

export default function AuditTrail() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canViewAudit = hasPermission('reports_audit');
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

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
  const [filterAction, setFilterAction] = useState('all');
  const [filterModule, setFilterModule] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewAudit) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadAuditEntries()
      .then((entries) => {
        setAuditEntries(entries);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setAuditEntries([]);
      })
      .finally(() => setLoading(false));
  }, [refreshKey, canViewAudit]);

  const filtered = useMemo(() => {
    return auditEntries.filter(entry => {
      if (filterAction !== 'all' && entry.action !== filterAction) return false;
      if (filterModule !== 'all' && entry.module !== filterModule) return false;
      if (filterUser !== 'all' && entry.userName !== filterUser) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        return entry.description?.toLowerCase().includes(q) ||
               entry.userName?.toLowerCase().includes(q) ||
               entry.module?.toLowerCase().includes(q);
      }
      return true;
    });
  }, [auditEntries, filterAction, filterModule, filterUser, searchTerm]);

  const uniqueModules = useMemo(() => [...new Set(auditEntries.map(e => e.module))].sort(), [auditEntries]);
  const uniqueUsers = useMemo(() => [...new Set(auditEntries.map(e => e.userName))].sort(), [auditEntries]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayEntries = auditEntries.filter(e => new Date(e.createdAt).toDateString() === today);
    return {
      total: auditEntries.length,
      today: todayEntries.length,
      creates: auditEntries.filter(e => e.action === 'create').length,
      updates: auditEntries.filter(e => e.action === 'update').length,
      deletes: auditEntries.filter(e => e.action === 'delete' || e.action === 'void').length,
      logins: auditEntries.filter(e => e.action === 'login').length,
    };
  }, [auditEntries]);

  // Group by date for timeline
  const groupedByDate = useMemo(() => {
    const groups: Record<string, AuditEntry[]> = {};
    filtered.forEach(entry => {
      const dateKey = new Date(entry.createdAt).toLocaleDateString(uiLocale);
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    });
    return Object.entries(groups);
  }, [filtered, uiLocale]);

  const exportAudit = () => {
    const json = JSON.stringify(filtered, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void api.audit.log({
      action: 'export',
      tableName: 'audit_log',
      description: t.auditTrailUi.auditExportedLog,
    });
    toast.success(t.auditTrailUi.auditExportedToast);
    setRefreshKey(k => k + 1);
  };

  if (!canViewAudit) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
        <Shield className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">{t.auditTrailUi.permissionDenied}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Shield className="w-5 h-5" /> {t.auditTrailUi.title}
            </h1>
            <p className="text-sm text-muted-foreground">{t.auditTrailUi.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRefreshKey(k => k + 1)}>
              <RefreshCw className="w-3.5 h-3.5" /> {t.auditTrailUi.refresh}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportAudit}>
              <Download className="w-3.5 h-3.5" /> {t.auditTrailUi.export}
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-2 px-4 pt-3">
        {[
          { label: t.auditTrailUi.statsTotal, value: stats.total, icon: Shield },
          { label: t.auditTrailUi.statsToday, value: stats.today, icon: Clock },
          { label: t.auditTrailUi.statsCreates, value: stats.creates, icon: FileText },
          { label: t.auditTrailUi.statsUpdates, value: stats.updates, icon: Edit },
          { label: t.auditTrailUi.statsVoids, value: stats.deletes, icon: XCircle },
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

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder={t.auditTrailUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-8 text-sm pl-8" />
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
        <Select value={filterModule} onValueChange={setFilterModule}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterModule} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allModules}</SelectItem>
            {uniqueModules.map(m => (
              <SelectItem key={m as string} value={m as string}>
                {t.auditTrailUi[MODULE_LABELS[m as string] as keyof typeof t.auditTrailUi] || (m as string)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterUser} onValueChange={setFilterUser}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={t.auditTrailUi.filterUser} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditTrailUi.allUsers}</SelectItem>
            {uniqueUsers.map(u => (
              <SelectItem key={u as string} value={u as string}>{u as string}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {t.auditTrailUi.resultsCount.replace('{count}', String(filtered.length))}
        </Badge>
      </div>

      {/* Timeline Table */}
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
                  <TableHead className="w-24">{t.auditTrailUi.colUser}</TableHead>
                  <TableHead>{t.auditTrailUi.colDescription}</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(entry => {
                  const config = ACTION_CONFIG[entry.action] || { icon: FileText, labelKey: '', color: 'text-muted-foreground' };
                  const Icon = config.icon;
                  return (
                    <TableRow key={entry.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setSelectedEntry(entry)}>
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
                          {t.auditTrailUi[MODULE_LABELS[entry.module] as keyof typeof t.auditTrailUi] || entry.module}
                        </Badge>
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

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t.auditTrailUi.empty}</p>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
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
                    {t.auditTrailUi[MODULE_LABELS[selectedEntry.module] as keyof typeof t.auditTrailUi] || selectedEntry.module}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailUser}:</span><p className="text-xs">{selectedEntry.userName}</p></div>
                <div><span className="text-muted-foreground text-xs">{t.auditTrailUi.detailUserId}:</span><p className="font-mono text-xs">{selectedEntry.userId || '-'}</p></div>
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
