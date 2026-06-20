import { generateId } from '@/lib/utils';
import { enrichProductSupplier } from '@/lib/productSupplierResolve';
import {
  buildSellingPriceBySku,
  withSellingPriceFromMap,
} from '@/lib/productDedupe';
import {
  fetchSellingPriceHints,
  invalidateSellingPriceHintsCache,
  readSellingPriceHintsSession,
} from '@/lib/sellingPriceHints';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useProducts } from '@/hooks/useERP';
import { useInventoryGrid } from '@/hooks/useInventoryGrid';
import { invalidateInventoryGridCache, invalidateInventoryGridCacheForBranches, readProductStock } from '@/lib/inventoryGrid';
import { useInventoryBranchScope } from '@/hooks/useInventoryBranchScope';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { resolveBranchScopeDisplayLabel } from '@/lib/branchScopeDisplay';
import { normalizeIsMain } from '@/lib/branchAccess';
import { Product, StockMovement } from '@/types/erp';
import { api } from '@/lib/api/client';
import { DEFAULT_VAT_RATE, normalizeTaxRate } from '@/lib/taxUtils';
import { saveProduct, getProducts as storageGetProducts, getStockMovements as localGetStockMovements, PRODUCTS_CHANGED_EVENT } from '@/lib/storage';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  FileText, 
  Filter, 
  BarChart3, 
  Eye, 
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Download,
  ArrowRightLeft,
  Building2,
  Search,
  Percent,
} from 'lucide-react';
import { AdvancedDataGrid } from '@/components/inventory/AdvancedDataGrid';
import { ShelfLabelPrintDialog } from '@/components/inventory/ShelfLabelPrintDialog';
import { BulkTierPricingDialog } from '@/components/inventory/BulkTierPricingDialog';
import { ProductDetailDialog } from '@/components/inventory/ProductDetailDialog';
import { BranchStockDetail } from '@/components/inventory/BranchStockDetail';
import {
  filterMovementsForProduct,
  InventoryMonthlyMovementsPanel,
  InventoryMovementChartPanel,
  InventoryCostHistoryPanel,
  InventoryPurchasePricePanel,
  InventoryMonthlySalesPanel,
  InventoryProductOrdersPanel,
  InventoryBarcodeQtyPanel,
  InventoryProductAuditPanel,
  InventoryPendingTransfersPanel,
  InventorySerialNumbersPanel,
} from '@/components/inventory/InventoryProductPanels';
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
import { applyStockAdjustmentLines } from '@/lib/inventoryStockAdjust';
import { useTranslation } from '@/i18n';
import type { StockEntryReason } from '@/components/inventory/StockEntryDialog';
import { setContextMenuResolver } from '@/lib/contextMenuRegistry';
import type { StockExitReasonCode } from '@/components/inventory/StockExitDialog';
import { NEXOR_TOOLBAR } from '@/lib/nexorToolbarEvents';
import { NEXOR_ACTION_BTN, NEXOR_TAB_TRIGGER, NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';

type StockListFilter = 'all' | 'qtyGt0' | 'qtyLt0';

function mapMovementReason(referenceType: string, movementType: string): StockMovement['reason'] {
  const ref = String(referenceType || '').trim().toLowerCase();
  if (ref === 'transfer') {
    return String(movementType || '').toUpperCase() === 'IN' ? 'transfer_in' : 'transfer_out';
  }
  if (ref.includes('purchase') || ref === 'fatura_compra' || ref === 'purchase_order') {
    return 'purchase';
  }
  if (ref === 'sale' || ref.includes('sale')) return 'sale';
  if (ref === 'supplier_return' || ref === 'purchase_return' || ref === 'customer_return' || ref === 'sale_return') {
    return 'return';
  }
  const allowed: StockMovement['reason'][] = [
    'purchase', 'sale', 'transfer_in', 'transfer_out', 'adjustment', 'damage', 'return', 'initial',
  ];
  return (allowed.includes(ref as StockMovement['reason']) ? ref : 'adjustment') as StockMovement['reason'];
}

export default function Inventory() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    branches,
    allBranches,
    canSwitchBranch,
    userBranch,
    inventoryScopeId,
    setInventoryScope,
    isInventoryConsolidated,
    inventoryBranch,
    inventoryListBranchId,
  } = useInventoryBranchScope();
  const currentBranch = inventoryBranch;
  const isHeadOffice = isInventoryConsolidated;
  /** Per-branch qty breakdown — available whenever HQ can switch filials (not only "All branches" scope). */
  const showDetailedQtyTab = canSwitchBranch;
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  
  const isFilial = !isHeadOffice;
  
  /** Consolidated = sum all branches; otherwise stock for the selected branch (incl. main alone). */
  const listBranchId = inventoryListBranchId;
  const warehouseId = listBranchId ?? currentBranch?.id ?? null;

  const mainBranch = useMemo(
    () => branches.find((b) => normalizeIsMain(b.isMain)) ?? branches[0] ?? null,
    [branches],
  );

  const catalogListBranchId = canSwitchBranch
    ? mainBranch?.id
    : (listBranchId ?? mainBranch?.id);
  const {
    rows: inventoryRows,
    loading: inventoryGridLoading,
    refresh: refreshInventoryGrid,
    patchRow: patchInventoryRow,
  } = useInventoryGrid({
    branchId: listBranchId,
    consolidated: isHeadOffice,
  });

  const {
    refreshProducts,
    updateProduct,
    addProduct,
    deleteProduct,
  } = useProducts(catalogListBranchId, { light: true, enabled: false });

  const productsById = useMemo(
    () => new Map(inventoryRows.map((p) => [p.id, p])),
    [inventoryRows],
  );

  const [allBranchProducts, setAllBranchProducts] = useState<Record<string, Product[]>>({});
  const [sellingPriceHints, setSellingPriceHints] = useState<Record<string, number>>(
    () => readSellingPriceHintsSession(),
  );

  const mapApiRowToProduct = useCallback((p: any): Product => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode || '',
    category: p.category || 'GERAL',
    price: Number(p.price || 0),
    cost: Number(p.cost || 0),
    firstCost: Number(p.first_cost || p.firstCost || 0),
    lastCost: Number(p.last_cost || p.lastCost || 0),
    avgCost: Number(p.weighted_avg_cost || p.avg_cost || p.avgCost || 0),
    stock: readProductStock(p),
    unit: p.unit || 'UN',
    taxRate: normalizeTaxRate(p.tax_rate ?? p.taxRate),
    branchId: p.branch_id || p.branchId || null,
    supplierId: p.supplier_id || p.supplierId || null,
    supplierName: p.supplier_name || p.supplierName || '',
    isActive: p.is_active ?? p.isActive ?? true,
    createdAt: p.created_at || p.createdAt || '',
  }), []);

  const loadPerBranchBreakdown = useCallback(async () => {
    if (!canSwitchBranch) return;
    const branchList = allBranches.length > 0 ? allBranches : branches;
    const targets = branchList;
    const fetchOneBranch = async (branch: (typeof branchList)[0]) => {
      try {
        const result = await api.products.inventoryGrid({ branchId: branch.id });
        if (result.data?.rows && Array.isArray(result.data.rows)) {
          return {
            branchId: branch.id,
            rows: result.data.rows.map(mapApiRowToProduct),
          };
        }
      } catch {
        /* API failed — local fallback */
      }
      const prods = await storageGetProducts(branch.id);
      return { branchId: branch.id, rows: prods };
    };
    await Promise.all(
      targets.map(async (branch) => {
        const { branchId, rows } = await fetchOneBranch(branch);
        setAllBranchProducts((prev) => ({ ...prev, [branchId]: rows }));
      }),
    );
  }, [canSwitchBranch, branches, allBranches, mapApiRowToProduct]);

  const reloadInventoryList = useCallback(async () => {
    if (listBranchId && !isHeadOffice) {
      try {
        await api.products.repairFilialStock(listBranchId);
      } catch {
        /* non-blocking — grid still loads */
      }
    }
    invalidateInventoryGridCache(listBranchId, isHeadOffice);
    invalidateSellingPriceHintsCache();
    await fetchSellingPriceHints(true).then(setSellingPriceHints);
    await refreshInventoryGrid();
  }, [listBranchId, isHeadOffice, refreshInventoryGrid]);

  useEffect(() => {
    const onProductsChanged = (e: Event) => {
      const detail = (e as CustomEvent<{
        branchId?: string;
        toBranchId?: string;
        fromBranchId?: string;
        lightweight?: boolean;
      }>)?.detail;
      invalidateInventoryGridCache(listBranchId, isHeadOffice);
      if (detail?.toBranchId) invalidateInventoryGridCache(detail.toBranchId, false);
      if (detail?.fromBranchId) invalidateInventoryGridCache(detail.fromBranchId, false);
      if (detail?.branchId && detail.branchId !== 'all') {
        invalidateInventoryGridCache(detail.branchId, false);
      }
      if (detail?.lightweight) {
        void refreshInventoryGrid();
        return;
      }
      void reloadInventoryList();
      if (canSwitchBranch) void loadPerBranchBreakdown();
    };
    window.addEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
    return () => window.removeEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
  }, [listBranchId, isHeadOffice, reloadInventoryList, canSwitchBranch, loadPerBranchBreakdown]);

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
          branchId: m.warehouse_id || m.warehouseId || m.branch_id || m.branchId || '',
          branchName: m.branch_name || m.branchName || '',
          branchCode: m.branch_code || m.branchCode || '',
          createdByName: m.created_by_name || m.createdByName || '',
          type: (m.movement_type || m.type || 'IN') as 'IN' | 'OUT',
          quantity: Number(m.quantity) || 0,
          reason: mapMovementReason(
            m.reference_type || m.reason || 'purchase',
            m.movement_type || m.type || 'IN',
          ),
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

  const MOVEMENT_TABS = useMemo(
    () =>
      new Set([
        'extracto',
        'mes',
        'grafico',
        'preco-compra',
        'cost-history',
        'vendas-mensais',
      ]),
    [],
  );

  const priceAggregateSource = useMemo(() => {
    if (!isHeadOffice) return inventoryRows;
    const rows = [...inventoryRows];
    for (const branchRows of Object.values(allBranchProducts)) {
      rows.push(...branchRows);
    }
    return rows;
  }, [isHeadOffice, inventoryRows, allBranchProducts]);

  const sellingPriceBySku = useMemo(
    () => buildSellingPriceBySku(priceAggregateSource, sellingPriceHints),
    [priceAggregateSource, sellingPriceHints],
  );

  const displayProducts = useMemo(
    () => inventoryRows.map((p) => withSellingPriceFromMap(p, sellingPriceBySku)),
    [inventoryRows, sellingPriceBySku],
  );

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustmentBranchId, setAdjustmentBranchId] = useState('');
  const flatCatalog = useMemo(() => {
    const rows = [...inventoryRows];
    for (const branchRows of Object.values(allBranchProducts)) {
      rows.push(...branchRows);
    }
    return rows;
  }, [inventoryRows, allBranchProducts]);

  const stockEntrySearchProducts = useMemo(() => {
    if (canSwitchBranch && Object.keys(allBranchProducts).length > 0) {
      return Object.entries(allBranchProducts).flatMap(([branchId, prods]) =>
        prods
          .filter((p) => p.isActive !== false)
          .map((p) => ({ ...p, branchId: p.branchId || branchId })),
      );
    }
    const branchId = listBranchId || currentBranch?.id || '';
    return inventoryRows.map((p) => ({ ...p, branchId: p.branchId || branchId }));
  }, [canSwitchBranch, allBranchProducts, inventoryRows, listBranchId, currentBranch?.id]);

  /** Full catalog for exit search (stock checked when selecting a line, not when searching). */
  const adjustmentProducts = useMemo(() => {
    const bid = adjustmentBranchId || listBranchId || currentBranch?.id || '';
    if (!bid) return inventoryRows;
    if (bid === (listBranchId || '')) return inventoryRows;
    const cached = allBranchProducts[bid];
    if (cached?.length) return cached;
    return inventoryRows.filter((p) => !p.branchId || p.branchId === bid);
  }, [adjustmentBranchId, listBranchId, currentBranch?.id, inventoryRows, allBranchProducts]);

  const [productCreateScopeBranchId, setProductCreateScopeBranchId] = useState<string | null>(null);

  const openNewProductDialog = useCallback((branchId?: string) => {
    setSelectedProduct(null);
    setProductCreateScopeBranchId(
      branchId || listBranchId || currentBranch?.id || null,
    );
    setDialogOpen(true);
  }, [listBranchId, currentBranch?.id]);

  const stockExitSearchProducts = useMemo(() => {
    if (stockEntrySearchProducts.length > 0) return stockEntrySearchProducts;
    if (flatCatalog.length > 0) return flatCatalog;
    return inventoryRows;
  }, [stockEntrySearchProducts, flatCatalog, inventoryRows]);

  const enrichedSelectedProduct = useMemo(() => {
    if (!selectedProduct) return null;
    const base = withSellingPriceFromMap(selectedProduct, sellingPriceBySku);
    return enrichProductSupplier(base, flatCatalog);
  }, [selectedProduct, sellingPriceBySku, flatCatalog]);

  const dialogProduct = useMemo(() => {
    if (!enrichedSelectedProduct) return null;
    return enrichedSelectedProduct;
  }, [enrichedSelectedProduct]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [countSheetDialogOpen, setCountSheetDialogOpen] = useState(false);
  const [reconciliationDialogOpen, setReconciliationDialogOpen] = useState(false);
  const [physicalCountBranchId, setPhysicalCountBranchId] = useState('');
  const [physicalCountProducts, setPhysicalCountProducts] = useState<Product[]>([]);
  const [physicalCountLoading, setPhysicalCountLoading] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [stockEntryDialogOpen, setStockEntryDialogOpen] = useState(false);
  const [stockExitDialogOpen, setStockExitDialogOpen] = useState(false);
  const [labelPrintDialogOpen, setLabelPrintDialogOpen] = useState(false);
  const [bulkTierDialogOpen, setBulkTierDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('lista');

  const branchList = allBranches.length > 0 ? allBranches : branches;

  const physicalCountBranch = useMemo(
    () => branchList.find((b) => b.id === physicalCountBranchId) || currentBranch,
    [branchList, physicalCountBranchId, currentBranch],
  );

  const resolvePhysicalCountBranchId = useCallback(
    () => listBranchId || currentBranch?.id || mainBranch?.id || '',
    [listBranchId, currentBranch?.id, mainBranch?.id],
  );

  const openCountSheetDialog = useCallback(() => {
    setPhysicalCountBranchId(resolvePhysicalCountBranchId());
    setCountSheetDialogOpen(true);
  }, [resolvePhysicalCountBranchId]);

  const openReconciliationDialog = useCallback(() => {
    setPhysicalCountBranchId(resolvePhysicalCountBranchId());
    setReconciliationDialogOpen(true);
  }, [resolvePhysicalCountBranchId]);

  useEffect(() => {
    if (!countSheetDialogOpen && !reconciliationDialogOpen) return;
    const bid = physicalCountBranchId || resolvePhysicalCountBranchId();
    if (!bid) {
      setPhysicalCountProducts([]);
      setPhysicalCountLoading(false);
      return;
    }
    if (!isHeadOffice && bid === listBranchId) {
      setPhysicalCountProducts(inventoryRows);
      setPhysicalCountLoading(false);
      return;
    }

    let cancelled = false;
    setPhysicalCountLoading(true);
    void api.products.inventoryGrid({ branchId: bid }).then((result) => {
      if (cancelled) return;
      const rows = result.data?.rows;
      if (rows && Array.isArray(rows)) {
        setPhysicalCountProducts(rows.map(mapApiRowToProduct));
      } else {
        setPhysicalCountProducts(
          inventoryRows.filter((p) => !p.branchId || p.branchId === bid),
        );
      }
      setPhysicalCountLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPhysicalCountProducts(inventoryRows);
      setPhysicalCountLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    countSheetDialogOpen,
    reconciliationDialogOpen,
    physicalCountBranchId,
    resolvePhysicalCountBranchId,
    listBranchId,
    isHeadOffice,
    inventoryRows,
    mapApiRowToProduct,
  ]);

  useEffect(() => {
    if (!showDetailedQtyTab && activeTab === 'qtd-detalhada') {
      setActiveTab('lista');
    }
  }, [showDetailedQtyTab, activeTab]);

  useEffect(() => {
    if (canSwitchBranch) {
      void loadPerBranchBreakdown();
    }
  }, [canSwitchBranch, loadPerBranchBreakdown, listBranchId, isHeadOffice]);

  useEffect(() => {
    setSelectedProduct(null);
    const branchIds = (allBranches.length > 0 ? allBranches : branches).map((b) => b.id);
    invalidateInventoryGridCacheForBranches(branchIds);
  }, [inventoryScopeId, allBranches, branches]);

  useEffect(() => {
    if (showDetailedQtyTab) {
      void loadPerBranchBreakdown();
    }
  }, [showDetailedQtyTab, loadPerBranchBreakdown, listBranchId, isHeadOffice]);
  const [stockListFilter, setStockListFilter] = useState<StockListFilter>('all');
  const [listSearch, setListSearch] = useState('');
  const listSearchRef = useRef<HTMLInputElement>(null);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  const attemptDeleteProduct = useCallback(
    async (product: Product) => {
      const check = await api.products.canDelete(product.id);
      if (check.data && !check.data.deletable) {
        toast.error(t.inventoryUi.cannotDeleteHasTransactions);
        return;
      }
      if (!confirm(t.inventoryUi.deleteConfirm)) return;
      try {
        await deleteProduct(product.id);
        toast.success(t.inventoryUi.productDeleted);
        if (selectedProduct?.id === product.id) {
          setSelectedProduct(null);
        }
        void refreshInventoryGrid();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message || t.inventoryUi.cannotDeleteHasTransactions);
      }
    },
    [deleteProduct, refreshInventoryGrid, selectedProduct?.id, t],
  );

  useEffect(() => {
    if (!MOVEMENT_TABS.has(activeTab)) return;
    void loadStockMovements();
  }, [activeTab, loadStockMovements, MOVEMENT_TABS]);

  const gridProducts = useMemo(() => {
    let rows = displayProducts;
    if (stockListFilter === 'qtyGt0') {
      rows = rows.filter((p) => readProductStock(p) > 0.0001);
    } else if (stockListFilter === 'qtyLt0') {
      rows = rows.filter((p) => readProductStock(p) <= 0.0001);
    }

    const q = listSearch.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((p) => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      const category = (p.category || '').toLowerCase();
      const supplier = (p.supplierName || '').toLowerCase();
      return (
        sku.includes(q)
        || name.includes(q)
        || barcode.includes(q)
        || category.includes(q)
        || supplier.includes(q)
      );
    });
  }, [displayProducts, stockListFilter, listSearch]);

  // While searching, auto-select the top matching product so every tab (Detailed Qty,
  // Statement, Chart, …) shows its info without the user having to click the row first.
  // Keeps the current selection if it still matches the search; otherwise picks the first hit.
  useEffect(() => {
    if (!listSearch.trim()) return;
    if (gridProducts.length === 0) return;
    setSelectedProduct((prev) =>
      prev && gridProducts.some((p) => p.id === prev.id) ? prev : gridProducts[0],
    );
  }, [listSearch, gridProducts]);

  const navigateProduct = useCallback((direction: -1 | 1) => {
    if (!gridProducts.length) return;
    const currentIndex = selectedProduct
      ? gridProducts.findIndex((p) => p.id === selectedProduct.id)
      : -1;
    const nextIndex = (currentIndex + direction + gridProducts.length) % gridProducts.length;
    setSelectedProduct(gridProducts[nextIndex]);
  }, [gridProducts, selectedProduct]);

  const handleOpenDialog = (product?: Product) => {
    setSelectedProduct(product || null);
    setDialogOpen(true);
  };

  const handleDoubleClickProduct = (product: Product) => {
    setSelectedProduct(product);
    setDialogOpen(true);
  };

  // TopNav toolbar actions
  useEffect(() => {
    const onDelete = () => {
      if (selectedProduct) void attemptDeleteProduct(selectedProduct);
    };
    const onEdit = () => {
      if (selectedProduct) handleOpenDialog(selectedProduct);
    };
    const onAll = () => {
      setActiveTab('lista');
      setStockListFilter('all');
      setListSearch('');
      setSelectedProduct(null);
      setDialogOpen(false);
    };
    const onAdjustExit = () => setStockExitDialogOpen(true);
    const onEntry = () => setStockEntryDialogOpen(true);
    const onMinQty = () => {
      setStockListFilter('qtyGt0');
      toast.info(t.inventoryPageUi.qtyGt0);
    };
    const onFilter = () => {
      setStockListFilter((prev) => {
        const next: StockListFilter = prev === 'all' ? 'qtyGt0' : prev === 'qtyGt0' ? 'qtyLt0' : 'all';
        return next;
      });
    };
    const onExcel = () => {
      exportProductsToExcel(gridProducts);
      toast.success(t.inventoryPageUi.exportedToExcel);
    };

    const onCountSheet = () => openCountSheetDialog();
    const onReconcile = () => openReconciliationDialog();
    const onImport = () => setImportDialogOpen(true);
    const onLabels = () => setLabelPrintDialogOpen(true);
    const onAdjustStock = () => {
      const bid = listBranchId || currentBranch?.id || '';
      setAdjustmentBranchId(bid);
      if (canSwitchBranch) void loadPerBranchBreakdown();
      setAdjustmentDialogOpen(true);
    };

    const map: Record<string, () => void> = {
      [NEXOR_TOOLBAR.DELETE]: onDelete,
      [NEXOR_TOOLBAR.EDIT]: onEdit,
      [NEXOR_TOOLBAR.ALL]: onAll,
      [NEXOR_TOOLBAR.INVENTORY_ADJUST_EXIT]: onAdjustExit,
      [NEXOR_TOOLBAR.INVENTORY_ENTRY]: onEntry,
      [NEXOR_TOOLBAR.INVENTORY_MIN_QTY]: onMinQty,
      [NEXOR_TOOLBAR.INVENTORY_COUNT_SHEET]: onCountSheet,
      [NEXOR_TOOLBAR.INVENTORY_RECONCILE]: onReconcile,
      [NEXOR_TOOLBAR.INVENTORY_IMPORT]: onImport,
      [NEXOR_TOOLBAR.INVENTORY_LABELS]: onLabels,
      [NEXOR_TOOLBAR.INVENTORY_ADJUST_STOCK]: onAdjustStock,
      [NEXOR_TOOLBAR.FILTER]: onFilter,
      [NEXOR_TOOLBAR.EXCEL]: onExcel,
    };

    for (const [event, handler] of Object.entries(map)) {
      window.addEventListener(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(map)) {
        window.removeEventListener(event, handler);
      }
    };
  }, [
    selectedProduct,
    attemptDeleteProduct,
    gridProducts,
    t,
    openCountSheetDialog,
    openReconciliationDialog,
    listBranchId,
    currentBranch?.id,
    canSwitchBranch,
    loadPerBranchBreakdown,
  ]);

  useEffect(() => {
    setContextMenuResolver((target) => {
      const row = target.closest('[data-nexor-context="inventory-row"]');
      if (!row) return [];
      const productId = row.getAttribute('data-nexor-id');
      const product = gridProducts.find((p) => p.id === productId);
      if (!product) return [];

      return [
        {
          id: 'inv-edit',
          label: t.interaction.openEdit,
          onSelect: () => handleOpenDialog(product),
        },
        {
          id: 'inv-delete',
          label: t.common.delete,
          destructive: true,
          onSelect: () => void attemptDeleteProduct(product),
        },
      ];
    });
    return () => setContextMenuResolver(null);
  }, [gridProducts, attemptDeleteProduct, t]);

  // TopNav toolbar "Novo"
  useEffect(() => {
    const st = location.state as {
      nexorToolbarNewProduct?: boolean;
      openCountSheet?: boolean;
      openReconcile?: boolean;
    } | null;
    if (st?.openCountSheet) {
      openCountSheetDialog();
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (st?.openReconcile) {
      openReconciliationDialog();
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (!st?.nexorToolbarNewProduct) return;
    setSelectedProduct(null);
    setDialogOpen(true);
    navigate('.', { replace: true, state: {} });
  }, [location.state, navigate, openCountSheetDialog, openReconciliationDialog, location.pathname]);

  const handleSaveProduct = async (product: Product & { preserveStock?: boolean }) => {
    const targetBranchId =
      (product.branchId && product.branchId !== 'all' ? product.branchId : null)
      || listBranchId
      || inventoryBranch?.id
      || mainBranch?.id
      || '';
    const gridProduct: Product = {
      ...product,
      branchId: targetBranchId,
    };
    patchInventoryRow(gridProduct);
    const writeOpts = { skipListMerge: true, lightweightChangedEvent: false } as const;
    let savedRow: Product | null = null;
    try {
      if (selectedProduct) {
        const saved = await updateProduct(gridProduct, writeOpts);
        savedRow = { ...saved, branchId: saved.branchId || gridProduct.branchId };
        patchInventoryRow(savedRow);
        setSelectedProduct((prev) =>
          prev && prev.id === product.id ? { ...prev, ...saved } : prev,
        );
        toast.success(t.productFormUi.productUpdated);
      } else {
        const saved = await addProduct(gridProduct, writeOpts);
        savedRow = { ...saved, branchId: saved.branchId || gridProduct.branchId };
        patchInventoryRow(savedRow);
        toast.success(t.productFormUi.productCreated);
        setSelectedProduct(null);
      }
      await reloadInventoryList();
      if (savedRow) {
        patchInventoryRow(savedRow);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message || t.productFormUi.productSaveFailed);
      invalidateInventoryGridCache(listBranchId, isHeadOffice);
      void refreshInventoryGrid();
      throw e;
    }
  };

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
  };

  const handleImportProducts = async (data: ExcelProduct[], options?: { updateDuplicates?: boolean }) => {
    // Assign to the inventory scope branch so branch-filtered lists show imported rows (global null + zero stock are hidden).
    const importBranchId =
      listBranchId ?? mainBranch?.id ?? currentBranch?.id ?? userBranch?.id ?? null;

    const productsToImport = data.map((item) => ({
        sku: item.codigo,
        name: item.descricao,
        barcode: item.codigoBarras || '',
        category: item.categoria || 'GERAL',
        price: item.preco,
        cost: item.custo,
        stock: item.quantidade,
        unit: item.unidade || 'UN',
        taxRate: item.iva ?? DEFAULT_VAT_RATE,
        isActive: true,
        branchId: importBranchId,
      }));

    if (productsToImport.length === 0) {
      toast.info(t.inventoryUi.noNewProductsToImport);
      return;
    }

    try {
      const result = await api.products.batchImport(productsToImport);
      if (result.error) {
        throw new Error(result.error);
      }
      if (result.data) {
        const { imported = 0, updated = 0, failed = 0 } = result.data;
        const saved = imported + updated;
        const messages: string[] = [];
        if (imported > 0) messages.push(t.inventoryUi.importedCount.replace('{count}', String(imported)));
        if (updated > 0) messages.push(`${updated} ${language === 'pt' ? 'actualizados' : 'updated'}`);
        if (failed > 0) messages.push(t.inventoryUi.failedCount.replace('{count}', String(failed)));
        if (saved > 0) {
          toast.success(messages.join(', ') || t.inventoryUi.importCompleted);
        } else if (failed > 0) {
          toast.error(messages.join(', ') || t.inventoryUi.importError);
        } else {
          toast.info(t.inventoryUi.noNewProductsToImport);
        }
      } else {
        throw new Error(t.inventoryUi.importError);
      }
    } catch (error: unknown) {
      console.error('Import error:', error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message || t.inventoryUi.importError);
    }

    await reloadInventoryList();
  };

  // Handle stock adjustments from physical count
  const handleApplyAdjustments = (
    adjustments: { productId: string; newStock: number; difference: number }[],
    reason: string,
    notes: string,
    receiptNumber: string,
    warehouseId: string,
  ) => {
    const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
    const noteParts = [
      reason,
      receiptNumber ? `${t.inventoryAdjustUi.receiptNumber}: ${receiptNumber}` : null,
      notes || null,
    ].filter(Boolean);
    const movementNotes = noteParts.join(' — ');
    
    adjustments.forEach(adj => {
      const product = adjustmentProducts.find(p => p.id === adj.productId)
        ?? inventoryRows.find(p => p.id === adj.productId);
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
          branchId: warehouseId || currentBranch?.id || '',
          type: adj.difference > 0 ? 'IN' : 'OUT',
          quantity: Math.abs(adj.difference),
          reason: 'adjustment',
          createdBy: currentUser?.id || 'system',
          notes: movementNotes,
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

    void reloadInventoryList();
  };

  const entryReferenceType = (reason: StockEntryReason): string => {
    if (reason === 'purchase') return 'purchase';
    if (reason === 'transfer_in') return 'transfer';
    if (reason === 'initial') return 'initial';
    return 'adjustment';
  };

  const exitReferenceType = (code: StockExitReasonCode): string => {
    if (code === 'expired' || code === 'damaged' || code === 'loss') return 'damage';
    return 'adjustment';
  };

  const refreshInventoryAfterStockAdjust = useCallback(
    async (targetWarehouseId: string) => {
      window.dispatchEvent(
        new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId: targetWarehouseId } }),
      );
      await reloadInventoryList();
      await loadStockMovements();
    },
    [reloadInventoryList, loadStockMovements],
  );

  const handleApplyStockEntry = useCallback(
    async (
      items: {
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        effectiveCost?: number;
        cost: number;
      }[],
      meta: {
        reason: StockEntryReason;
        reference: string;
        entryDate: string;
        warehouseId: string;
        branchName: string;
        currency: string;
        currencyRate: number;
        notes: string;
        totalLandingCosts?: number;
        freightSourceAccount?: string;
        freightSourceName?: string;
      },
    ) => {
      const targetWarehouseId = meta.warehouseId || warehouseId;
      if (!targetWarehouseId) {
        toast.error(t.stockEntryUi.branchRequiredDesc);
        return;
      }

      const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
      const noteParts = [
        meta.entryDate ? `${t.stockEntryUi.entryDate}: ${meta.entryDate}` : null,
        meta.branchName ? `${t.stockEntryUi.branch}: ${meta.branchName}` : null,
        meta.currency && meta.currency !== 'KZ'
          ? `${t.stockEntryUi.currency}: ${meta.currency} · ${t.stockEntryUi.exchangeRate}: ${meta.currencyRate}`
          : null,
        meta.reason === 'transfer_in' ? t.stockEntryUi.reasonTransferIn : null,
        meta.notes,
      ].filter(Boolean);

      const result = await applyStockAdjustmentLines({
        lines: items.map((item) => ({
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitCost: item.effectiveCost ?? item.cost,
        })),
        warehouseId: targetWarehouseId,
        movementType: 'IN',
        referenceType: entryReferenceType(meta.reason),
        referenceNumber: meta.reference,
        entryDate: meta.entryDate,
        notes: noteParts.join(' — ') || meta.reference,
        createdBy: currentUser?.id || currentUser?.name || 'system',
        productsById,
        fallbackUpdateProduct: updateProduct,
        landingCosts: meta.totalLandingCosts,
        freightSourceAccount: meta.freightSourceAccount,
        freightSourceName: meta.freightSourceName,
      });

      for (const item of items) {
        const product = productsById.get(item.productId);
        if (!product) continue;
        logTransaction({
          category: 'inventory',
          action: 'stock_adjusted',
          entityType: 'Produto',
          entityId: item.productId,
          entityNumber: item.sku,
          entityName: item.name,
          description: `+${item.quantity} ${item.name} — ${meta.reference}`,
          details: { reason: meta.reason, reference: meta.reference, notes: meta.notes },
          previousValue: product.stock,
          newValue: (product.stock ?? 0) + item.quantity,
        });
      }

      await refreshInventoryAfterStockAdjust(targetWarehouseId);
      if (result.errors.length > 0) {
        toast.error(result.errors.slice(0, 3).join('; '));
      } else if (result.applied > 0) {
        const msg = t.stockEntryUi.productsAddedDesc.replace('{count}', String(result.applied));
        toast.success(
          result.journalEntryId ? `${msg} (${t.stockEntryUi.journalPosted})` : msg,
        );
      } else {
        toast.error(t.stockEntryUi.saveFailed);
      }
    },
    [warehouseId, productsById, updateProduct, refreshInventoryAfterStockAdjust, t],
  );

  const handleApplyStockExit = useCallback(
    async (
      items: {
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        cost: number;
      }[],
      meta: {
        reasonCode: StockExitReasonCode;
        reasonLabel: string;
        notes: string;
        reference: string;
        exitDate: string;
        warehouseId: string;
        branchName: string;
        currency: string;
        currencyRate: number;
      },
    ) => {
      const targetWarehouseId = meta.warehouseId || warehouseId;
      if (!targetWarehouseId) {
        toast.error(t.stockExitUi.branchRequiredDesc);
        return;
      }

      const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
      const noteParts = [
        meta.exitDate ? `${t.stockExitUi.exitDate}: ${meta.exitDate}` : null,
        meta.branchName ? `${t.stockExitUi.branch}: ${meta.branchName}` : null,
        meta.currency && meta.currency !== 'KZ'
          ? `${t.stockExitUi.currency}: ${meta.currency} · ${t.stockExitUi.exchangeRate}: ${meta.currencyRate}`
          : null,
        meta.reasonLabel,
        meta.notes,
      ].filter(Boolean);
      const notes = noteParts.join(' — ');

      const result = await applyStockAdjustmentLines({
        lines: items.map((item) => ({
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitCost: item.cost,
        })),
        warehouseId: targetWarehouseId,
        movementType: 'OUT',
        referenceType: meta.reasonCode,
        referenceNumber: meta.reference,
        entryDate: meta.exitDate,
        notes,
        createdBy: currentUser?.id || currentUser?.name || 'system',
        productsById,
        fallbackUpdateProduct: updateProduct,
      });

      for (const item of items) {
        const product = productsById.get(item.productId);
        if (!product) continue;
        const newStock = Math.max(0, (product.stock ?? 0) - item.quantity);
        logTransaction({
          category: 'inventory',
          action: 'stock_adjusted',
          entityType: 'Produto',
          entityId: item.productId,
          entityNumber: item.sku,
          entityName: item.name,
          description: `-${item.quantity} ${item.name} — ${meta.reasonLabel}`,
          details: {
            reason: meta.reasonCode,
            reference: meta.reference,
            notes: meta.notes,
            lossValue: item.quantity * item.cost,
          },
          previousValue: product.stock,
          newValue: newStock,
        });
      }

      await refreshInventoryAfterStockAdjust(targetWarehouseId);
      if (result.errors.length > 0) {
        toast.error(result.errors.slice(0, 3).join('; '));
      } else if (result.applied > 0) {
        const msg = t.stockExitUi.productsRemovedDesc.replace('{count}', String(result.applied));
        toast.success(
          result.journalEntryId ? `${msg} (${t.stockExitUi.journalPosted})` : msg,
        );
      } else {
        toast.error(t.stockExitUi.saveFailed);
      }
    },
    [warehouseId, productsById, updateProduct, refreshInventoryAfterStockAdjust, t],
  );

  // Get existing SKUs for duplicate detection
  const existingSkus = inventoryRows.map(p => p.sku);

  const productImportColumns: { key: keyof ExcelProduct; label: string }[] = [
    { key: 'codigo', label: t.inventoryUi.colCode },
    { key: 'descricao', label: t.inventoryUi.colDescription },
    { key: 'preco', label: t.inventoryUi.colPrice },
    { key: 'quantidade', label: 'Qtd' },
    { key: 'categoria', label: 'Categoria' },
  ];

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

  const scopedBranchIds = useMemo(
    () => (allBranches.length > 0 ? allBranches : branches).map((b) => b.id),
    [allBranches, branches],
  );

  const branchById = useMemo(() => {
    const map = new Map<string, (typeof branches)[number]>();
    for (const b of [...allBranches, ...branches]) {
      if (b.id) map.set(b.id, b);
    }
    return map;
  }, [allBranches, branches]);

  const formatMovementBranch = useCallback((movement: StockMovement) => {
    if (movement.branchName?.trim()) return movement.branchName.trim();
    const branch = branchById.get(movement.branchId);
    if (branch) return formatBranchDisplayName(branch);
    return movement.branchId || '—';
  }, [branchById]);

  const formatMovementUser = useCallback((movement: StockMovement) => {
    if (movement.createdByName?.trim()) return movement.createdByName.trim();
    const id = String(movement.createdBy || '').trim();
    if (!id || id === 'system') return t.inventoryPageUi.table.systemUser;
    return id;
  }, [t]);

  const selectedProductMovements = useMemo(() => {
    return filterMovementsForProduct(stockMovements, enrichedSelectedProduct, allBranchProducts, scopedBranchIds)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [enrichedSelectedProduct, stockMovements, allBranchProducts, scopedBranchIds]);

  const panelProps = useMemo(
    () => ({
      product: enrichedSelectedProduct,
      movements: stockMovements,
      allBranchProducts,
      scopedBranchIds,
      uiLocale,
      getReasonLabel: getMovementReasonLabel,
    }),
    [enrichedSelectedProduct, stockMovements, allBranchProducts, scopedBranchIds, uiLocale, getMovementReasonLabel]
  );

  const tabPanelClass = 'flex-1 min-h-0 m-0 p-4 overflow-auto data-[state=inactive]:hidden';

  const movementSummary = useMemo(() => selectedProductMovements.reduce((acc, movement) => ({
    entries: acc.entries + (movement.type === 'IN' ? movement.quantity : 0),
    exits: acc.exits + (movement.type === 'OUT' ? movement.quantity : 0),
  }), { entries: 0, exits: 0 }), [selectedProductMovements]);

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
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-card/50 border-b backdrop-blur-sm">
        {canSwitchBranch && (
          <BranchSelector
            compact
            includeAllBranches
            branchList={allBranches.length > 0 ? allBranches : branches}
            inventoryScopeId={inventoryScopeId}
            onInventoryScopeChange={setInventoryScope}
          />
        )}
        {canSwitchBranch && inventoryBranch && (
          <span
            className="text-[10px] text-muted-foreground truncate max-w-[9rem] shrink-0"
            title={resolveBranchScopeDisplayLabel(
              canSwitchBranch,
              inventoryScopeId,
              inventoryBranch,
              t.branchUi.allBranches,
            )}
          >
            {isHeadOffice
              ? t.inventoryGridUi.totalQty
              : formatBranchDisplayName(inventoryBranch)}
          </span>
        )}
        {canSwitchBranch && <div className="w-px h-5 bg-border mx-1" />}
        <div className="relative shrink-0 w-[min(100%,16rem)]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
          <Input
            ref={listSearchRef}
            type="search"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gridProducts.length > 0) {
                setSelectedProduct(gridProducts[0]);
                setActiveTab('lista');
              }
              if (e.key === 'Escape') {
                setListSearch('');
                listSearchRef.current?.blur();
              }
            }}
            placeholder={t.inventoryPageUi.searchListPlaceholder}
            className="h-7 pl-7 text-xs bg-background"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <Button variant="outline" size="sm" className={NEXOR_TOOLBAR_BTN_SM} onClick={() => {
          setStockListFilter((prev) => prev === 'all' ? 'qtyGt0' : prev === 'qtyGt0' ? 'qtyLt0' : 'all');
        }}>
          <Filter className="w-3 h-3" />
          {t.common.filters}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          onClick={() => {
            exportProductsToExcel(inventoryRows);
            toast.success(t.inventoryPageUi.exportedToExcel);
          }}
        >
          <Download className="w-3 h-3" />
          {t.common.export}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          onClick={() => setBulkTierDialogOpen(true)}
          title={t.inventoryPageUi.tierPricing.title}
        >
          <Percent className="w-3 h-3" />
          {t.inventoryPageUi.tierPricing.button}
        </Button>

        <div className="flex-1" />

        {/* Selected product quick navigation (display only — use search box above to filter) */}
        <div className="flex items-center gap-1 border rounded px-2 py-1 bg-background shrink-0 max-w-[min(100%,20rem)]">
          <span className="text-xs font-mono font-medium min-w-[4rem] truncate">
            {selectedProduct?.sku || t.inventoryUi.codePlaceholder}
          </span>
          <span className="text-xs text-muted-foreground truncate">{selectedProduct?.name || ''}</span>
          <div className="flex gap-0.5 ml-2">
            <Button variant="ghost" size="icon" className="h-5 w-5 text-foreground" onClick={() => navigateProduct(-1)}>
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5 text-foreground" onClick={() => navigateProduct(1)}>
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          <TabsTrigger value="lista" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.list}
          </TabsTrigger>
          <TabsTrigger value="extracto" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.statement}
          </TabsTrigger>
          <TabsTrigger value="mes" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.month}
          </TabsTrigger>
          {showDetailedQtyTab && (
            <TabsTrigger value="qtd-detalhada" className={NEXOR_TAB_TRIGGER}>
              {t.inventoryPageUi.tabs.detailedQty}
            </TabsTrigger>
          )}
          <TabsTrigger value="transferencia" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.pendingTransfer}
          </TabsTrigger>
          <TabsTrigger value="grafico" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.chart}
          </TabsTrigger>
          <TabsTrigger value="preco-compra" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.purchasePrice}
          </TabsTrigger>
          <TabsTrigger value="no-serie" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.serialNo}
          </TabsTrigger>
          <TabsTrigger value="info-produto" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.productInfo}
          </TabsTrigger>
          <TabsTrigger value="cost-history" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.costHistory}
          </TabsTrigger>
          <TabsTrigger value="pedidos" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.orders}
          </TabsTrigger>
          <TabsTrigger value="barcode-qty" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.barcodeQty}
          </TabsTrigger>
          <TabsTrigger value="vendas-mensais" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.monthlySales}
          </TabsTrigger>
          <TabsTrigger value="auditoria" className={NEXOR_TAB_TRIGGER}>
            {t.inventoryPageUi.tabs.audit}
          </TabsTrigger>
        </TabsList>

        {/* Action buttons row */}
        <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 border-b">
          <div className="flex-1" />
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setActiveTab('info-produto')}>
            <FileText className="w-3 h-3" />
            {t.inventoryPageUi.note}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setStockListFilter('all')}>
            {t.common.all}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setStockListFilter('qtyGt0')}>
            {t.inventoryPageUi.qtyGt0}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setStockListFilter('qtyLt0')}>
            {t.inventoryPageUi.qtyLt0}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setActiveTab('preco-compra')}>
            {t.inventoryPageUi.costLt}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => setActiveTab('grafico')}>
            <BarChart3 className="w-3 h-3" />
            {t.inventoryPageUi.chart}
          </Button>
          <Button variant="outline" size="sm" className={NEXOR_ACTION_BTN} onClick={() => selectedProduct && handleOpenDialog(selectedProduct)} disabled={!selectedProduct}>
            <Eye className="w-3 h-3" />
            {t.inventoryPageUi.view}
          </Button>
        </div>

        <TabsContent value="lista" forceMount className="flex-1 min-h-0 m-0 p-2 data-[state=inactive]:hidden overflow-auto">
          {gridProducts.length === 0 && inventoryGridLoading ? (
            <p className="text-center py-16 text-muted-foreground">{t.common.loading}</p>
          ) : (
            <AdvancedDataGrid 
              key={isHeadOffice ? 'hq' : (listBranchId || 'none')}
              products={gridProducts}
              onSelectProduct={handleSelectProduct}
              onDoubleClickProduct={handleDoubleClickProduct}
              selectedProductId={selectedProduct?.id}
              isHeadOffice={isHeadOffice}
              branches={branches}
              allBranchProducts={allBranchProducts}
              preSorted
            />
          )}
        </TabsContent>

        <TabsContent value="extracto" className={tabPanelClass}>
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
                        <TableHead>{t.inventoryPageUi.table.branch}</TableHead>
                        <TableHead>{t.inventoryPageUi.table.user}</TableHead>
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
                          <TableCell className="text-xs">{formatMovementBranch(movement)}</TableCell>
                          <TableCell className="text-xs">{formatMovementUser(movement)}</TableCell>
                          <TableCell className="text-right font-mono">{movement.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{(movement.costAtTime || 0).toLocaleString(uiLocale, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-xs">{movement.notes || '—'}</TableCell>
                        </TableRow>
                      ))}
                      {selectedProductMovements.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{t.inventoryUi.noMovementsForProduct}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="mes" className={tabPanelClass}>
          <InventoryMonthlyMovementsPanel
            product={selectedProduct}
            movements={stockMovements}
            allBranchProducts={allBranchProducts}
          />
        </TabsContent>

        {showDetailedQtyTab && (
          <TabsContent value="qtd-detalhada" className={tabPanelClass}>
            <BranchStockDetail
              selectedProduct={selectedProduct}
              allBranchProducts={allBranchProducts}
              branchList={allBranches.length > 0 ? allBranches : branches}
            />
          </TabsContent>
        )}

        <TabsContent value="transferencia" forceMount className={tabPanelClass}>
          <InventoryPendingTransfersPanel
            product={selectedProduct}
            allBranchProducts={allBranchProducts}
            scopedBranchIds={scopedBranchIds}
            isInventoryConsolidated={isInventoryConsolidated}
            inventoryListBranchId={inventoryListBranchId}
            isActive={activeTab === 'transferencia'}
          />
        </TabsContent>

        <TabsContent value="grafico" className={tabPanelClass}>
          <InventoryMovementChartPanel
            product={selectedProduct}
            movements={stockMovements}
            allBranchProducts={allBranchProducts}
          />
        </TabsContent>

        <TabsContent value="preco-compra" className={tabPanelClass}>
          <InventoryPurchasePricePanel {...panelProps} />
        </TabsContent>

        <TabsContent value="no-serie" className={tabPanelClass}>
          <InventorySerialNumbersPanel product={selectedProduct} />
        </TabsContent>

        <TabsContent value="info-produto" className={tabPanelClass}>
          {selectedProduct ? (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><strong>SKU:</strong> {selectedProduct.sku}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.name}</strong> {selectedProduct.name}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.category}</strong> {selectedProduct.category}</div>
                  <div><strong>{t.inventoryPageUi.productInfo.price}</strong> {selectedProduct.price.toLocaleString(uiLocale)} Kz</div>
                  <div><strong>{t.inventoryPageUi.productInfo.cost}</strong> {(selectedProduct.avgCost || selectedProduct.lastCost || selectedProduct.cost || 0).toLocaleString(uiLocale)} Kz</div>
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

        <TabsContent value="cost-history" className={tabPanelClass}>
          <InventoryCostHistoryPanel {...panelProps} />
        </TabsContent>

        <TabsContent value="pedidos" className={tabPanelClass}>
          <InventoryProductOrdersPanel product={selectedProduct} />
        </TabsContent>

        <TabsContent value="barcode-qty" className={tabPanelClass}>
          <InventoryBarcodeQtyPanel product={selectedProduct} allBranchProducts={allBranchProducts} />
        </TabsContent>

        <TabsContent value="vendas-mensais" className={tabPanelClass}>
          <InventoryMonthlySalesPanel {...panelProps} />
        </TabsContent>

        <TabsContent value="auditoria" className={tabPanelClass}>
          <InventoryProductAuditPanel {...panelProps} />
        </TabsContent>
      </Tabs>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-muted/50 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          {isHeadOffice && <span className="text-primary font-medium">📊 {t.inventoryPageUi.status.headOfficeAllBranches.replace('{count}', String(branches.length))}</span>}
          {isFilial && <span>📍 {formatBranchDisplayName(currentBranch)}</span>}
          <span className="text-destructive">{t.inventoryPageUi.status.qtyLt0}</span>
          <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 px-2 rounded">{t.inventoryPageUi.status.minQty}</span>
        </div>
        <span>{t.inventoryPageUi.status.productsCount.replace('{count}', String(displayProducts.length))}</span>
      </div>

      {dialogOpen ? (
        <ProductDetailDialog
          open
          onOpenChange={(next) => {
            if (!next) setDialogOpen(false);
          }}
          product={dialogProduct}
          catalogProducts={flatCatalog}
          scopeBranchId={
            productCreateScopeBranchId
            ?? listBranchId
            ?? inventoryBranch?.id
            ?? null
          }
          onSave={handleSaveProduct}
        />
      ) : null}

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
        products={physicalCountProducts}
        branch={physicalCountBranch}
        categories={[...new Set(physicalCountProducts.map((p) => p.category).filter(Boolean))]}
        branches={branchList}
        branchId={physicalCountBranchId}
        onBranchIdChange={setPhysicalCountBranchId}
        branchRequired={isHeadOffice}
        loading={physicalCountLoading}
        onContinueToReconcile={() => {
          setCountSheetDialogOpen(false);
          setReconciliationDialogOpen(true);
        }}
      />

      {/* Inventory Reconciliation Dialog */}
      <InventoryReconciliationDialog
        open={reconciliationDialogOpen}
        onOpenChange={setReconciliationDialogOpen}
        products={physicalCountProducts}
        branch={physicalCountBranch}
        categories={[...new Set(physicalCountProducts.map((p) => p.category).filter(Boolean))]}
        onReconcile={(adjustments) => {
          const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
          
          adjustments.forEach(adj => {
            const product = inventoryRows.find(p => p.id === adj.productId);
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

          void reloadInventoryList();
        }}
        currentUser={JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}')?.name}
      />

      {/* Inventory Adjustment Dialog */}
      <InventoryAdjustmentDialog
        open={adjustmentDialogOpen}
        onOpenChange={setAdjustmentDialogOpen}
        products={adjustmentProducts}
        branches={branches}
        branchId={adjustmentBranchId || listBranchId || currentBranch?.id || ''}
        onBranchChange={(id) => {
          setAdjustmentBranchId(id);
          if (canSwitchBranch && !allBranchProducts[id]?.length) {
            void loadPerBranchBreakdown();
          }
        }}
        canSwitchBranch={canSwitchBranch}
        onAddProduct={() =>
          openNewProductDialog(adjustmentBranchId || listBranchId || currentBranch?.id)
        }
        onApplyAdjustments={handleApplyAdjustments}
      />

      {/* Stock Entry Dialog (Ajustar Entrada) */}
      <StockEntryDialog
        key={`stock-entry-${language}`}
        open={stockEntryDialogOpen}
        onOpenChange={setStockEntryDialogOpen}
        products={inventoryRows}
        searchProducts={stockEntrySearchProducts}
        currentBranch={currentBranch}
        warehouseId={warehouseId}
        canSwitchBranch={canSwitchBranch}
        onAddProduct={() =>
          openNewProductDialog(listBranchId || currentBranch?.id || undefined)
        }
        initialProduct={selectedProduct}
        onApplyEntry={handleApplyStockEntry}
      />

      <StockExitDialog
        key={`stock-exit-${language}`}
        open={stockExitDialogOpen}
        onOpenChange={setStockExitDialogOpen}
        products={inventoryRows}
        searchProducts={stockExitSearchProducts}
        currentBranch={currentBranch}
        warehouseId={warehouseId}
        initialProduct={selectedProduct}
        onApplyExit={handleApplyStockExit}
      />

      {/* Bulk tier pricing (Price 2/3/4 = Price 1 x % across all products) */}
      <BulkTierPricingDialog
        open={bulkTierDialogOpen}
        onOpenChange={setBulkTierDialogOpen}
        onApplied={() => {
          window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: {} }));
          void reloadInventoryList();
          if (canSwitchBranch) void loadPerBranchBreakdown();
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