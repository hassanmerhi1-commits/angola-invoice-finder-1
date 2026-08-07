import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { E2E_ADMIN } from './auth';
import { E2E_BACKEND_URL } from './config';

export interface E2eAuthContext {
  token: string;
  userId: string;
  branchId: string;
  branchCode: string;
}

export interface SeededProduct {
  auth: E2eAuthContext;
  productId: string;
  sku: string;
  name: string;
  initialStock: number;
  price: number;
  cost: number;
}

export interface SeededSupplier {
  auth: E2eAuthContext;
  supplierId: string;
  supplierName: string;
  accountCode: string;
  nif: string;
}

export interface SeededPurchaseInvoice {
  auth: E2eAuthContext;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  total: number;
  productId: string;
  quantity: number;
}

export interface StockTransferScenario {
  auth: E2eAuthContext;
  productId: string;
  sku: string;
  productName: string;
  sourceBranchId: string;
  destBranchId: string;
  destBranchName: string;
  initialStock: number;
  transferQty: number;
}

export type SeededPosProduct = SeededProduct;

export async function loginApi(request: APIRequestContext): Promise<E2eAuthContext> {
  const loginRes = await request.post(`${E2E_BACKEND_URL}/api/auth/login`, {
    data: {
      email: E2E_ADMIN.username,
      username: E2E_ADMIN.username,
      password: E2E_ADMIN.password,
    },
  });
  expect(loginRes.ok()).toBeTruthy();
  const loginBody = await loginRes.json();
  expect(loginBody.token).toBeTruthy();

  const branchesRes = await request.get(`${E2E_BACKEND_URL}/api/branches`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  expect(branchesRes.ok()).toBeTruthy();
  const branches = await branchesRes.json();
  expect(Array.isArray(branches)).toBeTruthy();
  expect(branches.length).toBeGreaterThan(0);

  const mainBranch = branches.find((b: { is_main?: boolean; isMain?: boolean }) => b.is_main || b.isMain)
    ?? branches[0];

  return {
    token: loginBody.token,
    userId: loginBody.user?.id,
    branchId: mainBranch.id,
    branchCode: mainBranch.code || 'MAIN',
  };
}

export async function seedProduct(
  request: APIRequestContext,
  options: {
    auth?: E2eAuthContext;
    sku?: string;
    stock?: number;
    price?: number;
    cost?: number;
    branchId?: string;
  } = {},
): Promise<SeededProduct> {
  const auth = options.auth ?? await loginApi(request);
  const sku = options.sku ?? `E2E-${Date.now().toString(36).slice(-8)}`;
  const name = `E2E Widget ${sku}`;
  const stock = options.stock ?? 0;
  const price = options.price ?? 1000;
  const cost = options.cost ?? 500;
  const branchId = options.branchId ?? auth.branchId;

  const productRes = await request.post(`${E2E_BACKEND_URL}/api/products`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      name,
      sku,
      barcode: `5601${sku.replace(/\D/g, '').slice(-8).padStart(8, '0')}`,
      category: 'GERAL',
      price,
      cost,
      stock,
      unit: 'un',
      taxRate: 14,
      branchId,
      isActive: true,
    },
  });
  expect(productRes.ok()).toBeTruthy();
  const product = await productRes.json();

  if (stock > 0) {
    // POS / inventory-grid use movement ledger stock. Creating a product with
    // products.stock set does not create ledger rows — always top up the ledger.
    const movements = await fetchStockMovements(request, auth, {
      productId: product.id,
      warehouseId: branchId,
    }).catch(() => []);
    const ledger = movements.reduce((sum: number, m: { movement_type?: string; movementType?: string; quantity?: number }) => {
      const qty = Number(m.quantity || 0);
      const type = String(m.movement_type ?? m.movementType ?? '').toUpperCase();
      if (type === 'IN') return sum + qty;
      if (type === 'OUT') return sum - qty;
      return sum;
    }, 0);
    const need = Math.max(0, stock - Math.max(0, ledger));
    if (need > 0) {
      const stockRes = await request.post(`${E2E_BACKEND_URL}/api/transactions/stock-movements`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        data: {
          productId: product.id,
          warehouseId: branchId,
          movementType: 'IN',
          quantity: need,
          unitCost: cost,
          referenceType: 'adjustment',
          referenceNumber: `E2E-SEED-${sku}`,
          createdBy: auth.userId,
        },
      });
      expect(stockRes.ok(), await stockRes.text()).toBeTruthy();
    }
  }

  const initialStock = await fetchProductStock(request, auth, product.id).catch(() => stock);

  return {
    auth,
    productId: product.id,
    sku,
    name,
    initialStock,
    price,
    cost,
  };
}

export async function ensureOpenCaixaSession(
  request: APIRequestContext,
  auth: E2eAuthContext,
  openingBalance = 0,
) {
  const res = await request.post(`${E2E_BACKEND_URL}/api/caixa/sessions/open`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      branchId: auth.branchId,
      branchName: 'Main Branch',
      openingBalance,
      openedBy: auth.userId,
    },
  });
  expect(res.ok()).toBeTruthy();
}

export async function seedPosSaleProduct(
  request: APIRequestContext,
  options: { sku?: string; stock?: number; price?: number } = {},
): Promise<SeededPosProduct> {
  return seedProduct(request, {
    stock: options.stock ?? 25,
    price: options.price ?? 1000,
    sku: options.sku,
  });
}

export async function seedSupplier(
  request: APIRequestContext,
  options: { auth?: E2eAuthContext; name?: string } = {},
): Promise<SeededSupplier> {
  const auth = options.auth ?? await loginApi(request);
  const suffix = Date.now().toString(36).slice(-6);
  const supplierName = options.name ?? `E2E Supplier ${suffix}`;
  const nif = `9${suffix.replace(/\D/g, '').padStart(8, '0').slice(0, 8)}`;

  const res = await request.post(`${E2E_BACKEND_URL}/api/suppliers`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      name: supplierName,
      nif,
      phone: '923000000',
      country: 'Angola',
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const supplier = await res.json();
  const accountCode = String(supplier._accountCode || supplier.accountCode || '').trim();
  expect(accountCode, 'supplier CoA leaf account was not created').toMatch(/^321\d+$/);

  return {
    auth,
    supplierId: supplier.id,
    supplierName: supplier.name,
    accountCode,
    nif: supplier.nif || nif,
  };
}

export async function createBranchApi(
  request: APIRequestContext,
  auth: E2eAuthContext,
  name: string,
): Promise<{ id: string; name: string; code: string }> {
  const code = `E2E${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const res = await request.post(`${E2E_BACKEND_URL}/api/branches`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: { name, code, isMain: false },
  });
  expect(res.ok()).toBeTruthy();
  const branch = await res.json();
  return { id: branch.id, name: branch.name, code: branch.code };
}

export async function createPurchaseInvoiceApi(
  request: APIRequestContext,
  options: {
    auth: E2eAuthContext;
    supplier: SeededSupplier;
    product: SeededProduct;
    quantity?: number;
    unitCost?: number;
  },
): Promise<SeededPurchaseInvoice> {
  const { auth, supplier, product } = options;
  const quantity = options.quantity ?? 10;
  const unitCost = options.unitCost ?? product.cost;
  const subtotal = unitCost * quantity;
  const ivaRate = 14;
  const ivaTotal = Math.round((subtotal * ivaRate / 100) * 100) / 100;
  const total = Math.round((subtotal + ivaTotal) * 100) / 100;
  const today = new Date().toISOString().split('T')[0];
  const invoiceId = randomUUID();
  const invoiceNumber = `FC-E2E-${Date.now().toString(36).slice(-8)}`;
  const supplierInvoiceNo = `SUP-INV-${Date.now().toString(36).slice(-8)}`;

  const res = await request.post(`${E2E_BACKEND_URL}/api/purchase-invoices`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    data: {
      id: invoiceId,
      invoiceNumber,
      supplierId: supplier.supplierId,
      supplierAccountCode: supplier.accountCode,
      supplierName: supplier.supplierName,
      supplierNif: supplier.nif,
      supplierInvoiceNo,
      branchId: auth.branchId,
      warehouseId: auth.branchId,
      status: 'confirmed',
      date: today,
      paymentDate: today,
      subtotal,
      ivaTotal,
      total,
      createdBy: auth.userId,
      lines: [{
        productId: product.productId,
        productCode: product.sku,
        description: product.name,
        quantity,
        totalQty: quantity,
        unitPrice: unitCost,
        total: subtotal,
        ivaRate,
        ivaAmount: ivaTotal,
      }],
      journalLines: [
        { accountCode: '212', accountName: 'Mercadorias', debit: subtotal, credit: 0 },
        { accountCode: '3451', accountName: 'IVA Dedutível', debit: ivaTotal, credit: 0 },
        { accountCode: supplier.accountCode, accountName: supplier.supplierName, debit: 0, credit: total },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  expect(body.accounting?.stockMovementIds?.length ?? 0).toBeGreaterThan(0);

  return {
    auth,
    invoiceId,
    invoiceNumber,
    supplierId: supplier.supplierId,
    supplierName: supplier.supplierName,
    total,
    productId: product.productId,
    quantity,
  };
}

export async function seedStockTransferScenario(
  request: APIRequestContext,
  options: { stock?: number; transferQty?: number } = {},
): Promise<StockTransferScenario> {
  const auth = await loginApi(request);
  const dest = await createBranchApi(request, auth, `E2E Branch ${Date.now().toString(36).slice(-4)}`);
  const stock = options.stock ?? 30;
  const transferQty = options.transferQty ?? 5;
  const product = await seedProduct(request, { auth, stock });

  return {
    auth,
    productId: product.productId,
    sku: product.sku,
    productName: product.name,
    sourceBranchId: auth.branchId,
    destBranchId: dest.id,
    destBranchName: dest.name,
    initialStock: stock,
    transferQty,
  };
}

export async function fetchLatestSaleForBranch(
  request: APIRequestContext,
  auth: E2eAuthContext,
) {
  const res = await request.get(`${E2E_BACKEND_URL}/api/sales?branchId=${encodeURIComponent(auth.branchId)}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(res.ok()).toBeTruthy();
  const sales = await res.json();
  return Array.isArray(sales) ? sales[0] : null;
}

export async function fetchProductStock(
  request: APIRequestContext,
  auth: E2eAuthContext,
  productId: string,
  warehouseId?: string,
): Promise<number> {
  const branchId = warehouseId ?? auth.branchId;
  const res = await request.get(
    `${E2E_BACKEND_URL}/api/products/inventory-grid?branchId=${encodeURIComponent(branchId)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.rows ?? []);
  const row = rows.find((r: { id?: string; product_id?: string; sku?: string }) =>
    r.id === productId || r.product_id === productId,
  );
  if (row) return Number(row.stock ?? row.quantity ?? 0);

  const productRes = await request.get(`${E2E_BACKEND_URL}/api/products/${productId}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(productRes.ok()).toBeTruthy();
  const product = await productRes.json();
  const sku = String(product.sku || '').trim();
  if (sku) {
    const skuRow = rows.find((r: { sku?: string }) => String(r.sku || '').trim() === sku);
    if (skuRow) return Number(skuRow.stock ?? skuRow.quantity ?? 0);
  }
  return Number(product.stock ?? 0);
}

export async function fetchStockMovements(
  request: APIRequestContext,
  auth: E2eAuthContext,
  filters: { productId?: string; referenceType?: string; warehouseId?: string } = {},
) {
  const params = new URLSearchParams();
  if (filters.productId) params.set('productId', filters.productId);
  if (filters.referenceType) params.set('referenceType', filters.referenceType);
  params.set('warehouseId', filters.warehouseId ?? auth.branchId);

  const res = await request.get(`${E2E_BACKEND_URL}/api/transactions/stock-movements?${params}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchSupplierBalance(
  request: APIRequestContext,
  auth: E2eAuthContext,
  supplierId: string,
): Promise<number> {
  const res = await request.get(
    `${E2E_BACKEND_URL}/api/payments/balance/supplier/${encodeURIComponent(supplierId)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return Number(body.balance ?? 0);
}

export async function fetchOpenItemsForSupplier(
  request: APIRequestContext,
  auth: E2eAuthContext,
  supplierId: string,
) {
  const res = await request.get(
    `${E2E_BACKEND_URL}/api/payments/open-items/supplier/${encodeURIComponent(supplierId)}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchJournalEntries(
  request: APIRequestContext,
  auth: E2eAuthContext,
  filters: { description?: string; referenceType?: string } = {},
) {
  const params = new URLSearchParams({ branchId: auth.branchId, limit: '500' });
  if (filters.referenceType) params.set('referenceType', filters.referenceType);

  const res = await request.get(`${E2E_BACKEND_URL}/api/journal-entries?${params}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const rows = await res.json();
  const entries = Array.isArray(rows) ? rows : (rows.items ?? rows.data ?? []);
  if (!filters.description) return entries;
  const needle = filters.description.toLowerCase();
  return entries.filter((e: { description?: string }) =>
    String(e.description || '').toLowerCase().includes(needle),
  );
}

export async function fetchChartOfAccounts(
  request: APIRequestContext,
  auth: E2eAuthContext,
) {
  const res = await request.get(`${E2E_BACKEND_URL}/api/chart-of-accounts`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function syncChartOfAccountsToPage(
  page: Page,
  request: APIRequestContext,
  auth: E2eAuthContext,
) {
  const accounts = await fetchChartOfAccounts(request, auth);
  await page.evaluate((data) => {
    localStorage.setItem('kwanzaerp_chart_of_accounts', JSON.stringify(data));
  }, accounts);
}
