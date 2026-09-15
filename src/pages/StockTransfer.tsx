import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useStockTransfers, useAuth, useProducts } from '@/hooks/useERP';
import { useInventoryGrid } from '@/hooks/useInventoryGrid';
import { useBranchScope } from '@/hooks/useBranchScope';
import { canApproveStockTransfer, canReceiveStockTransfer } from '@/lib/branchAccess';
import { Product, StockTransfer as StockTransferType } from '@/types/erp';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightLeft, Plus, Package, Check, X, Truck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFocusId, scrollToNexorRow } from '@/lib/searchFocus';
import { userHasPermission } from '@/lib/permissions';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { TransferLineGrid, type TransferLineItem } from '@/components/inventory/TransferLineGrid';
import { ProductDetailDialog } from '@/components/inventory/ProductDetailDialog';
import { format, type Locale } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api/client';

const transferDialogFullscreen = cn(
  'fixed inset-0 left-0 top-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0',
  'flex-col gap-0 overflow-hidden rounded-none border-0 p-0',
  'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
  'data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0',
);

type TransferItem = TransferLineItem;

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNonNegativeQty(raw: string, fallback: number, max: number): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return fallback;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n)) return fallback;
  return clampInt(n, 0, max);
}

export default function StockTransfer() {
  const { t, language } = useTranslation();
  const location = useLocation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { branches, currentBranch, scopeId, canSwitchBranch, userBranch } = useBranchScope();
  // Load ALL transfers (not branch-filtered) so we can see transfers between any branches
  const { transfers, createTransfer, approveTransfer, receiveTransfer, cancelTransfer } = useStockTransfers();
  const { toast } = useToast();
  const canTransfer = !!user && userHasPermission(user.role, user.permissionOverrides, 'inventory_transfer');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [transferLineSeed, setTransferLineSeed] = useState<Product | null>(null);
  const [createdOverlay, setCreatedOverlay] = useState<Product[]>([]);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransferType | null>(null);
  const [transferTab, setTransferTab] = useState('pending');
  const [fromBranchId, setFromBranchId] = useState(currentBranch?.id || '');
  const [toBranchId, setToBranchId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [fromWarehouses, setFromWarehouses] = useState<Array<{ id: string; code: string; name: string; isDefault?: boolean }>>([]);
  const [toWarehouses, setToWarehouses] = useState<Array<{ id: string; code: string; name: string; isDefault?: boolean }>>([]);
  const [notes, setNotes] = useState('');
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [receivedQtyDrafts, setReceivedQtyDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (currentBranch?.id) setFromBranchId(currentBranch.id);
  }, [scopeId, currentBranch?.id]);

  useEffect(() => {
    const onAll = () => {
      setDialogOpen(false);
      setReceiveDialogOpen(false);
      setSelectedTransfer(null);
    };
    window.addEventListener(NEXOR_TOOLBAR.ALL, onAll);
    return () =>     window.removeEventListener(NEXOR_TOOLBAR.ALL, onAll);
  }, []);

  const searchFocusKeyRef = useRef('');
  useEffect(() => {
    const transferId = readFocusId(location, 'transferId', 'stockTransfer', 'transferId');
    if (!transferId) return;
    const hit = transfers.find((t) => t.id === transferId);
    if (!hit) return;
    if (searchFocusKeyRef.current === transferId) {
      scrollToNexorRow(hit.id);
      return;
    }
    searchFocusKeyRef.current = transferId;
    if (hit.status === 'in_transit') setTransferTab('transit');
    else if (hit.status === 'received' || hit.status === 'cancelled') setTransferTab('completed');
    else setTransferTab('pending');
    setSelectedTransfer(hit);
    scrollToNexorRow(hit.id);
  }, [transfers, location.search, location.hash, location.state]);

  useEffect(() => {
    if (currentBranch?.id) setFromBranchId(currentBranch.id);
  }, [scopeId, currentBranch?.id]);

  // Load products from the selected SOURCE branch — use the same ledger-accurate
  // inventory-grid source as the Inventory page (not the "light" products list, whose
  // stock is the raw products.stock column and can drift from the real SKU ledger,
  // which made in-stock products silently vanish from the transfer picker or cap the
  // qty below what Inventory shows).
  const {
    rows: sourceProducts,
    refresh: refreshSourceProducts,
  } = useInventoryGrid({
    branchId: fromBranchId || undefined,
    consolidated: false,
    enabled: !!fromBranchId,
  });

  // A recent Adjust In / Purchase can land just before this list's cache refreshes —
  // force a live re-fetch whenever the transfer dialog opens so "Disponível" reflects
  // the real current stock instead of whatever was cached before the write.
  useEffect(() => {
    if (dialogOpen && fromBranchId) {
      void refreshSourceProducts();
    }
  }, [dialogOpen, fromBranchId, refreshSourceProducts]);

  const { addProduct, products: createCatalog } = useProducts(fromBranchId || undefined, {
    enabled: showCreateProduct,
    light: true,
  });

  const transferCatalog = useMemo(() => {
    const extra = createdOverlay.filter((p) => !sourceProducts.some((s) => s.id === p.id));
    return extra.length ? [...sourceProducts, ...extra] : sourceProducts;
  }, [sourceProducts, createdOverlay]);

  const sourceStockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of transferCatalog) map.set(p.id, Number(p.stock) || 0);
    return map;
  }, [transferCatalog]);

  const pendingTransfers = transfers.filter(t => t.status === 'pending');
  const inTransitTransfers = transfers.filter(t => t.status === 'in_transit');
  const completedTransfers = transfers.filter(t => t.status === 'received' || t.status === 'cancelled');

  const resetForm = () => {
    setFromBranchId(currentBranch?.id || '');
    setToBranchId('');
    setFromWarehouseId('');
    setToWarehouseId('');
    setNotes('');
    setTransferItems([]);
  };

  const handleTransferLinesChange = useCallback((items: TransferItem[]) => {
    setTransferItems((prev) => {
      if (
        prev.length === items.length &&
        prev.every((item, i) =>
          item.productId === items[i].productId
          && item.quantity === items[i].quantity
          && item.availableStock === items[i].availableStock,
        )
      ) {
        return prev;
      }
      return items;
    });
  }, []);

  // Clear items when source branch changes
  const handleFromBranchChange = (branchId: string) => {
    setFromBranchId(branchId);
    setFromWarehouseId('');
    setTransferItems([]);
    setCreatedOverlay([]);
    setTransferLineSeed(null);
    // Reset destination if same as new source
    if (toBranchId === branchId) {
      setToBranchId('');
      setToWarehouseId('');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fromBranchId) {
        setFromWarehouses([]);
        setFromWarehouseId('');
        return;
      }
      const res = await api.warehouses.list(fromBranchId);
      if (cancelled) return;
      const rows = Array.isArray(res.data) ? res.data : [];
      setFromWarehouses(rows);
      const def = rows.find((w: any) => w.isDefault) || rows[0];
      setFromWarehouseId(def?.id || '');
    })();
    return () => { cancelled = true; };
  }, [fromBranchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!toBranchId) {
        setToWarehouses([]);
        setToWarehouseId('');
        return;
      }
      const res = await api.warehouses.list(toBranchId);
      if (cancelled) return;
      const rows = Array.isArray(res.data) ? res.data : [];
      setToWarehouses(rows);
      const def = rows.find((w: any) => w.isDefault) || rows[0];
      setToWarehouseId(def?.id || '');
    })();
    return () => { cancelled = true; };
  }, [toBranchId]);

  const handleCreateTransfer = async () => {
    if (!fromBranchId || !toBranchId || transferItems.length === 0 || !user) {
      toast({
        title: t.common.error,
        description: t.stockTransferUi.fillRequiredFields,
        variant: 'destructive',
      });
      return;
    }

    try {
      const itemsToSend = transferItems;
      await createTransfer(
        fromBranchId,
        toBranchId,
        itemsToSend.map(item => ({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
        })),
        user.id,
        notes,
        { fromWarehouseId: fromWarehouseId || undefined, toWarehouseId: toWarehouseId || undefined },
      );

      toast({
        title: t.stockTransferUi.transferCreatedTitle,
        description: t.stockTransferUi.transferCreatedDesc,
      });

      setDialogOpen(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error?.message || t.stockTransferUi.createTransferFailed,
        variant: 'destructive',
      });
    }
  };

  const handleApprove = async (transfer: StockTransferType) => {
    if (!user) return;
    try {
      await approveTransfer(transfer.id, user.id);
      toast({
        title: t.stockTransferUi.transferApprovedTitle,
        description: t.stockTransferUi.transferApprovedDesc,
      });
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error?.message || t.stockTransferUi.approveTransferFailed,
        variant: 'destructive',
      });
    }
  };

  const handleOpenReceiveDialog = (transfer: StockTransferType) => {
    setSelectedTransfer(transfer);
    const quantities: Record<string, number> = {};
    transfer.items.forEach(item => {
      quantities[item.productId] = item.quantity;
    });
    setReceivedQuantities(quantities);
    setReceivedQtyDrafts({});
    setReceiveDialogOpen(true);
  };

  const handleReceive = async () => {
    if (!selectedTransfer || !user) return;
    const committed: Record<string, number> = { ...receivedQuantities };
    for (const item of selectedTransfer.items) {
      const raw = receivedQtyDrafts[item.productId];
      if (raw !== undefined) {
        committed[item.productId] = parseNonNegativeQty(
          raw,
          receivedQuantities[item.productId] ?? item.quantity,
          item.quantity,
        );
      }
    }
    try {
      await receiveTransfer(selectedTransfer.id, user.id, committed);
      toast({
        title: t.stockTransferUi.transferReceivedTitle,
        description: t.stockTransferUi.transferReceivedDesc,
      });
      setReceiveDialogOpen(false);
      setSelectedTransfer(null);
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error?.message || t.stockTransferUi.receiveTransferFailed,
        variant: 'destructive',
      });
    }
  };

  const handleCancel = async (transfer: StockTransferType) => {
    if (!user) return;
    try {
      await cancelTransfer(transfer.id, user.id);
      toast({
        title: t.stockTransferUi.transferCancelledTitle,
        description: t.stockTransferUi.transferCancelledDesc,
      });
    } catch (error: any) {
      toast({
        title: t.common.error,
        description: error?.message || t.stockTransferUi.cancelTransferFailed,
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: StockTransferType['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />{t.stockTransferUi.statusPending}</Badge>;
      case 'in_transit':
        return <Badge variant="default"><Truck className="w-3 h-3 mr-1" />{t.stockTransferUi.statusInTransit}</Badge>;
      case 'received':
        return <Badge className="bg-green-500"><Check className="w-3 h-3 mr-1" />{t.stockTransferUi.statusReceived}</Badge>;
      case 'cancelled':
        return <Badge variant="destructive"><X className="w-3 h-3 mr-1" />{t.stockTransferUi.statusCancelled}</Badge>;
    }
  };

  const destinationBranches = branches.filter(b => b.id !== fromBranchId);
  const dateLocale = language === 'pt' ? pt : enUS;

  const branchTransferActions = {
    scopeId,
    canSwitchBranch,
    userBranchId: userBranch?.id || user?.branchId,
    branches,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.stockTransferUi.title}</h1>
          <p className="text-muted-foreground">{t.stockTransferUi.subtitle}</p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={!canTransfer}
          title={!canTransfer ? t.topNav.toolbar.noPermission : undefined}
        >
          <Plus className="w-4 h-4 mr-2" />
          {t.stockTransferUi.newTransfer}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.stockTransferUi.pending}</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingTransfers.length}</div>
            <p className="text-xs text-muted-foreground">{t.stockTransferUi.awaitingApproval}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.stockTransferUi.inTransit}</CardTitle>
            <Truck className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inTransitTransfers.length}</div>
            <p className="text-xs text-muted-foreground">{t.stockTransferUi.onTheWay}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.stockTransferUi.totalTransferred}</CardTitle>
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedTransfers.filter(t => t.status === 'received').length}</div>
            <p className="text-xs text-muted-foreground">{t.stockTransferUi.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t.stockTransferUi.lowStockProducts}</CardTitle>
            <Package className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sourceProducts.filter(p => p.stock <= 10).length}</div>
            <p className="text-xs text-muted-foreground">{t.stockTransferUi.lowStock}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transfers Tabs */}
      <Tabs value={transferTab} onValueChange={setTransferTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">
            {t.stockTransferUi.pending} ({pendingTransfers.length})
          </TabsTrigger>
          <TabsTrigger value="transit">
            {t.stockTransferUi.inTransit} ({inTransitTransfers.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            {t.stockTransferUi.completedF} ({completedTransfers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle>{t.stockTransferUi.pendingTransfersTitle}</CardTitle>
              <CardDescription>{t.stockTransferUi.pendingTransfersDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <TransferTable
                transfers={pendingTransfers}
                selectedId={selectedTransfer?.id}
                getStatusBadge={getStatusBadge}
                onApprove={canTransfer ? handleApprove : undefined}
                onCancel={canTransfer ? handleCancel : undefined}
                branchTransferActions={branchTransferActions}
                t={t}
                dateLocale={dateLocale}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transit">
          <Card>
            <CardHeader>
              <CardTitle>{t.stockTransferUi.inTransitTitle}</CardTitle>
              <CardDescription>{t.stockTransferUi.inTransitDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <TransferTable
                transfers={inTransitTransfers}
                selectedId={selectedTransfer?.id}
                getStatusBadge={getStatusBadge}
                onReceive={canTransfer ? handleOpenReceiveDialog : undefined}
                branchTransferActions={branchTransferActions}
                t={t}
                dateLocale={dateLocale}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed">
          <Card>
            <CardHeader>
              <CardTitle>{t.stockTransferUi.completedTransfersTitle}</CardTitle>
              <CardDescription>{t.stockTransferUi.completedTransfersDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <TransferTable
                transfers={completedTransfers}
                selectedId={selectedTransfer?.id}
                getStatusBadge={getStatusBadge}
                branchTransferActions={branchTransferActions}
                t={t}
                dateLocale={dateLocale}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Transfer Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            resetForm();
            setCreatedOverlay([]);
            setTransferLineSeed(null);
            setShowCreateProduct(false);
          }
        }}
      >
        <DialogContent className={cn(transferDialogFullscreen, '[&>button]:hidden')}>
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle>{t.stockTransferUi.newTransferTitle}</DialogTitle>
                <DialogDescription>
                  {t.stockTransferUi.newTransferDesc}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
                aria-label={t.common.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 sm:px-6">
            <div className="grid shrink-0 grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.stockTransferUi.fromLabel}</Label>
                <Select value={fromBranchId} onValueChange={handleFromBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.stockTransferUi.selectSourceBranch} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name} {branch.isMain && `(${t.branchUi.headOffice})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.stockTransferUi.toLabel}</Label>
                <Select value={toBranchId} onValueChange={setToBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.stockTransferUi.selectDestinationBranch} />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationBranches.map(branch => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name} {branch.isMain && `(${t.branchUi.headOffice})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.stockTransferUi.sourceWarehouseLabel}</Label>
                <Select
                  value={fromWarehouseId}
                  onValueChange={setFromWarehouseId}
                  disabled={!fromBranchId || fromWarehouses.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="MAIN" />
                  </SelectTrigger>
                  <SelectContent>
                    {fromWarehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.stockTransferUi.destinationWarehouseLabel}</Label>
                <Select
                  value={toWarehouseId}
                  onValueChange={setToWarehouseId}
                  disabled={!toBranchId || toWarehouses.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="MAIN" />
                  </SelectTrigger>
                  <SelectContent>
                    {toWarehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <TransferLineGrid
              key={`${dialogOpen}-${fromBranchId}`}
              products={transferCatalog}
              branchId={fromBranchId}
              stockByProductId={sourceStockByProductId}
              enabled={!!fromBranchId}
              onItemsChange={handleTransferLinesChange}
              autoFocus={dialogOpen}
              onAddProduct={() => setShowCreateProduct(true)}
              seedProduct={transferLineSeed}
              onSeedConsumed={() => setTransferLineSeed(null)}
            />

            <div className="shrink-0 space-y-2">
              <Label>{t.stockTransferUi.notesLabel}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.stockTransferUi.notesPlaceholder}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleCreateTransfer} disabled={transferItems.length === 0 || !toBranchId || !fromBranchId}>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              {t.stockTransferUi.createTransfer}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showCreateProduct ? (
        <ProductDetailDialog
          open
          onOpenChange={setShowCreateProduct}
          product={null}
          copyCatalog={createCatalog.length > 0 ? createCatalog : transferCatalog}
          catalogProducts={createCatalog.length > 0 ? createCatalog : transferCatalog}
          scopeBranchId={fromBranchId || null}
          onSave={async (product) => {
            const saved = await addProduct(
              {
                ...product,
                branchId: fromBranchId || product.branchId,
              },
              { skipListRefresh: true, lightweightChangedEvent: true },
            );
            setCreatedOverlay((prev) => [...prev.filter((p) => p.id !== saved.id), saved]);
            setTransferLineSeed(saved);
            void refreshSourceProducts();
            toast({
              title: t.productFormUi.productCreated,
              description: t.productFormUi.savedDesc
                .replace('{name}', saved.name)
                .replace('{action}', t.productFormUi.actionCreated),
            });
          }}
        />
      ) : null}

      {/* Receive Dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent className={cn(transferDialogFullscreen, '[&>button]:hidden')}>
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle>{t.stockTransferUi.receiveTransferTitle}</DialogTitle>
                <DialogDescription>
                  {t.stockTransferUi.receiveTransferDesc}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setReceiveDialogOpen(false)}
                aria-label={t.common.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 py-3 sm:px-6">
            {selectedTransfer && (
              <div className="border rounded-lg overflow-auto max-h-[min(50vh,400px)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.stockTransferUi.colProduct}</TableHead>
                      <TableHead>{t.stockTransferUi.colSku}</TableHead>
                      <TableHead>{t.stockTransferUi.colSent}</TableHead>
                      <TableHead>{t.stockTransferUi.colReceived}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedTransfer.items.map(item => (
                      <TableRow key={item.productId}>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>
                          <Input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={
                              receivedQtyDrafts[item.productId]
                              ?? String(receivedQuantities[item.productId] ?? item.quantity)
                            }
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, '');
                              setReceivedQtyDrafts((prev) => ({ ...prev, [item.productId]: raw }));
                            }}
                            onBlur={() => {
                              const raw = receivedQtyDrafts[item.productId];
                              if (raw === undefined) return;
                              setReceivedQuantities((prev) => ({
                                ...prev,
                                [item.productId]: parseNonNegativeQty(
                                  raw,
                                  prev[item.productId] ?? item.quantity,
                                  item.quantity,
                                ),
                              }));
                              setReceivedQtyDrafts((prev) => {
                                const next = { ...prev };
                                delete next[item.productId];
                                return next;
                              });
                            }}
                            className="w-24"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleReceive}>
              <Check className="w-4 h-4 mr-2" />
              {t.stockTransferUi.confirmReceiving}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Transfer Table Component
function TransferTable({
  transfers,
  selectedId,
  getStatusBadge,
  onApprove,
  onReceive,
  onCancel,
  branchTransferActions,
  t,
  dateLocale,
}: {
  transfers: StockTransferType[];
  selectedId?: string;
  getStatusBadge: (status: StockTransferType['status']) => React.ReactNode;
  onApprove?: (transfer: StockTransferType) => void;
  onReceive?: (transfer: StockTransferType) => void;
  onCancel?: (transfer: StockTransferType) => void;
  branchTransferActions: {
    scopeId?: string;
    canSwitchBranch?: boolean;
    userBranchId?: string;
    branches?: { id: string; name?: string; code?: string; isMain?: boolean }[];
  };
  t: ReturnType<typeof useTranslation>['t'];
  dateLocale: Locale;
}) {
  if (transfers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t.stockTransferUi.noTransfersFound}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.stockTransferUi.colNumber}</TableHead>
          <TableHead>{t.stockTransferUi.colOrigin}</TableHead>
          <TableHead>{t.stockTransferUi.colDestination}</TableHead>
          <TableHead>{t.stockTransferUi.colItems}</TableHead>
          <TableHead>{t.stockTransferUi.colDate}</TableHead>
          <TableHead>{t.stockTransferUi.colStatus}</TableHead>
          <TableHead>{t.stockTransferUi.colActions}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transfers.map(transfer => (
          <TableRow
            key={transfer.id}
            data-nexor-id={transfer.id}
            className={cn(selectedId === transfer.id && 'nexor-row-selected')}
          >
            <TableCell className="font-medium">{transfer.transferNumber}</TableCell>
            <TableCell>{transfer.fromBranchName}</TableCell>
            <TableCell>{transfer.toBranchName}</TableCell>
            <TableCell>{transfer.items.length} {t.stockTransferUi.itemsCountSuffix}</TableCell>
            <TableCell>
              {format(new Date(transfer.requestedAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}
            </TableCell>
            <TableCell>{getStatusBadge(transfer.status)}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                {canApproveStockTransfer(transfer, branchTransferActions) && onApprove && (
                  <Button size="sm" variant="outline" onClick={() => onApprove(transfer)}>
                    <Check className="w-4 h-4 mr-1" />
                    {t.stockTransferUi.approve}
                  </Button>
                )}
                {canReceiveStockTransfer(transfer, branchTransferActions) && onReceive && (
                  <Button size="sm" variant="outline" onClick={() => onReceive(transfer)}>
                    <Package className="w-4 h-4 mr-1" />
                    {t.stockTransferUi.confirmReceipt}
                  </Button>
                )}
                {transfer.status === 'pending' && onCancel && (
                  <Button size="sm" variant="ghost" onClick={() => onCancel(transfer)}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
