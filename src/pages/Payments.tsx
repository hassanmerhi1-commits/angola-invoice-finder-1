import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Client, Supplier } from '@/types/erp';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Plus, Search, RefreshCw, CreditCard, Receipt,
  ArrowDownCircle, ArrowUpCircle, CheckCircle, Clock,
  Banknote, Building2, FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useClients, useSuppliers } from '@/hooks/useERP';
import type { OpenItem, Payment } from '@/types/erp';
import { subscribeSupplierReturnsChanged } from '@/lib/supplierReturnSync';
import * as storage from '@/lib/storage';
import { OPEN_ITEMS_CHANGED_EVENT, SUPPLIERS_CHANGED_EVENT } from '@/lib/storage';
import { isOpenItemDebit, signedOpenItemBalance } from '@/lib/openItems';
import { userHasPermission } from '@/lib/permissions';

// Demo data for localStorage mode
function mapPaymentRow(p: any): Payment {
  return {
    id: p.id,
    paymentNumber: p.payment_number || p.paymentNumber || '',
    paymentType: p.payment_type || p.paymentType,
    entityType: p.entity_type || p.entityType,
    entityId: p.entity_id || p.entityId,
    entityName: p.entity_name || p.entityName,
    paymentMethod: p.payment_method || p.paymentMethod,
    amount: parseFloat(p.amount),
    currency: p.currency || 'AOA',
    reference: p.reference,
    notes: p.notes,
    branchId: p.branch_id || p.branchId,
    createdBy: p.created_by || p.createdBy,
    createdAt: p.created_at || p.createdAt,
  };
}

function mapOpenItemRow(oi: any): OpenItem {
  const documentType = oi.document_type || oi.documentType || 'invoice';
  const rawDebit = oi.is_debit ?? oi.isDebit;
  const isDebit =
    rawDebit === undefined || rawDebit === null
      ? documentType === 'invoice' || documentType === 'debit_note'
      : isOpenItemDebit(rawDebit);

  return {
    id: String(oi.id ?? ''),
    entityType: oi.entity_type || oi.entityType,
    entityId: String(oi.entity_id ?? oi.entityId ?? ''),
    entityName: oi.entity_name || oi.entityName || undefined,
    documentType,
    documentId: String(oi.document_id ?? oi.documentId ?? ''),
    documentNumber: String(oi.document_number ?? oi.documentNumber ?? ''),
    documentDate: oi.document_date || oi.documentDate,
    dueDate: oi.due_date || oi.dueDate,
    originalAmount: parseFloat(oi.original_amount ?? oi.originalAmount ?? 0),
    remainingAmount: parseFloat(oi.remaining_amount ?? oi.remainingAmount ?? 0),
    isDebit,
    status: oi.status,
    currency: oi.currency || 'AOA',
    branchId: oi.branch_id || oi.branchId,
    createdAt: oi.created_at || oi.createdAt,
    clearedAt: oi.cleared_at || oi.clearedAt,
  };
}

function usePaymentsData(branchId?: string) {
  const scope = branchId ?? 'all';
  const [payments, setPayments] = useState<Payment[]>(() => getCachedList<Payment[]>(`payments:${scope}`) ?? []);
  const [openItems, setOpenItems] = useState<OpenItem[]>(() => getCachedList<OpenItem[]>(`openItems:${scope}`) ?? []);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [paymentsRes, openRes] = await Promise.all([
        api.payments.list(branchId ? { branchId } : undefined),
        api.transactions.openItems(branchId ? { branchId } : undefined),
      ]);
      if (paymentsRes.error) {
        console.error('[PAYMENTS] List error:', paymentsRes.error);
      }
      if (paymentsRes.data) {
        const mapped = paymentsRes.data.map(mapPaymentRow);
        setPayments(mapped);
        setCachedList(`payments:${branchId ?? 'all'}`, mapped);
      }
      if (openRes.data) {
        const mappedOpen = openRes.data.map(mapOpenItemRow);
        setOpenItems(mappedOpen);
        setCachedList(`openItems:${branchId ?? 'all'}`, mappedOpen);
      }
    } catch (e) {
      console.error('[PAYMENTS] Failed to load:', e);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => subscribeSupplierReturnsChanged(refresh), [refresh]);

  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener(OPEN_ITEMS_CHANGED_EVENT, onChanged);
    window.addEventListener(SUPPLIERS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(OPEN_ITEMS_CHANGED_EVENT, onChanged);
      window.removeEventListener(SUPPLIERS_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const createPayment = useCallback(async (paymentData: any) => {
    const res = await api.payments.create(paymentData);
    if (res.error) throw new Error(res.error);
    await refresh();
    return res.data;
  }, [refresh]);

  return { payments, openItems, loading, refresh, createPayment };
}

export default function Payments() {
  const { t, language } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const deepLinkHandled = useRef(false);
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { apiBranchId } = useBranchScope();
  const { clients, refreshClients } = useClients();
  const { suppliers, refreshSuppliers } = useSuppliers();
  const { payments, openItems, loading, refresh, createPayment } = usePaymentsData(apiBranchId);
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const [activeTab, setActiveTab] = useState<'receipts' | 'payments' | 'open-items'>('receipts');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [paymentType, setPaymentType] = useState<'receipt' | 'payment'>('receipt');

  // New payment form
  const [entityId, setEntityId] = useState('');
  const [entitySearch, setEntitySearch] = useState('');
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'cheque'>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedOpenItems, setSelectedOpenItems] = useState<Set<string>>(new Set());
  const [entityDialogOpenItems, setEntityDialogOpenItems] = useState<OpenItem[]>([]);
  const [entityOpenItemsLoading, setEntityOpenItemsLoading] = useState(false);

  const canRecordReceipt = !!user && (
    userHasPermission(user.role, user.permissionOverrides, 'accounting_receipt')
    || userHasPermission(user.role, user.permissionOverrides, 'accounting_payment')
  );
  const canRecordPayment = !!user && userHasPermission(user.role, user.permissionOverrides, 'accounting_payment');

  const entities = paymentType === 'receipt' ? clients : suppliers;
  const entityLabel = paymentType === 'receipt' ? t.paymentsUi.customer : t.paymentsUi.supplier;

  const filteredEntities = useMemo(() => {
    const active = entities.filter((e) => e.isActive !== false);
    const q = entitySearch.trim().toLowerCase();
    if (!q) return active.slice(0, 30);
    return active
      .filter((e) => {
        const name = e.name.toLowerCase();
        const nif = String(e.nif || '').toLowerCase();
        const phone = String(e.phone || '');
        const id = String(e.id || '').toLowerCase();
        return (
          name.includes(q)
          || nif.includes(q)
          || phone.includes(q)
          || id.includes(q)
        );
      })
      .slice(0, 30);
  }, [entities, entitySearch]);

  const formatEntityOption = (entity: Client | Supplier) => {
    const code = String(entity.nif || '').trim();
    return code ? `${entity.name} — ${code}` : entity.name;
  };

  const selectEntity = (entity: Client | Supplier) => {
    setEntityId(String(entity.id));
    setEntitySearch(formatEntityOption(entity));
    setEntityPickerOpen(false);
    setSelectedOpenItems(new Set());
    setAmount('');
  };

  const resolveEntityName = useCallback((
    entityType: string,
    entityId: string,
    cachedName?: string,
  ) => {
    const name = String(cachedName || '').trim();
    if (name) return name;
    const id = String(entityId || '').trim();
    if (!id) return '—';
    if (entityType === 'supplier') {
      return suppliers.find((s) => String(s.id) === id)?.name || id;
    }
    return clients.find((c) => String(c.id) === id)?.name || id;
  }, [suppliers, clients]);

  const entityPayableItems = useMemo(() => {
    return entityDialogOpenItems.filter((oi) => isOpenItemDebit(oi.isDebit));
  }, [entityDialogOpenItems]);

  const payableTotal = useMemo(() => {
    return entityPayableItems.reduce((sum, oi) => sum + signedOpenItemBalance(oi), 0);
  }, [entityPayableItems]);

  const selectedTotal = useMemo(() => {
    return entityPayableItems
      .filter(oi => selectedOpenItems.has(oi.id))
      .reduce((sum, oi) => sum + signedOpenItemBalance(oi), 0);
  }, [entityPayableItems, selectedOpenItems]);

  const formatSignedAmount = (oi: OpenItem) => {
    const signed = signedOpenItemBalance(oi);
    const formatted = Math.abs(signed).toLocaleString(locale);
    return signed < 0 ? `-${formatted}` : formatted;
  };

  const filteredPayments = useMemo(() => {
    const typeFilter = activeTab === 'receipts' ? 'receipt' : 'payment';
    const q = searchTerm.trim().toLowerCase();
    return payments
      .filter(p => activeTab === 'open-items' || p.paymentType === typeFilter)
      .filter((p) => {
        if (!q) return true;
        const party = resolveEntityName(p.entityType, p.entityId, p.entityName).toLowerCase();
        return party.includes(q) || p.paymentNumber.toLowerCase().includes(q);
      });
  }, [payments, activeTab, searchTerm, resolveEntityName]);

  const filteredOpenItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return openItems
      .filter((oi) => oi.status !== 'cleared')
      .filter((oi) => {
        if (!q) return true;
        const party = resolveEntityName(oi.entityType, oi.entityId, oi.entityName).toLowerCase();
        return (
          party.includes(q)
          || oi.documentNumber.toLowerCase().includes(q)
        );
      });
  }, [openItems, searchTerm, resolveEntityName]);

  const resetForm = () => {
    setEntityId('');
    setEntitySearch('');
    setEntityPickerOpen(false);
    setEntityDialogOpenItems([]);
    setEntityOpenItemsLoading(false);
    setPaymentMethod('cash');
    setAmount('');
    setReference('');
    setNotes('');
    setSelectedOpenItems(new Set());
  };

  useEffect(() => {
    if (!showNewDialog || !entityId) {
      setEntityDialogOpenItems([]);
      setEntityOpenItemsLoading(false);
      return;
    }
    const entType = paymentType === 'receipt' ? 'customer' : 'supplier';
    let cancelled = false;
    setEntityOpenItemsLoading(true);
    void api.payments.openItems(entType, entityId).then((res) => {
      if (cancelled) return;
      if (res.error) {
        toast.error(res.error);
        setEntityDialogOpenItems([]);
        return;
      }
      const rows = Array.isArray(res.data) ? res.data : [];
      setEntityDialogOpenItems(rows.map(mapOpenItemRow).filter((x) => x.status !== 'cleared'));
    }).catch((err) => {
      if (!cancelled) {
        console.error('[PAYMENTS] openItems failed:', err);
        setEntityDialogOpenItems([]);
        toast.error(t.paymentsUi.recordFailed);
      }
    }).finally(() => {
      if (!cancelled) setEntityOpenItemsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [showNewDialog, entityId, paymentType, t.paymentsUi.recordFailed]);

  const payableItemsKey = entityPayableItems.map((oi) => oi.id).join('|');
  useEffect(() => {
    if (!entityId || !payableItemsKey) return;
    setSelectedOpenItems(new Set(entityPayableItems.map((oi) => oi.id)));
    setAmount((prev) => {
      if (prev && Number(prev) > 0) return prev;
      return String(Math.round(payableTotal * 100) / 100);
    });
  }, [entityId, payableItemsKey, entityPayableItems, payableTotal]);

  const handleCreate = async () => {
    if (!entityId || !amount || Number(amount) <= 0) {
      toast.error(t.paymentsUi.requiredFields);
      return;
    }

    const entity = entities.find(e => String(e.id) === String(entityId));
    const selected = entityPayableItems.filter(oi => selectedOpenItems.has(oi.id));

    const branchId = currentBranch?.id || user?.branchId || 'branch-main';
    const createdBy = user?.id || user?.email || 'user-admin';

    try {
      await createPayment({
        paymentType,
        entityType: paymentType === 'receipt' ? 'customer' : 'supplier',
        entityId,
        entityName: entity?.name || '',
        paymentMethod,
        amount: Number(amount),
        branchId,
        createdBy,
        reference,
        notes,
        invoiceIds: selected.map(oi => oi.documentId),
      });
      if (paymentType === 'payment') {
        try {
          await api.suppliers.reconcileBalances();
        } catch (e) {
          console.warn('[PAYMENTS] Supplier balance reconcile skipped:', e);
        }
        window.dispatchEvent(new CustomEvent(storage.SUPPLIERS_CHANGED_EVENT, { detail: {} }));
      }
      toast.success(paymentType === 'receipt' ? t.paymentsUi.receiptRecorded : t.paymentsUi.paymentRecorded);
      setShowNewDialog(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || t.paymentsUi.recordFailed);
      console.error('[PAYMENTS] Create failed:', err);
    }
  };

  const openNewDialog = (type: 'receipt' | 'payment', preset?: { entityId?: string; entityName?: string }) => {
    if (type === 'receipt' && !canRecordReceipt) {
      toast.error(t.topNav.toolbar.noPermission);
      return;
    }
    if (type === 'payment' && !canRecordPayment) {
      toast.error(t.topNav.toolbar.noPermission);
      return;
    }
    setPaymentType(type);
    resetForm();
    void (type === 'receipt' ? refreshClients() : refreshSuppliers());
    if (preset?.entityId) {
      setEntityId(String(preset.entityId));
      if (preset.entityName) setEntitySearch(preset.entityName);
    } else if (preset?.entityName) {
      const directory = type === 'receipt' ? clients : suppliers;
      const match = directory.find((e) =>
        e.name.toLowerCase() === preset.entityName!.toLowerCase()
        || String(e.nif || '').toLowerCase() === preset.entityName!.toLowerCase(),
      );
      if (match) {
        setEntityId(String(match.id));
        setEntitySearch(formatEntityOption(match));
      } else {
        setEntitySearch(preset.entityName);
        setEntityPickerOpen(true);
      }
    }
    setShowNewDialog(true);
  };

  useEffect(() => {
    const state = location.state as {
      openReceipt?: boolean;
      openPayment?: boolean;
      entityId?: string;
      entityName?: string;
    } | null;
    if (!state || deepLinkHandled.current) return;
    if (!state.openReceipt && !state.openPayment) return;
    deepLinkHandled.current = true;
    const type = state.openReceipt ? 'receipt' : 'payment';
    openNewDialog(type, {
      entityId: state.entityId,
      entityName: state.entityName,
    });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const totalReceipts = payments.filter(p => p.paymentType === 'receipt').reduce((s, p) => s + p.amount, 0);
  const totalPayments = payments.filter(p => p.paymentType === 'payment').reduce((s, p) => s + p.amount, 0);
  const totalOpenReceivable = openItems
    .filter(oi => oi.entityType === 'customer' && oi.status !== 'cleared')
    .reduce((s, oi) => s + signedOpenItemBalance(oi), 0);
  const totalOpenPayable = openItems
    .filter(oi => oi.entityType === 'supplier' && oi.status !== 'cleared')
    .reduce((s, oi) => s + signedOpenItemBalance(oi), 0);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3 p-4 pb-2">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ArrowDownCircle className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t.paymentsUi.receipts}</p>
                <p className="text-lg font-bold">{totalReceipts.toLocaleString(locale)} Kz</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t.paymentsUi.payments}</p>
                <p className="text-lg font-bold">{totalPayments.toLocaleString(locale)} Kz</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t.dashboardUi.kpis.accountsReceivable}</p>
                <p className="text-lg font-bold">{totalOpenReceivable.toLocaleString(locale)} Kz</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">{t.dashboardUi.kpis.accountsPayable}</p>
                <p className="text-lg font-bold">{totalOpenPayable.toLocaleString(locale)} Kz</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <Button size="sm" className="gap-1" onClick={() => openNewDialog('receipt')} disabled={!canRecordReceipt}>
          <ArrowDownCircle className="w-4 h-4" /> {t.paymentsUi.newReceipt}
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => openNewDialog('payment')} disabled={!canRecordPayment}>
          <ArrowUpCircle className="w-4 h-4" /> {t.paymentsUi.newPayment}
        </Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder={t.paymentsUi.searchPlaceholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 h-8 w-48 text-sm" />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refresh}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as any)} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          <TabsTrigger value="receipts" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2">
            {t.paymentsUi.receipts} ({payments.filter(p => p.paymentType === 'receipt').length})
          </TabsTrigger>
          <TabsTrigger value="payments" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2">
            {t.paymentsUi.payments} ({payments.filter(p => p.paymentType === 'payment').length})
          </TabsTrigger>
          <TabsTrigger value="open-items" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2">
            {t.paymentsUi.openItems} ({openItems.filter(oi => oi.status !== 'cleared').length})
          </TabsTrigger>
        </TabsList>

        {/* Receipts / Payments Table */}
        {(activeTab === 'receipts' || activeTab === 'payments') && (
          <TabsContent value={activeTab} className="flex-1 m-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 border-b sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Nº</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.common.date}</th>
                  <th className="px-3 py-2 text-left font-semibold">{activeTab === 'receipts' ? t.paymentsUi.customer : t.paymentsUi.supplier}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.method}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.paymentsUi.amount}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.reference}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredPayments.map(p => (
                  <tr key={p.id} className="hover:bg-accent/50 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs">{p.paymentNumber}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString(locale)}</td>
                    <td className="px-3 py-2 font-medium">
                      {resolveEntityName(p.entityType, p.entityId, p.entityName)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {p.paymentMethod === 'cash'
                          ? t.paymentsUi.methods.cash
                          : p.paymentMethod === 'card'
                            ? t.paymentsUi.methods.card
                            : p.paymentMethod === 'transfer'
                              ? t.paymentsUi.methods.shortTransfer
                              : p.paymentMethod === 'cheque'
                                ? t.paymentsUi.methods.cheque
                                : p.paymentMethod}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium">{p.amount.toLocaleString(locale)} Kz</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPayments.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t.paymentsUi.noneFound.replace('{kind}', activeTab === 'receipts' ? t.documents.receipt.toLowerCase() : t.documents.payment.toLowerCase())}</p>
              </div>
            )}
          </TabsContent>
        )}

        {/* Open Items */}
        <TabsContent value="open-items" className="flex-1 m-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.party}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.type}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.document}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.common.date}</th>
                <th className="px-3 py-2 text-left font-semibold">{t.paymentsUi.dueDate}</th>
                <th className="px-3 py-2 text-right font-semibold">{t.paymentsUi.original}</th>
                <th className="px-3 py-2 text-right font-semibold">{t.paymentsUi.openAmount}</th>
                <th className="px-3 py-2 text-center font-semibold">{t.paymentsUi.state}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredOpenItems.map(oi => (
                <tr key={oi.id} className="hover:bg-accent/50">
                  <td className="px-3 py-2 font-medium">
                    {resolveEntityName(oi.entityType, oi.entityId, oi.entityName)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={oi.entityType === 'customer' ? 'default' : 'secondary'} className="text-xs">
                      {oi.entityType === 'customer' ? t.paymentsUi.customer : t.paymentsUi.supplier}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{oi.documentNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(oi.documentDate).toLocaleDateString(locale)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{oi.dueDate ? new Date(oi.dueDate).toLocaleDateString(locale) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{oi.originalAmount.toLocaleString(locale)} Kz</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">{formatSignedAmount(oi)} Kz</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={oi.status === 'open' ? 'destructive' : 'outline'} className="text-xs">
                      {oi.status === 'open' ? t.paymentsUi.open : t.documentStatus.partial}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredOpenItems.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.paymentsUi.noneOpenItems}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Payment Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent
          className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {paymentType === 'receipt' ? <ArrowDownCircle className="w-5 h-5 text-green-500" /> : <ArrowUpCircle className="w-5 h-5 text-red-500" />}
              {paymentType === 'receipt' ? t.paymentsUi.newReceiptTitle : t.paymentsUi.newPaymentTitle}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Entity search (name, NIF/code, phone) */}
            <div>
              <Label>{entityLabel}</Label>
              <div className="relative">
                <Input
                  value={entitySearch}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEntitySearch(value);
                    setEntityId('');
                    setEntityPickerOpen(true);
                    setSelectedOpenItems(new Set());
                    setAmount('');
                  }}
                  onFocus={() => setEntityPickerOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setEntityPickerOpen(false), 150);
                  }}
                  placeholder={t.paymentsUi.entitySearchPlaceholder.replace('{entity}', entityLabel.toLowerCase())}
                  className="h-10"
                  autoComplete="off"
                />
                {entityPickerOpen && filteredEntities.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-lg max-h-56 overflow-y-auto">
                    {filteredEntities.map((entity) => (
                      <button
                        key={entity.id}
                        type="button"
                        className={cn(
                          'w-full text-left px-3 py-2.5 text-sm hover:bg-accent/50 flex justify-between gap-3 border-b border-border/40 last:border-0',
                          entityId === String(entity.id) && 'nexor-row-selected',
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectEntity(entity)}
                      >
                        <span className="truncate font-medium">{entity.name}</span>
                        <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                          {entity.nif || '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {entityPickerOpen && filteredEntities.length === 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md px-3 py-2 text-sm text-muted-foreground">
                    {entitySearch.trim()
                      ? t.paymentsUi.noEntityMatch
                      : t.paymentsUi.noEntitiesAvailable.replace('{entity}', entityLabel.toLowerCase())}
                  </div>
                )}
              </div>
            </div>

            {entityId && entityOpenItemsLoading && (
              <p className="text-sm text-muted-foreground">{t.paymentsUi.loadingOpenDocs}</p>
            )}

            {/* Open Items for this entity */}
            {entityId && !entityOpenItemsLoading && entityPayableItems.length > 0 && (
              <div>
                <Label className="mb-2 block">{t.paymentsUi.openDocsToOffset}</Label>
                <div className="border rounded-md max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 w-8"></th>
                        <th className="px-2 py-1.5 text-left">{t.paymentsUi.document}</th>
                        <th className="px-2 py-1.5 text-left">{t.common.date}</th>
                        <th className="px-2 py-1.5 text-right">{t.paymentsUi.openAmount}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {entityPayableItems.map(oi => (
                        <tr key={oi.id} className={cn("cursor-pointer hover:bg-accent/50", selectedOpenItems.has(oi.id) && "nexor-row-selected")}>
                          <td className="px-2 py-1.5">
                            <Checkbox
                              checked={selectedOpenItems.has(oi.id)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedOpenItems);
                                checked ? next.add(oi.id) : next.delete(oi.id);
                                setSelectedOpenItems(next);
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 font-mono">{oi.documentNumber}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{new Date(oi.documentDate).toLocaleDateString(locale)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{formatSignedAmount(oi)} Kz</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedOpenItems.size > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.paymentsUi.totalSelected} <strong>{selectedTotal.toLocaleString(locale)} Kz</strong>
                  </p>
                )}
              </div>
            )}

            {entityId && !entityOpenItemsLoading && entityPayableItems.length === 0 && (
              <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground space-y-2">
                <p>
                  {paymentType === 'receipt' ? t.paymentsUi.noOpenDocsForEntity : t.paymentsUi.noOpenDocsForSupplier}
                </p>
                {paymentType === 'payment' && (
                  <p className="text-xs">{t.paymentsUi.noOpenPayablesPoHint}</p>
                )}
              </div>
            )}

            {/* Payment Details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.paymentsUi.paymentMethod}</Label>
                <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t.paymentsUi.methods.cash}</SelectItem>
                    <SelectItem value="card">{t.paymentsUi.methods.card}</SelectItem>
                    <SelectItem value="transfer">{t.paymentsUi.bankTransfer}</SelectItem>
                    <SelectItem value="cheque">{t.paymentsUi.methods.cheque}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valor (Kz)</Label>
                <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                  onFocus={() => { if (!amount && selectedTotal > 0) setAmount(selectedTotal.toString()); }}
                />
              </div>
            </div>

            <div>
              <Label>{t.paymentsUi.reference} ({t.paymentsUi.optional})</Label>
              <Input value={reference} onChange={e => setReference(e.target.value)} placeholder={t.paymentsUi.optional} />
            </div>

            <div>
              <Label>{t.common.notes}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t.paymentsUi.notesPlaceholder} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>{t.paymentsUi.cancel}</Button>
            <Button onClick={handleCreate}>
              {paymentType === 'receipt' ? t.paymentsUi.registerReceipt : t.paymentsUi.registerPayment}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
