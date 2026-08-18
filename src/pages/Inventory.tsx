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
import { fetchInventoryGrid, invalidateInventoryGridCache, isInventoryGridCacheFresh, readProductStock } from '@/lib/inventoryGrid';
import { useInventoryBranchScope } from '@/hooks/useInventoryBranchScope';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { resolveBranchScopeDisplayLabel } from '@/lib/branchScopeDisplay';
import { looksLikeHeadOfficeBranch, normalizeIsMain } from '@/lib/branchAccess';
import { Product, StockMovement } from '@/types/erp';
import { api } from '@/lib/api/client';
import { parseTaxRateOrNull } from '@/lib/taxUtils';
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
  ClipboardList,
  Table2,
  BadgePercent,
} from 'lucide-react';
import { AdvancedDataGrid } from '@/components/inventory/AdvancedDataGrid';
import { digitProductCodeForMatch, pickBestProductSearchHit, sortProductSearchResults } from '@/components/inventory/productLineSearch';
import { ShelfLabelPrintDialog } from '@/components/inventory/ShelfLabelPrintDialog';
import { BulkTierPricingDialog } from '@/components/inventory/BulkTierPricingDialog';
import { BulkPriceCostDialog } from '@/components/inventory/BulkPriceCostDialog';
import { BulkIvaDialog } from '@/components/inventory/BulkIvaDialog';
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
import { StockAdjustmentHistoryDialog } from '@/components/inventory/StockAdjustmentHistoryDialog';
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
  const filialBranchIds = useMemo(
    () => (allBranches.length > 0 ? allBranches : branches).map((b) => b.id).filter(Boolean),
    [allBranches, branches],
  );

  const {
    rows: inventoryRows,
    loading: inventoryGridLoading,
    error: inventoryGridError,
    refresh: refreshInventoryGrid,
    patchRow: patchInventoryRow,
  } = useInventoryGrid({
    branchId: listBranchId,
    consolidated: isHeadOffice,
    filialBranchIds,
  });

  const {
    refreshProducts,
    updateProduct,
    addProduct,
    deleteProduct,
  } = useProducts(catalogListBranchId, { light: true, enabled: false });

  // Warm every other switchable branch's grid in the background so hopping between
  // branches (HQ workflow) hits an instant cache instead of a cold, several-second
  // network round trip each time. Staggered + skips branches already warm.
  useEffect(() => {
    if (!canSwitchBranch) return;
    const branchList = allBranches.length > 0 ? allBranches : branches;
    const targets = branchList.filter(
      (b) => b.id && b.id !== listBranchId && !isInventoryGridCacheFresh(b.id, false, 90_000),
    );
    if (targets.length === 0) return;
    let cancelled = false;
    const timers = targets.map((b, i) =>
      setTimeout(() => {
        if (cancelled) return;
        void fetchInventoryGrid({ branchId: b.id, consolidated: false }).catch(() => {});
      }, 800 + i * 600),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [canSwitchBranch, allBranches, branches, listBranchId]);

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
    onHandStock: Number(p.onHandStock ?? p.on_hand_stock ?? p.stock) || 0,
    reservedStock: Number(p.reservedStock ?? p.reserved_stock ?? 0) || 0,
    lockedStock: Number(p.lockedStock ?? p.locked_stock ?? 0) || 0,
    quotedStock: Number(p.quotedStock ?? p.quoted_stock ?? 0) || 0,
    unit: p.unit || 'UN',
    taxRate: parseTaxRateOrNull(p.tax_rate ?? p.taxRate) ?? 0,
    vatOverride: !!(p.vat_override ?? p.vatOverride),
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
    // Skip repairFilialStock on every reload — server inventory-grid already reconciles
    // with a cooldown; calling repair here was a major Inventory open/tab lag source.
    invalidateInventoryGridCache(listBranchId, isHeadOffice);
    invalidateSellingPriceHintsCache();
    await fetchSellingPriceHints(true).then(setSellingPriceHints);
    await refreshInventoryGrid();
  }, [listBranchId, isHeadOffice, refreshInventoryGrid]);

  useEffect(() => {
    let lightweightRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const onProductsChanged = (e: Event) => {
      const detail = (e as CustomEvent<{
        branchId?: string;
        toBranchId?: string;
        fromBranchId?: string;
        lightweight?: boolean;
        skipGridRefresh?: boolean;
      }>)?.detail;
      if (detail?.skipGridRefresh) {
        return;
      }
      // Always invalidate the caches for the branches the event actually names — a stock
      // transfer/adjust for branch X should never leave branch X's cache stale.
      if (detail?.toBranchId) invalidateInventoryGridCache(detail.toBranchId, false);
      if (detail?.fromBranchId) invalidateInventoryGridCache(detail.fromBranchId, false);
      if (detail?.branchId && detail.branchId !== 'all') {
        invalidateInventoryGridCache(detail.branchId, false);
      }
      // Whether this event has anything to do with the branch currently on screen. A sale
      // at branch B was unconditionally nuking branch A's cache below even while nobody was
      // looking at A — so switching back to A later always paid for a cold, slow refetch
      // instead of an instant cache hit (the whole point of caching branch switches).
      const changedBranchId = detail?.branchId;
      const affectsAllBranches = !changedBranchId || changedBranchId === 'all';
      const affectsThisScope =
        isHeadOffice
        || affectsAllBranches
        || changedBranchId === listBranchId
        || detail?.toBranchId === listBranchId
        || detail?.fromBranchId === listBranchId;
      if (!affectsThisScope) return;
      invalidateInventoryGridCache(listBranchId, isHeadOffice);
      if (detail?.lightweight) {
        // Adjust In / POS already patch rows optimistically for the branch that made the
        // write. But HQ consolidated totals and writes from another page/client (new
        // Purchase, another Tailscale client) are NOT covered by that patch, so without this
        // the grid would silently go stale until the page is remounted (REGRESSION seen by
        // users: "outside" grid disagreeing with a fresh double-click fetch). Debounce so a
        // burst of events costs one background round-trip, not one per event.
        if (lightweightRefreshTimer) clearTimeout(lightweightRefreshTimer);
        lightweightRefreshTimer = setTimeout(() => {
          lightweightRefreshTimer = null;
          void refreshInventoryGrid();
        }, 1000);
        return;
      }
      void reloadInventoryList();
    };
    window.addEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
    return () => {
      window.removeEventListener(PRODUCTS_CHANGED_EVENT, onProductsChanged);
      if (lightweightRefreshTimer) clearTimeout(lightweightRefreshTimer);
    };
  }, [listBranchId, isHeadOffice, reloadInventoryList, refreshInventoryGrid]);

  const stockMovementsScopeRef = useRef<string>('');
  const stockMovementsLoadedAtRef = useRef(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);

  const loadStockMovements = useCallback(async (force = false) => {
    const sku = String(selectedProduct?.sku || '').trim();
    const scopeKey = `${isHeadOffice ? 'hq' : String(currentBranch?.id || '')}|${sku || 'none'}`;
    if (
      !force
      && stockMovementsScopeRef.current === scopeKey
      && Date.now() - stockMovementsLoadedAtRef.current < 60_000
      && stockMovementsScopeRef.current !== ''
    ) {
      return;
    }
    // Product tabs: fetch only this SKU's movements (not the last 500 of everything).
    if (!sku) {
      setStockMovements([]);
      stockMovementsScopeRef.current = scopeKey;
      stockMovementsLoadedAtRef.current = Date.now();
      return;
    }
    try {
      const result = await api.transactions.stockMovements({
        warehouseId: isHeadOffice ? undefined : currentBranch?.id,
        sku,
        limit: 200,
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
        stockMovementsScopeRef.current = scopeKey;
        stockMovementsLoadedAtRef.current = Date.now();
        return;
      }
    } catch (e) {
      // API unreachable — fall through to local
    }
    const data = await localGetStockMovements(isHeadOffice ? undefined : currentBranch?.id);
    const skuKey = sku.toLowerCase();
    setStockMovements(
      data.filter((m) => String(m.sku || '').trim().toLowerCase() === skuKey),
    );
    stockMovementsScopeRef.current = scopeKey;
    stockMovementsLoadedAtRef.current = Date.now();
  }, [currentBranch?.id, isHeadOffice, selectedProduct?.sku]);

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

  const sellingPriceBySku = useMemo(
    () => buildSellingPriceBySku(inventoryRows, sellingPriceHints),
    [inventoryRows, sellingPriceHints],
  );

  const displayProducts = useMemo(() => {
    // HQ rows come straight from the server — no client-side price hint blending.
    if (isHeadOffice) return inventoryRows;
    return inventoryRows.map((p) => withSellingPriceFromMap(p, sellingPriceBySku));
  }, [isHeadOffice, inventoryRows, sellingPriceBySku]);

  const reservedQtyByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of displayProducts) {
      const r = Number(p.reservedStock) || 0;
      if (r > 0) map[p.id] = r;
    }
    return map;
  }, [displayProducts]);

  const [adjustmentBranchId, setAdjustmentBranchId] = useState('');
  const flatCatalog = useMemo(() => {
    const rows = [...inventoryRows];
    for (const branchRows of Object.values(allBranchProducts)) {
      rows.push(...branchRows);
    }
    return rows;
  }, [inventoryRows, allBranchProducts]);

  const stockEntrySearchProducts = useMemo(() => {
    const fromCatalog = flatCatalog.filter((p) => p.isActive !== false);
    if (fromCatalog.length > 0) return fromCatalog;
    if (canSwitchBranch && Object.keys(allBranchProducts).length > 0) {
      return Object.entries(allBranchProducts).flatMap(([branchId, prods]) =>
        prods
          .filter((p) => p.isActive !== false)
          .map((p) => ({ ...p, branchId: p.branchId || branchId })),
      );
    }
    const branchId = listBranchId || currentBranch?.id || '';
    return inventoryRows.map((p) => ({ ...p, branchId: p.branchId || branchId }));
  }, [flatCatalog, canSwitchBranch, allBranchProducts, inventoryRows, listBranchId, currentBranch?.id]);

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
  const [lockedDialogProduct, setLockedDialogProduct] = useState<Product | null>(null);
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
  const [bulkPriceCostOpen, setBulkPriceCostOpen] = useState(false);
  const [bulkIvaOpen, setBulkIvaOpen] = useState(false);
  const [adjustmentHistoryOpen, setAdjustmentHistoryOpen] = useState(false);
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

  // Qtd detalhada loads one SKU via /products/stock-by-sku — do not fan out N× inventory-grid.
  useEffect(() => {
    if (!showDetailedQtyTab && activeTab === 'qtd-detalhada') {
      setActiveTab('lista');
    }
  }, [showDetailedQtyTab, activeTab]);

  // Branch switch: clear selection only. Do NOT wipe sibling inventory-grid caches —
  // that forced a cold ~10s reload for every dropdown change from Sede.
  useEffect(() => {
    setSelectedProduct(null);
    stockMovementsScopeRef.current = '';
    stockMovementsLoadedAtRef.current = 0;
  }, [inventoryScopeId]);
  const [stockListFilter, setStockListFilter] = useState<StockListFilter>('all');
  const [listSearch, setListSearch] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const listSearchRef = useRef<HTMLInputElement>(null);

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
    if (!selectedProduct?.sku) {
      setStockMovements([]);
      return;
    }
    void loadStockMovements();
  }, [activeTab, loadStockMovements, MOVEMENT_TABS, selectedProduct?.sku]);

  const gridProducts = useMemo(() => {
    let rows = displayProducts;
    if (stockListFilter === 'qtyGt0') {
      rows = rows.filter((p) => readProductStock(p) > 0.0001);
    } else if (stockListFilter === 'qtyLt0') {
      rows = rows.filter((p) => readProductStock(p) <= 0.0001);
    }

    const q = listSearch.trim().toLowerCase();
    if (!q) return rows;

    const matched = rows.filter((p) => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      const category = (p.category || '').toLowerCase();
      const supplier = (p.supplierName || '').toLowerCase();
      const qDigits = digitProductCodeForMatch(q);
      const skuDigits = digitProductCodeForMatch(p.sku);
      const barcodeDigits = digitProductCodeForMatch(p.barcode);
      return (
        sku.includes(q)
        || name.includes(q)
        || barcode.includes(q)
        || category.includes(q)
        || supplier.includes(q)
        || (qDigits.length >= 6 && (
          skuDigits === qDigits
          || barcodeDigits === qDigits
          || skuDigits.includes(qDigits)
          || barcodeDigits.includes(qDigits)
        ))
      );
    });
    return [...matched].sort((a, b) =>
      sortProductSearchResults(a, b, listSearch, listBranchId || currentBranch?.id || ''),
    );
  }, [displayProducts, stockListFilter, listSearch, listBranchId, currentBranch?.id]);

  // Keep the row the user clicked. Only jump to another hit when the current product
  // no longer matches the search (or there is no selection yet).
  useEffect(() => {
    const term = listSearch.trim();
    if (!term) return;
    setSelectedProduct((prev) => {
      const next = pickBestProductSearchHit(
        gridProducts,
        term,
        prev,
        listBranchId || currentBranch?.id || '',
      );
      if (!next) return prev;
      return prev && prev.id === next.id ? prev : next;
    });
  }, [listSearch, gridProducts, listBranchId, currentBranch?.id]);

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
    setLockedDialogProduct(product || null);
    setDialogOpen(true);
  };

  const handleDoubleClickProduct = (product: Product) => {
    setSelectedProduct(product);
    setLockedDialogProduct(product);
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
    const onAdjustExit = () => {
      setSelectedProduct(null);
      setStockExitDialogOpen(true);
    };
    const onEntry = () => {
      setSelectedProduct(null);
      if (canSwitchBranch) void loadPerBranchBreakdown();
      setStockEntryDialogOpen(true);
    };
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
      openAdjustStock?: boolean;
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
    if (st?.openAdjustStock) {
      const bid = listBranchId || currentBranch?.id || '';
      setAdjustmentBranchId(bid);
      if (canSwitchBranch) void loadPerBranchBreakdown();
      setAdjustmentDialogOpen(true);
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (!st?.nexorToolbarNewProduct) return;
    setSelectedProduct(null);
    setDialogOpen(true);
    navigate('.', { replace: true, state: {} });
  }, [
    location.state,
    navigate,
    openCountSheetDialog,
    openReconciliationDialog,
    location.pathname,
    listBranchId,
    currentBranch?.id,
    canSwitchBranch,
    loadPerBranchBreakdown,
  ]);

  const handleSaveProduct = async (product: Product & { preserveStock?: boolean }) => {
    const targetBranchId =
      (product.branchId && product.branchId !== 'all' ? product.branchId : null)
      || listBranchId
      || inventoryBranch?.id
      || mainBranch?.id
      || '';
    const gridProduct: Product & { propagatePrices?: boolean } = {
      ...product,
      branchId: targetBranchId,
      // Sede/HQ edits push PVP to all filiais that have not set a local override.
      ...(isHeadOffice ? { propagatePrices: true } : {}),
    };
    patchInventoryRow(gridProduct);
    // Patch UI immediately; do not await a full Tailscale inventory-grid reload.
    const writeOpts = { skipListMerge: true, lightweightChangedEvent: true } as const;
    try {
      if (selectedProduct) {
        const saved = await updateProduct(gridProduct, writeOpts);
        const savedRow = { ...saved, branchId: saved.branchId || gridProduct.branchId };
        patchInventoryRow(savedRow);
        setSelectedProduct((prev) =>
          prev && prev.id === product.id ? { ...prev, ...saved } : prev,
        );
        toast.success(t.productFormUi.productUpdated);
      } else {
        const saved = await addProduct(gridProduct, writeOpts);
        const savedRow = { ...saved, branchId: saved.branchId || gridProduct.branchId };
        patchInventoryRow(savedRow);
        toast.success(t.productFormUi.productCreated);
        setSelectedProduct(null);
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

    const productsToImport = data.map((item) => {
      const row: Record<string, unknown> = {
        sku: item.codigo,
        name: item.descricao,
        barcode: item.codigoBarras || '',
        category: item.categoria || 'GERAL',
        price: item.preco,
        cost: item.custo,
        stock: item.quantidade,
        unit: item.unidade || 'UN',
        isActive: true,
        branchId: importBranchId,
      };
      // Omit taxRate when Excel had no IVA column so updates keep existing 14%/7%/0%.
      if (item.iva != null) row.taxRate = item.iva;
      return row;
    });

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
        if (saved > 0 && failed === 0) {
          const bits: string[] = [];
          if (imported > 0) bits.push(t.inventoryUi.importedCount.replace('{count}', String(imported)));
          if (updated > 0) bits.push(`${updated} ${language === 'pt' ? 'actualizados' : 'updated'}`);
          toast.success(bits.join(', ') || t.inventoryUi.importCompleted);
        } else if (saved > 0) {
          const messages: string[] = [];
          if (imported > 0) messages.push(t.inventoryUi.importedCount.replace('{count}', String(imported)));
          if (updated > 0) messages.push(`${updated} ${language === 'pt' ? 'actualizados' : 'updated'}`);
          if (failed > 0) messages.push(t.inventoryUi.failedCount.replace('{count}', String(failed)));
          toast.success(messages.join(', ') || t.inventoryUi.importCompleted);
        } else if (failed > 0) {
          toast.error(t.inventoryUi.failedCount.replace('{count}', String(failed)));
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
    (
      targetWarehouseId: string,
      productUpdates?: import('@/lib/inventoryStockAdjust').StockProductUpdate[],
    ) => {
      // Branch-scoped view: patch from server (or optimistic) snapshots — no full grid reload.
      // HQ consolidated totals need a lightweight grid refresh (warehouse stock ≠ HQ sum).
      const canPatchLocally =
        !isHeadOffice
        && Array.isArray(productUpdates)
        && productUpdates.length > 0;

      if (canPatchLocally) {
        for (const u of productUpdates!) {
          const existing =
            productsById.get(u.productId)
            ?? inventoryRows.find(
              (p) =>
                p.id === u.productId
                || (u.sku && p.sku && p.sku.toLowerCase() === u.sku.toLowerCase()),
            );
          if (!existing) continue;
          patchInventoryRow({
            ...existing,
            stock: u.stock,
            onHandStock: u.stock,
            ...(u.cost != null && Number.isFinite(u.cost) ? { cost: u.cost } : {}),
            ...(u.avgCost != null && Number.isFinite(u.avgCost) ? { avgCost: u.avgCost } : {}),
            ...(u.lastCost != null && Number.isFinite(u.lastCost) ? { lastCost: u.lastCost } : {}),
            ...(u.taxRate != null && Number.isFinite(u.taxRate) ? { taxRate: u.taxRate } : {}),
          });
        }
        // applyStockAdjustmentLines already fired skipGridRefresh; nothing else to do.
        return;
      }

      window.dispatchEvent(
        new CustomEvent(PRODUCTS_CHANGED_EVENT, {
          detail: { branchId: targetWarehouseId, lightweight: true },
        }),
      );
    },
    [isHeadOffice, productsById, inventoryRows, patchInventoryRow],
  );

  const handleApplyAdjustments = useCallback(async (
    adjustments: { productId: string; newStock: number; difference: number }[],
    reason: string,
    notes: string,
    receiptNumber: string,
    warehouseId: string,
  ) => {
    const targetWarehouseId = warehouseId || listBranchId || currentBranch?.id || '';
    if (!targetWarehouseId) {
      toast.error(t.inventoryAdjustUi.branchRequiredDesc);
      throw new Error(t.inventoryAdjustUi.branchRequiredDesc);
    }

    const currentUser = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
    const noteParts = [
      reason,
      receiptNumber ? `${t.inventoryAdjustUi.receiptNumber}: ${receiptNumber}` : null,
      notes || null,
    ].filter(Boolean);
    const movementNotes = noteParts.join(' — ');
    const docRef = receiptNumber.trim() || `CNT-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;

    const mapLine = (adj: { productId: string; difference: number }) => {
      const product = adjustmentProducts.find((p) => p.id === adj.productId)
        ?? inventoryRows.find((p) => p.id === adj.productId);
      return {
        productId: adj.productId,
        sku: product?.sku ?? adj.productId,
        name: product?.name ?? '',
        quantity: Math.abs(adj.difference),
        unitCost: product?.cost ?? 0,
      };
    };

    const increases = adjustments.filter((a) => a.difference > 0);
    const decreases = adjustments.filter((a) => a.difference < 0);
    const allErrors: string[] = [];
    let totalApplied = 0;
    const mergedUpdates: import('@/lib/inventoryStockAdjust').StockProductUpdate[] = [];
    const prevStock = new Map(
      adjustments.map((a) => {
        const product = adjustmentProducts.find((p) => p.id === a.productId)
          ?? inventoryRows.find((p) => p.id === a.productId);
        return [a.productId, Number(product?.stock ?? 0)] as const;
      }),
    );

    if (increases.length > 0) {
      const result = await applyStockAdjustmentLines({
        lines: increases.map(mapLine),
        warehouseId: targetWarehouseId,
        movementType: 'IN',
        referenceType: 'adjustment',
        referenceNumber: docRef,
        notes: movementNotes,
        createdBy: currentUser?.id || currentUser?.name || 'system',
        previousStockById: prevStock,
      });
      totalApplied += result.applied;
      allErrors.push(...result.errors);
      if (result.productUpdates?.length) mergedUpdates.push(...result.productUpdates);
    }

    if (decreases.length > 0) {
      const result = await applyStockAdjustmentLines({
        lines: decreases.map(mapLine),
        warehouseId: targetWarehouseId,
        movementType: 'OUT',
        referenceType: 'adjustment',
        referenceNumber: `${docRef}-OUT`,
        notes: movementNotes,
        createdBy: currentUser?.id || currentUser?.name || 'system',
        previousStockById: prevStock,
      });
      totalApplied += result.applied;
      allErrors.push(...result.errors);
      if (result.productUpdates?.length) {
        // Later OUT wins over earlier IN for the same product in one count doc.
        const byId = new Map(mergedUpdates.map((u) => [u.productId, u]));
        for (const u of result.productUpdates) byId.set(u.productId, u);
        mergedUpdates.length = 0;
        mergedUpdates.push(...byId.values());
      }
    }

    for (const adj of adjustments) {
      const product = adjustmentProducts.find((p) => p.id === adj.productId)
        ?? inventoryRows.find((p) => p.id === adj.productId);
      if (!product) continue;
      logTransaction({
        category: 'inventory',
        action: 'stock_adjusted',
        entityType: 'Produto',
        entityId: adj.productId,
        entityNumber: product.sku,
        entityName: product.name,
        description: `Stock ajustado de ${product.stock} para ${adj.newStock} (${adj.difference > 0 ? '+' : ''}${adj.difference}) - ${reason}`,
        details: { previousStock: product.stock, newStock: adj.newStock, difference: adj.difference, reason, notes },
        previousValue: product.stock,
        newValue: adj.newStock,
      });
    }

    refreshInventoryAfterStockAdjust(targetWarehouseId, mergedUpdates);

    if (totalApplied === 0) {
      throw new Error(allErrors.slice(0, 3).join('; ') || t.stockEntryUi.saveFailed);
    }
    if (allErrors.length > 0) {
      toast.error(allErrors.slice(0, 3).join('; '));
    }
  }, [
    adjustmentProducts,
    inventoryRows,
    listBranchId,
    currentBranch?.id,
    refreshInventoryAfterStockAdjust,
    t,
  ]);

  const handleApplyStockEntry = useCallback(
    async (
      items: {
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        effectiveCost?: number;
        cost: number;
        taxRate?: number;
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
          taxRate: item.taxRate,
        })),
        warehouseId: targetWarehouseId,
        movementType: 'IN',
        referenceType: entryReferenceType(meta.reason),
        referenceNumber: meta.reference,
        entryDate: meta.entryDate,
        notes: noteParts.join(' — ') || meta.reference,
        createdBy: currentUser?.id || currentUser?.name || 'system',
        landingCosts: meta.totalLandingCosts,
        freightSourceAccount: meta.freightSourceAccount,
        freightSourceName: meta.freightSourceName,
        previousStockById: new Map(
          items.map((item) => [
            item.productId,
            Number(productsById.get(item.productId)?.stock ?? 0),
          ]),
        ),
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

      refreshInventoryAfterStockAdjust(targetWarehouseId, result.productUpdates);
      if (result.applied === 0) {
        throw new Error(result.errors.slice(0, 3).join('; ') || t.stockEntryUi.saveFailed);
      }
      if (result.errors.length > 0) {
        throw new Error(result.errors.slice(0, 3).join('; '));
      }
      const msg = t.stockEntryUi.productsAddedDesc.replace('{count}', String(result.applied));
      toast.success(
        result.journalEntryId ? `${msg} (${t.stockEntryUi.journalPosted})` : msg,
      );
    },
    [warehouseId, productsById, refreshInventoryAfterStockAdjust, t],
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
        previousStockById: new Map(
          items.map((item) => [
            item.productId,
            Number(productsById.get(item.productId)?.stock ?? 0),
          ]),
        ),
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

      refreshInventoryAfterStockAdjust(targetWarehouseId, result.productUpdates);
      if (result.applied === 0) {
        throw new Error(result.errors.slice(0, 3).join('; ') || t.stockExitUi.saveFailed);
      }
      if (result.errors.length > 0) {
        throw new Error(result.errors.slice(0, 3).join('; '));
      }
      const msg = t.stockExitUi.productsRemovedDesc.replace('{count}', String(result.applied));
      toast.success(
        result.journalEntryId ? `${msg} (${t.stockExitUi.journalPosted})` : msg,
      );
    },
    [warehouseId, productsById, refreshInventoryAfterStockAdjust, t],
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
      {/* Stock mode notices */}
      {isHeadOffice && (
        <Alert className="mx-3 mt-3 rounded-xl bg-accent border-primary/20">
          <Building2 className="h-4 w-4 text-primary" />
          <AlertDescription className="text-foreground">
            <strong>{t.inventoryPageUi.headOfficeTitle}</strong> {t.inventoryPageUi.headOfficeDesc}
          </AlertDescription>
        </Alert>
      )}
      {!isHeadOffice && canSwitchBranch && looksLikeHeadOfficeBranch(inventoryBranch) && (
        <Alert className="mx-3 mt-3 rounded-xl bg-muted/60 border-border">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <AlertDescription className="text-foreground">
            <strong>{t.inventoryPageUi.sedeStockOnlyTitle}</strong>{' '}
            {t.inventoryPageUi.sedeStockOnlyDesc}
          </AlertDescription>
        </Alert>
      )}
      {/* Toolbar */}
      <div className="relative z-30 flex items-center gap-1.5 px-3 py-2 bg-card/50 border-b backdrop-blur-sm">
        {canSwitchBranch && (
          <BranchSelector
            compact
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
            onChange={(e) => {
              setListSearch(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            onBlur={() => setTimeout(() => setShowSearchResults(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gridProducts.length > 0) {
                setSelectedProduct(gridProducts[0]);
                setShowSearchResults(false);
              }
              if (e.key === 'Escape') {
                setListSearch('');
                setShowSearchResults(false);
                listSearchRef.current?.blur();
              }
            }}
            placeholder={t.inventoryPageUi.searchListPlaceholder}
            className="h-7 pl-7 text-xs bg-background"
            autoComplete="off"
            spellCheck={false}
          />
          {showSearchResults && listSearch.trim() && gridProducts.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-72 overflow-auto rounded-md border bg-popover shadow-md">
              {gridProducts.slice(0, 50).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedProduct(p);
                    setShowSearchResults(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    selectedProduct?.id === p.id ? 'bg-accent' : ''
                  }`}
                >
                  <span className="font-mono text-muted-foreground shrink-0 w-20 truncate">{p.sku}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{readProductStock(p)}</span>
                </button>
              ))}
            </div>
          )}
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
          onClick={() => setAdjustmentHistoryOpen(true)}
          title={t.adjustmentHistoryUi.openFromInventory}
        >
          <ClipboardList className="w-3 h-3" />
          {t.adjustmentHistoryUi.openFromInventory}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          onClick={() => setBulkPriceCostOpen(true)}
          title={t.inventoryPageUi.massPrice.title}
        >
          <Table2 className="w-3 h-3" />
          {t.inventoryPageUi.massPrice.button}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          onClick={() => setBulkIvaOpen(true)}
          title={t.inventoryPageUi.massIva.title}
        >
          <BadgePercent className="w-3 h-3" />
          {t.inventoryPageUi.massIva.button}
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
          {inventoryGridError && isHeadOffice ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-destructive">{inventoryGridError}</p>
              <Button variant="outline" size="sm" onClick={() => void refreshInventoryGrid()}>
                {t.common.refresh}
              </Button>
            </div>
          ) : gridProducts.length === 0 && inventoryGridLoading ? (
            <p className="text-center py-16 text-muted-foreground">{t.common.loading}</p>
          ) : (
            <div className="relative h-full min-h-0">
              {inventoryGridLoading && gridProducts.length > 0 && (
                <div className="absolute top-0 inset-x-0 z-10 flex justify-center pointer-events-none">
                  <span className="mt-1 rounded-md bg-background/90 border px-2 py-0.5 text-xs text-muted-foreground shadow-sm">
                    {t.common.loading}
                  </span>
                </div>
              )}
              <AdvancedDataGrid 
                key={isHeadOffice ? 'hq' : (listBranchId || 'none')}
                products={gridProducts}
                onSelectProduct={handleSelectProduct}
                onDoubleClickProduct={handleDoubleClickProduct}
                selectedProductId={selectedProduct?.id}
                isHeadOffice={isHeadOffice}
                branches={branches}
                allBranchProducts={allBranchProducts}
                reservedQty={reservedQtyByProductId}
                preSorted
              />
            </div>
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
                  {(Number(selectedProduct.reservedStock) || 0) > 0 && (
                    <div>
                      <strong>{t.inventoryGridUi.reservedQty}:</strong>{' '}
                      {selectedProduct.reservedStock}
                      {(Number(selectedProduct.quotedStock) || 0) > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          ({t.inventoryGridUi.quotedQtyHint.replace('{qty}', String(selectedProduct.quotedStock))})
                        </span>
                      )}
                      {(Number(selectedProduct.onHandStock) || 0) > 0 && (
                        <span className="text-muted-foreground">
                          {' '}({language === 'pt' ? 'físico' : 'on hand'}: {selectedProduct.onHandStock})
                        </span>
                      )}
                    </div>
                  )}
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
            if (!next) {
              setDialogOpen(false);
              setLockedDialogProduct(null);
            }
          }}
          product={lockedDialogProduct || dialogProduct}
          catalogProducts={flatCatalog}
          scopeBranchId={
            productCreateScopeBranchId
            ?? listBranchId
            ?? inventoryBranch?.id
            ?? null
          }
          onSave={handleSaveProduct}
          onProductLoaded={(fresh) => {
            patchInventoryRow({
              ...fresh,
              branchId: fresh.branchId || dialogProduct?.branchId || listBranchId || '',
            });
            setSelectedProduct((prev) =>
              prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev,
            );
          }}
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
        defaultDuplicateAction="update"
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
          const writeOpts = { skipListMerge: true, lightweightChangedEvent: true } as const;

          adjustments.forEach((adj) => {
            const product = inventoryRows.find((p) => p.id === adj.productId);
            if (product) {
              const next = {
                ...product,
                stock: adj.countedStock,
                updatedAt: new Date().toISOString(),
              };
              patchInventoryRow(next);
              void updateProduct(next, writeOpts).then((saved) => {
                patchInventoryRow({ ...saved, branchId: saved.branchId || product.branchId });
              }).catch((err) => {
                console.warn('[Inventory] reconciliation product update:', err);
              });

              const movementType = adj.difference > 0 ? 'IN' : 'OUT';
              void saveStockMovement({
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

          window.dispatchEvent(
            new CustomEvent(PRODUCTS_CHANGED_EVENT, {
              detail: { branchId: currentBranch?.id || listBranchId, lightweight: true },
            }),
          );
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

      {/* Stock Entry Dialog (Ajustar Entrada) — unmount when closed so lines never persist */}
      {stockEntryDialogOpen ? (
        <StockEntryDialog
          key={`stock-entry-${language}`}
          open
          onOpenChange={(next) => {
            if (!next) setStockEntryDialogOpen(false);
          }}
          products={inventoryRows}
          searchProducts={stockEntrySearchProducts}
          currentBranch={currentBranch}
          warehouseId={warehouseId}
          canSwitchBranch={canSwitchBranch}
          onAddProduct={() =>
            openNewProductDialog(listBranchId || currentBranch?.id || undefined)
          }
          initialProduct={null}
          onApplyEntry={handleApplyStockEntry}
        />
      ) : null}

      {stockExitDialogOpen ? (
        <StockExitDialog
          key={`stock-exit-${language}`}
          open
          onOpenChange={(next) => {
            if (!next) setStockExitDialogOpen(false);
          }}
          products={inventoryRows}
          searchProducts={stockExitSearchProducts}
          currentBranch={currentBranch}
          warehouseId={warehouseId}
          initialProduct={null}
          onApplyExit={handleApplyStockExit}
        />
      ) : null}

      <StockAdjustmentHistoryDialog
        open={adjustmentHistoryOpen}
        onOpenChange={setAdjustmentHistoryOpen}
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

      <BulkPriceCostDialog
        open={bulkPriceCostOpen}
        onOpenChange={setBulkPriceCostOpen}
        products={displayProducts}
        isHeadOffice={isHeadOffice}
        onApplied={() => {
          window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: {} }));
          void reloadInventoryList();
          if (canSwitchBranch) void loadPerBranchBreakdown();
        }}
      />

      <BulkIvaDialog
        open={bulkIvaOpen}
        onOpenChange={setBulkIvaOpen}
        products={displayProducts}
        isHeadOffice={isHeadOffice}
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