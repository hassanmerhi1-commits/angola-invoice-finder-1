import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth, useProducts, useClients } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import { generateId } from '@/lib/utils';
import { SalesOrder, SalesOrderItem } from '@/lib/salesOrderToDocument';
import { Product, Client } from '@/types/erp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, RefreshCw, CheckCircle, Package, ArrowRight, Pencil, Trash2, Search, XCircle } from 'lucide-react';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';
import { PRODUCTS_CHANGED_EVENT } from '@/lib/storage';

function notifySoftReserveChanged(branchId?: string | null) {
  if (branchId) {
    invalidateInventoryGridCacheForBranches([branchId]);
  }
  window.dispatchEvent(
    new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId: branchId || undefined } }),
  );
}

function applyClientToFields(client: Client) {
  return {
    clientId: client.id,
    customerName: client.name,
    customerNif: client.nif || '',
    customerEmail: client.email || '',
    customerPhone: client.phone || '',
    customerAddress: client.address || '',
  };
}

function generateOrderNumber(branchCode: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Date.now().toString().slice(-4);
  return `SO ${branchCode}/${dateStr}/${seq}`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'confirmed':
    case 'reserved':
    case 'partially_shipped':
    case 'shipped':
      return 'default';
    case 'converted':
      return 'outline';
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function lineTotals(item: SalesOrderItem) {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  const discount = Number(item.discount) || 0;
  const taxRate = Number(item.taxRate ?? 14);
  const subtotal = qty * price * (1 - discount / 100);
  const taxAmount = subtotal * (taxRate / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function orderTotals(items: SalesOrderItem[]) {
  let subtotal = 0;
  let taxAmount = 0;
  for (const item of items) {
    const t = lineTotals(item);
    subtotal += t.subtotal;
    taxAmount += t.taxAmount;
  }
  return { subtotal, taxAmount, total: subtotal + taxAmount, discount: 0 };
}

export default function SalesOrdersPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { currentBranch, apiBranchId } = useBranchScope();
  const { user } = useAuth();
  const branchId = apiBranchId || currentBranch?.id;
  const { products } = useProducts(branchId, { light: true });
  const { clients } = useClients();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; code: string; name: string; isDefault?: boolean }>>([]);
  const [warehouseId, setWarehouseId] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [editItems, setEditItems] = useState<SalesOrderItem[]>([]);
  const [editCustomer, setEditCustomer] = useState('');
  const [editClientId, setEditClientId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editClientPickerOpen, setEditClientPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.salesOrders.list(branchId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setOrders(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!branchId) {
        setWarehouses([]);
        setWarehouseId('');
        return;
      }
      const res = await api.warehouses.list(branchId);
      if (cancelled) return;
      const rows = Array.isArray(res.data) ? res.data : [];
      setWarehouses(rows);
      const def = rows.find((w) => w.isDefault) || rows[0];
      setWarehouseId(def?.id || '');
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  const formatMoney = (value: number) =>
    `${value.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} ${t.common.currency}`;

  const formatDate = (value?: string) =>
    value ? new Date(value).toLocaleDateString(uiLocale) : '—';

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled'),
    [orders],
  );

  const productHits = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((p) => p.isActive !== false)
      .filter((p) =>
        p.name.toLowerCase().includes(term)
        || String(p.sku || '').toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [productSearch, products]);

  const filterClients = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    const active = clients.filter((c) => c.isActive !== false);
    if (!q) return active.slice(0, 12);
    return active
      .filter((c) =>
        c.name.toLowerCase().includes(q)
        || String(c.nif || '').toLowerCase().includes(q)
        || String(c.phone || '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [clients]);

  const createClientHits = useMemo(() => filterClients(customerName), [filterClients, customerName]);
  const editClientHits = useMemo(() => filterClients(editCustomer), [filterClients, editCustomer]);

  const selectCreateClient = (client: Client) => {
    const fields = applyClientToFields(client);
    setSelectedClientId(fields.clientId);
    setCustomerName(fields.customerName);
    setCustomerNif(fields.customerNif);
    setCustomerEmail(fields.customerEmail);
    setCustomerPhone(fields.customerPhone);
    setCustomerAddress(fields.customerAddress);
    setClientPickerOpen(false);
  };

  const selectEditClient = (client: Client) => {
    const fields = applyClientToFields(client);
    setEditClientId(fields.clientId);
    setEditCustomer(fields.customerName);
    setEditing((prev) => (prev ? {
      ...prev,
      ...fields,
    } : prev));
    setEditClientPickerOpen(false);
  };

  const handleCreateDraft = async () => {
    const name = customerName.trim();
    if (!name) {
      toast.error(language === 'pt' ? 'Indique o cliente' : 'Enter customer name');
      return;
    }
    if (!branchId) {
      toast.error(language === 'pt' ? 'Selecione uma filial' : 'Select a branch');
      return;
    }
    setCreating(true);
    try {
      const branchCode = currentBranch?.code || '01';
      const payload: SalesOrder = {
        id: generateId(),
        orderNumber: generateOrderNumber(branchCode),
        branchId,
        branchName: currentBranch?.name || '',
        warehouseId: warehouseId || undefined,
        customerName: name,
        clientId: selectedClientId || '',
        customerNif: customerNif || undefined,
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
        customerAddress: customerAddress || undefined,
        notes: draftNotes.trim() || undefined,
        items: [],
        subtotal: 0,
        taxAmount: 0,
        discount: 0,
        total: 0,
        currency: 'AOA',
        status: 'draft',
        createdBy: user?.id || '',
        createdByName: user?.name || '',
      };
      const res = await api.salesOrders.create(payload);
      if (res.error || !res.data) {
        toast.error(res.error || (language === 'pt' ? 'Falha ao criar encomenda' : 'Failed to create order'));
        return;
      }
      toast.success(language === 'pt' ? 'Encomenda criada — adicione produtos' : 'Order created — add products');
      setCustomerName('');
      setSelectedClientId('');
      setCustomerNif('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setDraftNotes('');
      await loadOrders();
      openEdit(res.data as SalesOrder);
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (order: SalesOrder) => {
    setEditing(order);
    setEditCustomer(order.customerName || '');
    setEditClientId(order.clientId || '');
    setEditNotes(order.notes || '');
    setEditItems(
      (order.items || []).map((it) => ({
        id: it.id || generateId(),
        productId: it.productId,
        productName: it.productName,
        sku: it.sku,
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        discount: Number(it.discount) || 0,
        taxRate: Number(it.taxRate ?? 14),
        reservedQty: it.reservedQty,
      })),
    );
    setProductSearch('');
    setEditClientPickerOpen(false);
    setEditOpen(true);
  };

  const addProduct = (product: Product) => {
    setEditItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: Number(i.quantity) + 1 }
            : i,
        );
      }
      return [
        ...prev,
        {
          id: generateId(),
          productId: product.id,
          productName: product.name,
          sku: product.sku || '',
          quantity: 1,
          unitPrice: Number(product.price) || 0,
          discount: 0,
          taxRate: Number(product.taxRate ?? 14) || 14,
        },
      ];
    });
    setProductSearch('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!['draft', 'confirmed'].includes(editing.status)) {
      toast.error(language === 'pt' ? 'Só rascunho/confirmada pode ser editada' : 'Only draft/confirmed orders can be edited');
      return;
    }
    setSavingEdit(true);
    try {
      const totals = orderTotals(editItems);
      const payload = {
        ...editing,
        customerName: editCustomer.trim() || editing.customerName,
        clientId: editClientId || editing.clientId || '',
        notes: editNotes.trim() || undefined,
        items: editItems.map((it) => {
          const lt = lineTotals(it);
          return {
            ...it,
            subtotal: lt.subtotal,
            taxAmount: lt.taxAmount,
            total: lt.total,
          };
        }),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discount: 0,
        total: totals.total,
      };
      const res = await api.salesOrders.update(payload);
      if (res.error || !res.data) {
        toast.error(res.error || (language === 'pt' ? 'Falha ao guardar' : 'Failed to save'));
        return;
      }
      toast.success(language === 'pt' ? 'Encomenda actualizada' : 'Order updated');
      setEditOpen(false);
      setEditing(null);
      await loadOrders();
    } finally {
      setSavingEdit(false);
    }
  };

  const runAction = async (
    id: string,
    action: 'confirm' | 'reserve' | 'convert' | 'cancel' | 'ship',
  ) => {
    const order = orders.find((o) => o.id === id);
    if (action === 'cancel') {
      if (!window.confirm(language === 'pt' ? 'Cancelar esta encomenda?' : 'Cancel this sales order?')) {
        return;
      }
      const wasReserved = order?.status === 'reserved';
      const res = await api.salesOrders.delete(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(language === 'pt' ? 'Encomenda cancelada' : 'Order cancelled');
      if (wasReserved) notifySoftReserveChanged(order?.branchId || branchId);
      await loadOrders();
      return;
    }
    if (action === 'reserve' && !(order?.items || []).some((i) => i.productId && Number(i.quantity) > 0)) {
      toast.error(language === 'pt' ? 'Adicione produtos antes de reservar' : 'Add products before reserving');
      if (order) openEdit(order);
      return;
    }
    if (action === 'ship') {
      const res = await api.salesOrders.ship(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(language === 'pt' ? 'Expedição registada' : 'Shipment recorded');
      notifySoftReserveChanged(order?.branchId || branchId);
      await loadOrders();
      return;
    }
    if (action === 'convert') {
      if (!order?.clientId) {
        toast.error(
          language === 'pt'
            ? 'Associe um cliente registado antes de converter (necessário para fatura a crédito)'
            : 'Link a registered client before converting (needed for credit invoice)',
        );
        if (order) openEdit(order);
        return;
      }
    }
    const wasReserved = order?.status === 'reserved';
    const fn =
      action === 'confirm'
        ? api.salesOrders.confirm
        : action === 'reserve'
          ? api.salesOrders.reserve
          : api.salesOrders.convert;
    const res = await fn(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (action === 'convert' && res.data?.order) {
      toast.success(
        language === 'pt' ? 'A abrir fatura a partir da encomenda' : 'Opening invoice from sales order',
      );
      navigate('/invoices', { state: { fromSalesOrder: res.data.order } });
      return;
    }
    if (action === 'reserve' || (action === 'confirm' && wasReserved)) {
      notifySoftReserveChanged(order?.branchId || branchId);
    }
    toast.success(
      action === 'confirm'
        ? language === 'pt'
          ? wasReserved
            ? 'Reserva libertada — encomenda confirmada'
            : 'Encomenda confirmada'
          : wasReserved
            ? 'Hold released — order confirmed'
            : 'Order confirmed'
        : language === 'pt'
          ? 'Stock reservado'
          : 'Stock reserved',
    );
    await loadOrders();
  };

  const title = t.nav.salesOrders;
  const editTotals = orderTotals(editItems);
  const canEdit = editing && ['draft', 'confirmed'].includes(editing.status);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Button variant="outline" size="sm" onClick={() => void loadOrders()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {t.common.refresh}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {language === 'pt' ? 'Nova encomenda (rascunho)' : 'New draft order'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px] space-y-1">
            <Label htmlFor="so-customer">{language === 'pt' ? 'Cliente' : 'Customer'}</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="so-customer"
                className="pl-8"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSelectedClientId('');
                  setClientPickerOpen(true);
                }}
                onFocus={() => setClientPickerOpen(true)}
                onBlur={() => window.setTimeout(() => setClientPickerOpen(false), 150)}
                placeholder={language === 'pt' ? 'Pesquisar cliente ou escrever nome…' : 'Search client or type name…'}
                autoComplete="off"
              />
              {clientPickerOpen && createClientHits.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-0.5 border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
                  {createClientHits.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 flex justify-between gap-2 border-b last:border-b-0"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectCreateClient(client)}
                    >
                      <span className="truncate font-medium">{client.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {client.nif || client.phone || '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedClientId && (
              <p className="text-xs text-muted-foreground">
                {language === 'pt' ? 'Cliente registado ligado' : 'Registered client linked'}
              </p>
            )}
          </div>
          <div className="flex-1 min-w-[180px] space-y-1">
            <Label htmlFor="so-notes">{language === 'pt' ? 'Notas' : 'Notes'}</Label>
            <Input
              id="so-notes"
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder={language === 'pt' ? 'Opcional' : 'Optional'}
            />
          </div>
          {warehouses.length > 0 && (
            <div className="min-w-[180px] space-y-1">
              <Label>{language === 'pt' ? 'Armazém' : 'Warehouse'}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="MAIN" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={() => void handleCreateDraft()} disabled={creating}>
            <Plus className="w-4 h-4 mr-2" />
            {language === 'pt' ? 'Criar rascunho' : 'Create draft'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'pt' ? 'N.º' : 'Number'}</TableHead>
                <TableHead>{language === 'pt' ? 'Cliente' : 'Customer'}</TableHead>
                <TableHead>{language === 'pt' ? 'Linhas' : 'Lines'}</TableHead>
                <TableHead>{language === 'pt' ? 'Data' : 'Date'}</TableHead>
                <TableHead className="text-right">{language === 'pt' ? 'Total' : 'Total'}</TableHead>
                <TableHead>{language === 'pt' ? 'Estado' : 'Status'}</TableHead>
                <TableHead className="text-right">{language === 'pt' ? 'Acções' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {language === 'pt' ? 'Sem encomendas' : 'No orders yet'}
                  </TableCell>
                </TableRow>
              ) : (
                activeOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell>{order.items?.length || 0}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-right">{formatMoney(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
                      {order.status === 'reserved' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {(order.items || []).reduce((s, i) => s + (Number(i.reservedQty) || 0), 0)} reserved
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {['draft', 'confirmed'].includes(order.status) && (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(order)}>
                          <Pencil className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Itens' : 'Items'}
                        </Button>
                      )}
                      {order.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runAction(order.id, 'confirm')}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Confirmar' : 'Confirm'}
                        </Button>
                      )}
                      {order.status === 'reserved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          title={language === 'pt' ? 'Liberta a reserva de stock' : 'Releases stock hold'}
                          onClick={() => void runAction(order.id, 'confirm')}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Confirmar (libertar)' : 'Confirm (release)'}
                        </Button>
                      )}
                      {['draft', 'confirmed'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runAction(order.id, 'reserve')}
                        >
                          <Package className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Reservar' : 'Reserve'}
                        </Button>
                      )}
                      {['confirmed', 'reserved', 'partially_shipped'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runAction(order.id, 'ship')}
                        >
                          <Package className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Expedir' : 'Ship'}
                        </Button>
                      )}
                      {['confirmed', 'reserved', 'partially_shipped', 'shipped'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => void runAction(order.id, 'convert')}
                        >
                          <ArrowRight className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Converter' : 'Convert'}
                        </Button>
                      )}
                      {['draft', 'confirmed', 'reserved', 'partially_shipped', 'shipped'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => void runAction(order.id, 'cancel')}
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Cancelar' : 'Cancel'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing?.orderNumber || '—'} — {language === 'pt' ? 'Linhas' : 'Lines'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{language === 'pt' ? 'Cliente' : 'Customer'}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-8"
                  value={editCustomer}
                  onChange={(e) => {
                    setEditCustomer(e.target.value);
                    setEditClientId('');
                    setEditClientPickerOpen(true);
                  }}
                  onFocus={() => canEdit && setEditClientPickerOpen(true)}
                  onBlur={() => window.setTimeout(() => setEditClientPickerOpen(false), 150)}
                  disabled={!canEdit}
                  autoComplete="off"
                />
                {canEdit && editClientPickerOpen && editClientHits.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
                    {editClientHits.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 flex justify-between gap-2 border-b last:border-b-0"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectEditClient(client)}
                      >
                        <span className="truncate font-medium">{client.name}</span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {client.nif || client.phone || '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {editClientId ? (
                <p className="text-xs text-muted-foreground">
                  {language === 'pt' ? 'Cliente registado ligado' : 'Registered client linked'}
                </p>
              ) : (
                <p className="text-xs text-amber-600">
                  {language === 'pt'
                    ? 'Sem cliente registado — necessário para converter em fatura a crédito'
                    : 'No registered client — required to convert to a credit invoice'}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>{language === 'pt' ? 'Notas' : 'Notes'}</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                disabled={!canEdit}
                rows={2}
                placeholder={language === 'pt' ? 'Notas da encomenda…' : 'Order notes…'}
              />
            </div>
            {canEdit && (
              <div className="space-y-2">
                <Label>{language === 'pt' ? 'Adicionar produto' : 'Add product'}</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder={language === 'pt' ? 'Pesquisar nome ou SKU…' : 'Search name or SKU…'}
                  />
                </div>
                {productHits.length > 0 && (
                  <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                    {productHits.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between gap-2"
                        onClick={() => addProduct(p)}
                      >
                        <span>{p.name} <span className="text-muted-foreground">{p.sku}</span></span>
                        <span className="tabular-nums">{formatMoney(Number(p.price) || 0)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === 'pt' ? 'Produto' : 'Product'}</TableHead>
                  <TableHead className="w-24">{language === 'pt' ? 'Qtd' : 'Qty'}</TableHead>
                  <TableHead className="w-28">{language === 'pt' ? 'Preço' : 'Price'}</TableHead>
                  <TableHead className="text-right">{language === 'pt' ? 'Total' : 'Total'}</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {editItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      {language === 'pt' ? 'Sem linhas' : 'No lines'}
                    </TableCell>
                  </TableRow>
                ) : (
                  editItems.map((item) => (
                    <TableRow key={item.id || item.productId}>
                      <TableCell>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-muted-foreground">{item.sku}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0.001}
                          step="any"
                          className="h-8"
                          value={item.quantity}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const quantity = Number(e.target.value) || 0;
                            setEditItems((prev) =>
                              prev.map((i) => (i.id === item.id ? { ...i, quantity } : i)),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          className="h-8"
                          value={item.unitPrice}
                          disabled={!canEdit}
                          onChange={(e) => {
                            const unitPrice = Number(e.target.value) || 0;
                            setEditItems((prev) =>
                              prev.map((i) => (i.id === item.id ? { ...i, unitPrice } : i)),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(lineTotals(item).total)}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setEditItems((prev) => prev.filter((i) => i.id !== item.id))
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="flex justify-end text-sm font-medium">
              {language === 'pt' ? 'Total' : 'Total'}: {formatMoney(editTotals.total)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t.common.cancel}
            </Button>
            {canEdit && (
              <Button onClick={() => void saveEdit()} disabled={savingEdit}>
                {savingEdit ? t.common.saving : t.common.save}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
