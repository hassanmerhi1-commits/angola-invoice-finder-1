import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
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
  return {
    id: oi.id,
    entityType: oi.entity_type || oi.entityType,
    entityId: oi.entity_id || oi.entityId,
    documentType: oi.document_type || oi.documentType,
    documentId: oi.document_id || oi.documentId,
    documentNumber: oi.document_number || oi.documentNumber,
    documentDate: oi.document_date || oi.documentDate,
    dueDate: oi.due_date || oi.dueDate,
    originalAmount: parseFloat(oi.original_amount ?? oi.originalAmount ?? 0),
    remainingAmount: parseFloat(oi.remaining_amount ?? oi.remainingAmount ?? 0),
    isDebit: oi.is_debit ?? oi.isDebit,
    status: oi.status,
    currency: oi.currency || 'AOA',
    branchId: oi.branch_id || oi.branchId,
    createdAt: oi.created_at || oi.createdAt,
    clearedAt: oi.cleared_at || oi.clearedAt,
  };
}

function usePaymentsData(branchId?: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
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
        setPayments(paymentsRes.data.map(mapPaymentRow));
      }
      if (openRes.data) {
        setOpenItems(openRes.data.map(mapOpenItemRow));
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

  const loadOpenItems = useCallback(async (entityType: string, entityId: string) => {
    const res = await api.payments.openItems(entityType, entityId);
    if (res.data) {
      const scoped = res.data.map(mapOpenItemRow);
      setOpenItems((prev) => {
        const others = prev.filter((oi) => !(oi.entityType === entityType && oi.entityId === entityId));
        return [...others, ...scoped];
      });
    }
  }, []);

  return { payments, openItems, loading, refresh, createPayment, loadOpenItems };
}

export default function Payments() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { currentBranch } = useBranchContext();
  const { apiBranchId } = useBranchScope();
  const { clients } = useClients();
  const { suppliers } = useSuppliers();
  const { payments, openItems, loading, refresh, createPayment, loadOpenItems } = usePaymentsData(apiBranchId);
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const [activeTab, setActiveTab] = useState<'receipts' | 'payments' | 'open-items'>('receipts');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [paymentType, setPaymentType] = useState<'receipt' | 'payment'>('receipt');

  // New payment form
  const [entityId, setEntityId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'cheque'>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedOpenItems, setSelectedOpenItems] = useState<Set<string>>(new Set());

  const entities = paymentType === 'receipt' ? clients : suppliers;
  const entityLabel = paymentType === 'receipt' ? t.paymentsUi.customer : t.paymentsUi.supplier;

  const entityOpenItems = useMemo(() => {
    if (!entityId) return [];
    const entType = paymentType === 'receipt' ? 'customer' : 'supplier';
    return openItems.filter(oi => oi.entityType === entType && oi.entityId === entityId && oi.status !== 'cleared');
  }, [entityId, paymentType, openItems]);

  /** Invoices / payables to settle (exclude payment lines and supplier credits). */
  const entityPayableItems = useMemo(() => {
    return entityOpenItems.filter((oi) => isOpenItemDebit(oi.isDebit));
  }, [entityOpenItems]);

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
    return payments
      .filter(p => activeTab === 'open-items' || p.paymentType === typeFilter)
      .filter(p => !searchTerm || p.entityName?.toLowerCase().includes(searchTerm.toLowerCase()) || p.paymentNumber.includes(searchTerm));
  }, [payments, activeTab, searchTerm]);

  const resetForm = () => {
    setEntityId('');
    setPaymentMethod('cash');
    setAmount('');
    setReference('');
    setNotes('');
    setSelectedOpenItems(new Set());
  };

  const handleEntityChange = useCallback((id: string) => {
    setEntityId(id);
    setSelectedOpenItems(new Set());
    setAmount('');
    if (id) {
      const entType = paymentType === 'receipt' ? 'customer' : 'supplier';
      loadOpenItems(entType, id);
    }
  }, [paymentType, loadOpenItems]);

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

    const entity = entities.find(e => e.id === entityId);
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

  const openNewDialog = (type: 'receipt' | 'payment') => {
    setPaymentType(type);
    resetForm();
    setShowNewDialog(true);
  };

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
        <Button size="sm" className="gap-1" onClick={() => openNewDialog('receipt')}>
          <ArrowDownCircle className="w-4 h-4" /> {t.paymentsUi.newReceipt}
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => openNewDialog('payment')}>
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
                    <td className="px-3 py-2">{p.entityName}</td>
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
              {openItems.filter(oi => oi.status !== 'cleared').map(oi => (
                <tr key={oi.id} className="hover:bg-accent/50">
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
          {openItems.filter(oi => oi.status !== 'cleared').length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t.paymentsUi.noneOpenItems}</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Payment Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {paymentType === 'receipt' ? <ArrowDownCircle className="w-5 h-5 text-green-500" /> : <ArrowUpCircle className="w-5 h-5 text-red-500" />}
              {paymentType === 'receipt' ? t.paymentsUi.newReceiptTitle : t.paymentsUi.newPaymentTitle}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Entity Select */}
            <div>
              <Label>{entityLabel}</Label>
              <Select value={entityId} onValueChange={handleEntityChange}>
                <SelectTrigger><SelectValue placeholder={`Seleccionar ${entityLabel.toLowerCase()}...`} /></SelectTrigger>
                <SelectContent>
                  {entities.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.name} — {e.nif}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Open Items for this entity */}
            {entityId && entityPayableItems.length > 0 && (
              <div>
                <Label className="mb-2 block">{t.paymentsUi.openDocsToOffset}</Label>
                <div className="border rounded-md max-h-48 overflow-y-auto">
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
                        <tr key={oi.id} className={cn("cursor-pointer hover:bg-accent/50", selectedOpenItems.has(oi.id) && "bg-primary/10")}>
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
