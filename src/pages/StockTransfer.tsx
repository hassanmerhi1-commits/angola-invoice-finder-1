import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useProducts, useStockTransfers, useAuth } from '@/hooks/useERP';
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
import { ArrowRightLeft, Plus, Package, Check, X, Truck, Clock, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const transferDialogFullscreen = cn(
  'fixed inset-0 left-0 top-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0',
  'flex-col gap-0 overflow-hidden rounded-none border-0 p-0',
  'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
  'data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0',
);
import {
  filterProductsForSearch,
  sortProductSearchResults,
  PRODUCT_LINE_SUGGESTION_LIMIT,
} from '@/components/inventory/productLineSearch';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

interface TransferItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  availableStock: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveQty(raw: string, fallback: number, max: number): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return fallback;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n)) return fallback;
  return clampInt(n, 1, max);
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
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { branches, currentBranch, scopeId, canSwitchBranch, userBranch } = useBranchScope();
  // Load ALL transfers (not branch-filtered) so we can see transfers between any branches
  const { transfers, createTransfer, approveTransfer, receiveTransfer, cancelTransfer } = useStockTransfers();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransferType | null>(null);
  const [fromBranchId, setFromBranchId] = useState(currentBranch?.id || '');
  const [toBranchId, setToBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [transferQtyDrafts, setTransferQtyDrafts] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState('');
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [receivedQtyDrafts, setReceivedQtyDrafts] = useState<Record<string, string>>({});

  // Load products from the selected SOURCE branch
  const { products: sourceProducts } = useProducts(fromBranchId || undefined);

  const pendingTransfers = transfers.filter(t => t.status === 'pending');
  const inTransitTransfers = transfers.filter(t => t.status === 'in_transit');
  const completedTransfers = transfers.filter(t => t.status === 'received' || t.status === 'cancelled');

  const resetForm = () => {
    setFromBranchId(currentBranch?.id || '');
    setToBranchId('');
    setNotes('');
    setTransferItems([]);
    setTransferQtyDrafts({});
    setProductSearch('');
  };

  const usedProductIds = useMemo(
    () => new Set(transferItems.map((item) => item.productId)),
    [transferItems],
  );

  const searchableSourceProducts = useMemo(
    () => sourceProducts.filter((p) => p.isActive !== false && (p.stock ?? 0) > 0),
    [sourceProducts],
  );

  const productSearchResults = useMemo(() => {
    const term = productSearch.trim();
    if (!term || !fromBranchId) return [];
    return filterProductsForSearch(
      searchableSourceProducts,
      term,
      usedProductIds,
      fromBranchId,
    )
      .sort((a, b) => sortProductSearchResults(a, b, term, fromBranchId))
      .slice(0, PRODUCT_LINE_SUGGESTION_LIMIT);
  }, [productSearch, fromBranchId, searchableSourceProducts, usedProductIds]);

  const commitTransferItems = (items: TransferItem[], drafts: Record<string, string>): TransferItem[] =>
    items.map((item) => {
      const raw = drafts[item.productId];
      if (raw === undefined) return item;
      return {
        ...item,
        quantity: parsePositiveQty(raw, item.quantity, item.availableStock),
      };
    });

  const handleAddProduct = (product: Product) => {
    if (transferItems.find(item => item.productId === product.id)) {
      toast({
        title: t.stockTransferUi.productAlreadyAddedTitle,
        description: t.stockTransferUi.productAlreadyInTransferList,
        variant: 'destructive',
      });
      return;
    }

    setTransferItems([
      ...transferItems,
      {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: 1,
        availableStock: product.stock,
      },
    ]);
  };

  // Clear items when source branch changes
  const handleFromBranchChange = (branchId: string) => {
    setFromBranchId(branchId);
    setTransferItems([]);
    setTransferQtyDrafts({});
    setProductSearch('');
    // Reset destination if same as new source
    if (toBranchId === branchId) setToBranchId('');
  };

  const updateItemQuantity = (productId: string, quantity: number) => {
    setTransferItems(items =>
      items.map(item =>
        item.productId === productId
          ? { ...item, quantity: Math.min(quantity, item.availableStock) }
          : item
      )
    );
  };

  const removeItem = (productId: string) => {
    setTransferItems(items => items.filter(item => item.productId !== productId));
    setTransferQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

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
      const itemsToSend = commitTransferItems(transferItems, transferQtyDrafts);
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
        notes
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

  const branchTransferActions = {
    scopeId,
    canSwitchBranch,
    userBranchId: userBranch?.id || user?.branchId,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.stockTransferUi.title}</h1>
          <p className="text-muted-foreground">{t.stockTransferUi.subtitle}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
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
      <Tabs defaultValue="pending" className="space-y-4">
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
                getStatusBadge={getStatusBadge}
                onApprove={handleApprove}
                onCancel={handleCancel}
                branchTransferActions={branchTransferActions}
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
                getStatusBadge={getStatusBadge}
                onReceive={handleOpenReceiveDialog}
                branchTransferActions={branchTransferActions}
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
                getStatusBadge={getStatusBadge}
                branchTransferActions={branchTransferActions}
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
          if (!open) resetForm();
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
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 py-3 sm:px-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>De (Origem):</Label>
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
                <Label>Para (Destino):</Label>
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
            </div>

            <div className="space-y-2">
              <Label>
                {t.stockTransferUi.selectProduct}
                {fromBranchId
                  ? ` — ${branches.find((b) => b.id === fromBranchId)?.name || ''}`
                  : ''}
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && productSearchResults[0]) {
                      e.preventDefault();
                      handleAddProduct(productSearchResults[0]);
                      setProductSearch('');
                    }
                  }}
                  placeholder={
                    fromBranchId
                      ? t.stockTransferUi.searchProductPlaceholder
                      : t.stockTransferUi.selectSourceFirst
                  }
                  disabled={!fromBranchId}
                  className="pl-10"
                  autoComplete="off"
                />
              </div>
              {fromBranchId && productSearch.trim() && (
                <ScrollArea className="h-52 border rounded-md bg-background">
                  {productSearchResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-3">
                      {t.stockTransferUi.noSearchResults}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {productSearchResults.map((product) => (
                        <li key={product.id}>
                          <button
                            type="button"
                            className={cn(
                              'w-full text-left px-3 py-2 text-sm hover:bg-muted/80 transition-colors',
                              'flex flex-wrap items-baseline gap-x-2 gap-y-0.5',
                            )}
                            onClick={() => {
                              handleAddProduct(product);
                              setProductSearch('');
                            }}
                          >
                            <span className="font-mono font-semibold">{product.sku}</span>
                            <span className="text-muted-foreground">—</span>
                            <span className="flex-1 min-w-0">{product.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                              {t.stockTransferUi.stockAvailable.replace(
                                '{stock}',
                                String(product.stock ?? 0),
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              )}
            </div>

            {transferItems.length > 0 && (
              <div className="border rounded-lg max-h-[min(40vh,320px)] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Disponível</TableHead>
                      <TableHead>Quantidade</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transferItems.map(item => (
                      <TableRow key={item.productId}>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell>{item.sku}</TableCell>
                        <TableCell>{item.availableStock}</TableCell>
                        <TableCell>
                          <Input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={transferQtyDrafts[item.productId] ?? String(item.quantity)}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, '');
                              setTransferQtyDrafts((prev) => ({ ...prev, [item.productId]: raw }));
                            }}
                            onBlur={() => {
                              const raw = transferQtyDrafts[item.productId];
                              if (raw === undefined) return;
                              updateItemQuantity(
                                item.productId,
                                parsePositiveQty(raw, item.quantity, item.availableStock),
                              );
                              setTransferQtyDrafts((prev) => {
                                const next = { ...prev };
                                delete next[item.productId];
                                return next;
                              });
                            }}
                            className="w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => removeItem(item.productId)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="space-y-2">
              <Label>Observações:</Label>
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
                      <TableHead>Produto</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Enviado</TableHead>
                      <TableHead>Recebido</TableHead>
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
  getStatusBadge,
  onApprove,
  onReceive,
  onCancel,
  branchTransferActions,
}: {
  transfers: StockTransferType[];
  getStatusBadge: (status: StockTransferType['status']) => React.ReactNode;
  onApprove?: (transfer: StockTransferType) => void;
  onReceive?: (transfer: StockTransferType) => void;
  onCancel?: (transfer: StockTransferType) => void;
  branchTransferActions: {
    scopeId?: string;
    canSwitchBranch?: boolean;
    userBranchId?: string;
  };
}) {
  if (transfers.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Nenhuma transferência encontrada
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Número</TableHead>
          <TableHead>Origem</TableHead>
          <TableHead>Destino</TableHead>
          <TableHead>Itens</TableHead>
          <TableHead>Data</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transfers.map(transfer => (
          <TableRow key={transfer.id}>
            <TableCell className="font-medium">{transfer.transferNumber}</TableCell>
            <TableCell>{transfer.fromBranchName}</TableCell>
            <TableCell>{transfer.toBranchName}</TableCell>
            <TableCell>{transfer.items.length} produtos</TableCell>
            <TableCell>
              {format(new Date(transfer.requestedAt), 'dd/MM/yyyy HH:mm', { locale: pt })}
            </TableCell>
            <TableCell>{getStatusBadge(transfer.status)}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                {canApproveStockTransfer(transfer, branchTransferActions) && onApprove && (
                  <Button size="sm" variant="outline" onClick={() => onApprove(transfer)}>
                    <Check className="w-4 h-4 mr-1" />
                    Aprovar
                  </Button>
                )}
                {canReceiveStockTransfer(transfer, branchTransferActions) && onReceive && (
                  <Button size="sm" variant="outline" onClick={() => onReceive(transfer)}>
                    <Package className="w-4 h-4 mr-1" />
                    Confirmar Recepção
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
