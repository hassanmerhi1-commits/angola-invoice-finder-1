/**
 * NEXOR ERP - Core Business Logic Hooks
 * 
 * API-First architecture: All hooks try the backend API first,
 * falling back to localStorage for web preview / demo mode.
 */

import { useState, useEffect, useCallback, useRef, useSyncExternalStore, useMemo } from 'react';
import { Branch, Product, Sale, User, CartItem, SaleItem, DailySummary, Client, StockTransfer, Supplier, PurchaseOrder, PurchaseOrderItem, Category } from '@/types/erp';
import { api, clearAuthSessionCache, ensureBackendAuthToken, isJwtAuthToken, setAuthToken } from '@/lib/api/client';
import { isDemoMode, isThinClientMode } from '@/lib/api/config';
import { isOfflineModeActive } from '@/lib/offlineAuth';
import { lanCatalogScopeKey, readLanProducts, readLanSuppliers, saveLanProducts, saveLanSuppliers } from '@/lib/lanCatalogCache';
import { getCachedList, setCachedList } from '@/lib/listCache';
import { TABLE_REFRESH_EVENT } from '@/lib/realtime/tableRefreshBridge';
import * as storage from '@/lib/storage';
import { ensureSupplierAccount } from '@/lib/chartOfAccountsEngine';
import { normalizeTaxRate } from '@/lib/taxUtils';
import { applyUserBranchLockOnLogin, normalizeIsMain } from '@/lib/branchAccess';
import { mapStockTransferRow } from '@/lib/stockTransferUtils';
import {
  applyCanonicalSkuAggregates,
  buildCanonicalSkuAggregates,
  canonicalProductSku,
  dedupeProductsForDisplay,
} from '@/lib/productDedupe';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';
import { normalizeCustomerNif, resolveSaleDocumentType, resolveSaleInvoiceType } from '@/lib/fiscalInvoiceType';
import {
  applySellingPriceHintsToProducts,
  fetchSellingPriceHints,
  invalidateSellingPriceHintsCache,
  readSellingPriceHintsSession,
} from '@/lib/sellingPriceHints';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { validateNIF } from '@/lib/companySettings';

// Helper: only use local demo storage in explicit demo mode.
// In real web localhost/API mode, never silently revive stale browser data.
async function apiFallback<T>(apiFn: () => Promise<{ data?: T; error?: string }>, storageFn: () => Promise<T> | T): Promise<T> {
  const allowDemoFallback = isDemoMode();

  try {
    const result = await apiFn();
    if (result.data !== undefined) return result.data;
    if (!allowDemoFallback) {
      throw new Error(result.error || 'API returned no data');
    }
  } catch (e) {
    if (!allowDemoFallback) {
      throw e;
    }
  }

  return await storageFn();
}

// ============================================
// BRANCHES
// ============================================
export function useBranches() {
  const scope = useBranchScope();
  const ctx = useBranchContext();
  return {
    branches: scope.allBranches,
    currentBranch: scope.currentBranch,
    setCurrentBranch: scope.setOperatingBranch,
    refreshBranches: ctx.refreshBranches,
    isLoading: ctx.isLoading,
  };
}

// Map API snake_case to frontend camelCase for products
function mapProduct(p: any): Product {
  const rawActive = p.isActive ?? p.is_active;
  const isActive =
    rawActive === undefined || rawActive === null
      ? true
      : rawActive === true ||
        rawActive === 1 ||
        rawActive === '1' ||
        rawActive === 't' ||
        String(rawActive).toLowerCase() === 'true';

  return {
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    barcode: p.barcode || '',
    category: p.category || 'GERAL',
    price: Number(p.price) || 0,
    price2: p.price2 ?? p.price_2,
    price3: p.price3 ?? p.price_3,
    price4: p.price4 ?? p.price_4,
    cost: Number(p.cost) || 0,
    firstCost: Number(p.firstCost ?? p.first_cost ?? p.cost) || 0,
    lastCost: Number(p.lastCost ?? p.last_cost ?? p.cost) || 0,
    avgCost: Number(p.avgCost ?? p.avg_cost ?? p.cost) || 0,
    stock: Number(p.stock) || 0,
    minStock: p.minStock ?? p.min_stock,
    maxStock: p.maxStock ?? p.max_stock,
    unit: p.unit || 'UN',
    taxRate: normalizeTaxRate(p.taxRate ?? p.tax_rate),
    branchId: p.branchId ?? p.branch_id ?? '',
    supplierId: p.supplierId ?? p.supplier_id,
    supplierName: p.supplierName ?? p.supplier_name,
    isActive,
    createdAt: p.createdAt ?? p.created_at ?? '',
    updatedAt: p.updatedAt ?? p.updated_at,
    version: p.version ?? undefined,
  };
}

function mapSupplier(s: any): Supplier {
  // Normalize is_active: handle boolean, string, integer from PostgreSQL
  const rawActive = s.isActive ?? s.is_active;
  const isActive = rawActive === undefined || rawActive === null ? true
    : rawActive === true || rawActive === 1 || rawActive === 'true' || rawActive === '1' || rawActive === 't';

  return {
    id: s.id,
    name: s.name || '',
    nif: s.nif || '',
    email: s.email || '',
    phone: s.phone || '',
    address: s.address || '',
    city: s.city || '',
    country: s.country || 'Angola',
    contactPerson: s.contactPerson ?? s.contact_person ?? '',
    paymentTerms: s.paymentTerms ?? s.payment_terms ?? '30_days',
    balance: Number(s.balance ?? s.current_balance ?? 0),
    isActive,
    notes: s.notes || '',
    createdAt: s.createdAt ?? s.created_at ?? '',
    updatedAt: s.updatedAt ?? s.updated_at ?? s.createdAt ?? s.created_at ?? '',
    version: s.version ?? undefined,
  };
}

function mapStockTransfer(transfer: any): StockTransfer {
  return mapStockTransferRow(transfer as Record<string, unknown>);
}

function normalizeProductBranchIdForApi(branchId?: string | null): string | null | undefined {
  if (branchId == null || branchId === '' || branchId === 'all') return null;
  return branchId;
}

function readStoredUserBranchId(): string | undefined {
  try {
    const raw = localStorage.getItem('kwanzaerp_current_user');
    if (!raw) return undefined;
    const u = JSON.parse(raw) as { branchId?: string };
    const id = String(u.branchId ?? '').trim();
    return id && id !== 'all' ? id : undefined;
  } catch {
    return undefined;
  }
}

function normalizeProductSku(sku?: string): string {
  return (sku || '').trim().toLowerCase();
}

function productBelongsToBranchList(product: Product, branchId: string, apiSkus: Set<string>): boolean {
  const skuKey = normalizeProductSku(product.sku);
  if (skuKey && apiSkus.has(skuKey)) return false;
  if (product.branchId === branchId) return true;
  const isShared = !product.branchId || product.branchId === 'all';
  return isShared && !apiSkus.has(skuKey);
}

/** Drop rows owned by another branch; keep shared catalog and sede catalog rows (stock may be 0 at filial). */
function filterProductsForApiScope(
  products: Product[],
  branchId?: string,
  catalogBranchIds: string[] = [],
): Product[] {
  if (!branchId) return products;
  const key = String(branchId).trim();
  const isMainScope = catalogBranchIds.includes(key);
  return products.filter((p) => {
    const owner = String(p.branchId || '').trim();
    if (!owner) return true;
    if (owner === key) return true;
    if (isMainScope && catalogBranchIds.includes(owner)) return true;
    return false;
  });
}

function dedupeProductsBySku(products: Product[], branchId?: string, catalogBranchIds: string[] = []): Product[] {
  return dedupeProductsForDisplay(products, branchId, catalogBranchIds);
}

/** Merge best selling price/cost per SKU (catalog + filial) for POS and pickers. */
function applyCanonicalSellingPrices(products: Product[]): Product[] {
  const aggregates = buildCanonicalSkuAggregates(products);
  return products.map((p) => {
    const key = canonicalProductSku(p.sku).toLowerCase();
    const agg = key ? aggregates.get(key) : undefined;
    return agg ? applyCanonicalSkuAggregates(p, agg) : p;
  });
}

export type ProductsListOptions = { light?: boolean; enabled?: boolean };

export function useProducts(branchId?: string, listOptions?: ProductsListOptions) {
  const listEnabled = listOptions?.enabled !== false;
  const productsCacheKey = `products:${branchId ?? 'all'}:${listOptions?.light ? 'light' : 'full'}`;
  const { branches } = useBranchContext();
  const catalogBranchIds = useMemo(
    () => branches.filter((b) => normalizeIsMain(b.isMain)).map((b) => b.id),
    [branches],
  );
  const [products, setProducts] = useState<Product[]>(
    () => (listEnabled ? getCachedList<Product[]>(productsCacheKey) : null) ?? [],
  );
  const [productsLoading, setProductsLoading] = useState(
    () => listEnabled && !(getCachedList<Product[]>(productsCacheKey)?.length),
  );
  /** Ignores stale list fetches that finish after a newer write (e.g. add product). */
  const listGenerationRef = useRef(0);

  const fetchMergedProductList = useCallback(async (): Promise<Product[]> => {
    let apiProducts: Product[] | null = null;
    try {
      const response = await api.products.list(branchId, listOptions);
      if (!response.error && Array.isArray(response.data)) {
        apiProducts = filterProductsForApiScope(response.data.map(mapProduct), branchId);
      }
    } catch (e) {
      console.warn('[useProducts] API list failed:', e);
    }

    let localProducts: Product[] = [];
    try {
      localProducts = await storage.getProducts(branchId);
    } catch (e) {
      console.error('[useProducts] local getProducts failed:', e);
    }

    if (apiProducts !== null) {
      // Light picker lists (PO/PI/sales) only need cost/SKU — skip slow PVP hint fetch.
      if (listOptions?.light && !isDemoMode()) {
        return filterProductsForApiScope(apiProducts, branchId, catalogBranchIds);
      }
      let hints: Record<string, number> = readSellingPriceHintsSession();
      if (Object.keys(hints).length === 0) {
        try {
          hints = await fetchSellingPriceHints();
        } catch {
          /* non-blocking */
        }
      }
      const withCanonicalPrices = applySellingPriceHintsToProducts(
        applyCanonicalSellingPrices(apiProducts),
        hints,
      );
      const dedupedApi = dedupeProductsBySku(withCanonicalPrices, branchId, catalogBranchIds);
      // API is source of truth — merging Electron DB / localStorage re-shows duplicate SKUs after login.
      if (!isDemoMode()) {
        const scoped = filterProductsForApiScope(
          applySellingPriceHintsToProducts(
            applyCanonicalSellingPrices(dedupedApi),
            hints,
          ),
          branchId,
          catalogBranchIds,
        );
        if (isThinClientMode()) {
          saveLanProducts(lanCatalogScopeKey(branchId), scoped);
        }
        return scoped;
      }
      const apiIds = new Set(dedupedApi.map((p) => p.id));
      const apiSkus = new Set(
        dedupedApi.map((p) => normalizeProductSku(p.sku)).filter(Boolean),
      );
      const localOnly = localProducts.filter((p) => {
        if (apiIds.has(p.id)) return false;
        const skuKey = normalizeProductSku(p.sku);
        if (skuKey && apiSkus.has(skuKey)) return false;
        if (!branchId) return false;
        return productBelongsToBranchList(p, branchId, apiSkus);
      });
      return filterProductsForApiScope(
        dedupeProductsBySku([...dedupedApi, ...localOnly], branchId, catalogBranchIds),
        branchId,
        catalogBranchIds,
      );
    }

    if (isThinClientMode()) {
      const cached = readLanProducts(lanCatalogScopeKey(branchId));
      if (cached?.length) {
        console.warn('[useProducts] Server unreachable — using cached product list');
        return filterProductsForApiScope(
          dedupeProductsBySku(cached, branchId, catalogBranchIds),
          branchId,
          catalogBranchIds,
        );
      }
    }

    return filterProductsForApiScope(
      dedupeProductsBySku(localProducts, branchId, catalogBranchIds),
      branchId,
      catalogBranchIds,
    );
  }, [branchId, catalogBranchIds, listOptions?.light]);

  const refreshProducts = useCallback(async () => {
    if (!listEnabled) {
      setProductsLoading(false);
      return;
    }
    const generation = ++listGenerationRef.current;
    setProductsLoading(true);
    try {
      const list = await fetchMergedProductList();
      if (generation === listGenerationRef.current) {
        setProducts(list);
        setCachedList(productsCacheKey, list);
        try {
          const { syncProductsToLocalCache } = await import('@/lib/sync/offlineFirst');
          await syncProductsToLocalCache(
            list.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              price: p.price,
              cost: p.avgCost ?? p.cost,
              taxRate: p.taxRate,
              stock: p.stock,
              branchId: p.branchId,
            }))
          );
        } catch {
          /* offline-first cache is optional */
        }
      }
    } finally {
      if (generation === listGenerationRef.current) {
        setProductsLoading(false);
      }
    }
  }, [fetchMergedProductList, listEnabled, productsCacheKey]);

  useEffect(() => {
    if (!listEnabled) {
      setProducts([]);
      setProductsLoading(false);
      return;
    }
    void refreshProducts();
  }, [refreshProducts, listEnabled]);

  useEffect(() => {
    const handleProductsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ branchId?: string; lightweight?: boolean }>;
      if (customEvent.detail?.lightweight) return;
      const changedBranchId = customEvent.detail?.branchId;
      const affectsAllBranches = !changedBranchId || changedBranchId === 'all';
      if (!branchId || affectsAllBranches || changedBranchId === branchId) {
        refreshProducts();
      }
    };
    window.addEventListener(storage.PRODUCTS_CHANGED_EVENT, handleProductsChanged as EventListener);
    return () => window.removeEventListener(storage.PRODUCTS_CHANGED_EVENT, handleProductsChanged as EventListener);
  }, [branchId, refreshProducts]);

  type ProductWriteOptions = { skipListMerge?: boolean; lightweightChangedEvent?: boolean };

  const mergeSavedIntoProductList = useCallback(
    (saved: Product, generation: number) => {
      if (generation !== listGenerationRef.current) return;
      setProducts((prev) => {
        const idx = prev.findIndex((p) => p.id === saved.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = saved;
          return next;
        }
        return dedupeProductsBySku([saved, ...prev], branchId, catalogBranchIds);
      });
    },
    [branchId, catalogBranchIds],
  );

  const dispatchProductsChanged = useCallback(
    (changedBranch: string, options?: ProductWriteOptions) => {
      if (!options?.lightweightChangedEvent) {
        invalidateSellingPriceHintsCache();
      }
      window.dispatchEvent(
        new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, {
          detail: {
            branchId: changedBranch,
            lightweight: options?.lightweightChangedEvent === true,
          },
        }),
      );
    },
    [],
  );

  const addProduct = useCallback(async (
    product: Product,
    options?: ProductWriteOptions,
  ): Promise<Product> => {
    if (isOfflineModeActive()) {
      throw new Error(
        'Cannot save products while signed in offline. Connect to the server and log in again.',
      );
    }

    const writeGeneration = ++listGenerationRef.current;
    const normalizedBranch = normalizeProductBranchIdForApi(product.branchId);
    const payload = {
      ...product,
      branchId: normalizedBranch ?? product.branchId ?? undefined,
    };
    if (!payload.branchId || payload.branchId === 'all' || payload.branchId === '') {
      const fallbackBranch = readStoredUserBranchId() || branchId;
      if (fallbackBranch && fallbackBranch !== 'all') {
        payload.branchId = fallbackBranch;
      } else {
        delete payload.branchId;
      }
    }
    delete (payload as Record<string, unknown>).preserveStock;
    delete (payload as Record<string, unknown>).id;

    const result = await api.products.create(payload);
    if (!result.data) {
      if (isDemoMode()) {
        try {
          await storage.saveProduct(product);
          let merged = await fetchMergedProductList();
          if (!merged.some((p) => p.id === product.id)) {
            merged = [...merged, product];
          }
          if (writeGeneration === listGenerationRef.current) {
            setProducts(merged);
          }
          return product;
        } catch (e) {
          console.error('[useProducts] addProduct: demo local save failed:', e);
          throw e instanceof Error ? e : new Error('Could not save product');
        }
      }
      throw new Error(result.error || 'Failed to save product to database');
    }

    const savedProduct = mapProduct(result.data);
    try {
      await storage.saveProduct(savedProduct, { skipProductsChangedEvent: true });
    } catch (e) {
      console.warn('[useProducts] local cache mirror after API create failed:', e);
    }
    mergeSavedIntoProductList(savedProduct, writeGeneration);
    if (!options?.skipListMerge) {
      void fetchMergedProductList()
        .then((merged) => {
          let list = merged;
          if (!list.some((p) => p.id === savedProduct.id)) {
            list = dedupeProductsBySku([savedProduct, ...list], branchId, catalogBranchIds);
          }
          if (writeGeneration === listGenerationRef.current) {
            setProducts(list);
          }
        })
        .catch(() => { /* list already has optimistic row */ });
    }
    const changedBranch =
      savedProduct.branchId || branchId || catalogBranchIds[0] || 'all';
    dispatchProductsChanged(changedBranch, {
      ...options,
      lightweightChangedEvent: options?.lightweightChangedEvent ?? true,
    });
    return savedProduct;
  }, [
    branchId,
    catalogBranchIds,
    dispatchProductsChanged,
    fetchMergedProductList,
    mergeSavedIntoProductList,
  ]);

  const updateProduct = useCallback(async (
    product: Product & { preserveStock?: boolean },
    options?: ProductWriteOptions,
  ): Promise<Product> => {
    const writeGeneration = ++listGenerationRef.current;
    const { preserveStock, ...rest } = product;
    const payload = {
      ...rest,
      branchId: normalizeProductBranchIdForApi(product.branchId) ?? undefined,
      ...(preserveStock ? { preserveStock: true } : {}),
    };
    const result = await api.products.update(product.id, payload);
    let resolved = product;
    if (!result.data) {
      try {
        await storage.saveProduct(product);
      } catch (e) {
        console.error('[useProducts] updateProduct: API and local save failed:', e);
        throw e instanceof Error ? e : new Error('Could not update product');
      }
    } else {
      resolved = mapProduct(result.data);
      try {
        await storage.saveProduct(resolved, { skipProductsChangedEvent: true });
      } catch (e) {
        console.warn('[useProducts] local cache mirror after API update failed:', e);
      }
    }
    if (options?.skipListMerge) {
      mergeSavedIntoProductList(resolved, writeGeneration);
    } else {
      let merged = await fetchMergedProductList();
      const idx = merged.findIndex((p) => p.id === resolved.id);
      if (idx >= 0) {
        merged = merged.slice();
        merged[idx] = resolved;
      }
      if (writeGeneration === listGenerationRef.current) {
        setProducts(merged);
      }
    }
    const changedBranch = resolved.branchId || branchId || 'all';
    dispatchProductsChanged(changedBranch, options);
    return resolved;
  }, [
    branchId,
    dispatchProductsChanged,
    fetchMergedProductList,
    mergeSavedIntoProductList,
  ]);

  const deleteProduct = useCallback(async (productId: string) => {
    ++listGenerationRef.current;
    const result = await api.products.delete(productId);
    if (result.error) {
      throw new Error(result.error);
    }
    if (!result.data) await storage.deleteProduct(productId);
    await refreshProducts();
  }, [refreshProducts]);

  return { products, productsLoading, refreshProducts, addProduct, updateProduct, deleteProduct };
}

// ============================================
// CART (Always local - per session)
// ============================================
export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((product: Product, quantity: number = 1) => {
    setItems(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity, subtotal: (item.quantity + quantity) * item.product.price * (1 - item.discount / 100) }
            : item
        );
      }
      return [...prev, { product, quantity, discount: 0, subtotal: quantity * product.price }];
    });
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems(prev => prev.filter(item => item.product.id !== productId));
    } else {
      setItems(prev => prev.map(item =>
        item.product.id === productId
          ? { ...item, quantity, subtotal: quantity * item.product.price * (1 - item.discount / 100) }
          : item
      ));
    }
  }, []);

  const setItemDiscount = useCallback((productId: string, discount: number) => {
    setItems(prev => prev.map(item =>
      item.product.id === productId
        ? { ...item, discount, subtotal: item.quantity * item.product.price * (1 - discount / 100) }
        : item
    ));
  }, []);

  // Override the effective unit price of a line (used when the POS price level or
  // selected client changes). The cart stores an effective price on the product
  // clone, so all downstream math (subtotal, checkout) keeps working unchanged.
  const repriceItem = useCallback((productId: string, unitPrice: number) => {
    setItems(prev => prev.map(item =>
      item.product.id === productId
        ? {
            ...item,
            product: { ...item.product, price: unitPrice },
            subtotal: item.quantity * unitPrice * (1 - item.discount / 100),
          }
        : item
    ));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems(prev => prev.filter(item => item.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const taxAmount = items.reduce((sum, item) => sum + item.subtotal * (item.product.taxRate / 100), 0);
  const total = subtotal + taxAmount;

  return { items, addItem, updateQuantity, setItemDiscount, repriceItem, removeItem, clearCart, subtotal, taxAmount, total };
}

// ============================================
// SALES
// ============================================
function mapSaleRow(s: any): Sale {
  return {
    id: s.id,
    invoiceNumber: s.invoiceNumber || s.invoice_number || '',
    branchId: s.branchId || s.branch_id || '',
    cashierId: s.cashierId || s.cashier_id || '',
    cashierName: s.cashierName || s.cashier_name || '',
    items: (s.items || []).map((i: any) => ({
      productId: i.productId || i.product_id,
      productName: i.productName || i.product_name,
      sku: i.sku || '',
      quantity: Number(i.quantity) || 0,
      unitPrice: Number(i.unitPrice ?? i.unit_price) || 0,
      discount: Number(i.discount) || 0,
      taxRate: Number(i.taxRate ?? i.tax_rate) || 0,
      taxAmount: Number(i.taxAmount ?? i.tax_amount) || 0,
      subtotal: Number(i.subtotal ?? i.total) || 0,
    })),
    subtotal: Number(s.subtotal || 0),
    taxAmount: Number(s.taxAmount || s.tax_amount || 0),
    discount: Number(s.discount || 0),
    total: Number(s.total || 0),
    paymentMethod: s.paymentMethod || s.payment_method || 'cash',
    amountPaid: Number(s.amountPaid || s.amount_paid || 0),
    change: Number(s.change || s.change_amount || 0),
    customerNif: s.customerNif || s.customer_nif || '',
    customerName: s.customerName || s.customer_name || '',
    status: s.status || 'completed',
    invoiceType: resolveSaleDocumentType({
      invoiceType: s.invoiceType || s.invoice_type,
      invoiceNumber: s.invoiceNumber || s.invoice_number,
    }),
    saftHash: s.saftHash || s.agt_hash || s.saft_hash || '',
    agtStatus: s.agtStatus || s.agt_status || undefined,
    agtCode: s.agtCode || s.agt_code || undefined,
    agtValidatedAt: s.agtValidatedAt || s.agt_validated_at || undefined,
    createdAt: s.createdAt || s.created_at || '',
  };
}

export function useSales(branchId?: string, deferInitialLoad = false) {
  const salesCacheKey = `sales:${branchId ?? 'all'}`;
  const [sales, setSales] = useState<Sale[]>(() => getCachedList<Sale[]>(salesCacheKey) ?? []);

  const refreshSales = useCallback(async () => {
    let data: any[] = [];
    let reachedServer = false;
    try {
      const result = await api.sales.list(branchId);
      if (result.data !== undefined) {
        data = result.data;
        reachedServer = true;
      } else if (isDemoMode()) {
        data = await storage.getSales(branchId);
        reachedServer = true;
      } else {
        throw new Error(result.error || 'Failed to load sales');
      }
    } catch (e) {
      console.error('[useSales] refresh failed:', e);
      if (isDemoMode()) {
        try {
          data = await storage.getSales(branchId);
          reachedServer = true;
        } catch {
          data = [];
        }
      } else {
        data = [];
      }
    }
    // Don't wipe a good cached list to empty on a transient fetch failure.
    if (!reachedServer && data.length === 0) return;
    const mapped = data.map(mapSaleRow);
    setSales(mapped);
    setCachedList(`sales:${branchId ?? 'all'}`, mapped);
  }, [branchId]);

  useEffect(() => {
    const onSalesChanged = () => {
      void refreshSales();
    };
    window.addEventListener(storage.SALES_CHANGED_EVENT, onSalesChanged);
    return () => window.removeEventListener(storage.SALES_CHANGED_EVENT, onSalesChanged);
  }, [refreshSales]);

  useEffect(() => {
    if (deferInitialLoad) return;
    refreshSales();
  }, [refreshSales, deferInitialLoad]);

  const completeSale = useCallback(async (
    cartItems: CartItem[],
    branchCode: string,
    branchId: string,
    cashierId: string,
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
    discountPct = 0,
    clientId?: string,
    clientRequestId?: string,
  ): Promise<Sale> => {
    // Whole-sale commercial discount applied to the ex-VAT base of every line, so VAT
    // is charged on the discounted base (AGT-correct). Header `discount` holds the Kz value.
    const pct = Number.isFinite(discountPct) ? Math.min(Math.max(discountPct, 0), 100) : 0;
    const discountFactor = 1 - pct / 100;

    const saleItems: SaleItem[] = cartItems.map(item => {
      const lineExVat = item.subtotal * discountFactor;
      return {
        productId: item.product.id,
        productName: item.product.name,
        sku: item.product.sku,
        quantity: item.quantity,
        unitPrice: item.product.price,
        discount: pct,
        taxRate: item.product.taxRate,
        taxAmount: lineExVat * (item.product.taxRate / 100),
        subtotal: lineExVat,
      };
    });

    const grossSubtotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
    const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = saleItems.reduce((sum, item) => sum + item.taxAmount, 0);
    const total = subtotal + taxAmount;
    const discountValue = grossSubtotal - subtotal;

    const normalizedCustomerNif = customerNif ? normalizeCustomerNif(customerNif) : undefined;

    const invoiceType = resolveSaleInvoiceType({
      customerNif: normalizedCustomerNif,
      paymentMethod,
      total,
    });

    const cashierName = (() => {
      try {
        const u = JSON.parse(sessionStorage.getItem('kwanzaerp_current_user') || localStorage.getItem('kwanzaerp_current_user') || '{}');
        return u?.name || '';
      } catch { return ''; }
    })();

    const apiResult = await api.sales.create({
      branchId,
      branchCode,
      cashierId,
      cashierName,
      items: saleItems,
      subtotal,
      taxAmount,
      discount: discountValue,
      total,
      paymentMethod,
      amountPaid,
      change: amountPaid - total,
      customerNif: normalizedCustomerNif,
      customerName,
      clientId,
      clientRequestId,
    });

    if (!apiResult.data) {
      console.error('[POS] API business error:', apiResult.error);
      throw new Error(apiResult.error || t.erpUi.processSaleFailed);
    }

    const sale: Sale = {
      id: apiResult.data.id,
      invoiceNumber: apiResult.data.invoice_number || apiResult.data.invoiceNumber || '',
      branchId,
      cashierId,
      cashierName,
      items: saleItems,
      subtotal,
      taxAmount,
      discount: discountValue,
      total,
      paymentMethod,
      amountPaid,
      change: amountPaid - total,
      customerNif: normalizedCustomerNif,
      customerName,
      status: 'completed',
      invoiceType: resolveSaleDocumentType({
        invoiceType: apiResult.data.invoice_type || apiResult.data.invoiceType || invoiceType,
        invoiceNumber: apiResult.data.invoice_number || apiResult.data.invoiceNumber,
      }),
      saftHash: apiResult.data.saft_hash || apiResult.data.saftHash || undefined,
      agtCode: apiResult.data.agt_code || apiResult.data.agtCode || undefined,
      createdAt: apiResult.data.created_at || new Date().toISOString(),
    };

    console.log(`[POS] Sale ${sale.invoiceNumber} processed via backend API ✓`);

    setSales((prev) => {
      if (prev.some((row) => row.id === sale.id)) return prev;
      if (
        sale.invoiceNumber
        && prev.some(
          (row) =>
            row.invoiceNumber
            && row.invoiceNumber.trim().toUpperCase() === sale.invoiceNumber.trim().toUpperCase(),
        )
      ) {
        return prev;
      }
      return [sale, ...prev];
    });
    // POS refreshes sales in the background; awaiting here blocks checkout + auto-print.
    void refreshSales();
    return sale;
  }, [refreshSales]);

  return { sales, completeSale, refreshSales };
}

// ============================================
// AUTH
// ============================================
const SESSION_TOKEN_KEY = 'kwanzaerp_window_session';

/** Electron: set on successful login; cleared on logout. Survives navigation but not app restart (sessionStorage). */
export const ELECTRON_SESSION_AUTH_KEY = 'kwanzaerp_session_authenticated';

function markElectronSessionAuthenticated() {
  try {
    if (storage.isElectronMode()) {
      sessionStorage.setItem(ELECTRON_SESSION_AUTH_KEY, '1');
    }
  } catch {
    /* ignore */
  }
}

function clearElectronSessionAuthenticated() {
  try {
    sessionStorage.removeItem(ELECTRON_SESSION_AUTH_KEY);
  } catch {
    /* ignore */
  }
}

type AuthState = { user: User | null; isLoading: boolean };
let authState: AuthState = { user: null, isLoading: true };
let authInitialized = false;
const authListeners = new Set<() => void>();

function setAuthState(patch: Partial<AuthState>) {
  authState = { ...authState, ...patch };
  authListeners.forEach(l => l());
}

function subscribeAuth(listener: () => void) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function getAuthSnapshot() { return authState; }

function initWindowSession() {
  const existingToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (!existingToken) {
    const token = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    // Don't clear user on new tab - let initAuthStateOnce validate instead
  }
}

initWindowSession();

/**
 * Electron: restore user only if this **session** logged in (`sessionStorage` is empty on cold start).
 * Avoids skipping the login screen while still avoiding an endless spinner on secondary windows
 * (main.cjs injects the same session flag when opening a child window).
 */
function hydrateElectronAuthBeforeFirstPaint() {
  if (!storage.isElectronMode()) return;
  if (authInitialized) return;
  authInitialized = true;
  let sessionOk = false;
  try {
    sessionOk = sessionStorage.getItem(ELECTRON_SESSION_AUTH_KEY) === '1';
  } catch {
    sessionOk = false;
  }
  const currentUser = storage.getCurrentUser();
  if (sessionOk && currentUser?.id && currentUser?.email) {
    applyUserBranchLockOnLogin(currentUser);
    authState = { user: currentUser, isLoading: false };
    return;
  }
  authState = { user: null, isLoading: false };
}
hydrateElectronAuthBeforeFirstPaint();

async function initAuthStateOnce() {
  if (authInitialized) return;
  authInitialized = true;

  const currentUser = storage.getCurrentUser();

  // Electron: same rules as hydrate — only revive user when this session authenticated.
  if (storage.isElectronMode()) {
    let sessionOk = false;
    try {
      sessionOk = sessionStorage.getItem(ELECTRON_SESSION_AUTH_KEY) === '1';
    } catch {
      sessionOk = false;
    }
    if (sessionOk && currentUser?.id && currentUser?.email) {
      applyUserBranchLockOnLogin(currentUser);
      try {
        await ensureBackendAuthToken();
        const meResult = await api.auth.me();
        if (meResult.data?.id) {
          const me = meResult.data;
          const fresh: User = {
            id: String(me.id),
            email: String(me.email || currentUser.email),
            name: String(me.name || currentUser.name),
            username: currentUser.username || String(me.email || '').split('@')[0] || '',
            role: (me.role as User['role']) || currentUser.role,
            branchId: String(me.branchId ?? me.branch_id ?? currentUser.branchId ?? ''),
            isActive: true,
            createdAt: String(me.createdAt ?? me.created_at ?? currentUser.createdAt ?? ''),
            permissionOverrides: me.permissionOverrides ?? currentUser.permissionOverrides,
          };
          storage.setCurrentUser(fresh);
          applyUserBranchLockOnLogin(fresh);
          setAuthState({ user: fresh, isLoading: false });
          return;
        }
      } catch {
        /* API not available */
      }
      setAuthState({ user: currentUser, isLoading: false });
      return;
    }
    setAuthState({ user: null, isLoading: false });
    return;
  }

  if (currentUser && currentUser.id && currentUser.email) {
    try {
      await ensureBackendAuthToken();
      const meResult = await api.auth.me();
      if (meResult.data?.id) {
        const me = meResult.data;
        const fresh: User = {
          id: String(me.id),
          email: String(me.email || currentUser.email),
          name: String(me.name || currentUser.name),
          username: currentUser.username || String(me.email || '').split('@')[0] || '',
          role: (me.role as User['role']) || currentUser.role,
          branchId: String(me.branchId ?? me.branch_id ?? currentUser.branchId ?? ''),
          isActive: me.isActive !== false && me.is_active !== false,
          createdAt: String(me.createdAt ?? me.created_at ?? currentUser.createdAt ?? ''),
          permissionOverrides: me.permissionOverrides ?? currentUser.permissionOverrides,
        };
        storage.setCurrentUser(fresh);
        applyUserBranchLockOnLogin(fresh);
        window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
        setAuthState({ user: fresh, isLoading: false });
        return;
      }
      const err = String(meResult.error || '').toLowerCase();
      const backendDown =
        !err
        || err.includes('failed to fetch')
        || err.includes('network')
        || err.includes('timeout')
        || err.includes('abort')
        || err.includes('econnrefused');
      if (backendDown) {
        applyUserBranchLockOnLogin(currentUser);
        setAuthState({ user: currentUser, isLoading: false });
        return;
      }
    } catch {
      applyUserBranchLockOnLogin(currentUser);
      setAuthState({ user: currentUser, isLoading: false });
      return;
    }

    if (isDemoMode()) {
      const users = await storage.getUsers();
      const validUser = users.find(u => u.id === currentUser.id && u.isActive);
      if (validUser) {
        setAuthState({ user: currentUser, isLoading: false });
        return;
      }
    }

    storage.setCurrentUser(null);
  }
  setAuthState({ user: null, isLoading: false });
}

export type LoginOutcome =
  | { ok: true; offline?: boolean }
  | { ok: false; kind: 'credentials' | 'connection'; message?: string };

export function useAuth() {
  const snapshot = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  useEffect(() => { initAuthStateOnce(); }, []);

  const login = useCallback(async (identifier: string, password: string): Promise<LoginOutcome> => {
    const normalized = identifier.trim();
    if (!normalized || !password) return { ok: false, kind: 'credentials' };

    const normalizedLower = normalized.toLowerCase();
    const normalizedUsername = normalizedLower.includes('@')
      ? normalizedLower.split('@')[0]
      : normalizedLower;

    setAuthToken(null);
    clearAuthSessionCache();

    try {
      // Send identifier as entered — backend matches email, username, or email local part
      const response = await api.auth.login(normalized, password);
      if (response.error) {
        console.warn('[Auth] Login failed:', response.error);
        const kind = (response as { errorKind?: 'credentials' | 'connection' }).errorKind || 'credentials';
        return { ok: false, kind, message: response.error };
      }
      const apiUser = response.data?.user;
      const isOffline = !!(response.data as { offline?: boolean })?.offline;
      if (apiUser && (isOffline || (response.data?.token && isJwtAuthToken(response.data.token)))) {
        if (!isOffline && response.data?.token) {
          setAuthToken(response.data.token);
        } else {
          setAuthToken(null);
        }
        const user: User = {
          id: String(apiUser.id),
          email: String(apiUser.email || ''),
          name: String(apiUser.name || ''),
          username: normalizedUsername,
          role: (apiUser.role as User['role']) || 'cashier',
          branchId: String(apiUser.branchId ?? apiUser.branch_id ?? ''),
          isActive: true,
          createdAt: String(apiUser.createdAt ?? apiUser.created_at ?? new Date().toISOString()),
          permissionOverrides: apiUser.permissionOverrides,
        };
        storage.clearLocalProductsCache();
        storage.setCurrentUser(user);
        applyUserBranchLockOnLogin(user);
        window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
        setAuthState({ user });
        markElectronSessionAuthenticated();
        return { ok: true, offline: isOffline };
      }
    } catch (e) {
      console.warn('[Auth] Login API error:', e);
      if (!isDemoMode()) {
        const { tryOfflineLogin, setOfflineModeActive } = await import('@/lib/offlineAuth');
        const { isThinClientMode } = await import('@/lib/api/config');
        if (isThinClientMode()) {
          const offlineUser = await tryOfflineLogin(normalized, password);
          if (offlineUser) {
            setAuthToken(null);
            setOfflineModeActive(true);
            storage.clearLocalProductsCache();
            storage.setCurrentUser(offlineUser);
            applyUserBranchLockOnLogin(offlineUser);
            window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
            setAuthState({ user: offlineUser });
            markElectronSessionAuthenticated();
            return { ok: true, offline: true };
          }
        }
        return { ok: false, kind: 'connection' };
      }
    }

    if (isDemoMode()) {
      const users = await storage.getUsers();
      const foundUser = users.find(u =>
        u.isActive && (
          u.username === normalized
          || u.email === normalized
          || u.email === normalizedLower
          || u.email === `${normalizedUsername}@kwanzaerp.ao`
        )
      );

      if (foundUser) {
        storage.clearLocalProductsCache();
        storage.setCurrentUser(foundUser);
        applyUserBranchLockOnLogin(foundUser);
        window.dispatchEvent(new CustomEvent('nexor:branch-lock-changed'));
        setAuthState({ user: foundUser });
        markElectronSessionAuthenticated();
        return { ok: true };
      }
    }
    return { ok: false, kind: 'credentials' };
  }, []);

  const logout = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('kwanza_auth_token') : null;
    if (token && isJwtAuthToken(token)) {
      void api.auth.logout().catch(() => {});
    }
    clearElectronSessionAuthenticated();
    storage.clearLocalProductsCache();
    storage.setCurrentUser(null);
    setAuthToken(null);
    clearAuthSessionCache();
    setAuthState({ user: null });
  }, []);

  return { user: snapshot.user, isLoading: snapshot.isLoading, login, logout };
}

// ============================================
// DAILY REPORTS
// ============================================
function mapDailyReportRow(row: any): DailySummary {
  return {
    id: row.id,
    date: row.date,
    branchId: row.branchId ?? row.branch_id ?? '',
    branchName: row.branchName ?? row.branch_name ?? '',
    totalSales: Number(row.totalSales ?? row.total_sales ?? 0),
    totalTransactions: Number(row.totalTransactions ?? row.total_transactions ?? 0),
    cashTotal: Number(row.cashTotal ?? row.cash_total ?? 0),
    cardTotal: Number(row.cardTotal ?? row.card_total ?? 0),
    transferTotal: Number(row.transferTotal ?? row.transfer_total ?? 0),
    taxCollected: Number(row.taxCollected ?? row.tax_collected ?? 0),
    openingBalance: Number(row.openingBalance ?? row.opening_balance ?? 0),
    closingBalance: Number(row.closingBalance ?? row.closing_balance ?? 0),
    status: row.status ?? 'open',
    closedBy: row.closedBy ?? row.closed_by,
    closedAt: row.closedAt ?? row.closed_at,
    notes: row.notes,
    createdAt: row.createdAt ?? row.created_at ?? '',
  };
}

export function useDailyReports(branchId?: string) {
  const [reports, setReports] = useState<DailySummary[]>(
    () => getCachedList<DailySummary[]>(`dailyReports:${branchId ?? 'all'}`) ?? [],
  );

  const refreshReports = useCallback(async () => {
    const key = `dailyReports:${branchId ?? 'all'}`;
    try {
      const response = await api.dailyReports.list(branchId);
      if (!response.error && Array.isArray(response.data)) {
        const mapped = response.data.map(mapDailyReportRow);
        setReports(mapped);
        setCachedList(key, mapped);
        return;
      }
      if (!isDemoMode()) {
        // Keep the last-known list rather than wiping to empty on a transient failure.
        console.warn('[useDailyReports] API list failed:', response.error);
        return;
      }
    } catch (e) {
      if (!isDemoMode()) {
        console.warn('[useDailyReports] API list failed:', e);
        return;
      }
    }

    try {
      const fromStorage = await storage.getDailyReports(branchId);
      const mapped = fromStorage.map(mapDailyReportRow);
      setReports(mapped);
      setCachedList(key, mapped);
    } catch (e) {
      console.warn('[useDailyReports] storage fallback failed:', e);
    }
  }, [branchId]);

  useEffect(() => { refreshReports(); }, [refreshReports]);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (table === 'daily_reports') void refreshReports();
    };
    window.addEventListener(TABLE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TABLE_REFRESH_EVENT, onRefresh);
  }, [refreshReports]);

  const generateReport = useCallback(async (branchId: string, date: string): Promise<DailySummary> => {
    const apiResult = await api.dailyReports.generate(branchId, date);
    if (apiResult.data) {
      const mapped = mapDailyReportRow(apiResult.data);
      await storage.persistDailyReportLocal(mapped);
      await refreshReports();
      return mapped;
    }
    if (!isDemoMode()) {
      throw new Error(apiResult.error || 'Failed to generate daily report');
    }
    const report = await storage.generateDailyReport(branchId, date);
    await storage.persistDailyReportLocal(report);
    try {
      await storage.saveDailyReport(report);
    } catch {
      /* optional IPC persist */
    }
    await refreshReports();
    return report;
  }, [refreshReports]);

  const closeDay = useCallback(async (reportId: string, closingBalance: number, notes: string, userId: string) => {
    const apiResult = await api.dailyReports.close(reportId, { closingBalance, notes, closedBy: userId });
    if (!apiResult.data) {
      const allReports = await storage.getDailyReports();
      const report = allReports.find(r => r.id === reportId);
      if (report) {
        report.status = 'closed';
        report.closingBalance = closingBalance;
        report.notes = notes;
        report.closedBy = userId;
        report.closedAt = new Date().toISOString();
        await storage.saveDailyReport(report);
      }
    }
    await refreshReports();
  }, [refreshReports]);

  const getTodayReport = useCallback(async (branchId: string): Promise<DailySummary | null> => {
    return storage.getTodayReport(branchId);
  }, []);

  return { reports, generateReport, closeDay, getTodayReport, refreshReports };
}

// ============================================
// CLIENTS
// ============================================
function mapClientApiRow(c: any): Client {
  return {
    id: String(c.id ?? ''),
    name: c.name || '',
    nif: c.nif || '',
    email: c.email || '',
    phone: c.phone || '',
    address: c.address || '',
    city: c.city || '',
    country: c.country || 'Angola',
    creditLimit: Number(c.creditLimit ?? c.credit_limit ?? 0),
    currentBalance: Number(c.currentBalance ?? c.current_balance ?? 0),
    defaultPriceLevel: (() => {
      const lvl = Math.trunc(Number(c.defaultPriceLevel ?? c.default_price_level ?? 1));
      return lvl >= 1 && lvl <= 4 ? lvl : 1;
    })(),
    priceAdjustmentPct: Number(c.priceAdjustmentPct ?? c.price_adjustment_pct ?? 0),
    paymentTermsDays: (() => {
      const d = Math.trunc(Number(c.paymentTermsDays ?? c.payment_terms_days ?? 0));
      return Number.isFinite(d) && d > 0 ? d : 0;
    })(),
    isActive: c.isActive ?? c.is_active ?? true,
    createdAt: c.createdAt ?? c.created_at ?? new Date().toISOString(),
    updatedAt: c.updatedAt ?? c.updated_at ?? new Date().toISOString(),
  };
}

export function useClients(deferInitialLoad = false) {
  const [clients, setClients] = useState<Client[]>(() => getCachedList<Client[]>('clients') ?? []);

  const refreshClients = useCallback(async () => {
    let apiRows: any[] = [];
    try {
      const response = await api.clients.list();
      if (!response.error && Array.isArray(response.data)) {
        apiRows = response.data;
      }
    } catch (e) {
      console.warn('[useClients] API list failed', e);
    }

    let fromStorage: Client[] = [];
    try {
      fromStorage = await storage.getClients();
    } catch (e) {
      console.warn('[useClients] storage.getClients failed', e);
    }

    // Merge: API rows first, then storage-only (fixes empty HTTP [] while local/SQLite has rows;
    // Electron create via IPC + list via HTTP was hiding new clients.)
    const byId = new Map<string, Client>();
    for (const row of apiRows) {
      const c = mapClientApiRow(row);
      if (c.id) byId.set(c.id, c);
    }
    for (const c of fromStorage) {
      const id = String(c.id ?? '');
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, mapClientApiRow(c));
    }

    const sorted = Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    setClients(sorted);
    setCachedList('clients', sorted);
  }, []);

  const notifyClientsChanged = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(storage.CLIENTS_CHANGED_EVENT, { detail: {} }));
  }, []);

  useEffect(() => {
    if (deferInitialLoad) return;
    refreshClients();
  }, [refreshClients, deferInitialLoad]);

  // Keep every useClients instance (Clients page, Chart of Accounts dialog, POS, …)
  // in sync when a client is created/updated/deleted from anywhere.
  useEffect(() => {
    const onClientsChanged = () => { void refreshClients(); };
    window.addEventListener(storage.CLIENTS_CHANGED_EVENT, onClientsChanged);
    return () => window.removeEventListener(storage.CLIENTS_CHANGED_EVENT, onClientsChanged);
  }, [refreshClients]);

  const saveClient = useCallback(async (client: Client) => {
    const name = String(client.name || '').trim();
    const nif = String(client.nif || '').replace(/\s/g, '').trim();
    if (!name) throw new Error('Name is required');
    if (!nif) throw new Error('NIF is required');
    if (!validateNIF(nif)) throw new Error('NIF must have 10 digits');

    const payload = { ...client, name, nif };
    const result = await api.clients.update(client.id, payload);
    if (!result.data) await storage.saveClient(payload);
    await refreshClients();
    notifyClientsChanged();
  }, [refreshClients, notifyClientsChanged]);

  const deleteClient = useCallback(async (clientId: string) => {
    const result = await api.clients.delete(clientId);
    if (!result.data) await storage.deleteClient(clientId);
    await refreshClients();
    notifyClientsChanged();
  }, [refreshClients, notifyClientsChanged]);

  const createClient = useCallback(async (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> => {
    const name = String(data.name || '').trim();
    const nif = String(data.nif || '').replace(/\s/g, '').trim();
    if (!name) throw new Error('Name is required');
    if (!nif) throw new Error('NIF is required');
    if (!validateNIF(nif)) throw new Error('NIF must have 10 digits');

    const payload = { ...data, name, nif };
    const result = await api.clients.create(payload);
    const row = result.data as Record<string, unknown> | undefined;
    const apiOk =
      row != null &&
      !result.error &&
      (String((row as { id?: unknown }).id ?? '').length > 0 ||
        typeof (row as { name?: unknown }).name === 'string');
    if (apiOk) {
      await refreshClients();
      notifyClientsChanged();
      return mapClientApiRow(row);
    }
    const client: Client = {
      ...payload,
      id: `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveClient(client);
    await refreshClients();
    notifyClientsChanged();
    return client;
  }, [refreshClients, notifyClientsChanged]);

  return { clients, saveClient, deleteClient, createClient, refreshClients };
}

// ============================================
// STOCK TRANSFERS
// ============================================
export function useStockTransfers(branchId?: string) {
  const { t } = useTranslation();
  const [transfers, setTransfers] = useState<StockTransfer[]>(
    () => getCachedList<StockTransfer[]>(`transfers:${branchId ?? 'all'}`) ?? [],
  );

  const refreshTransfers = useCallback(async () => {
    try {
      const data = await apiFallback<any[]>(
        () => api.stockTransfers.list(branchId),
        () => storage.getStockTransfers(branchId)
      );
      const mapped = Array.isArray(data) ? data.map(mapStockTransfer) : [];
      setTransfers(mapped);
      setCachedList(`transfers:${branchId ?? 'all'}`, mapped);
    } catch (error) {
      console.error('[STOCK TRANSFERS] Failed to load:', error);
    }
  }, [branchId]);

  const notifyTransfersChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent(storage.STOCK_TRANSFERS_CHANGED_EVENT, { detail: {} }));
  }, []);

  useEffect(() => { refreshTransfers(); }, [refreshTransfers]);

  const createTransfer = useCallback(async (
    fromBranchId: string, toBranchId: string,
    items: { productId: string; productName: string; sku: string; quantity: number }[],
    requestedBy: string, notes?: string
  ): Promise<StockTransfer> => {
    const result = await api.stockTransfers.create({
      fromBranchId, toBranchId, items, requestedBy, notes,
    });
    if (!result.data) {
      throw new Error(result.error || t.erpUi.createTransferFailed);
    }
    await refreshTransfers();
    notifyTransfersChanged();
    return mapStockTransfer(result.data);
  }, [refreshTransfers, notifyTransfersChanged, t.erpUi.createTransferFailed]);

  const approveTransfer = useCallback(async (transferId: string, userId: string) => {
    const result = await api.stockTransfers.approve(transferId, userId);
    if (!result.data) throw new Error(result.error || t.erpUi.approveTransferFailed);
    await refreshTransfers();
    notifyTransfersChanged();
    const fromBranchId = (result.data as { from_branch_id?: string; fromBranchId?: string })?.from_branch_id
      || (result.data as { fromBranchId?: string })?.fromBranchId;
    invalidateInventoryGridCacheForBranches([fromBranchId]);
    window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, {
      detail: { branchId: fromBranchId || 'all', fromBranchId },
    }));
  }, [refreshTransfers, notifyTransfersChanged, t.erpUi.approveTransferFailed]);

  const receiveTransfer = useCallback(async (transferId: string, userId: string, receivedQuantities?: Record<string, number>) => {
    const result = await api.stockTransfers.receive(transferId, userId, receivedQuantities);
    if (!result.data) throw new Error(result.error || t.erpUi.receiveTransferFailed);
    await refreshTransfers();
    notifyTransfersChanged();
    const payload = result.data as { to_branch_id?: string; toBranchId?: string; from_branch_id?: string; fromBranchId?: string };
    const toBranchId = payload?.to_branch_id || payload?.toBranchId;
    const fromBranchId = payload?.from_branch_id || payload?.fromBranchId;
    invalidateInventoryGridCacheForBranches([toBranchId, fromBranchId]);
    window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, {
      detail: { branchId: toBranchId || fromBranchId || 'all', toBranchId, fromBranchId },
    }));
  }, [refreshTransfers, notifyTransfersChanged, t.erpUi.receiveTransferFailed]);

  const cancelTransfer = useCallback(async (transferId: string, userId: string) => {
    const result = await api.stockTransfers.cancel(transferId, userId);
    if (result.error) throw new Error(result.error);
    await refreshTransfers();
    notifyTransfersChanged();
  }, [refreshTransfers, notifyTransfersChanged]);

  return { transfers, createTransfer, approveTransfer, receiveTransfer, cancelTransfer, refreshTransfers };
}

// ============================================
// SUPPLIERS
// ============================================
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getCachedList<Supplier[]>('suppliers') ?? []);

  const refreshSuppliers = useCallback(async () => {
    let data: any[] = [];
    try {
      const result = await api.suppliers.list();
      if (result.data !== undefined) {
        data = result.data;
      } else if (isDemoMode()) {
        data = await storage.getSuppliers();
      } else if (isThinClientMode()) {
        const cached = readLanSuppliers();
        if (cached?.length) {
          console.warn('[useSuppliers] Server unreachable — using cached suppliers');
          setSuppliers(cached);
          return;
        }
        data = await storage.getSuppliers();
      } else {
        throw new Error(result.error || 'API returned no data');
      }
    } catch {
      if (isThinClientMode()) {
        const cached = readLanSuppliers();
        if (cached?.length) {
          console.warn('[useSuppliers] Server unreachable — using cached suppliers');
          setSuppliers(cached);
          return;
        }
      }
      if (isDemoMode()) {
        data = await storage.getSuppliers();
      }
    }
    const mapped = Array.isArray(data) ? data.map(mapSupplier) : [];
    if (mapped.length && isThinClientMode()) {
      saveLanSuppliers(mapped);
    }
    console.log(`[ERP] Suppliers loaded: ${mapped.length} total, ${mapped.filter(s => s.isActive).length} active`);
    setSuppliers(mapped);
    setCachedList('suppliers', mapped);
  }, []);

  const notifySuppliersChanged = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(storage.SUPPLIERS_CHANGED_EVENT, { detail: {} }));
  }, []);

  useEffect(() => { refreshSuppliers(); }, [refreshSuppliers]);

  useEffect(() => {
    const onSuppliersChanged = () => { void refreshSuppliers(); };
    window.addEventListener(storage.SUPPLIERS_CHANGED_EVENT, onSuppliersChanged);
    return () => window.removeEventListener(storage.SUPPLIERS_CHANGED_EVENT, onSuppliersChanged);
  }, [refreshSuppliers]);

  const saveSupplier = useCallback(async (supplier: Supplier) => {
    const result = await api.suppliers.update(supplier.id, supplier);
    if (!result.data) await storage.saveSupplier(supplier);
    await refreshSuppliers();
    notifySuppliersChanged();
  }, [refreshSuppliers, notifySuppliersChanged]);

  const deleteSupplier = useCallback(async (supplierId: string) => {
    const result = await api.suppliers.delete(supplierId);
    if (!result.data) await storage.deleteSupplier(supplierId);
    await refreshSuppliers();
    notifySuppliersChanged();
  }, [refreshSuppliers, notifySuppliersChanged]);

  const createSupplier = useCallback(async (data: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> => {
    const result = await api.suppliers.create(data);
    if (result.data) {
      const mapped = mapSupplier(result.data);
      try {
        const accountCode = (result.data as { _accountCode?: string })._accountCode;
        if (!accountCode) {
          await ensureSupplierAccount(mapped.id, mapped.name, mapped.nif, (data as { accountParentCode?: string }).accountParentCode);
        }
      } catch (e) {
        console.warn('[ERP] ensureSupplierAccount after create skipped:', e);
      }
      await refreshSuppliers();
      notifySuppliersChanged();
      return mapped;
    }
    const errMsg = (result.error || '').toLowerCase();
    const likelyValidation =
      errMsg.includes('duplicate') ||
      errMsg.includes('unique') ||
      errMsg.includes('validation') ||
      errMsg.includes('already exists');
    const recoverable =
      !likelyValidation &&
      (!result.error ||
        errMsg.includes('database not connected') ||
        errMsg.includes('network') ||
        errMsg.includes('fetch') ||
        errMsg.includes('failed to fetch') ||
        errMsg.includes('econnrefused') ||
        errMsg.includes('timeout') ||
        errMsg.includes('demo mode') ||
        errMsg.includes('backend not available'));
    if (result.error && !recoverable) {
      throw new Error(result.error);
    }
    if (result.error) {
      console.warn('[ERP] createSupplier recoverable failure, using local cache:', result.error);
    }
    const supplier: Supplier = {
      ...data,
      id: `supplier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    storage.saveSupplierLocalFallback(supplier);
    await ensureSupplierAccount(supplier.id, supplier.name, supplier.nif, (data as { accountParentCode?: string }).accountParentCode);
    await refreshSuppliers();
    notifySuppliersChanged();
    return supplier;
  }, [refreshSuppliers, notifySuppliersChanged]);

  return { suppliers, saveSupplier, deleteSupplier, createSupplier, refreshSuppliers };
}

// ============================================
// PURCHASE ORDERS
// ============================================
function mapPurchaseOrderItem(item: any): PurchaseOrderItem {
  const quantity = Number(item.quantity ?? 0);
  const unitCost = Number(item.unitCost ?? item.unit_cost ?? 0);
  const taxRate = Number(item.taxRate ?? item.tax_rate ?? 0);
  const subtotal = Number(item.subtotal ?? quantity * unitCost);

  return {
    productId: item.productId ?? item.product_id ?? '',
    productName: item.productName ?? item.product_name ?? '',
    sku: item.sku || '',
    quantity,
    receivedQuantity: item.receivedQuantity ?? item.received_quantity != null
      ? Number(item.receivedQuantity ?? item.received_quantity)
      : undefined,
    unitCost,
    freightAllocation: item.freightAllocation ?? item.freight_allocation != null
      ? Number(item.freightAllocation ?? item.freight_allocation)
      : undefined,
    effectiveCost: item.effectiveCost ?? item.effective_cost != null
      ? Number(item.effectiveCost ?? item.effective_cost)
      : undefined,
    taxRate,
    subtotal,
  };
}

function normalizePurchaseOrderStatus(raw: unknown): PurchaseOrder['status'] {
  const s = String(raw || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
  const allowed = new Set([
    'draft', 'pending', 'awaiting_approval', 'approved', 'received', 'partial', 'cancelled',
  ]);
  return (allowed.has(s) ? s : 'pending') as PurchaseOrder['status'];
}

function mapPurchaseOrder(order: any): PurchaseOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? order.order_number ?? '',
    supplierId: order.supplierId ?? order.supplier_id ?? '',
    supplierName: order.supplierName ?? order.supplier_name ?? '',
    branchId: order.branchId ?? order.branch_id ?? '',
    branchName: order.branchName ?? order.branch_name ?? '',
    items: Array.isArray(order.items) ? order.items.map(mapPurchaseOrderItem) : [],
    subtotal: Number(order.subtotal ?? 0),
    taxAmount: Number(order.taxAmount ?? order.tax_amount ?? 0),
    total: Number(order.total ?? 0),
    freightCost: order.freightCost ?? order.freight_cost != null ? Number(order.freightCost ?? order.freight_cost) : undefined,
    freightDistributed: order.freightDistributed ?? order.freight_distributed ?? false,
    otherCosts: order.otherCosts ?? order.other_costs != null ? Number(order.otherCosts ?? order.other_costs) : undefined,
    otherCostsDescription: order.otherCostsDescription ?? order.other_costs_description,
    status: normalizePurchaseOrderStatus(order.status),
    notes: order.notes || '',
    createdBy: order.createdBy ?? order.created_by ?? '',
    createdAt: order.createdAt ?? order.created_at ?? '',
    approvedBy: order.approvedBy ?? order.approved_by,
    approvedAt: order.approvedAt ?? order.approved_at,
    receivedBy: order.receivedBy ?? order.received_by,
    receivedAt: order.receivedAt ?? order.received_at,
    expectedDeliveryDate: order.expectedDeliveryDate ?? order.expected_delivery_date,
  };
}

export function usePurchaseOrders(branchId?: string) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<PurchaseOrder[]>(
    () => getCachedList<PurchaseOrder[]>(`purchaseOrders:${branchId ?? 'all'}`) ?? [],
  );

  const refreshOrders = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.purchaseOrders.list(branchId),
      () => storage.getPurchaseOrders(branchId)
    );
    const mapped = Array.isArray(data) ? data.map(mapPurchaseOrder) : [];
    setOrders(mapped);
    setCachedList(`purchaseOrders:${branchId ?? 'all'}`, mapped);
  }, [branchId]);

  useEffect(() => { refreshOrders(); }, [refreshOrders]);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (table === 'purchase_orders') void refreshOrders();
    };
    window.addEventListener(TABLE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TABLE_REFRESH_EVENT, onRefresh);
  }, [refreshOrders]);

  const createOrder = useCallback(async (
    supplierId: string, branchId: string, items: PurchaseOrderItem[],
    createdBy: string, notes?: string, expectedDeliveryDate?: string,
    freightCost?: number, otherCosts?: number, otherCostsDescription?: string
  ): Promise<PurchaseOrder> => {
    const result = await api.purchaseOrders.create({
      supplierId, branchId, items, createdBy, notes, expectedDeliveryDate,
      freightCost, otherCosts, otherCostsDescription,
    });
    if (!result.data) {
      throw new Error(result.error || t.erpUi.createPurchaseOrderFailed);
    }
    await refreshOrders();
    return mapPurchaseOrder(result.data);
  }, [refreshOrders]);

  const approveOrder = useCallback(async (orderId: string, userId: string) => {
    const result = await api.purchaseOrders.approve(orderId, userId);
    if (!result.data) {
      throw new Error(result.error || t.erpUi.approvePurchaseOrderFailed);
    }
    await refreshOrders();
  }, [refreshOrders]);

  const receiveOrder = useCallback(async (orderId: string, userId: string, receivedQuantities: Record<string, number>) => {
    const result = await api.purchaseOrders.receive(orderId, userId, receivedQuantities);
    if (!result.data) throw new Error(result.error || t.erpUi.receivePurchaseOrderFailed);
    await refreshOrders();
    window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, { detail: { branchId } }));
  }, [branchId, refreshOrders]);

  const cancelOrder = useCallback(async (orderId: string) => {
    const allOrders = await storage.getPurchaseOrders();
    const order = allOrders.find(o => o.id === orderId);
    if (order) {
      order.status = 'cancelled';
      await storage.savePurchaseOrder(order);
      await refreshOrders();
    }
  }, [refreshOrders]);

  return { orders, createOrder, approveOrder, receiveOrder, cancelOrder, refreshOrders };
}

// ============================================
// CATEGORIES
// ============================================
function mapCategory(c: any): Category {
  return {
    id: c.id,
    name: String(c.name || '').replace(/\s+/g, ' ').trim(),
    parentId: c.parentId ?? c.parent_id ?? null,
    description: c.description || '',
    color: c.color || '#6b7280',
    isActive: c.isActive ?? c.is_active ?? true,
    createdAt: c.createdAt ?? c.created_at ?? '',
    updatedAt: c.updatedAt ?? c.updated_at ?? '',
  };
}

function dedupeCategoriesByName(categories: Category[]): Category[] {
  const uniqueByName = new Map<string, Category>();

  for (const category of categories) {
    if (!category.name) continue;
    const key = category.name.toLowerCase();
    const existing = uniqueByName.get(key);

    if (!existing) {
      uniqueByName.set(key, category);
      continue;
    }

    const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
    const currentTime = new Date(category.updatedAt || category.createdAt || 0).getTime();

    if ((!existing.isActive && category.isActive) || currentTime > existingTime) {
      uniqueByName.set(key, category);
    }
  }

  return Array.from(uniqueByName.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-AO'));
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>(() => getCachedList<Category[]>('categories') ?? []);

  const refreshCategories = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.categories.list(),
      () => storage.getCategories()
    );
    const mapped = Array.isArray(data) ? dedupeCategoriesByName(data.map(mapCategory)) : [];
    setCategories(mapped);
    setCachedList('categories', mapped);
  }, []);

  useEffect(() => { refreshCategories(); }, [refreshCategories]);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const table = (event as CustomEvent<{ table?: string }>).detail?.table;
      if (table === 'categories') void refreshCategories();
    };
    window.addEventListener(TABLE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TABLE_REFRESH_EVENT, onRefresh);
  }, [refreshCategories]);

  const saveCategory = useCallback(async (category: Category) => {
    const result = await api.categories.update(category.id, category);
    if (!result.data) await storage.saveCategory(category);
    await refreshCategories();
  }, [refreshCategories]);

  const deleteCategory = useCallback(async (categoryId: string) => {
    const result = await api.categories.delete(categoryId);
    if (!result.data) await storage.deleteCategory(categoryId);
    await refreshCategories();
  }, [refreshCategories]);

  const createCategory = useCallback(async (data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>): Promise<Category> => {
    const result = await api.categories.create(data);
    if (result.data) {
      await refreshCategories();
      return result.data;
    }
    const category: Category = {
      ...data,
      id: `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveCategory(category);
    await refreshCategories();
    return category;
  }, [refreshCategories]);

  return { categories, saveCategory, deleteCategory, createCategory, refreshCategories };
}

// ============================================
// DATA SYNC (Offline USB scenarios)
// ============================================
export function useDataSync() {
  const exportData = useCallback(async (branchId: string, dateFrom: string, dateTo: string) => {
    const [products, suppliers, clients, sales, stockMovements, stockTransfers, dailyReports, branches] = await Promise.all([
      storage.getProducts(branchId),
      storage.getSuppliers(),
      storage.getClients(),
      storage.getSales(branchId),
      storage.getStockMovements(branchId),
      storage.getStockTransfers(branchId),
      storage.getDailyReports(branchId),
      storage.getBranches(),
    ]);

    const branch = branches.find(b => b.id === branchId);
    const isInRange = (dateStr: string) => {
      const d = dateStr.split('T')[0];
      return d >= dateFrom && d <= dateTo;
    };

    return {
      id: `sync_${branch?.code || branchId}_${Date.now()}`,
      branchId, branchCode: branch?.code || '', branchName: branch?.name || '',
      exportDate: new Date().toISOString(),
      dateRange: { from: dateFrom, to: dateTo },
      products, suppliers, clients,
      purchases: [] as PurchaseOrder[],
      sales: sales.filter(s => isInRange(s.createdAt)),
      stockMovements: stockMovements.filter(m => isInRange(m.createdAt)),
      stockTransfers: stockTransfers.filter(t => isInRange(t.requestedAt)),
      dailyReports: dailyReports.filter(r => r.date >= dateFrom && r.date <= dateTo),
      version: '2.0.0',
      totalRecords: 0,
    };
  }, []);

  const downloadSyncPackage = useCallback((syncPackage: any) => {
    const dataStr = JSON.stringify(syncPackage, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kwanza_sync_${syncPackage.branchCode}_${syncPackage.dateRange.from}_${syncPackage.dateRange.to}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  return { exportData, downloadSyncPackage };
}

// ============================================
// IMPORT ORDERS
// ============================================

export interface ImportOrderItem {
  id: string;
  productId?: string;
  description: string;
  hsCode?: string;
  quantity: number;
  unit: string;
  unitPriceForeign: number;
  unitPriceAOA: number;
  totalForeign: number;
  totalAOA: number;
  landedCostPerUnit: number;
  receivedQuantity?: number;
}

export interface ImportOrder {
  id: string;
  orderNumber: string;
  supplierId?: string;
  supplierName: string;
  supplierCountry: string;
  transportMode: 'sea' | 'air' | 'land';
  incoterm: 'FOB' | 'CIF' | 'EXW' | 'DDP' | 'CFR';
  portOfOrigin: string;
  portOfDestination: string;
  currency: 'USD' | 'EUR' | 'CNY';
  exchangeRate: number;
  fobValue: number;
  fobValueAOA: number;
  freightCost: number;
  insuranceCost: number;
  cifValue: number;
  customsDeclarationNumber?: string;
  customsDutyRate: number;
  customsDutyAmount: number;
  otherTaxes: number;
  totalCustoms: number;
  portCharges: number;
  transportLocal: number;
  otherCosts: number;
  totalLandedCost: number;
  costPerUnit: number;
  totalQuantity: number;
  items: ImportOrderItem[];
  status: 'draft' | 'ordered' | 'shipped' | 'in_customs' | 'cleared' | 'received' | 'cancelled';
  orderDate?: string;
  shippingDate?: string;
  arrivalDate?: string;
  customsClearanceDate?: string;
  receivedDate?: string;
  branchId?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
}

function mapImportOrder(row: any): ImportOrder {
  return {
    id: String(row.id),
    orderNumber: row.orderNumber || row.order_number,
    supplierId: row.supplierId || row.supplier_id,
    supplierName: row.supplierName || row.supplier_name || '',
    supplierCountry: row.supplierCountry || row.supplier_country || '',
    transportMode: row.transportMode || row.transport_mode || 'sea',
    incoterm: row.incoterm || 'FOB',
    portOfOrigin: row.portOfOrigin || row.port_of_origin || '',
    portOfDestination: row.portOfDestination || row.port_of_destination || '',
    currency: row.currency || 'USD',
    exchangeRate: Number(row.exchangeRate ?? row.exchange_rate ?? 1),
    fobValue: Number(row.fobValue ?? row.fob_value ?? 0),
    fobValueAOA: Number(row.fobValueAOA ?? row.fob_value_aoa ?? 0),
    freightCost: Number(row.freightCost ?? row.freight_cost ?? 0),
    insuranceCost: Number(row.insuranceCost ?? row.insurance_cost ?? 0),
    cifValue: Number(row.cifValue ?? row.cif_value ?? 0),
    customsDeclarationNumber: row.customsDeclarationNumber || row.customs_declaration_number,
    customsDutyRate: Number(row.customsDutyRate ?? row.customs_duty_rate ?? 0),
    customsDutyAmount: Number(row.customsDutyAmount ?? row.customs_duty_amount ?? 0),
    otherTaxes: Number(row.otherTaxes ?? row.other_taxes ?? 0),
    totalCustoms: Number(row.totalCustoms ?? row.total_customs ?? 0),
    portCharges: Number(row.portCharges ?? row.port_charges ?? 0),
    transportLocal: Number(row.transportLocal ?? row.transport_local ?? 0),
    otherCosts: Number(row.otherCosts ?? row.other_costs ?? 0),
    totalLandedCost: Number(row.totalLandedCost ?? row.total_landed_cost ?? 0),
    costPerUnit: Number(row.costPerUnit ?? row.cost_per_unit ?? 0),
    totalQuantity: Number(row.totalQuantity ?? row.total_quantity ?? 0),
    items: Array.isArray(row.items) ? row.items.map((it: any) => ({
      id: String(it.id),
      productId: it.productId || it.product_id,
      description: it.description || '',
      hsCode: it.hsCode || it.hs_code,
      quantity: Number(it.quantity || 0),
      unit: it.unit || 'un',
      unitPriceForeign: Number(it.unitPriceForeign ?? it.unit_price_foreign ?? 0),
      unitPriceAOA: Number(it.unitPriceAOA ?? it.unit_price_aoa ?? 0),
      totalForeign: Number(it.totalForeign ?? it.total_foreign ?? 0),
      totalAOA: Number(it.totalAOA ?? it.total_aoa ?? 0),
      landedCostPerUnit: Number(it.landedCostPerUnit ?? it.landed_cost_per_unit ?? 0),
      receivedQuantity: Number(it.receivedQuantity ?? it.received_quantity ?? 0),
    })) : [],
    status: row.status || 'draft',
    orderDate: row.orderDate || row.order_date,
    shippingDate: row.shippingDate || row.shipping_date,
    arrivalDate: row.arrivalDate || row.arrival_date,
    customsClearanceDate: row.customsClearanceDate || row.customs_clearance_date,
    receivedDate: row.receivedDate || row.received_date,
    branchId: row.branchId || row.branch_id,
    notes: row.notes,
    createdBy: row.createdBy || row.created_by,
    createdAt: row.createdAt || row.created_at,
  };
}

export function useImportOrders(branchId?: string) {
  const { t } = useTranslation();
  const cachedOrders = getCachedList<ImportOrder[]>(`importOrders:${branchId ?? 'all'}`);
  const [orders, setOrders] = useState<ImportOrder[]>(() => cachedOrders ?? []);
  const [loading, setLoading] = useState(() => !(cachedOrders && cachedOrders.length));

  const refreshOrders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.importOrders.list(branchId);
      if (Array.isArray(result.data)) {
        const mapped = result.data.map(mapImportOrder);
        setOrders(mapped);
        setCachedList(`importOrders:${branchId ?? 'all'}`, mapped);
      }
    } catch (error) {
      console.error('[IMPORT ORDERS] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { void refreshOrders(); }, [refreshOrders]);

  const createOrder = useCallback(async (payload: Record<string, unknown>) => {
    const result = await api.importOrders.create(payload);
    if (!result.data) throw new Error(result.error || t.importsUi.importCreated);
    await refreshOrders();
    return mapImportOrder(result.data);
  }, [refreshOrders, t.importsUi.importCreated]);

  const updateStatus = useCallback(async (id: string, status: ImportOrder['status']) => {
    const result = await api.importOrders.updateStatus(id, status);
    if (!result.data) throw new Error(result.error || t.importsUi.statusUpdated);
    await refreshOrders();
    return mapImportOrder(result.data);
  }, [refreshOrders, t.importsUi.statusUpdated]);

  const receiveOrder = useCallback(async (id: string, receivedBy: string, warehouseBranchId?: string) => {
    const result = await api.importOrders.receive(id, {
      receivedBy,
      branchId: warehouseBranchId,
    });
    if (!result.data) throw new Error(result.error || t.importsUi.statusReceived);
    await refreshOrders();
    if ((result.data as { stockMovementIds?: string[] }).stockMovementIds?.length) {
      window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, {
        detail: { branchId: warehouseBranchId || 'all' },
      }));
    }
    return mapImportOrder(result.data);
  }, [refreshOrders, t.importsUi.statusReceived]);

  return {
    orders,
    loading,
    refreshOrders,
    createOrder,
    updateStatus,
    receiveOrder,
  };
}
