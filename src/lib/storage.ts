/**
 * NEXOR ERP - Storage Layer
 * 
 * Dual-mode storage:
 * 1. Electron mode: Uses electronAPI.db (SQLite via IPC → WebSocket)
 * 2. Web preview / Demo: Uses localStorage with default sample data
 * 
 * All functions are async to support both modes transparently.
 */

import { Branch, Product, Sale, User, DailySummary, Client, StockTransfer, Supplier, PurchaseOrder, Category, StockMovement } from '@/types/erp';
import { auditLog } from '@/lib/auditService';
import { isDemoMode } from '@/lib/api/config';
import { normalizeTaxRate } from './taxUtils';

// ============= MODE DETECTION =============
export function isElectronMode(): boolean {
  return !!window.electronAPI?.isElectron && !!window.electronAPI?.db;
}

// ============= ELECTRON DB HELPERS =============
async function dbGetAll<T>(table: string): Promise<T[]> {
  if (!isElectronMode()) return [];
  try {
    const result = await window.electronAPI!.db.getAll(table);
    return (result.data || []) as T[];
  } catch (e) {
    console.error(`[Storage] dbGetAll(${table}) error:`, e);
    return [];
  }
}

async function dbInsert(table: string, data: Record<string, any>): Promise<boolean> {
  if (!isElectronMode()) return false;
  try {
    const result = await window.electronAPI!.db.insert(table, data);
    return result.success;
  } catch (e) {
    console.error(`[Storage] dbInsert(${table}) error:`, e);
    return false;
  }
}

async function dbUpdate(table: string, id: string, data: Record<string, any>): Promise<boolean> {
  if (!isElectronMode()) return false;
  try {
    const result = await window.electronAPI!.db.update(table, id, data);
    return result.success;
  } catch (e) {
    console.error(`[Storage] dbUpdate(${table}) error:`, e);
    return false;
  }
}

async function dbDelete(table: string, id: string): Promise<boolean> {
  if (!isElectronMode()) return false;
  try {
    const result = await window.electronAPI!.db.delete(table, id);
    return result.success;
  } catch (e) {
    console.error(`[Storage] dbDelete(${table}) error:`, e);
    return false;
  }
}

async function dbExec(sql: string, params: any[] = []): Promise<boolean> {
  if (!isElectronMode()) return false;
  try {
    const result = await window.electronAPI!.db.query(sql, params);
    return !(result && typeof result === 'object' && 'success' in result && result.success === false);
  } catch (e) {
    console.error(`[Storage] dbExec error:`, e);
    return false;
  }
}

// ============= LOCAL STORAGE HELPERS =============
const STORAGE_KEYS = {
  branches: 'kwanzaerp_branches',
  products: 'kwanzaerp_products',
  sales: 'kwanzaerp_sales',
  users: 'kwanzaerp_users',
  currentBranch: 'kwanzaerp_current_branch',
  currentUser: 'kwanzaerp_current_user',
  dailyReports: 'kwanzaerp_daily_reports',
  clients: 'kwanzaerp_clients',
  stockTransfers: 'kwanzaerp_stock_transfers',
  suppliers: 'kwanzaerp_suppliers',
  purchaseOrders: 'kwanzaerp_purchase_orders',
  categories: 'kwanzaerp_categories',
  stockMovements: 'kwanzaerp_stock_movements',
  journalEntries: 'kwanzaerp_journal_entries',
};

export const PRODUCTS_CHANGED_EVENT = 'kwanzaerp:products-changed';

function lsGet<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function lsSet<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function getDemoDefault<T>(factory: () => T, emptyValue: T): T {
  return isDemoMode() ? factory() : emptyValue;
}

function emitProductsChanged(branchId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId } }));
}

// ============= BRANCH FUNCTIONS =============
export async function getBranches(): Promise<Branch[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('branches');
    return rows.map(mapBranchFromDb);
  }
  return lsGet<Branch[]>(STORAGE_KEYS.branches, getDemoDefault(getDefaultBranches, []));
}

export async function saveBranch(branch: Branch): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('branches', mapBranchToDb(branch));
    auditLog('create', 'branches', `Filial "${branch.name}" guardada`, 'Sistema');
    return;
  }
  const branches = lsGet<Branch[]>(STORAGE_KEYS.branches, []);
  const index = branches.findIndex(b => b.id === branch.id);
  const isNew = index < 0;
  if (index >= 0) branches[index] = branch;
  else branches.push(branch);
  lsSet(STORAGE_KEYS.branches, branches);
  auditLog(isNew ? 'create' : 'update', 'branches', `Filial "${branch.name}" ${isNew ? 'criada' : 'actualizada'}`, 'Sistema');
}

export async function deleteBranch(branchId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('branches', branchId); }
  else {
    const branches = lsGet<Branch[]>(STORAGE_KEYS.branches, []).filter(b => b.id !== branchId);
    lsSet(STORAGE_KEYS.branches, branches);
  }
  auditLog('delete', 'branches', `Filial ${branchId} eliminada`, 'Sistema');
}

export function getCurrentBranch(): Branch | null {
  return lsGet<Branch | null>(STORAGE_KEYS.currentBranch, null);
}

export function setCurrentBranch(branch: Branch): void {
  lsSet(STORAGE_KEYS.currentBranch, branch);
}

// ============= PRODUCT FUNCTIONS =============
export async function getProducts(branchId?: string): Promise<Product[]> {
  const includeSharedProducts = await shouldIncludeSharedProducts(branchId);

  if (isElectronMode()) {
    const rows = await dbGetAll<any>('products');
    return filterProductsForBranch(rows.map(mapProductFromDb), branchId, includeSharedProducts);
  }
  const products = lsGet<Product[]>(STORAGE_KEYS.products, getDemoDefault(getDefaultProducts, []));
  return filterProductsForBranch(products, branchId, includeSharedProducts);
}

export async function getAllProducts(): Promise<Product[]> {
  return getProducts();
}

export async function saveProduct(
  product: Product,
  opts?: { skipProductsChangedEvent?: boolean }
): Promise<void> {
  if (isElectronMode()) {
    const existing = await window.electronAPI!.db.getById('products', product.id);
    const payload = mapProductToDb(product);
    if (existing?.data) await dbUpdate('products', product.id, payload);
    else await dbInsert('products', payload);
    if (!opts?.skipProductsChangedEvent) {
      emitProductsChanged(product.branchId);
    }
    auditLog(existing?.data ? 'update' : 'create', 'products', `Produto "${product.name}" (${product.sku}) ${existing?.data ? 'actualizado' : 'criado'}`, 'Sistema');
    return;
  }
  const products = lsGet<Product[]>(STORAGE_KEYS.products, []);
  const index = products.findIndex(p => p.id === product.id);
  const isNew = index < 0;
  if (index >= 0) products[index] = product;
  else products.push(product);
  lsSet(STORAGE_KEYS.products, products);
  if (!opts?.skipProductsChangedEvent) {
    emitProductsChanged(product.branchId);
  }
  auditLog(isNew ? 'create' : 'update', 'products', `Produto "${product.name}" (${product.sku}) ${isNew ? 'criado' : 'actualizado'}`, 'Sistema');
}

export async function deleteProduct(productId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('products', productId); }
  else {
    const products = lsGet<Product[]>(STORAGE_KEYS.products, []).filter(p => p.id !== productId);
    lsSet(STORAGE_KEYS.products, products);
  }
  auditLog('delete', 'products', `Produto ${productId} eliminado`, 'Sistema');
}

export async function updateProductStock(productId: string, quantityChange: number, branchId?: string): Promise<void> {
  if (isElectronMode()) {
    const products = (await dbGetAll<any>('products')).map(mapProductFromDb);
    const { targetProduct, createdProduct } = resolveStockProduct(products, productId, quantityChange, branchId);
    if (!targetProduct) return;

    const updatedAt = new Date().toISOString();

    if (createdProduct) {
      await dbInsert('products', mapProductToDb({
        ...createdProduct,
        stock: quantityChange,
        updatedAt,
      }));
      emitProductsChanged(branchId || createdProduct.branchId);
      return;
    }

    const newStock = (targetProduct.stock || 0) + quantityChange;
    await dbUpdate('products', targetProduct.id, {
      stock: newStock,
      updated_at: updatedAt,
    });
    emitProductsChanged(branchId || targetProduct.branchId);
    return;
  }
  const products = lsGet<Product[]>(STORAGE_KEYS.products, []);
  const { targetProduct, createdProduct } = resolveStockProduct(products, productId, quantityChange, branchId);
  if (createdProduct) {
    // New branch clone — set stock directly and push
    createdProduct.stock = quantityChange;
    createdProduct.updatedAt = new Date().toISOString();
    products.push(createdProduct);
    lsSet(STORAGE_KEYS.products, products);
    emitProductsChanged(branchId || createdProduct.branchId);
    return;
  }

  if (targetProduct) {
    const index = products.findIndex(p => p.id === targetProduct.id);
    if (index >= 0) {
      products[index].stock = (products[index].stock || 0) + quantityChange;
      products[index].updatedAt = new Date().toISOString();
      lsSet(STORAGE_KEYS.products, products);
      emitProductsChanged(branchId || products[index].branchId);
    }
  }
}

async function shouldIncludeSharedProducts(branchId?: string): Promise<boolean> {
  if (!branchId) return true;

  const branches = isElectronMode()
    ? (await dbGetAll<any>('branches')).map(mapBranchFromDb)
    : lsGet<Branch[]>(STORAGE_KEYS.branches, getDemoDefault(getDefaultBranches, []));

  return branches.find(branch => branch.id === branchId)?.isMain ?? false;
}

function filterProductsForBranch(products: Product[], branchId?: string, includeSharedProducts: boolean = true): Product[] {
  if (!branchId) return products;

  const branchProducts = products.filter(p => p.branchId === branchId);
  if (!includeSharedProducts) {
    return branchProducts;
  }

  const branchSkus = new Set(branchProducts.map(p => normalizeSku(p.sku)).filter(Boolean));

  const sharedProducts = products.filter(p => {
    const isShared = !p.branchId || p.branchId === 'all';
    return isShared && !branchSkus.has(normalizeSku(p.sku));
  });

  return [...branchProducts, ...sharedProducts];
}

function resolveStockProduct(
  products: Product[],
  productId: string,
  quantityChange: number,
  branchId?: string,
): { targetProduct?: Product; createdProduct?: Product } {
  if (!branchId) {
    return { targetProduct: products.find(p => p.id === productId) };
  }

  const exactBranchProduct = products.find(p => p.id === productId && p.branchId === branchId);
  if (exactBranchProduct) {
    return { targetProduct: exactBranchProduct };
  }

  const sourceProduct = products.find(p => p.id === productId);
  const sourceSku = normalizeSku(sourceProduct?.sku);

  if (sourceSku) {
    const branchProductBySku = products.find(
      p => p.branchId === branchId && normalizeSku(p.sku) === sourceSku,
    );

    if (branchProductBySku) {
      return { targetProduct: branchProductBySku };
    }
  }

  if (quantityChange > 0 && sourceProduct) {
    const createdProduct: Product = {
      ...sourceProduct,
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      branchId,
      stock: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      targetProduct: createdProduct,
      createdProduct,
    };
  }

  return { targetProduct: sourceProduct };
}

function normalizeSku(sku?: string): string {
  return (sku || '').trim().toLowerCase();
}

// ============= SALES FUNCTIONS =============
export async function getSales(branchId?: string): Promise<Sale[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('sales');
    let sales = rows.map(mapSaleFromDb);
    // Also load sale_items for each sale
    const items = await dbGetAll<any>('sale_items');
    sales = sales.map(s => ({
      ...s,
      items: items.filter((i: any) => i.sale_id === s.id).map(mapSaleItemFromDb),
    }));
    if (branchId) sales = sales.filter(s => s.branchId === branchId);
    return sales;
  }
  const sales = lsGet<Sale[]>(STORAGE_KEYS.sales, []);
  return branchId ? sales.filter(s => s.branchId === branchId) : sales;
}

export async function getAllSales(): Promise<Sale[]> {
  return getSales();
}

export async function saveSale(sale: Sale): Promise<void> {
  if (isElectronMode()) {
    await dbExec('DELETE FROM sale_items WHERE sale_id = $1', [sale.id]);

    // Save sale header
    await dbInsert('sales', {
      id: sale.id,
      invoice_number: sale.invoiceNumber,
      invoice_type: 'FT',
      branch_id: sale.branchId,
      client_name: sale.customerName || '',
      client_nif: sale.customerNif || '',
      subtotal: sale.subtotal,
      tax_amount: sale.taxAmount,
      discount: sale.discount || 0,
      total: sale.total,
      amount_paid: sale.amountPaid,
      change_amount: sale.change || 0,
      payment_method: sale.paymentMethod,
      status: sale.status,
      cashier_id: sale.cashierId,
      cashier_name: sale.cashierName || '',
      agt_hash: sale.saftHash || '',
      created_at: sale.createdAt,
    });
    // Save sale items
    for (const item of sale.items) {
      await dbInsert('sale_items', {
        id: `si_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sale_id: sale.id,
        product_id: item.productId,
        product_name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        cost_at_sale: 0,
        discount: item.discount || 0,
        tax_rate: item.taxRate,
        tax_amount: item.taxAmount,
        total: item.subtotal,
      });
    }

    const { processTransaction } = await import('@/lib/transactionEngine');
    const txResult = await processTransaction({
      transactionType: 'sale',
      documentId: sale.id,
      documentNumber: sale.invoiceNumber,
      branchId: sale.branchId,
      branchName: '',
      userId: sale.cashierId,
      userName: sale.cashierName || '',
      date: sale.createdAt,
      currency: 'AOA',
      description: `Venda ${sale.invoiceNumber}`,
      amount: sale.total,
      stockEntries: sale.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productSku: item.sku,
        quantity: item.quantity,
        unitCost: item.unitPrice,
        direction: 'OUT' as const,
        warehouseId: sale.branchId,
      })),
      journalLines: [
        { accountCode: sale.paymentMethod === 'cash' ? '4.1.1' : '4.2.1', debit: sale.total, credit: 0 },
        { accountCode: '7.1.1', debit: 0, credit: sale.subtotal },
        ...(sale.taxAmount > 0 ? [{ accountCode: '3.3.1', debit: 0, credit: sale.taxAmount }] : []),
      ],
      ...(sale.paymentMethod !== 'cash' && sale.customerName ? {
        openItem: {
          entityType: 'customer' as const,
          entityId: sale.customerNif || sale.customerName,
          entityName: sale.customerName,
          documentType: 'invoice' as const,
          originalAmount: sale.total,
          isDebit: true,
        },
        entityBalanceUpdate: {
          entityType: 'customer' as const,
          entityId: sale.customerNif || sale.customerName,
          entityName: sale.customerName,
          amount: sale.total,
        },
      } : {}),
    });

    if (!txResult.success) {
      console.error(`[Storage] Sale ${sale.invoiceNumber} transaction engine failed:`, txResult.errors);
    }

    auditLog('create', 'sales', `Venda ${sale.invoiceNumber} - ${sale.total.toLocaleString()} Kz`, sale.cashierName || 'Sistema');
    return;
  }

  // localStorage mode — use transaction engine for atomic processing
  const sales = lsGet<Sale[]>(STORAGE_KEYS.sales, []);
  sales.push(sale);
  lsSet(STORAGE_KEYS.sales, sales);

  // Import and use transaction engine
  const { processTransaction } = await import('@/lib/transactionEngine');
  await processTransaction({
    transactionType: 'sale',
    documentId: sale.id,
    documentNumber: sale.invoiceNumber,
    branchId: sale.branchId,
    branchName: '',
    userId: sale.cashierId,
    userName: sale.cashierName || '',
    date: sale.createdAt,
    currency: 'AOA',
    description: `Venda ${sale.invoiceNumber}`,
    amount: sale.total,

    // Stock OUT — scoped to sale's branch
    stockEntries: sale.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      productSku: item.sku,
      quantity: item.quantity,
      unitCost: item.unitPrice,
      direction: 'OUT' as const,
      warehouseId: sale.branchId, // BRANCH-SCOPED
    })),

    // Double-entry journal
    journalLines: [
      { accountCode: sale.paymentMethod === 'cash' ? '4.1.1' : '4.2.1', debit: sale.total, credit: 0 },
      { accountCode: '7.1.1', debit: 0, credit: sale.subtotal },
      ...(sale.taxAmount > 0 ? [{ accountCode: '3.3.1', debit: 0, credit: sale.taxAmount }] : []),
    ],

    // Open item for credit sales
    ...(sale.paymentMethod !== 'cash' && sale.customerName ? {
      openItem: {
        entityType: 'customer' as const,
        entityId: sale.customerNif || sale.customerName,
        entityName: sale.customerName,
        documentType: 'invoice' as const,
        originalAmount: sale.total,
        isDebit: true,
      },
    } : {}),
  });

  auditLog('create', 'sales', `Venda ${sale.invoiceNumber} - ${sale.total.toLocaleString()} Kz`, sale.cashierName || 'Sistema');
}

export function generateInvoiceNumber(branchCode: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `FT ${branchCode}/${today}/${seq}`;
}

// ============= USER FUNCTIONS =============
export async function getUsers(): Promise<User[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('users');
    return rows.map(mapUserFromDb);
  }
  return lsGet<User[]>(STORAGE_KEYS.users, getDemoDefault(getDefaultUsers, []));
}

export async function saveUser(user: User): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('users', mapUserToDb(user));
  } else {
    const users = lsGet<User[]>(STORAGE_KEYS.users, []);
    const index = users.findIndex(u => u.id === user.id);
    if (index >= 0) users[index] = { ...user, updatedAt: new Date().toISOString() };
    else users.push(user);
    lsSet(STORAGE_KEYS.users, users);
  }
  auditLog('create', 'users', `Utilizador "${user.name}" guardado`, 'Sistema');
}

export async function deleteUser(userId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('users', userId); }
  else {
    const users = lsGet<User[]>(STORAGE_KEYS.users, []).filter(u => u.id !== userId);
    lsSet(STORAGE_KEYS.users, users);
  }
  auditLog('delete', 'users', `Utilizador ${userId} eliminado`, 'Sistema');
}

export function getCurrentUser(): User | null {
  return lsGet<User | null>(STORAGE_KEYS.currentUser, null);
}

export function setCurrentUser(user: User | null): void {
  lsSet(STORAGE_KEYS.currentUser, user);
}

// ============= CLIENT FUNCTIONS =============
export async function getClients(): Promise<Client[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('clients');
    return rows.map(mapClientFromDb);
  }
  return lsGet<Client[]>(STORAGE_KEYS.clients, []);
}

export async function saveClient(client: Client): Promise<void> {
  if (isElectronMode()) {
    const ok = await dbInsert('clients', mapClientToDb(client));
    if (!ok) throw new Error('[storage] Failed to save client to database');
  } else {
    const clients = lsGet<Client[]>(STORAGE_KEYS.clients, []);
    const index = clients.findIndex(c => c.id === client.id);
    const isNew = index < 0;
    if (index >= 0) clients[index] = { ...client, updatedAt: new Date().toISOString() };
    else clients.push(client);
    lsSet(STORAGE_KEYS.clients, clients);
  }
  auditLog('create', 'clients', `Cliente "${client.name}" guardado`, 'Sistema');
}

export async function deleteClient(clientId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('clients', clientId); }
  else { lsSet(STORAGE_KEYS.clients, lsGet<Client[]>(STORAGE_KEYS.clients, []).filter(c => c.id !== clientId)); }
  auditLog('delete', 'clients', `Cliente ${clientId} eliminado`, 'Sistema');
}

// ============= SUPPLIER FUNCTIONS =============
export async function getSuppliers(): Promise<Supplier[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('suppliers');
    const fromDb = rows.map(mapSupplierFromDb);
    /** When SQLite is served by Express, main-process IPC DB pool is null — suppliers may be cached here until API works. */
    const fromLs = lsGet<Supplier[]>(STORAGE_KEYS.suppliers, []);
    const byId = new Map<string, Supplier>();
    for (const s of fromDb) byId.set(s.id, s);
    for (const s of fromLs) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  return lsGet<Supplier[]>(STORAGE_KEYS.suppliers, []);
}

/** Browser-only cache used when Electron IPC DB is unavailable (SQLite owned by embedded Express). */
export function saveSupplierLocalFallback(supplier: Supplier): void {
  const suppliers = lsGet<Supplier[]>(STORAGE_KEYS.suppliers, []);
  const index = suppliers.findIndex(s => s.id === supplier.id);
  const next = { ...supplier, updatedAt: new Date().toISOString() };
  if (index >= 0) suppliers[index] = next;
  else suppliers.push(next);
  lsSet(STORAGE_KEYS.suppliers, suppliers);
}

export async function saveSupplier(supplier: Supplier): Promise<void> {
  if (isElectronMode()) {
    const existing = await window.electronAPI!.db.getById('suppliers', supplier.id);
    const payload = mapSupplierToDb(supplier);
    if (existing?.data) {
      await dbUpdate('suppliers', supplier.id, payload);
    } else {
      await dbInsert('suppliers', payload);
    }
  } else {
    const suppliers = lsGet<Supplier[]>(STORAGE_KEYS.suppliers, []);
    const index = suppliers.findIndex(s => s.id === supplier.id);
    if (index >= 0) suppliers[index] = supplier;
    else suppliers.push(supplier);
    lsSet(STORAGE_KEYS.suppliers, suppliers);
  }
  auditLog('create', 'suppliers', `Fornecedor "${supplier.name}" guardado`, 'Sistema');
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('suppliers', supplierId); }
  else { lsSet(STORAGE_KEYS.suppliers, lsGet<Supplier[]>(STORAGE_KEYS.suppliers, []).filter(s => s.id !== supplierId)); }
  auditLog('delete', 'suppliers', `Fornecedor ${supplierId} eliminado`, 'Sistema');
}

// ============= CATEGORY FUNCTIONS =============
export async function getCategories(): Promise<Category[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('categories');
    return rows.map(mapCategoryFromDb);
  }
  return lsGet<Category[]>(STORAGE_KEYS.categories, getDemoDefault(getDefaultCategories, []));
}

export async function saveCategory(category: Category): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('categories', {
      id: category.id,
      name: category.name,
      description: category.description || '',
      parent_id: category.parentId || '',
      is_active: category.isActive ? 1 : 0,
    });
  } else {
    const categories = lsGet<Category[]>(STORAGE_KEYS.categories, []);
    const index = categories.findIndex(c => c.id === category.id);
    if (index >= 0) categories[index] = category;
    else categories.push(category);
    lsSet(STORAGE_KEYS.categories, categories);
  }
  auditLog('create', 'categories', `Categoria "${category.name}" guardada`, 'Sistema');
}

export async function deleteCategory(categoryId: string): Promise<void> {
  if (isElectronMode()) { await dbDelete('categories', categoryId); }
  else { lsSet(STORAGE_KEYS.categories, lsGet<Category[]>(STORAGE_KEYS.categories, []).filter(c => c.id !== categoryId)); }
  auditLog('delete', 'categories', `Categoria ${categoryId} eliminada`, 'Sistema');
}

// ============= PURCHASE ORDER FUNCTIONS =============
export async function getPurchaseOrders(branchId?: string): Promise<PurchaseOrder[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('purchase_orders');
    const items = await dbGetAll<any>('purchase_order_items');
    let orders = rows.map(r => ({
      ...mapPurchaseOrderFromDb(r),
      items: items.filter((i: any) => (i.order_id || i.po_id) === r.id).map(mapPOItemFromDb),
    }));
    if (branchId) orders = orders.filter(o => o.branchId === branchId);
    return orders;
  }
  const orders = lsGet<PurchaseOrder[]>(STORAGE_KEYS.purchaseOrders, []);
  return branchId ? orders.filter(o => o.branchId === branchId) : orders;
}

export async function savePurchaseOrder(order: PurchaseOrder): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('purchase_orders', {
      id: order.id,
      order_number: order.orderNumber,
      supplier_id: order.supplierId,
      supplier_name: order.supplierName,
      branch_id: order.branchId,
      subtotal: order.subtotal,
      freight_cost: order.freightCost || 0,
      other_costs: order.otherCosts || 0,
      tax_amount: order.taxAmount,
      total: order.total,
      status: order.status,
      expected_delivery_date: order.expectedDeliveryDate || '',
      received_at: order.receivedAt || '',
      received_by: order.receivedBy || '',
      notes: order.notes || '',
      created_at: order.createdAt,
    });
    // Save items
    for (const item of order.items) {
      await dbInsert('purchase_order_items', {
        id: `poi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        order_id: order.id,
        product_id: item.productId,
        product_name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        received_quantity: item.receivedQuantity || 0,
        unit_cost: item.unitCost,
        freight_allocation: item.freightAllocation || 0,
        effective_cost: item.effectiveCost || item.unitCost,
        tax_rate: item.taxRate,
        subtotal: item.subtotal,
      });
    }
    auditLog('create', 'purchase_orders', `OC ${order.orderNumber} - ${order.supplierName} - ${order.total.toLocaleString()} Kz`, 'Sistema');
    return;
  }
  const orders = lsGet<PurchaseOrder[]>(STORAGE_KEYS.purchaseOrders, []);
  const index = orders.findIndex(o => o.id === order.id);
  if (index >= 0) orders[index] = order;
  else orders.push(order);
  lsSet(STORAGE_KEYS.purchaseOrders, orders);
  auditLog('create', 'purchase_orders', `OC ${order.orderNumber} - ${order.supplierName} - ${order.total.toLocaleString()} Kz`, 'Sistema');
}

/**
 * Mark PO as received when a purchase invoice references its order number (no stock posting).
 * - Browser + localStorage: update merged in-memory list.
 * - Electron: run SQL updates against the embedded DB (same data the orders list uses).
 */
export async function markPurchaseOrderReceivedFromInvoiceNumber(
  orderNumber: string,
  supplierId: string,
  receivedBy: string,
): Promise<boolean> {
  const numRaw = String(orderNumber || '').trim();
  const sid = String(supplierId || '').trim();
  if (!numRaw || !sid) return false;

  if (isElectronMode() && typeof window !== 'undefined' && window.electronAPI?.db?.query) {
    try {
      const sel = await window.electronAPI.db.query(
        `SELECT id, status FROM purchase_orders
         WHERE LOWER(TRIM(COALESCE(order_number, ''))) = LOWER($1)
           AND TRIM(supplier_id::text) = TRIM($2)
         LIMIT 1`,
        [numRaw, sid],
      );
      const row =
        (sel as { data?: { id: string; status: string }[] })?.data?.[0] ??
        (Array.isArray(sel) ? (sel as { id: string; status: string }[])[0] : undefined);
      if (!row?.id) return false;
      if (row.status === 'cancelled' || row.status === 'received') return true;
      await window.electronAPI.db.query(
        `UPDATE purchase_order_items SET received_quantity = quantity WHERE order_id = $1`,
        [row.id],
      );
      const rb = receivedBy != null && String(receivedBy).trim() !== '' ? String(receivedBy).trim() : null;
      try {
        if (rb) {
          await window.electronAPI.db.query(
            `UPDATE purchase_orders
             SET status = 'received',
                 received_by = $1::uuid,
                 received_at = CURRENT_TIMESTAMP,
                 freight_distributed = true
             WHERE id = $2`,
            [rb, row.id],
          );
        } else {
          await window.electronAPI.db.query(
            `UPDATE purchase_orders
             SET status = 'received',
                 received_at = CURRENT_TIMESTAMP,
                 freight_distributed = true
             WHERE id = $1`,
            [row.id],
          );
        }
      } catch {
        await window.electronAPI.db.query(
          `UPDATE purchase_orders
           SET status = 'received',
               received_at = CURRENT_TIMESTAMP,
               freight_distributed = true
           WHERE id = $1`,
          [row.id],
        );
      }
      return true;
    } catch (e) {
      console.warn('[Storage] markPurchaseOrderReceivedFromInvoiceNumber (electron):', e);
      return false;
    }
  }

  const num = numRaw.toLowerCase();
  const orders = await getPurchaseOrders();
  const order = orders.find(
    (o) =>
      String(o.supplierId || '').trim() === sid &&
      String(o.orderNumber || '').trim().toLowerCase() === num,
  );
  if (!order || order.status === 'cancelled' || order.status === 'received') return false;
  order.status = 'received';
  order.receivedBy = receivedBy;
  order.receivedAt = new Date().toISOString();
  (order as { freightDistributed?: boolean }).freightDistributed = true;
  order.items.forEach((it) => {
    it.receivedQuantity = it.quantity;
  });
  await savePurchaseOrder(order);
  return true;
}

export function generatePurchaseOrderNumber(): string {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `PO${today}${seq}`;
}

export async function processPurchaseOrderReceive(
  orderId: string,
  receivedQuantities: Record<string, number>,
  userId: string
): Promise<void> {
  const orders = await getPurchaseOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const orderItemsTotal = order.items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const totalLandingCosts = (order.freightCost || 0) + (order.otherCosts || 0);

  order.items.forEach(item => {
    item.receivedQuantity = receivedQuantities[item.productId] ?? item.quantity;
  });

  const allReceived = order.items.every(item => (item.receivedQuantity || 0) >= item.quantity);
  const someReceived = order.items.some(item => (item.receivedQuantity || 0) > 0);

  order.status = allReceived ? 'received' : someReceived ? 'partial' : order.status;
  order.receivedBy = userId;
  order.receivedAt = new Date().toISOString();
  order.freightDistributed = true;

  await savePurchaseOrder(order);

  // Calculate effective costs with freight
  const stockEntries: Array<{ productId: string; productName: string; productSku: string; quantity: number; unitCost: number; direction: 'IN'; warehouseId: string }> = [];
  const priceUpdates: Array<{ productId: string; newUnitCost: number; quantityReceived: number; updateAvgCost: boolean }> = [];

  for (const item of order.items) {
    const received = receivedQuantities[item.productId] || 0;
    if (received <= 0) continue;

    let freightPerUnit = 0;
    if (orderItemsTotal > 0 && totalLandingCosts > 0) {
      const itemValue = item.quantity * item.unitCost;
      const proportion = itemValue / orderItemsTotal;
      freightPerUnit = (totalLandingCosts * proportion) / item.quantity;
    }
    const effectiveCost = item.unitCost + freightPerUnit;

    stockEntries.push({
      productId: item.productId,
      productName: item.productName,
      productSku: item.sku,
      quantity: received,
      unitCost: effectiveCost,
      direction: 'IN',
      warehouseId: order.branchId, // BRANCH-SCOPED
    });

    priceUpdates.push({
      productId: item.productId,
      newUnitCost: effectiveCost,
      quantityReceived: received,
      updateAvgCost: true,
    });
  }

  // Use transaction engine for atomic processing
  const { processTransaction } = await import('@/lib/transactionEngine');
  const totalWithTax = order.subtotal + order.taxAmount + (order.freightCost || 0);

  await processTransaction({
    transactionType: 'purchase_invoice',
    documentId: order.id,
    documentNumber: order.orderNumber,
    branchId: order.branchId,
    branchName: order.branchName || '',
    userId,
    userName: '',
    date: new Date().toISOString(),
    description: `Compra ${order.orderNumber} — ${order.supplierName}`,
    amount: order.total,
    stockEntries,
    priceUpdates,
    journalLines: [
      { accountCode: '2.1.1', debit: order.subtotal + (order.freightCost || 0), credit: 0 },
      ...(order.taxAmount > 0 ? [{ accountCode: '3.3.1', debit: order.taxAmount, credit: 0 }] : []),
      { accountCode: '3.2.1', debit: 0, credit: totalWithTax },
    ],
    entityBalanceUpdate: {
      entityType: 'supplier',
      entityId: order.supplierId,
      entityName: order.supplierName,
      amount: order.total,
    },
    openItem: {
      entityType: 'supplier',
      entityId: order.supplierId,
      entityName: order.supplierName,
      documentType: 'invoice',
      originalAmount: order.total,
      isDebit: true,
    },
  });
}

// ============= STOCK TRANSFER FUNCTIONS =============
export async function getStockTransfers(branchId?: string): Promise<StockTransfer[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('stock_transfers');
    const items = await dbGetAll<any>('stock_transfer_items');
    let transfers = rows.map(r => ({
      ...mapStockTransferFromDb(r),
      items: items.filter((i: any) => i.transfer_id === r.id).map((i: any) => ({
        productId: i.product_id,
        productName: i.product_name,
        sku: i.sku,
        quantity: i.quantity,
        receivedQuantity: i.received_quantity,
      })),
    }));
    if (branchId) transfers = transfers.filter(t => t.fromBranchId === branchId || t.toBranchId === branchId);
    return transfers;
  }
  const transfers = lsGet<StockTransfer[]>(STORAGE_KEYS.stockTransfers, []);
  return branchId ? transfers.filter(t => t.fromBranchId === branchId || t.toBranchId === branchId) : transfers;
}

export async function saveStockTransfer(transfer: StockTransfer): Promise<void> {
  if (isElectronMode()) {
    const payload = {
      id: transfer.id,
      transfer_number: transfer.transferNumber,
      from_branch_name: transfer.fromBranchName,
      from_branch_id: transfer.fromBranchId,
      to_branch_name: transfer.toBranchName,
      to_branch_id: transfer.toBranchId,
      status: transfer.status,
      requested_by: transfer.requestedBy,
      approved_by: transfer.approvedBy || '',
      received_by: transfer.receivedBy || '',
      requested_at: transfer.requestedAt,
      approved_at: transfer.approvedAt || '',
      received_at: transfer.receivedAt || '',
      notes: transfer.notes || '',
    };

    const existing = await window.electronAPI!.db.getById('stock_transfers', transfer.id);
    if (existing?.data) await dbUpdate('stock_transfers', transfer.id, payload);
    else await dbInsert('stock_transfers', payload);

    await dbExec('DELETE FROM stock_transfer_items WHERE transfer_id = $1', [transfer.id]);

    for (const [index, item] of transfer.items.entries()) {
      await dbInsert('stock_transfer_items', {
        id: `${transfer.id}_item_${index + 1}`,
        transfer_id: transfer.id,
        product_id: item.productId,
        product_name: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        received_quantity: item.receivedQuantity || 0,
      });
    }
    auditLog('transfer', 'stock', `Transferência ${transfer.transferNumber} criada`, 'Sistema');
    return;
  }
  const transfers = lsGet<StockTransfer[]>(STORAGE_KEYS.stockTransfers, []);
  const index = transfers.findIndex(t => t.id === transfer.id);
  if (index >= 0) transfers[index] = transfer;
  else transfers.push(transfer);
  lsSet(STORAGE_KEYS.stockTransfers, transfers);
  auditLog('transfer', 'stock', `Transferência ${transfer.transferNumber} guardada`, 'Sistema');
}

export function generateTransferNumber(): string {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const seq = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  return `TRF${today}${seq}`;
}

// ============= DAILY REPORT FUNCTIONS =============
export async function getDailyReports(branchId?: string): Promise<DailySummary[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('daily_reports');
    let reports = rows.map(mapDailyReportFromDb);
    if (branchId) reports = reports.filter(r => r.branchId === branchId);
    return reports;
  }
  const reports = lsGet<DailySummary[]>(STORAGE_KEYS.dailyReports, []);
  return branchId ? reports.filter(r => r.branchId === branchId) : reports;
}

export async function persistDailyReportLocal(report: DailySummary): Promise<void> {
  const reports = lsGet<DailySummary[]>(STORAGE_KEYS.dailyReports, []);
  const index = reports.findIndex(
    (r) => r.branchId === report.branchId && r.date === report.date
  );
  if (index >= 0) reports[index] = report;
  else reports.push(report);
  lsSet(STORAGE_KEYS.dailyReports, reports);
}

export async function saveDailyReport(report: DailySummary): Promise<void> {
  if (isElectronMode()) {
    try {
      await dbInsert('daily_reports', {
        id: report.id, date: report.date, branch_id: report.branchId,
        branch_name: report.branchName, total_sales: report.totalSales,
        total_transactions: report.totalTransactions, cash_total: report.cashTotal,
        card_total: report.cardTotal, transfer_total: report.transferTotal,
        tax_collected: report.taxCollected, opening_balance: report.openingBalance,
        closing_balance: report.closingBalance, status: report.status,
        closed_by: report.closedBy || '', closed_at: report.closedAt || '',
      });
    } catch {
      /* IPC DB may be unavailable — localStorage mirror below */
    }
  }
  await persistDailyReportLocal(report);
}

export async function getTodayReport(branchId: string): Promise<DailySummary | null> {
  const today = new Date().toISOString().split('T')[0];
  const reports = await getDailyReports(branchId);
  return reports.find(r => r.date === today) || null;
}

export async function generateDailyReport(branchId: string, date: string): Promise<DailySummary> {
  const sales = (await getSales(branchId)).filter(s =>
    s.createdAt.startsWith(date) && s.status === 'completed'
  );
  const branches = await getBranches();
  const branch = branches.find(b => b.id === branchId);

  const cashTotal = sales.filter(s => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0);
  const cardTotal = sales.filter(s => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0);
  const transferTotal = sales.filter(s => s.paymentMethod === 'transfer').reduce((sum, s) => sum + s.total, 0);

  return {
    id: `report_${branchId}_${date}`,
    date, branchId, branchName: branch?.name || '',
    totalSales: sales.reduce((sum, s) => sum + s.total, 0),
    totalTransactions: sales.length,
    cashTotal, cardTotal, transferTotal,
    taxCollected: sales.reduce((sum, s) => sum + s.taxAmount, 0),
    openingBalance: 0, closingBalance: cashTotal,
    status: 'open', createdAt: new Date().toISOString(),
  };
}

// ============= STOCK MOVEMENT FUNCTIONS =============
export async function getStockMovements(branchId?: string): Promise<StockMovement[]> {
  if (isElectronMode()) {
    const rows = await dbGetAll<any>('stock_movements');
    let movements = rows.map((r: any) => ({
      id: r.id, productId: r.product_id, productName: r.product_name,
      sku: r.sku, branchId: r.branch_id, type: r.type, quantity: r.quantity,
      reason: r.reason, referenceId: r.reference_id, referenceNumber: r.reference_number,
      costAtTime: r.cost_at_time, notes: r.notes, createdBy: r.created_by,
      createdAt: r.created_at,
    }));
    if (branchId) movements = movements.filter((m: any) => m.branchId === branchId);
    return movements;
  }
  const movements = lsGet<StockMovement[]>(STORAGE_KEYS.stockMovements, []);
  return branchId ? movements.filter(m => m.branchId === branchId) : movements;
}

export async function saveStockMovement(movement: StockMovement): Promise<void> {
  if (isElectronMode()) {
    await dbInsert('stock_movements', {
      id: movement.id, product_id: movement.productId, product_name: movement.productName,
      sku: movement.sku, branch_id: movement.branchId, type: movement.type,
      quantity: movement.quantity, reason: movement.reason,
      reference_id: movement.referenceId || '', reference_number: movement.referenceNumber || '',
      cost_at_time: movement.costAtTime || 0, notes: movement.notes || '',
      created_by: movement.createdBy,
    });
    return;
  }
  const movements = lsGet<StockMovement[]>(STORAGE_KEYS.stockMovements, []);
  movements.push(movement);
  lsSet(STORAGE_KEYS.stockMovements, movements);
}

// ============= LOCAL JOURNAL ENTRY (Web Preview) =============
interface LocalJournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string;
  referenceId: string;
  branchId: string;
  totalDebit: number;
  totalCredit: number;
  createdBy?: string;
  lines: { accountCode: string; accountName?: string; description?: string; debit: number; credit: number }[];
  createdAt: string;
}

export async function createLocalJournalEntry(params: {
  description: string;
  referenceType: string;
  referenceId: string;
  branchId: string;
  entryDate?: string;
  createdBy?: string;
  entryNumber?: string;
  lines: { accountCode: string; accountName?: string; description?: string; debit: number; credit: number }[];
}): Promise<LocalJournalEntry> {
  const entries = lsGet<LocalJournalEntry[]>(STORAGE_KEYS.journalEntries, []);
  const entryDate = params.entryDate || new Date().toISOString().split('T')[0];
  const today = entryDate.replace(/-/g, '');
  const prefixMap: Record<string, string> = {
    sale: 'VD',
    venda: 'VD',
    purchase_invoice: 'CP',
    compra: 'CP',
    payment_receipt: 'RB',
    recibo: 'RB',
    payment_out: 'PG',
    pagamento: 'PG',
    adjustment: 'AJ',
    ajuste: 'AJ',
    abertura: 'AB',
    fecho: 'FC',
    manual: 'MN',
  };
  const prefix = prefixMap[params.referenceType] || 'JE';
  const seq = (entries.length + 1).toString().padStart(4, '0');
  const entryId = `je_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const entryNumber = params.entryNumber || `${prefix}-${today}${seq}`;
  
  const totalDebit = params.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = params.lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  const createdEntry: LocalJournalEntry = {
    id: entryId,
    entryNumber,
    entryDate,
    description: params.description,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    branchId: params.branchId,
    totalDebit,
    totalCredit,
    createdBy: params.createdBy || 'Sistema',
    lines: params.lines,
    createdAt: new Date().toISOString(),
  };

  if (isElectronMode()) {
    const accountsResult = await window.electronAPI!.db.query(
      'SELECT id, account_number, name, type, balance, debit_total, credit_total FROM chart_of_accounts',
      [],
    );
    const accountRows = Array.isArray(accountsResult?.data) ? accountsResult.data : [];
    const accountsByCode = new Map(accountRows.map((row: any) => [String(row.account_number || ''), { ...row }]));

    await dbInsert('journal_entries', {
      id: createdEntry.id,
      entry_number: createdEntry.entryNumber,
      date: createdEntry.entryDate,
      type: String(params.referenceType || 'manual').toUpperCase(),
      reference: params.referenceType || '',
      reference_id: params.referenceId,
      description: params.description,
      currency: 'AOA',
      exchange_rate: 1,
      total_debit: totalDebit,
      total_credit: totalCredit,
      is_balanced: Math.abs(totalDebit - totalCredit) < 0.01 ? 1 : 0,
      status: 'posted',
      branch_id: params.branchId,
      created_by: params.createdBy || 'Sistema',
      user_name: params.createdBy || 'Sistema',
      created_at: createdEntry.createdAt,
    });

    for (const [index, line] of params.lines.entries()) {
      const account = accountsByCode.get(line.accountCode);

      await dbInsert('journal_entry_lines', {
        id: `${createdEntry.id}_line_${index + 1}`,
        journal_entry_id: createdEntry.id,
        account_id: account?.id || line.accountCode,
        account_number: line.accountCode,
        account_name: line.accountName || account?.name || '',
        debit: line.debit || 0,
        credit: line.credit || 0,
        description: line.description || params.description,
        created_at: createdEntry.createdAt,
      });

      if (account?.id) {
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);
        const currentBalance = Number(account.balance || 0);
        const currentDebit = Number(account.debit_total || 0);
        const currentCredit = Number(account.credit_total || 0);
        const balanceChange = ['asset', 'expense'].includes(String(account.type || '').toLowerCase())
          ? debit - credit
          : credit - debit;

        account.balance = currentBalance + balanceChange;
        account.debit_total = currentDebit + debit;
        account.credit_total = currentCredit + credit;

        await dbUpdate('chart_of_accounts', account.id, {
          balance: account.balance,
          debit_total: account.debit_total,
          credit_total: account.credit_total,
        });
      }
    }

    return createdEntry;
  }

  entries.push({
    ...createdEntry,
  });
  lsSet(STORAGE_KEYS.journalEntries, entries);
  
  // Update Chart of Accounts balances for each account in the journal
  try {
    const { updateCoABalancesFromJournal } = await import('@/lib/chartOfAccountsEngine');
    await updateCoABalancesFromJournal(params.lines);
  } catch (e) {
    console.error('[Storage] Failed to update CoA balances:', e);
  }

  return createdEntry;
}

export async function getLocalJournalEntries(branchId?: string): Promise<LocalJournalEntry[]> {
  if (isElectronMode()) {
    const [entryRows, lineRows] = await Promise.all([
      dbGetAll<any>('journal_entries'),
      dbGetAll<any>('journal_entry_lines'),
    ]);

    let entries = entryRows.map(row => ({
      id: row.id,
      entryNumber: row.entry_number || row.id,
      entryDate: row.entry_date || row.date || row.created_at || '',
      description: row.description || '',
      referenceType: row.reference_type || row.type || 'manual',
      referenceId: row.reference_id || '',
      branchId: row.branch_id || '',
      totalDebit: Number(row.total_debit || 0),
      totalCredit: Number(row.total_credit || 0),
      createdBy: row.created_by || row.user_name || 'Sistema',
      lines: lineRows
        .filter(line => line.journal_entry_id === row.id)
        .map(line => ({
          accountCode: line.account_number || line.account_code || '',
          accountName: line.account_name || '',
          description: line.description || '',
          debit: Number(line.debit || line.debit_amount || 0),
          credit: Number(line.credit || line.credit_amount || 0),
        })),
      createdAt: row.created_at || '',
    }));

    entries = entries.sort((a, b) => new Date(b.createdAt || b.entryDate).getTime() - new Date(a.createdAt || a.entryDate).getTime());
    return branchId ? entries.filter(entry => entry.branchId === branchId) : entries;
  }

  const entries = lsGet<LocalJournalEntry[]>(STORAGE_KEYS.journalEntries, []);
  return branchId ? entries.filter(e => e.branchId === branchId) : entries;
}

// ============= DB <-> FRONTEND MAPPING =============
function mapBranchFromDb(row: any): Branch {
  return {
    id: row.id, name: row.name, code: row.code || '',
    address: row.address || '', phone: row.phone || '',
    isMain: !!(row.is_main ?? row.isMain),
    priceLevel: row.price_level ?? row.priceLevel ?? 1,
    createdAt: row.created_at ?? row.createdAt ?? '',
  };
}

function mapBranchToDb(branch: Branch): any {
  return {
    id: branch.id, name: branch.name, code: branch.code,
    address: branch.address, phone: branch.phone,
    is_main: branch.isMain ? 1 : 0, is_active: 1,
    price_level: branch.priceLevel || 1,
  };
}

function mapProductFromDb(row: any): Product {
  const cost = Number(row.cost || 0);
  return {
    id: row.id, name: row.name, sku: row.sku || '', barcode: row.barcode,
    category: row.category_id ?? row.category ?? '',
    price: Number(row.price || 0),
    price2: Number(row.price2 ?? row.price_2 ?? 0) || undefined,
    price3: Number(row.price3 ?? row.price_3 ?? 0) || undefined,
    price4: Number(row.price4 ?? row.price_4 ?? 0) || undefined,
    cost,
    firstCost: Number(row.first_cost ?? row.firstCost ?? cost),
    lastCost: Number(row.last_cost ?? row.lastCost ?? row.weighted_avg_cost ?? cost),
    avgCost: Number(row.weighted_avg_cost ?? row.avg_cost ?? row.avgCost ?? cost),
    stock: Number(row.stock || 0),
    unit: row.unit || 'un',
    taxRate: normalizeTaxRate(row.tax_rate ?? row.taxRate),
    branchId: row.branch_id ?? row.branchId ?? '',
    supplierId: row.supplier_id ?? row.supplierId,
    supplierName: row.supplier_name ?? row.supplierName,
    isActive: !!(row.is_active ?? row.isActive ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function mapProductToDb(product: Product): any {
  return {
    id: product.id, sku: product.sku, barcode: product.barcode || '',
    name: product.name, description: '', category_id: product.category,
    unit: product.unit, price: product.price,
    price_2: product.price2 || 0, price_3: product.price3 || 0, price_4: product.price4 || 0,
    cost: product.cost,
    last_cost: product.lastCost || product.cost,
    weighted_avg_cost: product.avgCost || product.cost,
    stock: product.stock, min_stock: 0, max_stock: 0,
    branch_id: product.branchId, supplier_id: product.supplierId || '',
    tax_rate: product.taxRate, is_active: product.isActive ? 1 : 0,
    image: '',
  };
}

function mapSaleFromDb(row: any): Sale {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number ?? row.invoiceNumber ?? '',
    branchId: row.branch_id ?? row.branchId ?? '',
    cashierId: row.cashier_id ?? row.cashierId ?? '',
    cashierName: row.cashier_name ?? row.cashierName,
    items: [],
    subtotal: Number(row.subtotal || 0),
    taxAmount: Number(row.tax_amount ?? row.taxAmount ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total || 0),
    paymentMethod: row.payment_method ?? row.paymentMethod ?? 'cash',
    amountPaid: Number(row.amount_paid ?? row.amountPaid ?? 0),
    change: Number(row.change_amount ?? row.change ?? 0),
    customerNif: row.client_nif ?? row.customerNif,
    customerName: row.client_name ?? row.customerName,
    status: row.status ?? 'completed',
    saftHash: row.agt_hash ?? row.saftHash,
    agtCode: row.agt_code ?? row.agtCode,
    createdAt: row.created_at ?? row.createdAt ?? '',
  };
}

function mapSaleItemFromDb(row: any): any {
  return {
    productId: row.product_id, productName: row.product_name, sku: row.sku || '',
    quantity: Number(row.quantity || 0), unitPrice: Number(row.unit_price || 0),
    discount: Number(row.discount || 0), taxRate: Number(row.tax_rate || 14),
    taxAmount: Number(row.tax_amount || 0), subtotal: Number(row.total || 0),
  };
}

function mapUserFromDb(row: any): User {
  return {
    id: row.id, email: row.email ?? `${row.username}@kwanzaerp.ao`,
    name: row.name || row.username, username: row.username,
    role: row.role ?? 'cashier', branchId: row.branch_id ?? row.branchId ?? '',
    isActive: !!(row.is_active ?? row.isActive ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function mapUserToDb(user: User): any {
  return {
    id: user.id, username: user.username || user.email?.split('@')[0] || user.name,
    password: 'changeme', name: user.name, role: user.role,
    branch_id: user.branchId, is_active: user.isActive ? 1 : 0,
  };
}

function mapClientFromDb(row: any): Client {
  return {
    id: row.id, name: row.name, nif: row.nif || '',
    email: row.email, phone: row.phone, address: row.address,
    city: row.city, country: row.country ?? row.province ?? 'Angola',
    creditLimit: Number(row.credit_limit ?? row.creditLimit ?? 0),
    currentBalance: Number(row.balance ?? row.current_balance ?? row.currentBalance ?? 0),
    isActive: !!(row.is_active ?? row.isActive ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  };
}

function mapClientToDb(client: Client): any {
  return {
    id: client.id, name: client.name, nif: client.nif,
    email: client.email || '', phone: client.phone || '',
    address: client.address || '', city: client.city || '',
    province: client.country || 'Angola',
    credit_limit: client.creditLimit, balance: client.currentBalance,
    is_active: client.isActive ? 1 : 0,
  };
}

function mapSupplierFromDb(row: any): Supplier {
  return {
    id: row.id, name: row.name, nif: row.nif || '',
    email: row.email, phone: row.phone, address: row.address,
    city: row.city, country: row.country ?? row.province ?? 'Angola',
    contactPerson: row.contact_person ?? row.contactPerson,
    paymentTerms: row.payment_terms ?? row.paymentTerms ?? '30_days',
    balance: Number(row.balance ?? 0),
    isActive: !!(row.is_active ?? row.isActive ?? true),
    notes: row.notes,
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  };
}

function mapSupplierToDb(supplier: Supplier): any {
  return {
    id: supplier.id, name: supplier.name, nif: supplier.nif,
    email: supplier.email || '', phone: supplier.phone || '',
    address: supplier.address || '', city: supplier.city || '',
    country: supplier.country || 'Angola',
    contact_person: supplier.contactPerson || '',
    payment_terms: supplier.paymentTerms, balance: supplier.balance || 0,
    is_active: supplier.isActive !== false, notes: supplier.notes || '',
  };
}

function mapCategoryFromDb(row: any): Category {
  return {
    id: row.id, name: row.name, description: row.description,
    parentId: row.parent_id || null,
    color: row.color,
    isActive: !!(row.is_active ?? row.isActive ?? true),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  };
}

function mapPurchaseOrderFromDb(row: any): PurchaseOrder {
  return {
    id: row.id,
    orderNumber: row.po_number ?? row.order_number ?? row.orderNumber ?? '',
    supplierId: row.supplier_id ?? row.supplierId ?? '',
    supplierName: row.supplier_name ?? row.supplierName ?? '',
    branchId: row.branch_id ?? row.branchId ?? '',
    branchName: row.branch_name ?? row.branchName ?? '',
    items: [],
    subtotal: Number(row.subtotal ?? 0),
    taxAmount: Number(row.tax_amount ?? row.taxAmount ?? 0),
    total: Number(row.total ?? 0),
    freightCost: Number(row.freight_cost ?? row.freight ?? row.freightCost ?? 0),
    otherCosts: Number(row.other_costs ?? row.otherCosts ?? 0),
    status: row.status ?? 'draft',
    notes: row.notes,
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    approvedBy: row.approved_by ?? row.approvedBy,
    approvedAt: row.approved_at ?? row.approvedAt,
    receivedBy: row.received_by ?? row.receivedBy,
    receivedAt: row.received_date ?? row.received_at ?? row.receivedAt,
    expectedDeliveryDate: row.expected_date ?? row.expected_delivery_date ?? row.expectedDeliveryDate,
  };
}

function mapPOItemFromDb(row: any): any {
  return {
    productId: row.product_id, productName: row.product_name, sku: row.sku || '',
    quantity: Number(row.quantity || row.quantity_ordered || 0),
    receivedQuantity: Number(row.received_quantity || row.quantity_received || 0),
    unitCost: Number(row.unit_cost || 0),
    freightAllocation: Number(row.freight_allocation || 0),
    effectiveCost: Number(row.effective_cost || row.unit_cost || 0),
    taxRate: Number(row.tax_rate || 14),
    subtotal: Number(row.subtotal || row.total || 0),
  };
}

function mapStockTransferFromDb(row: any): StockTransfer {
  return {
    id: row.id,
    transferNumber: row.transfer_number ?? row.transferNumber ?? '',
    fromBranchId: row.from_branch_id ?? row.fromBranchId ?? '',
    fromBranchName: row.from_branch_name ?? row.fromBranchName ?? '',
    toBranchId: row.to_branch_id ?? row.toBranchId ?? '',
    toBranchName: row.to_branch_name ?? row.toBranchName ?? '',
    items: [],
    status: row.status ?? 'pending',
    requestedBy: row.requested_by ?? row.requestedBy ?? '',
    requestedAt: row.requested_at ?? row.requestedAt ?? '',
    approvedBy: row.approved_by ?? row.approvedBy,
    approvedAt: row.approved_at ?? row.approvedAt,
    receivedBy: row.received_by ?? row.receivedBy,
    receivedAt: row.received_at ?? row.receivedAt,
    notes: row.notes,
  };
}

function mapDailyReportFromDb(row: any): DailySummary {
  return {
    id: row.id, date: row.date,
    branchId: row.branch_id ?? row.branchId ?? '',
    branchName: row.branch_name ?? row.branchName ?? '',
    totalSales: Number(row.total_sales ?? row.totalSales ?? 0),
    totalTransactions: Number(row.total_transactions ?? row.totalTransactions ?? 0),
    cashTotal: Number(row.cash_total ?? row.cashTotal ?? 0),
    cardTotal: Number(row.card_total ?? row.cardTotal ?? 0),
    transferTotal: Number(row.transfer_total ?? row.transferTotal ?? 0),
    taxCollected: Number(row.tax_collected ?? row.taxCollected ?? 0),
    openingBalance: Number(row.opening_balance ?? row.openingBalance ?? 0),
    closingBalance: Number(row.closing_balance ?? row.closingBalance ?? 0),
    status: row.status ?? 'open',
    closedBy: row.closed_by ?? row.closedBy,
    closedAt: row.closed_at ?? row.closedAt,
    createdAt: row.created_at ?? row.createdAt ?? '',
  };
}

// ============= DEFAULT DATA (Web Preview / Demo) =============
function getDefaultBranches(): Branch[] {
  return [
    { id: 'branch-001', name: 'Sede Principal - Luanda', code: 'LDA', address: 'Rua Principal 123, Luanda', phone: '+244 923 456 789', isMain: true, priceLevel: 1, createdAt: new Date().toISOString() },
    { id: 'branch-002', name: 'Filial Viana', code: 'VIA', address: 'Av. Deolinda Rodrigues, Viana', phone: '+244 923 456 790', isMain: false, priceLevel: 1, createdAt: new Date().toISOString() },
  ];
}

function getDefaultProducts(): Product[] {
  return [];
}

function getDefaultUsers(): User[] {
  return [
    { id: 'user-001', email: 'admin@kwanzaerp.ao', username: 'admin', name: 'Administrador', role: 'admin', branchId: 'branch-001', isActive: true, createdAt: new Date().toISOString() },
    { id: 'user-002', email: 'caixa1@kwanzaerp.ao', username: 'caixa1', name: 'João Silva', role: 'cashier', branchId: 'branch-001', isActive: true, createdAt: new Date().toISOString() },
    { id: 'user-003', email: 'gerente@kwanzaerp.ao', username: 'gerente', name: 'Maria Santos', role: 'manager', branchId: 'branch-001', isActive: true, createdAt: new Date().toISOString() },
  ];
}

function getDefaultCategories(): Category[] {
  const ts = new Date().toISOString();
  return [
    // Root families
    { id: 'cat-001', name: 'Alimentação', description: 'Produtos alimentares', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-002', name: 'Bebidas', description: 'Bebidas e sumos', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-003', name: 'Limpeza', description: 'Produtos de limpeza', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-004', name: 'Higiene', description: 'Higiene pessoal', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-005', name: 'Electrónicos', description: 'Electrónicos e acessórios', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-006', name: 'Outros', description: 'Outros produtos', parentId: null, isActive: true, createdAt: ts, updatedAt: ts },
    // Sub-categories
    { id: 'cat-101', name: 'Arroz', description: '', parentId: 'cat-001', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-102', name: 'Açúcar', description: '', parentId: 'cat-001', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-103', name: 'Farinha', description: '', parentId: 'cat-001', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-104', name: 'Óleo', description: '', parentId: 'cat-001', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-201', name: 'Água', description: '', parentId: 'cat-002', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-202', name: 'Gasosa', description: '', parentId: 'cat-002', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-203', name: 'Sumos', description: '', parentId: 'cat-002', isActive: true, createdAt: ts, updatedAt: ts },
    { id: 'cat-204', name: 'Cerveja', description: '', parentId: 'cat-002', isActive: true, createdAt: ts, updatedAt: ts },
  ];
}
