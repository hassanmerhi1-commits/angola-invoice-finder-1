import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useProducts, useSuppliers, usePurchaseOrders, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { PurchaseOrder, PurchaseOrderItem, Product } from '@/types/erp';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { navigateThenStartPurchaseCreate } from '@/lib/nexorPurchaseCreate';
import { Search, Plus, Eye, CheckCircle, Package, ShoppingCart, Trash2, Barcode, ScanLine, Truck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

const getStatusBadge = (t: any, status: string) => {
  const labels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    draft: { label: t.purchaseOrdersUi.statusDraft, variant: 'outline' },
    pending: { label: t.purchaseOrdersUi.statusPending, variant: 'secondary' },
    approved: { label: t.purchaseOrdersUi.statusApproved, variant: 'default' },
    received: { label: t.purchaseOrdersUi.statusReceived, variant: 'default' },
    partial: { label: t.purchaseOrdersUi.statusPartial, variant: 'secondary' },
    cancelled: { label: t.purchaseOrdersUi.statusCancelled, variant: 'destructive' },
    awaiting_approval: { label: t.purchaseOrdersUi.statusAwaitingApproval, variant: 'secondary' },
  };
  return labels[status] || { label: status, variant: 'outline' as const };
};

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();
  const { branches, currentBranch } = useBranchContext();
  const { products } = useProducts(currentBranch?.id);
  const { suppliers } = useSuppliers();
  const { 
    orders, 
    createOrder, 
    approveOrder, 
    receiveOrder, 
    cancelOrder 
  } = usePurchaseOrders();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.isActive), [suppliers]);
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});

  // Create order form state
  const [orderForm, setOrderForm] = useState({
    supplierId: '',
    branchId: currentBranch?.id || '',
    notes: '',
    expectedDeliveryDate: '',
    items: [] as { productId: string; quantity: number; unitCost: number }[],
    // Freight and other costs
    freightCost: 0,
    otherCosts: 0,
    otherCostsDescription: '',
  });

  const [newItemForm, setNewItemForm] = useState({
    productId: '',
    quantity: 1,
    unitCost: 0,
  });

  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanMode, setScanMode] = useState<'create' | 'receive' | null>(null);

  const handleOpenPurchaseInvoice = useCallback(() => {
    navigateThenStartPurchaseCreate(navigate, location.pathname);
  }, [navigate, location.pathname]);

  // Handle barcode scan for adding products
  const handleBarcodeScan = useCallback((barcode: string) => {
    const product = products.find(p => 
      p.barcode === barcode || p.sku.toLowerCase() === barcode.toLowerCase()
    );
    
    if (!product) {
      toast({
        title: t.purchaseOrdersUi.productNotFoundTitle,
        description: `Código: ${barcode}`,
        variant: 'destructive',
      });
      return;
    }

    if (scanMode === 'create') {
      // Check if product already in order
      const existingItem = orderForm.items.find(i => i.productId === product.id);
      if (existingItem) {
        // Increase quantity
        setOrderForm({
          ...orderForm,
          items: orderForm.items.map(i => 
            i.productId === product.id 
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        });
        toast({
          title: 'Quantidade aumentada',
          description: `${product.name} - Qtd: ${existingItem.quantity + 1}`,
        });
      } else {
        // Add new item
        setOrderForm({
          ...orderForm,
          items: [...orderForm.items, {
            productId: product.id,
            quantity: 1,
            unitCost: 0,
          }],
        });
        toast({
          title: 'Produto adicionado',
          description: `${product.name} — preencha o preço do fornecedor`,
        });
      }
    } else if (scanMode === 'receive' && selectedOrder) {
      // Find item in order and increment received quantity
      const orderItem = selectedOrder.items.find(i => i.productId === product.id);
      if (orderItem) {
        const currentQty = receivedQuantities[product.id] || 0;
        if (currentQty < orderItem.quantity) {
          setReceivedQuantities({
            ...receivedQuantities,
            [product.id]: currentQty + 1,
          });
          toast({
            title: 'Produto recebido',
            description: `${product.name} - ${currentQty + 1}/${orderItem.quantity}`,
          });
        } else {
          toast({
            title: 'Quantidade completa',
            description: `${product.name} já atingiu a quantidade da encomenda`,
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: t.purchaseOrdersUi.productNotInOrderTitle,
          description: product.name,
          variant: 'destructive',
        });
      }
    }
  }, [products, scanMode, orderForm, selectedOrder, receivedQuantities, toast]);

  // Barcode scanner hook
  useBarcodeScanner({
    onScan: handleBarcodeScan,
  });

  // Handle manual barcode input
  const handleManualBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcodeInput.trim()) {
      handleBarcodeScan(barcodeInput.trim());
      setBarcodeInput('');
    }
  };

  const filteredOrders = orders.filter(order =>
    order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.supplierName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = useMemo(() => ({
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending' || o.status === 'approved').length,
    received: orders.filter(o => o.status === 'received').length,
    totalValue: orders.filter(o => o.status === 'received').reduce((sum, o) => sum + o.total, 0),
  }), [orders]);

  const handleAddItem = () => {
    if (!newItemForm.productId || newItemForm.quantity <= 0 || newItemForm.unitCost <= 0) {
      toast({
        title: t.common.error,
        description: t.purchaseOrdersUi.selectProductQtyAndSupplierPrice,
        variant: 'destructive',
      });
      return;
    }

    const product = products.find(p => p.id === newItemForm.productId);
    if (!product) return;

    // Check if product already in list
    if (orderForm.items.find(i => i.productId === newItemForm.productId)) {
      toast({
        title: t.purchaseOrdersUi.warningTitle,
        description: t.purchaseOrdersUi.productAlreadyInList,
        variant: 'destructive',
      });
      return;
    }

    setOrderForm({
      ...orderForm,
      items: [
        ...orderForm.items,
        {
          productId: newItemForm.productId,
          quantity: newItemForm.quantity,
          unitCost: newItemForm.unitCost,
        },
      ],
    });

    setNewItemForm({ productId: '', quantity: 1, unitCost: 0 });
  };

  const handleRemoveItem = (productId: string) => {
    setOrderForm({
      ...orderForm,
      items: orderForm.items.filter(i => i.productId !== productId),
    });
  };

  const handleCreateOrder = async () => {
    if (!orderForm.supplierId || !orderForm.branchId || orderForm.items.length === 0) {
      toast({
        title: t.common.error,
        description: t.purchaseOrdersUi.selectSupplierBranchAndAddProduct,
        variant: 'destructive',
      });
      return;
    }

    if (orderForm.items.some(item => item.unitCost <= 0)) {
      toast({
        title: t.purchaseOrdersUi.supplierPriceMissingTitle,
        description: t.purchaseOrdersUi.fillSupplierPriceAllLines,
        variant: 'destructive',
      });
      return;
    }

    // Calculate freight allocation proportional to item value
    const freightAllocations = calculateFreightAllocation();

    const items: PurchaseOrderItem[] = orderForm.items.map(item => {
      const product = products.find(p => p.id === item.productId)!;
      const subtotal = item.quantity * item.unitCost;
      const freightAllocation = freightAllocations[item.productId] || 0;
      return {
        productId: item.productId,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitCost: item.unitCost,
        freightAllocation, // Per-unit freight cost
        effectiveCost: item.unitCost + freightAllocation, // Total per-unit cost including freight
        taxRate: product.taxRate,
        subtotal,
      };
    });

    try {
      await createOrder(
        orderForm.supplierId,
        orderForm.branchId,
        items,
        user?.id || '',
        orderForm.notes || undefined,
        orderForm.expectedDeliveryDate || undefined,
        orderForm.freightCost || undefined,
        orderForm.otherCosts || undefined,
        orderForm.otherCostsDescription || undefined
      );

      toast({
        title: t.purchaseOrdersUi.orderCreatedTitle,
        description: t.purchaseOrdersUi.orderCreatedDesc,
      });

      setCreateDialogOpen(false);
      setOrderForm({
        supplierId: '',
        branchId: currentBranch?.id || '',
        notes: '',
        expectedDeliveryDate: '',
        items: [],
        freightCost: 0,
        otherCosts: 0,
        otherCostsDescription: '',
      });
    } catch (error: any) {
      toast({
        title: t.purchaseOrdersUi.createFailedTitle,
        description: error.message || t.purchaseOrdersUi.createFailedDesc,
        variant: 'destructive',
      });
    }
  };

  const handleApprove = async (order: PurchaseOrder) => {
    try {
      await approveOrder(order.id, user?.id || '');
      toast({
        title: 'Encomenda aprovada',
        description: `Encomenda ${order.orderNumber} foi aprovada`,
      });
    } catch (error: any) {
      toast({
        title: t.purchaseOrdersUi.approveFailedTitle,
        description: error.message || t.purchaseOrdersUi.approveFailedDesc,
        variant: 'destructive',
      });
    }
  };

  const handleOpenReceive = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    const quantities: Record<string, number> = {};
    order.items.forEach(item => {
      quantities[item.productId] = item.quantity;
    });
    setReceivedQuantities(quantities);
    setReceiveDialogOpen(true);
  };

  const handleReceive = async () => {
    if (!selectedOrder) return;

    try {
      await receiveOrder(selectedOrder.id, user?.id || '', receivedQuantities);
      toast({
        title: 'Stock actualizado',
        description: `Encomenda ${selectedOrder.orderNumber} foi recebida e stock actualizado`,
      });
      setReceiveDialogOpen(false);
      setSelectedOrder(null);
    } catch (error: any) {
      toast({
        title: t.purchaseOrdersUi.receiveFailedTitle,
        description: error.message || t.purchaseOrdersUi.receiveFailedDesc,
        variant: 'destructive',
      });
    }
  };

  const handleCancel = (order: PurchaseOrder) => {
    cancelOrder(order.id);
    toast({
      title: 'Encomenda cancelada',
      description: `Encomenda ${order.orderNumber} foi cancelada`,
    });
  };

  const handleViewOrder = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setViewDialogOpen(true);
  };

  const orderItemsTotal = orderForm.items.reduce((sum, item) => {
    return sum + (item.quantity * item.unitCost);
  }, 0);

  // Total with freight and other costs
  const orderGrandTotal = orderItemsTotal + (orderForm.freightCost || 0) + (orderForm.otherCosts || 0);
  
  // Calculate freight allocation per item (proportional to value)
  const calculateFreightAllocation = () => {
    if (orderItemsTotal === 0 || !orderForm.freightCost) return {};
    const allocations: Record<string, number> = {};
    orderForm.items.forEach(item => {
      const itemValue = item.quantity * item.unitCost;
      const proportion = itemValue / orderItemsTotal;
      allocations[item.productId] = (orderForm.freightCost * proportion) / item.quantity;
    });
    return allocations;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Compras / Faturas de Compra</h1>
          <p className="text-sm text-muted-foreground font-medium">
            Gestão de compras a fornecedores e recepção de mercadoria
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => navigate('/suppliers')}>
            <Truck className="w-4 h-4 mr-2" />
            Gerir Fornecedores
          </Button>
          <Button className="rounded-xl gradient-primary shadow-glow" onClick={handleOpenPurchaseInvoice}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Fatura de Compra
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-primary shadow-md">
                <ShoppingCart className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Encomendas</p>
                <p className="text-3xl font-extrabold tracking-tight">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-warm shadow-md">
                <Package className="w-6 h-6 text-warning-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pendentes</p>
                <p className="text-3xl font-extrabold tracking-tight">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-success shadow-md">
                <CheckCircle className="w-6 h-6 text-success-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recebidas</p>
                <p className="text-3xl font-extrabold tracking-tight">{stats.received}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl gradient-accent shadow-md">
                <ShoppingCart className="w-6 h-6 text-info-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Valor Total</p>
                <p className="text-2xl font-extrabold tracking-tight">{stats.totalValue.toLocaleString('pt-AO')} Kz</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Lista de Encomendas</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma encomenda encontrada</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Encomenda</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Filial</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acções</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map(order => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono">{order.orderNumber}</TableCell>
                    <TableCell>{order.supplierName}</TableCell>
                    <TableCell>{order.branchName}</TableCell>
                    <TableCell>
                      {format(new Date(order.createdAt), 'dd/MM/yyyy', { locale: pt })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {order.total.toLocaleString('pt-AO')} Kz
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadge(t, order.status).variant}>
                        {getStatusBadge(t, order.status).label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewOrder(order)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {order.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleApprove(order)}
                            title="Aprovar"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          </Button>
                        )}
                        {order.status === 'approved' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenReceive(order)}
                            title="Receber mercadoria"
                          >
                            <Package className="w-4 h-4 text-blue-500" />
                          </Button>
                        )}
                        {(order.status === 'draft' || order.status === 'pending') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancel(order)}
                            title="Cancelar"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Order Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Encomenda de Compra</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {activeSuppliers.length === 0 && (
              <Alert>
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Não há fornecedores activos. Crie um fornecedor primeiro para emitir fatura de compra.</span>
                  <Button variant="outline" size="sm" onClick={() => navigate('/suppliers')}>
                    <Truck className="w-4 h-4 mr-2" />
                    Criar Fornecedor
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label>Fornecedor *</Label>
                  <Button variant="link" className="h-auto p-0" onClick={() => navigate('/suppliers')}>
                    Novo fornecedor
                  </Button>
                </div>
                <Select
                  value={orderForm.supplierId}
                  onValueChange={(value) => setOrderForm({ ...orderForm, supplierId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.purchaseOrdersUi.selectSupplierPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSuppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Filial Destino *</Label>
                <Select
                  value={orderForm.branchId}
                  onValueChange={(value) => setOrderForm({ ...orderForm, branchId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.purchaseOrdersUi.selectBranchPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.filter(b => b.id).map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Data Prevista de Entrega</Label>
                <Input
                  type="date"
                  value={orderForm.expectedDeliveryDate}
                  onChange={(e) => setOrderForm({ ...orderForm, expectedDeliveryDate: e.target.value })}
                />
              </div>

              <div>
                <Label>Notas</Label>
                <Textarea
                  value={orderForm.notes}
                  onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
                  placeholder={t.purchaseOrdersUi.notesPlaceholder}
                  rows={1}
                />
              </div>
            </div>

            {/* Barcode Scanner Section */}
            <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2">
                  <ScanLine className="w-5 h-5 text-primary" />
                  Leitura de Código de Barras
                </h4>
                <Badge variant={scanMode === 'create' ? 'default' : 'outline'}>
                  {scanMode === 'create' ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
              <form onSubmit={handleManualBarcodeSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={t.purchaseOrdersUi.barcodeInputPlaceholder}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onFocus={() => setScanMode('create')}
                    className="pl-10"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" variant="secondary">
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Use um leitor de código de barras ou digite manualmente. Produtos repetidos aumentam a quantidade.
              </p>
            </div>

            {/* Add product to order manually */}
            <div className="border rounded-lg p-4 space-y-4">
              <h4 className="font-medium">Adicionar Produto Manualmente</h4>
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <Select
                    value={newItemForm.productId}
                    onValueChange={(value) => {
                      const product = products.find(p => p.id === value);
                      setNewItemForm({
                        ...newItemForm,
                        productId: value,
                        unitCost: product?.cost || 0,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.purchaseOrdersUi.selectProductPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.filter(p => p.isActive).map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} ({product.sku}) {product.barcode && `- ${product.barcode}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qtd"
                    value={newItemForm.quantity}
                    onChange={(e) => setNewItemForm({ ...newItemForm, quantity: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Custo Unit."
                    value={newItemForm.unitCost}
                    onChange={(e) => setNewItemForm({ ...newItemForm, unitCost: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <Button type="button" variant="secondary" onClick={handleAddItem}>
                <Plus className="w-4 h-4 mr-2" />
                Adicionar à Lista
              </Button>
            </div>

            {/* Order items list */}
            {orderForm.items.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead className="text-right">Custo Unit.</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orderForm.items.map((item) => {
                      const product = products.find(p => p.id === item.productId);
                      return (
                        <TableRow key={item.productId}>
                          <TableCell>{product?.name}</TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">{item.unitCost.toLocaleString('pt-AO')} Kz</TableCell>
                          <TableCell className="text-right font-medium">
                            {(item.quantity * item.unitCost).toLocaleString('pt-AO')} Kz
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveItem(item.productId)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={3} className="text-right">
                        Subtotal Produtos:
                      </TableCell>
                      <TableCell className="text-right">
                        {orderItemsTotal.toLocaleString('pt-AO')} Kz
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Freight and Other Costs */}
            <div className="border rounded-lg p-4 space-y-4 bg-amber-50/50 dark:bg-amber-950/20">
              <h4 className="font-medium flex items-center gap-2">
                🚚 Frete e Despesas Adicionais
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Frete (Transporte)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={orderForm.freightCost || ''}
                    onChange={(e) => setOrderForm({ ...orderForm, freightCost: parseFloat(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Será distribuído proporcionalmente ao valor de cada produto
                  </p>
                </div>
                <div>
                  <Label>Outras Despesas</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={orderForm.otherCosts || ''}
                    onChange={(e) => setOrderForm({ ...orderForm, otherCosts: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              {(orderForm.otherCosts > 0) && (
                <div>
                  <Label>Descrição das Despesas</Label>
                  <Input
                    placeholder={t.purchaseOrdersUi.otherCostsDescriptionPlaceholder}
                    value={orderForm.otherCostsDescription}
                    onChange={(e) => setOrderForm({ ...orderForm, otherCostsDescription: e.target.value })}
                  />
                </div>
              )}
              
              {/* Totals Summary */}
              <div className="pt-3 border-t space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Subtotal Produtos:</span>
                  <span>{orderItemsTotal.toLocaleString('pt-AO')} Kz</span>
                </div>
                {orderForm.freightCost > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Frete:</span>
                    <span>+{orderForm.freightCost.toLocaleString('pt-AO')} Kz</span>
                  </div>
                )}
                {orderForm.otherCosts > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Outras Despesas:</span>
                    <span>+{orderForm.otherCosts.toLocaleString('pt-AO')} Kz</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>TOTAL DA ENCOMENDA:</span>
                  <span className="text-primary">{orderGrandTotal.toLocaleString('pt-AO')} Kz</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateOrder} disabled={orderForm.items.length === 0}>
              Criar Encomenda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Order Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes da Encomenda {selectedOrder?.orderNumber}</DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Fornecedor:</span>
                  <p className="font-medium">{selectedOrder.supplierName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Filial:</span>
                  <p className="font-medium">{selectedOrder.branchName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Data:</span>
                  <p className="font-medium">
                    {format(new Date(selectedOrder.createdAt), 'dd/MM/yyyy HH:mm', { locale: pt })}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Estado:</span>
                  <Badge variant={getStatusBadge(t, selectedOrder.status).variant} className="ml-2">
                    {getStatusBadge(t, selectedOrder.status).label}
                  </Badge>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedOrder.items.map((item) => (
                    <TableRow key={item.productId}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">{item.sku}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{item.unitCost.toLocaleString('pt-AO')} Kz</TableCell>
                      <TableCell className="text-right">{item.subtotal.toLocaleString('pt-AO')} Kz</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="text-right space-y-1">
                <p>Subtotal: {selectedOrder.subtotal.toLocaleString('pt-AO')} Kz</p>
                <p>IVA: {selectedOrder.taxAmount.toLocaleString('pt-AO')} Kz</p>
                <p className="text-lg font-bold">Total: {selectedOrder.total.toLocaleString('pt-AO')} Kz</p>
              </div>

              {selectedOrder.notes && (
                <div>
                  <span className="text-muted-foreground">Notas:</span>
                  <p>{selectedOrder.notes}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive Order Dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={(open) => {
        setReceiveDialogOpen(open);
        if (open) setScanMode('receive');
        else setScanMode(null);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Receber Mercadoria - {selectedOrder?.orderNumber}</DialogTitle>
          </DialogHeader>

          {selectedOrder && (() => {
            // Calculate freight allocation for display
            const orderItemsTotal = selectedOrder.items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
            const totalLandingCosts = (selectedOrder.freightCost || 0) + (selectedOrder.otherCosts || 0);
            
            const getFreightPerUnit = (item: PurchaseOrderItem) => {
              if (orderItemsTotal === 0 || totalLandingCosts === 0) return 0;
              const itemValue = item.quantity * item.unitCost;
              const proportion = itemValue / orderItemsTotal;
              return (totalLandingCosts * proportion) / item.quantity;
            };

            return (
              <div className="space-y-4">
                {/* Barcode Scanner for Receiving */}
                <div className="border rounded-lg p-4 bg-primary/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium flex items-center gap-2">
                      <ScanLine className="w-5 h-5 text-primary" />
                      Leitura de Recepção
                    </h4>
                    <Badge variant={scanMode === 'receive' ? 'default' : 'outline'}>
                      {scanMode === 'receive' ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </div>
                  <form onSubmit={handleManualBarcodeSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                      <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder={t.purchaseOrdersUi.receiveScanPlaceholder}
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        onFocus={() => setScanMode('receive')}
                        className="pl-10"
                        autoComplete="off"
                        autoFocus
                      />
                    </div>
                    <Button type="submit" variant="secondary">
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                  </form>
                </div>

                {/* Freight Summary */}
                {totalLandingCosts > 0 && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                    <h4 className="text-sm font-medium">Custos de Importação / Frete</h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Frete:</span>
                        <span className="ml-2 font-medium">{(selectedOrder.freightCost || 0).toLocaleString('pt-AO')} Kz</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Outros:</span>
                        <span className="ml-2 font-medium">{(selectedOrder.otherCosts || 0).toLocaleString('pt-AO')} Kz</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Custos:</span>
                        <span className="ml-2 font-bold text-primary">{totalLandingCosts.toLocaleString('pt-AO')} Kz</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Os custos serão distribuídos proporcionalmente e o custo médio dos produtos será actualizado automaticamente.
                    </p>
                  </div>
                )}

                <p className="text-sm text-muted-foreground">
                  Confirme as quantidades recebidas. O stock e custo médio serão actualizados automaticamente.
                </p>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right w-20">Enc.</TableHead>
                      <TableHead className="text-right w-24">Recebido</TableHead>
                      <TableHead className="text-right w-24">Custo Un.</TableHead>
                      <TableHead className="text-right w-24">Frete Un.</TableHead>
                      <TableHead className="text-right w-28">Custo Efetivo</TableHead>
                      <TableHead className="text-center w-20">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrder.items.map((item) => {
                      const received = receivedQuantities[item.productId] || 0;
                      const progress = (received / item.quantity) * 100;
                      const freightPerUnit = getFreightPerUnit(item);
                      const effectiveCost = item.unitCost + freightPerUnit;
                      
                      return (
                        <TableRow key={item.productId}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{item.productName}</p>
                              <p className="text-xs text-muted-foreground">{item.sku}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              max={item.quantity}
                              className="w-20 ml-auto h-8 text-center"
                              value={received}
                              onChange={(e) => setReceivedQuantities({
                                ...receivedQuantities,
                                [item.productId]: parseInt(e.target.value) || 0,
                              })}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {item.unitCost.toLocaleString('pt-AO')} Kz
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {freightPerUnit > 0 ? `+${freightPerUnit.toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-primary">
                            {effectiveCost.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 justify-center">
                              <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${progress >= 100 ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                                  style={{ width: `${Math.min(progress, 100)}%` }}
                                />
                              </div>
                              <span className={`text-xs w-8 ${progress >= 100 ? 'text-primary font-medium' : ''}`}>
                                {progress.toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Totals Summary */}
                <div className="grid grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50 text-sm">
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs">Subtotal Produtos</p>
                    <p className="font-medium">{orderItemsTotal.toLocaleString('pt-AO')} Kz</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs">Frete + Outros</p>
                    <p className="font-medium">{totalLandingCosts.toLocaleString('pt-AO')} Kz</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs">IVA</p>
                    <p className="font-medium">{selectedOrder.taxAmount.toLocaleString('pt-AO')} Kz</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground text-xs">Total c/ Custos</p>
                    <p className="font-bold text-primary">{(orderItemsTotal + totalLandingCosts + selectedOrder.taxAmount).toLocaleString('pt-AO')} Kz</p>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleReceive}>
              <CheckCircle className="w-4 h-4 mr-2" />
              Confirmar Recepção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}