import { generateId } from '@/lib/utils';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProducts } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
import { Product, StockMovement } from '@/types/erp';
import { api } from '@/lib/api/client';
import { saveProduct, getProducts as storageGetProducts, getStockMovements as localGetStockMovements } from '@/lib/storage';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileText, 
  Plus, 
  Edit, 
  Trash2, 
  Filter, 
  BarChart3, 
  Eye, 
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Download,
  Upload,
  ArrowRightLeft,
  ClipboardList,
  ClipboardCheck,
  Printer,
  Calculator,
  PackagePlus,
  PackageMinus,
  Building2
} from 'lucide-react';
import { AdvancedDataGrid } from '@/components/inventory/AdvancedDataGrid';
import { ShelfLabelPrintDialog } from '@/components/inventory/ShelfLabelPrintDialog';
import { ProductDetailDialog } from '@/components/inventory/ProductDetailDialog';
import { BranchStockDetail } from '@/components/inventory/BranchStockDetail';
import { BranchSelector } from '@/components/BranchSelector';
import { exportProductsToExcel, parseExcelFile, validateImportedProducts, downloadImportTemplate, ExcelProduct } from '@/lib/excel';
import { ExcelImportDialog } from '@/components/import/ExcelImportDialog';
import { InventoryCountSheetDialog } from '@/components/inventory/InventoryCountSheetDialog';
import { InventoryReconciliationDialog } from '@/components/inventory/InventoryReconciliationDialog';
import { InventoryAdjustmentDialog } from '@/components/inventory/InventoryAdjustmentDialog';
import { StockEntryDialog } from '@/components/inventory/StockEntryDialog';
import { StockExitDialog } from '@/components/inventory/StockExitDialog';
import { toast } from 'sonner';
import { logTransaction } from '@/lib/transactionHistory';
import { saveStockMovement } from '@/lib/storage';
import { useTranslation } from '@/i18n';

export default function Inventory() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentBranch, branches } = useBranchContext();
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  
  // Head office (Sede) sees ALL inventory; filials see only their own
  const isHeadOffice = currentBranch?.isMain === true;
  const isFilial = currentBranch && !currentBranch.isMain;
  
  // For head office: load all products (no branch filter)
  // For filial: load only that branch's products
  const { products, refreshProducts, updateProduct, addProduct, deleteProduct } = useProducts(isHeadOffice ? undefined : currentBranch?.id);
  
  // For head office: load all products per branch for qty breakdown
  const [allBranchProducts, setAllBranchProducts] = useState<Record<string, Product[]>>({});
  
  const loadBranchProducts = useCallback(async () => {
    if (!isHeadOffice) return;
    const branchProducts: Record<string, Product[]> = {};
    for (const branch of branches) {
      // Use API first (source of truth), fallback to localStorage
      try {
        const result = await api.products.list(branch.id);
        if (result.data && Array.isArray(result.data)) {
          branchProducts[branch.id] = result.data.map((p: any) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode || '',
            category: p.category || 'GERAL',
            price: Number(p.price || 0),
            cost: Number(p.cost || 0),
            firstCost: Number(p.first_cost || p.firstCost || 0),
            lastCost: Number(p.last_cost || p.lastCost || 0),
            avgCost: Number(p.weighted_avg_cost || p.avgCost || 0),
            stock: Number(p.stock || 0),
            unit: p.unit || 'UN',
            taxRate: Number(p.tax_rate || p.taxRate || 14),
            branchId: p.branch_id || p.branchId || null,
            supplierId: p.supplier_id || p.supplierId || null,
            supplierName: p.supplier_name || p.supplierName || '',
            isActive: p.is_active ?? p.isActive ?? true,
            createdAt: p.created_at || p.createdAt || '',
          })) as Product[];
          continue;
        }
      } catch (e) {
        // API failed, fall back to localStorage
      }
      const prods = await storageGetProducts(branch.id);
      branchProducts[branch.id] = prods;
    }
    setAllBranchProducts(branchProducts);
  }, [isHeadOffice, branches]);
  
  useEffect(() => {
    loadBranchProducts();
  }, [loadBranchProducts, products]);

  const loadStockMovements = useCallback(async () => {
    // Try API first (live DB), fall back to localStorage
    try {
      const result = await api.transactions.stockMovements({
        warehouseId: isHeadOffice ? undefined : currentBranch?.id,
        limit: 2000,
      });
      if (result.data && Array.isArray(result.data)) {
        const mapped: StockMovement[] = result.data.map((m: any) => ({
          id: m.id,
          productId: m.product_id || m.productId,
          productName: m.product_name || m.productName || '',
          sku: m.sku || '',
          branchId: m.warehouse_id || m.warehouseId || m.branchId || '',
          type: (m.movement_type || m.type || 'IN') as 'IN' | 'OUT',
          quantity: Number(m.quantity) || 0,
          reason: m.reference_type || m.reason || 'purchase',
          referenceId: m.reference_id || m.referenceId || '',
          referenceNumber: m.reference_number || m.referenceNumber || '',
          costAtTime: Number(m.unit_cost || m.costAtTime || 0),
          notes: m.notes || '',
          createdBy: m.created_by || m.createdBy || '',
          createdAt: m.created_at || m.createdAt || '',
        }));
        setStockMovements(mapped);
        return;
      }
    } catch (e) {
      // API unreachable — fall through to local
    }
    const data = await localGetStockMovements(isHeadOffice ? undefined : currentBranch?.id);
    setStockMovements(data);
  }, [currentBranch?.id, isHeadOffice]);

  useEffect(() => {
    loadStockMovements();
  }, [loadStockMovements, products]);
  
  // For head office: deduplicate products by SKU (show unique items with aggregated total).
  // Use trimmed SKU, falling back to product id so blank/duplicate SKU keys do not hide new rows.
  const displayProducts = useMemo(() => {
    if (!isHeadOffice) return products;
    const seen = new Map<string, Product>();
    for (const p of products) {
      const key = (p.sku || '').trim() || p.id;
      if (!seen.has(key)) {
        seen.set(key, { ...p });
      }
    }
    return Array.from(seen.values());
  }, [products, isHeadOffice]);
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [countSheetDialogOpen, setCountSheetDialogOpen] = useState(false);
  const [reconciliationDialogOpen, setReconciliationDialogOpen] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [stockEntryDialogOpen, setStockEntryDialogOpen] = useState(false);
  const [stockExitDialogOpen, setStockExitDialogOpen] = useState(false);
  const [labelPrintDialogOpen, setLabelPrintDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('lista');
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  const handleOpenDialog = (product?: Product) => {
    setSelectedProduct(product || null);
    setDialogOpen(true);
  };

  // TopNav toolbar "Novo"
  useEffect(() => {
    const st = location.state as { nexorToolbarNewProduct?: boolean } | null;
    if (!st?.nexorToolbarNewProduct) return;
    setSelectedProduct(null);
    setDialogOpen(true);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate]);

  const handleSaveProduct = async (product: Product) => {
    try {
      if (selectedProduct) {
        await updateProduct(product);
        toast.success(t.productFormUi.productUpdated);
      } else {
        await addProduct(product);
        toast.success(t.productFormUi.productCreated);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message || t.productFormUi.productSaveFailed);
      throw e;
    }
  };

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
  };

  const handleDoubleClickProduct = (product: Product) => {
    setSelectedProduct(product);
    setDialogOpen(true);
  };

  const handleImportProducts = async (data: ExcelProduct[], options?: { updateDuplicates?: boolean }) => {
    // Build product objects for batch import
    // Head office imports as GLOBAL (null branch) so all branches see the products
    const importBranchId = isHeadOffice ? null : (currentBranch?.id || null);
    
    const productsToImport = data
      .filter((item) => {
        const exists = products.find(p => p.sku.toLowerCase().trim() === item.codigo.toLowerCase().trim());
        return !exists || options?.updateDuplicates;
      })
      .map((item) => ({
        sku: item.codigo,
        name: item.descricao,
        barcode: item.codigoBarras || '',
        category: item.categoria || 'GERAL',
        price: item.preco,
        cost: item.custo,
        stock: item.quantidade,
        unit: item.unidade || 'UN',
        taxRate: item.iva || 14,
        isActive: true,
        branchId: importBranchId,
      }));

    if (productsToImport.length === 0) {
      toast.info(t.inventoryUi.noNewProductsToImport);
      return;
    }

    try {
      // Try batch API first
      const result = await api.products.batchImport(productsToImport);
      if (result.data) {
        const { imported, failed } = result.data;
        const messages: string[] = [];
        if (imported > 0) messages.push(t.inventoryUi.importedCount.replace('{count}', String(imported)));
        if (failed > 0) messages.push(t.inventoryUi.failedCount.replace('{count}', String(failed)));
        toast.success(messages.join(', ') || t.inventoryUi.importCompleted);
      } else {
        // Fallback: save individually to localStorage
        let count = 0;
        for (const p of productsToImport) {
          const product = {
            id: generateId(),
            ...p,
            firstCost: p.cost,
            lastCost: p.cost,
            avgCost: p.cost,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as Product;
          await addProduct(product);
          count++;
        }
        toast.success(t.inventoryUi.importedLocalMode.replace('{count}', String(count)));
      }
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(error.message || t.inventoryUi.importError);
    }

    refreshProducts();
  };

  // Handle stock adjustments from physical count
  const handleApplyAdjustments = (
    adjustments: { productId: string; newStock: number; difference: number }[],
    reason: string,
    notes: string
  ) => {
    const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
    
    adjustments.forEach(adj => {
      const product = products.find(p => p.id === adj.productId);
      if (product) {
        // Update product stock
        const updatedProduct = {
          ...product,
          stock: adj.newStock,
          updatedAt: new Date().toISOString(),
        };
        updateProduct(updatedProduct);

        // Create stock movement record
        saveStockMovement({
          id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          productId: adj.productId,
          productName: product.name,
          sku: product.sku,
          branchId: currentBranch?.id || '',
          type: adj.difference > 0 ? 'IN' : 'OUT',
          quantity: Math.abs(adj.difference),
          reason: 'adjustment',
          createdBy: currentUser?.id || 'system',
          notes: `${reason}${notes ? ': ' + notes : ''}`,
          createdAt: new Date().toISOString(),
        });

        // Log transaction
        logTransaction({
          category: 'inventory',
          action: 'stock_adjusted',
          entityType: 'Produto',
          entityId: adj.productId,
          entityNumber: product.sku,
          entityName: product.name,
          description: `Stock ajustado de ${product.stock} para ${adj.newStock} (${adj.difference > 0 ? '+' : ''}${adj.difference}) - ${reason}`,
          details: {
            previousStock: product.stock,
            newStock: adj.newStock,
            difference: adj.difference,
            reason,
            notes,
          },
          previousValue: product.stock,
          newValue: adj.newStock,
        });
      }
    });

    refreshProducts();
  };

  // Get existing SKUs for duplicate detection
  const existingSkus = products.map(p => p.sku);

  const productImportColumns: { key: keyof ExcelProduct; label: string }[] = [
    { key: 'codigo', label: t.inventoryUi.colCode },
    { key: 'descricao', label: t.inventoryUi.colDescription },
    { key: 'preco', label: t.inventoryUi.colPrice },
    { key: 'quantidade', label: 'Qtd' },
    { key: 'categoria', label: 'Categoria' },
  ];

  const selectedProductMovements = useMemo(() => {
    if (!selectedProduct) return [];

    return stockMovements
      .filter(m => m.productId === selectedProduct.id || m.sku === selectedProduct.sku)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedProduct, stockMovements]);

  const movementSummary = useMemo(() => selectedProductMovements.reduce((acc, movement) => ({
    entries: acc.entries + (movement.type === 'IN' ? movement.quantity : 0),
    exits: acc.exits + (movement.type === 'OUT' ? movement.quantity : 0),
  }), { entries: 0, exits: 0 }), [selectedProductMovements]);

  const getMovementReasonLabel = (reason: StockMovement['reason']) => {
    switch (reason) {
      case 'purchase': return t.inventoryUi.reasonPurchase;
      case 'sale': return t.inventoryUi.reasonSale;
      case 'transfer_in': return t.inventoryUi.reasonTransferIn;
      case 'transfer_out': return t.inventoryUi.reasonTransferOut;
      case 'adjustment': return t.inventoryUi.reasonAdjustment;
      case 'damage': return t.inventoryUi.reasonDamage;
      case 'return': return t.inventoryUi.reasonReturn;
      case 'initial': return t.inventoryUi.reasonInitial;
      default: return reason;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Head Office Notice */}
      {isHeadOffice && (
        <Alert className="mx-3 mt-3 rounded-xl bg-accent border-primary/20">
          <Building2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-foreground">
            <strong>{t.inventoryPageUi.headOfficeTitle}</strong> {t.inventoryPageUi.headOfficeDesc}
          </AlertDescription>
        </Alert>
      )}
      {/* Filial Notice */}
      {isFilial && (
        <Alert className="mx-3 mt-3 rounded-xl bg-warning/10 border-warning/20">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription className="text-foreground">
            <strong>{t.inventoryPageUi.branchModeTitle}</strong> {t.inventoryPageUi.branchModeDesc}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-card/50 border-b backdrop-blur-sm">
        <BranchSelector compact />
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleOpenDialog()}>
          <Plus className="w-3 h-3" />
          {t.common.new}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1" 
          disabled={!selectedProduct}
          onClick={() => selectedProduct && handleOpenDialog(selectedProduct)}
        >
          <Edit className="w-3 h-3" />
          {t.common.edit}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1 text-destructive" 
          disabled={!selectedProduct}
          onClick={() => {
            if (selectedProduct && confirm(t.inventoryUi.deleteConfirm)) {
              deleteProduct(selectedProduct.id);
              setSelectedProduct(null);
            }
          }}
        >
          <Trash2 className="w-3 h-3" />
          {t.common.delete}
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <Filter className="w-3 h-3" />
          {t.common.filters}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1 text-success border-success/30 hover:bg-success/10"
          onClick={() => setStockEntryDialogOpen(true)}
        >
          <PackagePlus className="w-3 h-3" />
          {t.inventoryPageUi.adjustEntry}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
          onClick={() => setStockExitDialogOpen(true)}
        >
          <PackageMinus className="w-3 h-3" />
          {t.inventoryPageUi.adjustExit}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => setImportDialogOpen(true)}
        >
          <Upload className="w-3 h-3" />
          {t.common.import}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => {
            exportProductsToExcel(products);
            toast.success(t.inventoryPageUi.exportedToExcel);
          }}
        >
          <Download className="w-3 h-3" />
          {t.common.export}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => setCountSheetDialogOpen(true)}
        >
          <ClipboardList className="w-3 h-3" />
          {t.inventoryPageUi.countSheet}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => setReconciliationDialogOpen(true)}
        >
          <ClipboardCheck className="w-3 h-3" />
          {t.inventoryPageUi.reconcile}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => setAdjustmentDialogOpen(true)}
        >
          <Calculator className="w-3 h-3" />
          {t.inventoryPageUi.adjustStock}
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 text-xs gap-1"
          onClick={() => setLabelPrintDialogOpen(true)}
          disabled={!selectedProduct && displayProducts.length === 0}
        >
          <Printer className="w-3 h-3" />
          {t.inventoryPageUi.labels}
        </Button>

        <div className="flex-1" />

        {/* Quick navigation */}
        <div className="flex items-center gap-1 border rounded px-2 py-1 bg-background">
          <Input 
            value={selectedProduct?.sku || ''} 
            readOnly
            className="h-5 w-24 text-xs border-0 p-0 focus-visible:ring-0"
            placeholder={t.inventoryUi.codePlaceholder}
          />
          <span className="text-xs text-muted-foreground">{selectedProduct?.name || ''}</span>
          <div className="flex gap-0.5 ml-2">
            <Button variant="ghost" size="icon" className="h-5 w-5">
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5">
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          <TabsTrigger value="lista" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.list}
          </TabsTrigger>
          <TabsTrigger value="extracto" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.statement}
          </TabsTrigger>
          <TabsTrigger value="mes" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.month}
          </TabsTrigger>
          <TabsTrigger value="qtd-detalhada" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.detailedQty}
          </TabsTrigger>
          <TabsTrigger value="transferencia" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.pendingTransfer}
          </TabsTrigger>
          <TabsTrigger value="grafico" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.chart}
          </TabsTrigger>
          <TabsTrigger value="preco-compra" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.purchasePrice}
          </TabsTrigger>
          <TabsTrigger value="no-serie" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.serialNo}
          </TabsTrigger>
          <TabsTrigger value="info-produto" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.productInfo}
          </TabsTrigger>
          <TabsTrigger value="cost-history" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.costHistory}
          </TabsTrigger>
          <TabsTrigger value="pedidos" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.orders}
          </TabsTrigger>
          <TabsTrigger value="barcode-qty" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.barcodeQty}
          </TabsTrigger>
          <TabsTrigger value="vendas-mensais" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.monthlySales}
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary">
            {t.inventoryPageUi.tabs.audit}
          </TabsTrigger>
        </TabsList>

        {/* Action buttons row */}
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 border-b">
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
            <FileText className="w-3 h-3" />
            {t.inventoryPageUi.note}
          </Button>
          <Button variant="secondary" size="sm" className="h-6 text-xs">
            {t.common.all}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-xs text-green-600">
            {t.inventoryPageUi.qtyGt0}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-xs text-red-600">
            {t.inventoryPageUi.qtyLt0}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-xs">
            {t.inventoryPageUi.costLt}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
            <BarChart3 className="w-3 h-3" />
            {t.inventoryPageUi.chart}
          </Button>
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1">
            <Eye className="w-3 h-3" />
            {t.inventoryPageUi.view}
          </Button>
        </div>

        <TabsContent value="lista" forceMount className="flex-1 m-0 p-2 data-[state=inactive]:hidden">
          <AdvancedDataGrid 
            products={displayProducts}
            onSelectProduct={handleSelectProduct}
            onDoubleClickProduct={handleDoubleClickProduct}
            selectedProductId={selectedProduct?.id}
            hideStock={!!isFilial}
            isHeadOffice={isHeadOffice}
            branches={branches}
            allBranchProducts={allBranchProducts}
          />
        </TabsContent>

        <TabsContent value="extracto" className="flex-1 m-0 p-4">
          {!selectedProduct ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-center">{t.inventoryPageUi.selectProductToViewStatement}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-base">{selectedProduct.sku} — {selectedProduct.name}</h3>
                    <p className="text-sm text-muted-foreground">{t.inventoryPageUi.statementSubtitle}</p>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span><strong>{t.inventoryPageUi.entriesLabel}</strong> {movementSummary.entries}</span>
                    <span><strong>{t.inventoryPageUi.exitsLabel}</strong> {movementSummary.exits}</span>
                    <span><strong>{t.inventoryPageUi.movementBalanceLabel}</strong> {movementSummary.entries - movementSummary.exits}</span>
                  </div>
                </div>

                <div className="overflow-x-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.inventoryPageUi.table.dateTime}</TableHead>
                        <TableHead>{t.inventoryPageUi.table.type}</TableHead>
                        <TableHead>{t.inventoryPageUi.table.reason}</TableHead>
                        <TableHead>{t.inventoryPageUi.table.document}</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">{t.inventoryPageUi.table.cost}</TableHead>
                        <TableHead>{t.inventoryPageUi.table.notes}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedProductMovements.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="text-xs text-muted-foreground">{new Date(movement.createdAt).toLocaleString(uiLocale)}</TableCell>
                          <TableCell className={movement.type === 'IN' ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                            {movement.type === 'IN' ? t.inventoryUi.entry : t.inventoryUi.exit}
                          </TableCell>
                          <TableCell>{getMovementReasonLabel(movement.reason)}</TableCell>
                          <TableCell className="font-mono text-xs">{movement.referenceNumber || '—'}</TableCell>
                          <TableCell className="text-right font-mono">{movement.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{(movement.costAtTime || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-xs">{movement.notes || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {selectedProductMovements.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t.inventoryUi.noMovementsForProduct}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="mes" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.monthlyMovements}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qtd-detalhada" className="flex-1 m-0 p-4 overflow-auto">
          <BranchStockDetail selectedProduct={selectedProduct} />
        </TabsContent>

        <TabsContent value="transferencia" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <ArrowRightLeft className="w-12 h-12 mx-auto text-muted-foreground" />
                <div>
                  <h3 className="font-semibold text-lg">{t.inventoryPageUi.transferTitle}</h3>
                  <p className="text-muted-foreground mb-4">{t.inventoryPageUi.transferDesc}</p>
                </div>
                <Button onClick={() => navigate('/stock-transfer')}>
                  <ArrowRightLeft className="w-4 h-4 mr-2" />
                  {t.inventoryPageUi.goToTransfers}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grafico" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.movementCharts}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preco-compra" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.purchasePriceHistory}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="no-serie" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.serialNumbers}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="info-produto" className="flex-1 m-0 p-4">
          {selectedProduct ? (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><strong>SKU:</strong> {selectedProduct.sku}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.name}</strong> {selectedProduct.name}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.category}</strong> {selectedProduct.category}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.price}</strong> {selectedProduct.price.toLocaleString(uiLocale)} Kz</div>
                  <div><strong>{t.inventoryPageUi.productInfo.cost}</strong> {selectedProduct.cost.toLocaleString(uiLocale)} Kz</div>
                  <div><strong>{t.inventoryPageUi.productInfo.stock}</strong> {selectedProduct.stock} {selectedProduct.unit}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.vat}</strong> {selectedProduct.taxRate}%</div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-center">{t.inventoryPageUi.selectProductToViewInfo}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cost-history" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.costHistoryPlaceholder}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pedidos" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.relatedOrders}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="barcode-qty" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.barcodeQuantities}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendas-mensais" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.monthlyProductSales}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auditoria" className="flex-1 m-0 p-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">{t.inventoryPageUi.auditHistory}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-muted/50 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          {isHeadOffice && <span className="text-primary font-medium">📊 {t.inventoryPageUi.status.headOfficeAllBranches.replace('{count}', String(branches.length))}</span>}
          {isFilial && <span>📍 {currentBranch?.name}</span>}
          <span className="text-destructive">{t.inventoryPageUi.status.qtyLt0}</span>
          <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-2 rounded">{t.inventoryPageUi.status.minQty}</span>
        </div>
        <span>{t.inventoryPageUi.status.productsCount.replace('{count}', String(displayProducts.length))}</span>
      </div>

      <ProductDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={selectedProduct}
        onSave={handleSaveProduct}
      />

      {/* Excel Import Dialog */}
      <ExcelImportDialog<ExcelProduct>
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title={t.inventoryPageUi.importDialogTitle}
        description={t.inventoryPageUi.importDialogDesc}
        parseFile={parseExcelFile}
        validateData={validateImportedProducts}
        onImport={handleImportProducts}
        downloadTemplate={downloadImportTemplate}
        columns={productImportColumns}
        duplicateKey="codigo"
        existingKeys={existingSkus}
        duplicateLabel="SKU"
        mappingType="products"
      />

      {/* Inventory Count Sheet Dialog */}
      <InventoryCountSheetDialog
        open={countSheetDialogOpen}
        onOpenChange={setCountSheetDialogOpen}
        products={products}
        branch={currentBranch}
        categories={[...new Set(products.map(p => p.category).filter(Boolean))]}
      />

      {/* Inventory Reconciliation Dialog */}
      <InventoryReconciliationDialog
        open={reconciliationDialogOpen}
        onOpenChange={setReconciliationDialogOpen}
        products={products}
        branch={currentBranch}
        categories={[...new Set(products.map(p => p.category).filter(Boolean))]}
        onReconcile={(adjustments) => {
          const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
          
          adjustments.forEach(adj => {
            const product = products.find(p => p.id === adj.productId);
            if (product) {
              // Update product stock to the counted value
              updateProduct({
                ...product,
                stock: adj.countedStock,
                updatedAt: new Date().toISOString(),
              });

              const movementType = adj.difference > 0 ? 'IN' : 'OUT';
              saveStockMovement({
                id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                productId: adj.productId,
                productName: product.name,
                sku: product.sku,
                branchId: currentBranch?.id || '',
                type: movementType,
                quantity: Math.abs(adj.difference),
                reason: 'adjustment',
                createdBy: currentUser?.id || 'system',
                notes: adj.reason,
                createdAt: new Date().toISOString(),
              });
            }
          });

          refreshProducts();
        }}
        currentUser={JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}')?.name}
      />

      {/* Inventory Adjustment Dialog */}
      <InventoryAdjustmentDialog
        open={adjustmentDialogOpen}
        onOpenChange={setAdjustmentDialogOpen}
        products={products}
        branch={currentBranch}
        onApplyAdjustments={handleApplyAdjustments}
      />

      {/* Stock Entry Dialog (Ajustar Entrada) */}
      <StockEntryDialog
        open={stockEntryDialogOpen}
        onOpenChange={setStockEntryDialogOpen}
        products={products}
        currentBranch={currentBranch}
        onApplyEntry={(items, sourceBranch, reference, notes) => {
          const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
          
          items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (product) {
              // Calculate new weighted average cost if freight was added
              const previousTotalValue = product.stock * (product.cost || 0);
              const newItemsTotalValue = item.quantity * (item.effectiveCost || item.cost);
              const newTotalStock = product.stock + item.quantity;
              
              // Weighted average cost = (previous value + new value) / total units
              const newAverageCost = newTotalStock > 0 
                ? (previousTotalValue + newItemsTotalValue) / newTotalStock
                : item.effectiveCost || item.cost;

              // Update product stock AND cost (with landed cost)
              updateProduct({
                ...product,
                stock: newTotalStock,
                cost: newAverageCost, // Update to weighted average landed cost
                updatedAt: new Date().toISOString(),
              });

              saveStockMovement({
                id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                productId: item.productId,
                productName: item.name,
                sku: item.sku,
                branchId: currentBranch?.id || '',
                type: 'IN',
                quantity: item.quantity,
                reason: 'transfer_in',
                createdBy: currentUser?.id || 'system',
                referenceNumber: reference,
                notes: `Transferência de ${sourceBranch}${notes ? ': ' + notes : ''}`,
                createdAt: new Date().toISOString(),
              });

              // Log transaction with cost update details
              logTransaction({
                category: 'inventory',
                action: 'stock_adjusted',
                entityType: 'Produto',
                entityId: item.productId,
                entityNumber: item.sku,
                entityName: item.name,
                description: `Entrada de ${item.quantity} un. - Ref: ${reference}${item.freightAllocation ? ' (c/ frete)' : ''}`,
                details: {
                  quantity: item.quantity,
                  sourceBranch,
                  reference,
                  notes,
                  unitCost: item.cost,
                  freightPerUnit: item.freightAllocation || 0,
                  effectiveCost: item.effectiveCost || item.cost,
                  previousCost: product.cost,
                  newAverageCost: newAverageCost,
                },
                previousValue: product.stock,
                newValue: newTotalStock,
              });
            }
          });

          refreshProducts();
        }}
      />

      {/* Stock Exit Dialog (Ajustar Saída) */}
      <StockExitDialog
        open={stockExitDialogOpen}
        onOpenChange={setStockExitDialogOpen}
        products={products}
        currentBranch={currentBranch}
        onApplyExit={(items, reason, notes, reference) => {
          const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
          
          items.forEach(item => {
            const product = products.find(p => p.id === item.productId);
            if (product) {
              // Update product stock
              const newStock = product.stock - item.quantity;
              updateProduct({
                ...product,
                stock: Math.max(0, newStock),
                updatedAt: new Date().toISOString(),
              });

              // Create stock movement record
              saveStockMovement({
                id: `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                productId: item.productId,
                productName: item.name,
                sku: item.sku,
                branchId: currentBranch?.id || '',
                type: 'OUT',
                quantity: item.quantity,
                reason: 'adjustment',
                createdBy: currentUser?.id || 'system',
                referenceNumber: reference,
                notes: `${reason}${notes ? ': ' + notes : ''}`,
                createdAt: new Date().toISOString(),
              });

              // Log transaction
              logTransaction({
                category: 'inventory',
                action: 'stock_adjusted',
                entityType: 'Produto',
                entityId: item.productId,
                entityNumber: item.sku,
                entityName: item.name,
                description: `Saída de ${item.quantity} un. - ${reason}`,
                details: {
                  quantity: item.quantity,
                  reason,
                  reference,
                  notes,
                  lossValue: item.quantity * item.cost,
                },
                previousValue: product.stock,
                newValue: Math.max(0, newStock),
              });
            }
          });

          refreshProducts();
        }}
      />

      {/* Shelf Label Print Dialog */}
      <ShelfLabelPrintDialog
        open={labelPrintDialogOpen}
        onOpenChange={setLabelPrintDialogOpen}
        products={selectedProduct ? [selectedProduct] : displayProducts}
      />
    </div>
  );
}