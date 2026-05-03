/**
 * NEXOR ERP - Core Business Logic Hooks
 * 
 * API-First architecture: All hooks try the backend API first,
 * falling back to localStorage for web preview / demo mode.
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Branch, Product, Sale, User, CartItem, SaleItem, DailySummary, Client, StockTransfer, Supplier, PurchaseOrder, PurchaseOrderItem, Category } from '@/types/erp';
import { api, setAuthToken } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import * as storage from '@/lib/storage';
import { ensureSupplierAccount } from '@/lib/chartOfAccountsEngine';

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);

  const refreshBranches = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.branches.list(),
      () => storage.getBranches()
    );
    // Map API response to Branch type
    const mapped = data.map((b: any) => ({
      id: b.id,
      name: b.name,
      code: b.code || b.branch_code || '',
      address: b.address || '',
      phone: b.phone || '',
      isMain: b.isMain ?? b.is_main ?? false,
      isActive: b.isActive ?? b.is_active ?? true,
      priceLevel: b.priceLevel ?? b.price_level ?? 1,
      createdAt: b.createdAt || b.created_at || '',
    })) as Branch[];
    setBranches(mapped);
    return mapped;
  }, []);

  useEffect(() => {
    refreshBranches().then(data => {
      const current = storage.getCurrentBranch();
      if (current) {
        setCurrentBranchState(current);
      } else {
        const mainBranch = data.find((b: Branch) => b.isMain);
        if (mainBranch) {
          storage.setCurrentBranch(mainBranch);
          setCurrentBranchState(mainBranch);
        }
      }
    });
  }, [refreshBranches]);

  const setCurrentBranch = useCallback((branch: Branch) => {
    storage.setCurrentBranch(branch);
    setCurrentBranchState(branch);
  }, []);

  return { branches, currentBranch, setCurrentBranch, refreshBranches };
}

// ============================================
// PRODUCTS
// ============================================
// Map API snake_case to frontend camelCase for products
function mapProduct(p: any): Product {
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
    taxRate: Number(p.taxRate ?? p.tax_rate) || 14,
    branchId: p.branchId ?? p.branch_id ?? '',
    supplierId: p.supplierId ?? p.supplier_id,
    supplierName: p.supplierName ?? p.supplier_name,
    isActive: p.isActive ?? p.is_active ?? true,
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

function mapStockTransferItem(item: any) {
  return {
    id: item.id,
    productId: item.productId ?? item.product_id ?? '',
    productName: item.productName ?? item.product_name ?? '',
    sku: item.sku || '',
    quantity: Number(item.quantity || 0),
    receivedQuantity: item.receivedQuantity ?? item.received_quantity != null
      ? Number(item.receivedQuantity ?? item.received_quantity)
      : undefined,
  };
}

function mapStockTransfer(transfer: any): StockTransfer {
  return {
    id: transfer.id,
    transferNumber: transfer.transferNumber ?? transfer.transfer_number ?? '',
    fromBranchId: transfer.fromBranchId ?? transfer.from_branch_id ?? '',
    fromBranchName: transfer.fromBranchName ?? transfer.from_branch_name ?? '',
    toBranchId: transfer.toBranchId ?? transfer.to_branch_id ?? '',
    toBranchName: transfer.toBranchName ?? transfer.to_branch_name ?? '',
    items: Array.isArray(transfer.items) ? transfer.items.map(mapStockTransferItem) : [],
    status: transfer.status || 'pending',
    requestedBy: transfer.requestedBy ?? transfer.requested_by ?? '',
    requestedAt: transfer.requestedAt ?? transfer.requested_at ?? transfer.created_at ?? '',
    approvedBy: transfer.approvedBy ?? transfer.approved_by,
    approvedAt: transfer.approvedAt ?? transfer.approved_at,
    receivedBy: transfer.receivedBy ?? transfer.received_by,
    receivedAt: transfer.receivedAt ?? transfer.received_at,
    notes: transfer.notes || '',
  };
}

export function useProducts(branchId?: string) {
  const [products, setProducts] = useState<Product[]>([]);

  const refreshProducts = useCallback(async () => {
    const response = await api.products.list(branchId);
    if (response.error) {
      throw new Error(response.error);
    }
    setProducts(Array.isArray(response.data) ? response.data.map(mapProduct) : []);
  }, [branchId]);

  useEffect(() => { refreshProducts(); }, [refreshProducts]);

  useEffect(() => {
    const handleProductsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ branchId?: string }>;
      const changedBranchId = customEvent.detail?.branchId;
      if (!branchId || !changedBranchId || changedBranchId === branchId) {
        refreshProducts();
      }
    };
    window.addEventListener(storage.PRODUCTS_CHANGED_EVENT, handleProductsChanged as EventListener);
    return () => window.removeEventListener(storage.PRODUCTS_CHANGED_EVENT, handleProductsChanged as EventListener);
  }, [branchId, refreshProducts]);

  const addProduct = useCallback(async (product: Product): Promise<Product> => {
    const result = await api.products.create(product);
    if (result.data) {
      const savedProduct = mapProduct(result.data);
      await refreshProducts();
      return savedProduct;
    }

    await storage.saveProduct(product);
    await refreshProducts();
    return product;
  }, [refreshProducts]);

  const updateProduct = useCallback(async (product: Product) => {
    const result = await api.products.update(product.id, product);
    if (!result.data) await storage.saveProduct(product);
    await refreshProducts();
  }, [refreshProducts]);

  const deleteProduct = useCallback(async (productId: string) => {
    const result = await api.products.delete(productId);
    if (!result.data) await storage.deleteProduct(productId);
    await refreshProducts();
  }, [refreshProducts]);

  return { products, refreshProducts, addProduct, updateProduct, deleteProduct };
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

  const removeItem = useCallback((productId: string) => {
    setItems(prev => prev.filter(item => item.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const taxAmount = items.reduce((sum, item) => sum + item.subtotal * (item.product.taxRate / 100), 0);
  const total = subtotal + taxAmount;

  return { items, addItem, updateQuantity, setItemDiscount, removeItem, clearCart, subtotal, taxAmount, total };
}

// ============================================
// SALES
// ============================================
export function useSales(branchId?: string) {
  const [sales, setSales] = useState<Sale[]>([]);

  const refreshSales = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.sales.list(branchId),
      () => storage.getSales(branchId)
    );
    setSales(data.map((s: any) => ({
      id: s.id,
      invoiceNumber: s.invoiceNumber || s.invoice_number || '',
      branchId: s.branchId || s.branch_id || '',
      cashierId: s.cashierId || s.cashier_id || '',
      cashierName: s.cashierName || s.cashier_name || '',
      items: (s.items || []).map((i: any) => ({
        productId: i.productId || i.product_id,
        productName: i.productName || i.product_name,
        sku: i.sku || '',
        quantity: i.quantity,
        unitPrice: i.unitPrice || i.unit_price,
        discount: i.discount || 0,
        taxRate: i.taxRate || i.tax_rate || 0,
        taxAmount: i.taxAmount || i.tax_amount || 0,
        subtotal: i.subtotal || i.total || 0,
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
      saftHash: s.saftHash || s.agt_hash || '',
      createdAt: s.createdAt || s.created_at || '',
    })));
  }, [branchId]);

  useEffect(() => { refreshSales(); }, [refreshSales]);

  const completeSale = useCallback(async (
    cartItems: CartItem[],
    branchCode: string,
    branchId: string,
    cashierId: string,
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
  ): Promise<Sale> => {
    const saleItems: SaleItem[] = cartItems.map(item => ({
      productId: item.product.id,
      productName: item.product.name,
      sku: item.product.sku,
      quantity: item.quantity,
      unitPrice: item.product.price,
      discount: item.discount,
      taxRate: item.product.taxRate,
      taxAmount: item.subtotal * (item.product.taxRate / 100),
      subtotal: item.subtotal,
    }));

    const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = saleItems.reduce((sum, item) => sum + item.taxAmount, 0);
    const total = subtotal + taxAmount;

    const cashierName = (() => {
      try {
        const u = JSON.parse(sessionStorage.getItem('kwanzaerp_current_user') || localStorage.getItem('kwanzaerp_current_user') || '{}');
        return u?.name || '';
      } catch { return ''; }
    })();

    const invoicePreview = await api.sales.generateInvoiceNumber(branchCode);
    const apiResult = await api.sales.create({
      invoiceNumber: invoicePreview.data?.invoiceNumber,
      branchId,
      cashierId,
      cashierName,
      items: saleItems,
      subtotal,
      taxAmount,
      discount: 0,
      total,
      paymentMethod,
      amountPaid,
      change: amountPaid - total,
      customerNif,
      customerName,
    });

    if (!apiResult.data) {
      console.error('[POS] API business error:', apiResult.error);
      throw new Error(apiResult.error || 'Falha ao processar venda no servidor');
    }

    const sale: Sale = {
      id: apiResult.data.id,
      invoiceNumber: apiResult.data.invoice_number || apiResult.data.invoiceNumber || invoicePreview.data?.invoiceNumber || '',
      branchId,
      cashierId,
      cashierName,
      items: saleItems,
      subtotal,
      taxAmount,
      discount: 0,
      total,
      paymentMethod,
      amountPaid,
      change: amountPaid - total,
      customerNif,
      customerName,
      status: 'completed',
      createdAt: apiResult.data.created_at || new Date().toISOString(),
    };

    console.log(`[POS] Sale ${sale.invoiceNumber} processed via backend API ✓`);

    await refreshSales();
    return sale;
  }, [refreshSales]);

  return { sales, completeSale, refreshSales };
}

// ============================================
// AUTH
// ============================================
const SESSION_TOKEN_KEY = 'kwanzaerp_window_session';

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

async function initAuthStateOnce() {
  if (authInitialized) return;
  authInitialized = true;

  const currentUser = storage.getCurrentUser();
  if (currentUser && currentUser.id && currentUser.email) {
    // Try to verify with API
    try {
      const meResult = await api.auth.me();
      if (meResult.data) {
        setAuthState({ user: currentUser, isLoading: false });
        return;
      }
    } catch {
      // API not available, check locally
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

export function useAuth() {
  const snapshot = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);

  useEffect(() => { initAuthStateOnce(); }, []);

  const login = useCallback(async (identifier: string, password: string): Promise<boolean> => {
    const normalized = identifier.trim();
    const maybeEmail = normalized.includes('@') ? normalized : `${normalized}@kwanzaerp.ao`;
    const normalizedLower = normalized.toLowerCase();
    const normalizedUsername = normalizedLower.includes('@')
      ? normalizedLower.split('@')[0]
      : normalizedLower;

    // Try backend API first
    try {
      const response = await api.auth.login(maybeEmail, password || 'demo');
      if (response.data) {
        setAuthToken(response.data.token);
        const apiUser = response.data.user;
        const user: User = {
          id: apiUser.id,
          email: apiUser.email,
          name: apiUser.name,
          username: normalizedUsername,
          role: apiUser.role || 'cashier',
          branchId: apiUser.branchId || apiUser.branch_id || '',
          isActive: true,
          createdAt: apiUser.createdAt || apiUser.created_at || new Date().toISOString(),
        };
        storage.setCurrentUser(user);
        setAuthState({ user });
        console.log('[Auth] Logged in via backend API');
        return true;
      }
    } catch (e) {
      console.log('[Auth] Backend API not available, falling back to local auth');
    }

    // Electron mode fallback
    if (storage.isElectronMode()) {
      let dbReachable = true;
      try {
        const tryQuery = async (sql: string, params: unknown[]) => {
          try {
            const result = await window.electronAPI!.db.query(sql, params);
            if (result?.success === false) throw new Error(result.error || 'Query failed');
            return Array.isArray(result?.data) ? result.data : [];
          } catch {
            dbReachable = false;
            return [];
          }
        };

        const userColumns = await tryQuery("SELECT name FROM pragma_table_info('users')", []);
        const availableColumns = new Set(
          userColumns.map((column: { name?: string }) => String(column.name || '').toLowerCase()).filter(Boolean)
        );

        const identifierClauses: string[] = [];
        const identifierParams: unknown[] = [];

        if (availableColumns.has('username')) { identifierClauses.push('LOWER(username) = LOWER(?)'); identifierParams.push(normalized); }
        if (availableColumns.has('email')) { identifierClauses.push('LOWER(email) = LOWER(?)'); identifierParams.push(maybeEmail); }
        if (availableColumns.has('id')) { identifierClauses.push('id = ?'); identifierParams.push(normalized); }

        if (identifierClauses.length > 0) {
          const activeClause = availableColumns.has('is_active')
            ? '(is_active = 1 OR is_active = true OR is_active = "1" OR is_active = "true" OR is_active IS NULL)'
            : '1 = 1';

          const matchedUsers = await tryQuery(
            `SELECT * FROM users WHERE ${activeClause} AND (${identifierClauses.join(' OR ')}) LIMIT 1`,
            identifierParams
          );

          if (matchedUsers.length > 0) {
            const dbUser = matchedUsers[0];
            const username = String(dbUser.username || dbUser.email?.split('@')?.[0] || dbUser.id || normalizedUsername).toLowerCase();
            const role = ['admin', 'manager', 'cashier', 'viewer'].includes(String(dbUser.role)) ? dbUser.role : 'cashier';
            const isDemoAccount = username === 'admin' || username === 'caixa1';
            const storedPassword = dbUser.password ?? dbUser.password_hash;
            const validPassword = isDemoAccount || password === '' || !storedPassword || storedPassword === password;

            if (validPassword) {
              const user: User = {
                id: dbUser.id,
                email: dbUser.email || `${dbUser.username || normalized}@kwanzaerp.ao`,
                name: dbUser.name || dbUser.username || normalized,
                username: dbUser.username || normalizedUsername,
                role,
                branchId: dbUser.branch_id || '',
                isActive: true,
                createdAt: dbUser.created_at || '',
              };
              storage.setCurrentUser(user);
              setAuthState({ user });
              return true;
            }
          }
        }
      } catch (e) {
        console.error('[Auth] DB login error:', e);
      }

      if (normalizedUsername === 'admin' || normalizedUsername === 'caixa1') {
        const branches = await storage.getBranches();
        const mainBranchId = branches.find(b => b.isMain)?.id || branches[0]?.id || 'branch-main';
        const user: User = {
          id: normalizedUsername === 'admin' ? 'user-admin' : 'user-caixa1',
          email: `${normalizedUsername}@kwanzaerp.ao`,
          name: normalizedUsername === 'admin' ? 'Administrador' : 'Caixa 1',
          username: normalizedUsername,
          role: normalizedUsername === 'admin' ? 'admin' : 'cashier',
          branchId: mainBranchId,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
        storage.setCurrentUser(user);
        setAuthState({ user });
        return true;
      }

      if (!dbReachable) {
        console.error('[Auth] Database not reachable in Electron mode');
      }
      return false;
    }

    // Demo mode fallback
    if (isDemoMode()) {
      const users = await storage.getUsers();
      const foundUser = users.find(u =>
        u.isActive && (u.username === normalized || u.email === normalized || u.email === maybeEmail)
      );

      if (foundUser) {
        storage.setCurrentUser(foundUser);
        setAuthState({ user: foundUser });
        return true;
      }
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    storage.setCurrentUser(null);
    setAuthToken(null);
    setAuthState({ user: null });
  }, []);

  return { user: snapshot.user, isLoading: snapshot.isLoading, login, logout };
}

// ============================================
// DAILY REPORTS
// ============================================
export function useDailyReports(branchId?: string) {
  const [reports, setReports] = useState<DailySummary[]>([]);

  const refreshReports = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.dailyReports.list(branchId),
      () => storage.getDailyReports(branchId)
    );
    setReports(data);
  }, [branchId]);

  useEffect(() => { refreshReports(); }, [refreshReports]);

  const generateReport = useCallback(async (branchId: string, date: string): Promise<DailySummary> => {
    const apiResult = await api.dailyReports.generate(branchId, date);
    if (apiResult.data) {
      await refreshReports();
      return apiResult.data;
    }
    const report = await storage.generateDailyReport(branchId, date);
    await storage.saveDailyReport(report);
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
export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);

  const refreshClients = useCallback(async () => {
    const response = await api.clients.list();
    if (response.error) {
      throw new Error(response.error);
    }
    const mapped = (response.data || []).map((c: any) => ({
      id: c.id,
      name: c.name || '',
      nif: c.nif || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      city: c.city || '',
      country: c.country || 'Angola',
      creditLimit: Number(c.creditLimit ?? c.credit_limit ?? 0),
      currentBalance: Number(c.currentBalance ?? c.current_balance ?? 0),
      isActive: c.isActive ?? c.is_active ?? true,
      createdAt: c.createdAt ?? c.created_at ?? new Date().toISOString(),
      updatedAt: c.updatedAt ?? c.updated_at ?? new Date().toISOString(),
    }));
    setClients(mapped);
  }, []);

  useEffect(() => { refreshClients(); }, [refreshClients]);

  const saveClient = useCallback(async (client: Client) => {
    const result = await api.clients.update(client.id, client);
    if (!result.data) await storage.saveClient(client);
    await refreshClients();
  }, [refreshClients]);

  const deleteClient = useCallback(async (clientId: string) => {
    const result = await api.clients.delete(clientId);
    if (!result.data) await storage.deleteClient(clientId);
    await refreshClients();
  }, [refreshClients]);

  const createClient = useCallback(async (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client> => {
    const result = await api.clients.create(data);
    if (result.data) {
      await refreshClients();
      return result.data;
    }
    const client: Client = {
      ...data,
      id: `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveClient(client);
    await refreshClients();
    return client;
  }, [refreshClients]);

  return { clients, saveClient, deleteClient, createClient, refreshClients };
}

// ============================================
// STOCK TRANSFERS
// ============================================
export function useStockTransfers(branchId?: string) {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);

  const refreshTransfers = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.stockTransfers.list(branchId),
      () => storage.getStockTransfers(branchId)
    );
    setTransfers(Array.isArray(data) ? data.map(mapStockTransfer) : []);
  }, [branchId]);

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
      throw new Error(result.error || 'Falha ao criar transferência');
    }
    await refreshTransfers();
    return mapStockTransfer(result.data);
  }, [refreshTransfers]);

  const approveTransfer = useCallback(async (transferId: string, userId: string) => {
    const result = await api.stockTransfers.approve(transferId, userId);
    if (!result.data) throw new Error(result.error || 'Falha ao aprovar transferência');
    await refreshTransfers();
    // Notify product listeners to refresh (source branch stock changed)
    window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, { detail: {} }));
  }, [refreshTransfers]);

  const receiveTransfer = useCallback(async (transferId: string, userId: string, receivedQuantities?: Record<string, number>) => {
    const result = await api.stockTransfers.receive(transferId, userId, receivedQuantities);
    if (!result.data) throw new Error(result.error || 'Falha ao receber transferência');
    await refreshTransfers();
    // Notify product listeners to refresh (destination branch now has new/updated products)
    window.dispatchEvent(new CustomEvent(storage.PRODUCTS_CHANGED_EVENT, { detail: {} }));
  }, [refreshTransfers]);

  const cancelTransfer = useCallback(async (transferId: string, _userId: string) => {
    const allTransfers = await storage.getStockTransfers();
    const transfer = allTransfers.find(t => t.id === transferId);
    if (transfer) {
      transfer.status = 'cancelled';
      await storage.saveStockTransfer(transfer);
      await refreshTransfers();
    }
  }, [refreshTransfers]);

  return { transfers, createTransfer, approveTransfer, receiveTransfer, cancelTransfer, refreshTransfers };
}

// ============================================
// SUPPLIERS
// ============================================
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const refreshSuppliers = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.suppliers.list(),
      () => storage.getSuppliers()
    );
    const mapped = Array.isArray(data) ? data.map(mapSupplier) : [];
    console.log(`[ERP] Suppliers loaded: ${mapped.length} total, ${mapped.filter(s => s.isActive).length} active`);
    setSuppliers(mapped);
  }, []);

  useEffect(() => { refreshSuppliers(); }, [refreshSuppliers]);

  const saveSupplier = useCallback(async (supplier: Supplier) => {
    const result = await api.suppliers.update(supplier.id, supplier);
    if (!result.data) await storage.saveSupplier(supplier);
    await refreshSuppliers();
  }, [refreshSuppliers]);

  const deleteSupplier = useCallback(async (supplierId: string) => {
    const result = await api.suppliers.delete(supplierId);
    if (!result.data) await storage.deleteSupplier(supplierId);
    await refreshSuppliers();
  }, [refreshSuppliers]);

  const createSupplier = useCallback(async (data: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> => {
    const result = await api.suppliers.create(data);
    if (result.error && !result.data) {
      throw new Error(result.error);
    }
    if (result.data) {
      await ensureSupplierAccount(result.data.id, data.name, data.nif);
      await refreshSuppliers();
      return result.data;
    }
    // Fallback for offline/demo
    const supplier: Supplier = {
      ...data,
      id: `supplier_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveSupplier(supplier);
    // Also create sub-account locally
    await ensureSupplierAccount(supplier.id, supplier.name, supplier.nif);
    await refreshSuppliers();
    return supplier;
  }, [refreshSuppliers]);

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
    status: order.status || 'pending',
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
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);

  const refreshOrders = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.purchaseOrders.list(branchId),
      () => storage.getPurchaseOrders(branchId)
    );
    setOrders(Array.isArray(data) ? data.map(mapPurchaseOrder) : []);
  }, [branchId]);

  useEffect(() => { refreshOrders(); }, [refreshOrders]);

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
      throw new Error(result.error || 'Falha ao criar encomenda');
    }
    await refreshOrders();
    return mapPurchaseOrder(result.data);
  }, [refreshOrders]);

  const approveOrder = useCallback(async (orderId: string, userId: string) => {
    const result = await api.purchaseOrders.approve(orderId, userId);
    if (!result.data) {
      throw new Error(result.error || 'Falha ao aprovar encomenda');
    }
    await refreshOrders();
  }, [refreshOrders]);

  const receiveOrder = useCallback(async (orderId: string, userId: string, receivedQuantities: Record<string, number>) => {
    const result = await api.purchaseOrders.receive(orderId, userId, receivedQuantities);
    if (!result.data) throw new Error(result.error || 'Falha ao receber encomenda');
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
  const [categories, setCategories] = useState<Category[]>([]);

  const refreshCategories = useCallback(async () => {
    const data = await apiFallback<any[]>(
      () => api.categories.list(),
      () => storage.getCategories()
    );
    setCategories(Array.isArray(data) ? dedupeCategoriesByName(data.map(mapCategory)) : []);
  }, []);

  useEffect(() => { refreshCategories(); }, [refreshCategories]);

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
