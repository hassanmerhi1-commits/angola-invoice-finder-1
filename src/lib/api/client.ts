import { generateId } from '@/lib/utils';
// NEXOR ERP API Client — API-first transaction routing
// Transactional writes always use the backend HTTP API so browser and desktop share the same execution path
// Electron IPC stays available only for desktop-only utilities and non-transactional reads

import { getApiUrl, isDemoMode } from './config';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

// ==================== MODE DETECTION ====================
export function isElectronMode(): boolean {
  return !!window.electronAPI?.isElectron && !!window.electronAPI?.db;
}

// ==================== AUTH (localStorage-based for both modes) ====================
function getAuthToken(): string | null {
  return localStorage.getItem('kwanza_auth_token');
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem('kwanza_auth_token', token);
  } else {
    localStorage.removeItem('kwanza_auth_token');
  }
}

// ==================== IPC DATABASE HELPERS ====================
async function ipcGetAll<T>(table: string): Promise<ApiResponse<T[]>> {
  try {
    const result = await window.electronAPI!.db.getAll(table);
    return { data: (result.data || []) as T[] };
  } catch (e: any) {
    return { error: e.message || 'IPC error' };
  }
}

async function ipcQuery<T>(sql: string, params: any[] = []): Promise<ApiResponse<T[]>> {
  try {
    const result = await window.electronAPI!.db.query(sql, params);
    return { data: (result.data || []) as T[] };
  } catch (e: any) {
    return { error: e.message || 'IPC query error' };
  }
}

async function ipcInsert(table: string, data: any): Promise<ApiResponse<any>> {
  try {
    // Ensure ID
    if (!data.id) {
      data.id = generateId();
    }
    const result = await window.electronAPI!.db.insert(table, data);
    if (result.success) return { data };
    return { error: result.error || 'Insert failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC insert error' };
  }
}

async function ipcUpdate(table: string, id: string, data: any): Promise<ApiResponse<any>> {
  try {
    const result = await window.electronAPI!.db.update(table, id, data);
    if (result.success) return { data: { ...data, id } };
    return { error: result.error || 'Update failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC update error' };
  }
}

async function ipcDelete(table: string, id: string): Promise<ApiResponse<any>> {
  try {
    const result = await window.electronAPI!.db.delete(table, id);
    if (result.success) return { data: { success: true } };
    return { error: result.error || 'Delete failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC delete error' };
  }
}

// ==================== HTTP FALLBACK (web preview/demo) ====================
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // In demo mode (cloud preview), skip network calls entirely — fall back to localStorage
  if (isDemoMode()) {
    return { error: 'Demo mode — backend not available' };
  }

  const buildUrl = (base: string) => `${base}/api${endpoint}`;
  let baseUrl = getApiUrl();
  let url = buildUrl(baseUrl);
  const token = getAuthToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  
  try {
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      const errorMessage = typeof payload === 'string'
        ? payload
        : payload?.error || (Array.isArray(payload?.errors) ? payload.errors.join('; ') : payload?.message);

      return { error: errorMessage || `HTTP ${response.status}` };
    }

    return { data: payload as T };
  } catch (error) {
    // Electron retry: if backend port changed/stale, resolve fresh port from main process and retry once.
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
    if (isElectron && window.electronAPI?.backend?.getPort) {
      try {
        const freshPort = await window.electronAPI.backend.getPort();
        if (typeof freshPort === 'number' && freshPort > 0) {
          const freshBase = `http://localhost:${freshPort}`;
          if (freshBase !== baseUrl) {
            baseUrl = freshBase;
            url = buildUrl(baseUrl);
            const retryResponse = await fetch(url, { ...options, headers });
            const retryContentType = retryResponse.headers.get('content-type') || '';
            const retryIsJson = retryContentType.includes('application/json');
            const retryPayload = retryIsJson
              ? await retryResponse.json().catch(() => null)
              : await retryResponse.text().catch(() => '');
            if (!retryResponse.ok) {
              const retryErrorMessage = typeof retryPayload === 'string'
                ? retryPayload
                : retryPayload?.error || (Array.isArray(retryPayload?.errors) ? retryPayload.errors.join('; ') : retryPayload?.message);
              return { error: retryErrorMessage || `HTTP ${retryResponse.status}` };
            }
            return { data: retryPayload as T };
          }
        }
      } catch {
        // Ignore retry failure and return original error below.
      }
    }

    console.error(`[API ERROR] ${endpoint} url=${url}:`, error);
    return { error: error instanceof Error ? error.message : 'Network error' };
  }
}

function mapSupplierPayloadForElectron(data: any) {
  const now = new Date().toISOString();

  return {
    id: data.id || generateId(),
    name: data.name || '',
    nif: data.nif || '',
    email: data.email || '',
    phone: data.phone || '',
    address: data.address || '',
    city: data.city || '',
    country: data.country || 'Angola',
    contact_person: data.contactPerson ?? data.contact_person ?? '',
    payment_terms: data.paymentTerms ?? data.payment_terms ?? '30_days',
    is_active: data.isActive ?? data.is_active ?? true,
    notes: data.notes || '',
    balance: Number(data.balance || 0),
    created_at: data.createdAt ?? data.created_at ?? now,
    updated_at: data.updatedAt ?? data.updated_at ?? now,
  };
}

function mapProductPayloadForElectron(data: any) {
  const now = new Date().toISOString();
  const cost = Number(data.cost ?? 0);

  return {
    id: data.id || generateId(),
    name: data.name || '',
    sku: data.sku || '',
    barcode: data.barcode || '',
    category: data.category || 'GERAL',
    price: Number(data.price ?? 0),
    price_2: Number(data.price2 ?? data.price_2 ?? 0),
    price_3: Number(data.price3 ?? data.price_3 ?? 0),
    price_4: Number(data.price4 ?? data.price_4 ?? 0),
    cost,
    first_cost: Number(data.firstCost ?? data.first_cost ?? cost),
    last_cost: Number(data.lastCost ?? data.last_cost ?? cost),
    weighted_avg_cost: Number(data.avgCost ?? data.avg_cost ?? cost),
    stock: Number(data.stock ?? 0),
    unit: data.unit || 'UN',
    tax_rate: Number(data.taxRate ?? data.tax_rate ?? 14),
    branch_id: data.branchId === '' ? null : (data.branchId ?? data.branch_id ?? null),
    supplier_id: data.supplierId === '' ? null : (data.supplierId ?? data.supplier_id ?? null),
    is_active: data.isActive ?? data.is_active ?? true,
    created_at: data.createdAt ?? data.created_at ?? now,
    updated_at: data.updatedAt ?? data.updated_at ?? now,
  };
}

async function ensureSupplierSubAccountElectron(supplierName: string, supplierNif?: string): Promise<string | null> {
  if (!isElectronMode() || !supplierName) return null;

  try {
    const existing = await ipcQuery<any>(
      `SELECT code FROM chart_of_accounts
       WHERE code LIKE '3.2.%' AND level = 3 AND is_header = false
         AND (name = $1 OR ($2 IS NOT NULL AND $2 != '' AND description LIKE '%' || $2 || '%'))
       ORDER BY code
       LIMIT 1`,
      [supplierName, supplierNif || null]
    );

    if (existing.data?.[0]?.code) {
      return existing.data[0].code;
    }

    const parent = await ipcQuery<any>(
      `SELECT id FROM chart_of_accounts WHERE code = '3.2' AND is_active = true LIMIT 1`
    );

    const parentId = parent.data?.[0]?.id;
    if (!parentId) return null;

    const seqResult = await ipcQuery<any>(
      `SELECT COUNT(*)::int AS count
       FROM chart_of_accounts
       WHERE code LIKE '3.2.%' AND level = 3 AND is_header = false`
    );

    const nextSeq = Number(seqResult.data?.[0]?.count || 0) + 1;
    const code = `3.2.${String(nextSeq).padStart(3, '0')}`;

    const insertResult = await ipcInsert('chart_of_accounts', {
      id: generateId(),
      code,
      name: supplierName,
      description: supplierNif ? `NIF: ${supplierNif}` : '',
      account_type: 'liability',
      account_nature: 'credit',
      parent_id: parentId,
      level: 3,
      is_header: false,
      is_active: true,
      opening_balance: 0,
      current_balance: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertResult.error) {
      console.warn('[API] Failed to create supplier sub-account in Electron:', insertResult.error);
      return null;
    }

    return code;
  } catch (error) {
    console.warn('[API] Supplier sub-account sync skipped in Electron:', error);
    return null;
  }
}

// ==================== UNIFIED API ====================
export const api = {
  // Health check
  health: () => {
    if (isElectronMode()) {
      return window.electronAPI!.db.getStatus().then(status => ({
        data: { status: status.connected ? 'ok' : 'disconnected', timestamp: new Date().toISOString(), mode: status.mode }
      })).catch(() => ({ error: 'Health check failed' })) as Promise<ApiResponse<any>>;
    }
    return apiFetch<{ status: string; timestamp: string }>('/health');
  },

  // Auth
  auth: {
    login: async (email: string, password: string) => {
      if (isElectronMode()) {
        const result = await ipcQuery<any>(
          'SELECT * FROM users WHERE email = $1 AND is_active = true', [email]
        );
        if (result.data && result.data.length > 0) {
          const user = result.data[0];
          // Simple password check (in production, use bcrypt via IPC)
          if (user.password_hash === password || user.password === password) {
            const token = `local-${Date.now()}-${Math.random().toString(36).substr(2)}`;
            setAuthToken(token);
            return { data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } } };
          }
        }
        return { error: 'Credenciais inválidas' };
      }
      return apiFetch<{ token: string; user: any }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
    },
    me: () => {
      if (isElectronMode()) {
        const token = getAuthToken();
        if (!token) return Promise.resolve({ error: 'Not authenticated' }) as Promise<ApiResponse<any>>;
        return Promise.resolve({ data: JSON.parse(localStorage.getItem('kwanza_current_user') || '{}') }) as Promise<ApiResponse<any>>;
      }
      return apiFetch<any>('/auth/me');
    },
  },

  // Branches
  branches: {
    list: () => {
      if (isElectronMode()) return ipcGetAll('branches');
      return apiFetch<any[]>('/branches');
    },
    create: (data: any) => {
      if (isElectronMode()) {
        const branch = {
          id: generateId(),
          name: data.name,
          code: data.code || `FIL${Date.now().toString().slice(-4)}`,
          address: data.address || '',
          phone: data.phone || '',
          is_main: data.isMain || false,
          created_at: new Date().toISOString(),
        };
        return ipcInsert('branches', branch);
      }
      return apiFetch<any>('/branches', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) {
        return ipcUpdate('branches', id, {
          name: data.name,
          code: data.code || '',
          address: data.address || '',
          phone: data.phone || '',
          is_main: data.isMain,
        });
      }
      return apiFetch<any>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
  },

  // Products
  products: {
    list: async (branchId?: string) => {
      const endpoint = `/products${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`;
      return apiFetch<any[]>(endpoint);
    },
    create: async (data: any) => {
      return apiFetch<any>('/products', { method: 'POST', body: JSON.stringify(data) });
    },
    batchImport: async (products: any[]) => {
      return apiFetch<any>('/products/batch', { method: 'POST', body: JSON.stringify({ products }) });
    },
    update: async (id: string, data: any) => {
      return apiFetch<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    updateStock: (id: string, quantityChange: number) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING *',
          [quantityChange, id]
        ).then(r => ({ data: r.data?.[0] }));
      }
      return apiFetch<any>(`/products/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ quantityChange }) });
    },
    delete: async (id: string) => {
      return apiFetch<any>(`/products/${id}`, { method: 'DELETE' });
    },
  },

  // Sales
  sales: {
    list: async (branchId?: string) => {
      const endpoint = `/sales${branchId ? `?branchId=${branchId}` : ''}`;
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>(endpoint);
        if (apiResult.data !== undefined) return apiResult;
        const sql = branchId
          ? 'SELECT * FROM sales WHERE branch_id = $1 ORDER BY created_at DESC'
          : 'SELECT * FROM sales ORDER BY created_at DESC';
        const params = branchId ? [branchId] : [];
        return (async () => {
          const salesResult = await ipcQuery<any>(sql, params);
          if (salesResult.data) {
            for (const sale of salesResult.data) {
              const itemsResult = await ipcQuery<any>('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
              sale.items = itemsResult.data || [];
            }
          }
          return salesResult;
        })();
      }
      return apiFetch<any[]>(endpoint);
    },
    create: (data: any) => {
      return apiFetch<any>('/sales', { method: 'POST', body: JSON.stringify(data) });
    },
    generateInvoiceNumber: (branchCode: string) => {
      return apiFetch<{ invoiceNumber: string }>(`/sales/generate-invoice-number/${branchCode}`);
    },
  },

  // Clients
  clients: {
    list: () => {
      return apiFetch<any[]>('/customers');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('clients', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiFetch<any>('/clients', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('clients', id, data);
      return apiFetch<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('clients', id);
      return apiFetch<any>(`/clients/${id}`, { method: 'DELETE' });
    },
  },

  // Categories
  categories: {
    list: () => {
      if (isElectronMode()) return ipcGetAll('categories');
      return apiFetch<any[]>('/categories');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('categories', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiFetch<any>('/categories', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('categories', id, data);
      return apiFetch<any>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('categories', id);
      return apiFetch<any>(`/categories/${id}`, { method: 'DELETE' });
    },
  },

  // Suppliers
  suppliers: {
    list: async () => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>('/suppliers');
        if (apiResult.data !== undefined) return apiResult;
        return ipcQuery<any>('SELECT * FROM suppliers ORDER BY name');
      }
      return apiFetch<any[]>('/suppliers');
    },
    create: async (data: any) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) });
        if (apiResult.data) return apiResult;
        const payload = mapSupplierPayloadForElectron(data);
        const result = await ipcInsert('suppliers', payload);
        if (result.data) {
          await ensureSupplierSubAccountElectron(payload.name, payload.nif);
        }
        return result;
      }
      return apiFetch<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) });
    },
    batchImport: async (suppliers: any[]) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>('/suppliers/batch', { method: 'POST', body: JSON.stringify({ suppliers }) });
        if (apiResult.data) return apiResult;
        let imported = 0, failed = 0;
        const errors: any[] = [];

        for (const supplier of suppliers) {
          const payload = mapSupplierPayloadForElectron(supplier);

          try {
            const existing = await ipcQuery<any>(
              `SELECT id FROM suppliers
               WHERE (NULLIF($1, '') IS NOT NULL AND nif = $1)
                  OR name = $2
               ORDER BY created_at ASC
               LIMIT 1`,
              [payload.nif || '', payload.name]
            );

            const existingId = existing.data?.[0]?.id;
            const result = existingId
              ? await ipcUpdate('suppliers', existingId, {
                  ...payload,
                  id: undefined,
                  created_at: undefined,
                  updated_at: new Date().toISOString(),
                })
              : await ipcInsert('suppliers', payload);

            if (result.data) {
              await ensureSupplierSubAccountElectron(payload.name, payload.nif);
              imported++;
            } else {
              failed++;
              errors.push({ supplier: payload.name, error: result.error || 'Import failed' });
            }
          } catch (error: any) {
            failed++;
            errors.push({ supplier: payload.name, error: error.message || 'Import failed' });
          }
        }

        return { data: { imported, failed, errors } } as ApiResponse<any>;
      }
      return apiFetch<any>('/suppliers/batch', { method: 'POST', body: JSON.stringify({ suppliers }) });
    },
    update: async (id: string, data: any) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        if (apiResult.data) return apiResult;
        const payload = mapSupplierPayloadForElectron({ ...data, id, updated_at: new Date().toISOString() });
        delete payload.id;
        const result = await ipcUpdate('suppliers', id, payload);
        if (result.data) {
          await ensureSupplierSubAccountElectron(data.name || payload.name, data.nif || payload.nif);
        }
        return result;
      }
      return apiFetch<any>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: async (id: string) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>(`/suppliers/${id}`, { method: 'DELETE' });
        if (apiResult.data) return apiResult;
        return ipcDelete('suppliers', id);
      }
      return apiFetch<any>(`/suppliers/${id}`, { method: 'DELETE' });
    },
  },

  // Daily Reports
  dailyReports: {
    list: (branchId?: string) => {
      if (isElectronMode()) {
        if (branchId) return ipcQuery<any>('SELECT * FROM daily_reports WHERE branch_id = $1 ORDER BY report_date DESC', [branchId]);
        return ipcQuery<any>('SELECT * FROM daily_reports ORDER BY report_date DESC');
      }
      return apiFetch<any[]>(`/daily-reports${branchId ? `?branchId=${branchId}` : ''}`);
    },
    generate: (branchId: string, date: string) => {
      if (isElectronMode()) {
        return ipcInsert('daily_reports', {
          id: generateId(), branch_id: branchId, report_date: date,
          status: 'open', created_at: new Date().toISOString(),
        });
      }
      return apiFetch<any>('/daily-reports/generate', { method: 'POST', body: JSON.stringify({ branchId, date }) });
    },
    close: (id: string, data: { closingBalance: number; notes: string; closedBy: string }) => {
      if (isElectronMode()) {
        return ipcUpdate('daily_reports', id, {
          status: 'closed', closing_balance: data.closingBalance,
          notes: data.notes, closed_by: data.closedBy,
          closed_at: new Date().toISOString(),
        });
      }
      return apiFetch<any>(`/daily-reports/${id}/close`, { method: 'POST', body: JSON.stringify(data) });
    },
  },

  // Stock Transfers
  stockTransfers: {
    list: async (branchId?: string) => {
      const endpoint = `/stock-transfers${branchId ? `?branchId=${branchId}` : ''}`;
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>(endpoint);
        if (apiResult.data !== undefined) return apiResult;
        return (async () => {
          const transfersResult = branchId
            ? await ipcQuery<any>(
                'SELECT * FROM stock_transfers WHERE from_branch_id = $1 OR to_branch_id = $1 ORDER BY created_at DESC',
                [branchId],
              )
            : await ipcQuery<any>('SELECT * FROM stock_transfers ORDER BY created_at DESC');

          if (!transfersResult.data) return transfersResult;

          const transfersWithItems = await Promise.all(
            transfersResult.data.map(async (transfer: any) => {
              const itemsResult = await ipcQuery<any>(
                'SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY created_at ASC NULLS LAST, id ASC',
                [transfer.id],
              );

              return {
                ...transfer,
                items: itemsResult.data || [],
              };
            }),
          );

          return { data: transfersWithItems } as ApiResponse<any[]>;
        })();
      }
      return apiFetch<any[]>(endpoint);
    },
    create: (data: any) => {
      return apiFetch<any>('/stock-transfers', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, approvedBy: string) => {
      return apiFetch<any>(`/stock-transfers/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy }) });
    },
    receive: (id: string, receivedBy: string, receivedQuantities?: Record<string, number>) => {
      return apiFetch<any>(`/stock-transfers/${id}/receive`, { method: 'POST', body: JSON.stringify({ receivedBy, receivedQuantities }) });
    },
  },

  // Purchase Orders
  purchaseOrders: {
    list: async (branchId?: string) => {
      const apiResult = await apiFetch<any[]>(`/purchase-orders${branchId ? `?branchId=${branchId}` : ''}`);
      if (apiResult.data !== undefined || !isElectronMode()) return apiResult;

      const ordersResult = branchId
        ? await ipcQuery<any>('SELECT * FROM purchase_orders WHERE branch_id = $1 ORDER BY created_at DESC', [branchId])
        : await ipcQuery<any>('SELECT * FROM purchase_orders ORDER BY created_at DESC');

      if (!ordersResult.data) return ordersResult;

      const ordersWithItems = await Promise.all(
        ordersResult.data.map(async (order: any) => {
          const itemsResult = await ipcQuery<any>('SELECT * FROM purchase_order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
          return { ...order, items: itemsResult.data || [] };
        })
      );

      return { data: ordersWithItems };
    },
    create: (data: any) => {
      return apiFetch<any>('/purchase-orders', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, approvedBy: string) => {
      return apiFetch<any>(`/purchase-orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy }) });
    },
    receive: (id: string, receivedBy: string, receivedQuantities: Record<string, number>) => {
      return apiFetch<any>(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ receivedBy, receivedQuantities }) });
    },
  },

  // Chart of Accounts
  chartOfAccounts: {
    list: () => {
      return apiFetch<any[]>('/accounts');
    },
    get: (id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE id = $1', [id]).then(r => ({ data: r.data?.[0] }));
      return apiFetch<any>(`/chart-of-accounts/${id}`);
    },
    getByType: (type: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE account_type = $1 ORDER BY code', [type]);
      return apiFetch<any[]>(`/chart-of-accounts/type/${type}`);
    },
    getChildren: (id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE parent_id = $1 ORDER BY code', [id]);
      return apiFetch<any[]>(`/chart-of-accounts/${id}/children`);
    },
    getBalance: (id: string, startDate?: string, endDate?: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE id = $1', [id]).then(r => ({ data: r.data?.[0] }));
      }
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      return apiFetch<any>(`/chart-of-accounts/${id}/balance?${params}`);
    },
    getTrialBalance: (startDate?: string, endDate?: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT ca.*, 
           COALESCE(SUM(jl.debit_amount), 0) as total_debit,
           COALESCE(SUM(jl.credit_amount), 0) as total_credit
           FROM chart_of_accounts ca
           LEFT JOIN journal_entry_lines jl ON jl.account_id = ca.id
           LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.is_posted = true
           WHERE ca.is_active = true
           GROUP BY ca.id
           ORDER BY ca.code`
        );
      }
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      return apiFetch<any[]>(`/chart-of-accounts/reports/trial-balance?${params}`);
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('chart_of_accounts', { id: generateId(), ...data, is_active: true, current_balance: 0, created_at: new Date().toISOString() });
      return apiFetch<any>('/chart-of-accounts', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('chart_of_accounts', id, data);
      return apiFetch<any>(`/chart-of-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('chart_of_accounts', id);
      return apiFetch<any>(`/chart-of-accounts/${id}`, { method: 'DELETE' });
    },
    getLedger: (id: string, startDate?: string, endDate?: string) => {
      if (isElectronMode()) {
        let sql = `
          SELECT jel.*, je.entry_number, je.entry_date, je.description as journal_description,
                 je.reference_type, je.reference_id, je.is_posted, je.created_at as journal_created_at
          FROM journal_entry_lines jel
          INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE jel.account_id = $1 AND je.is_posted = true
        `;
        const params: any[] = [id];
        if (startDate && endDate) {
          sql += ' AND je.entry_date BETWEEN $2 AND $3';
          params.push(startDate, endDate);
        }
        sql += ' ORDER BY je.entry_date DESC, je.created_at DESC';
        return ipcQuery<any>(sql, params);
      }
      const p = new URLSearchParams();
      if (startDate) p.append('start_date', startDate);
      if (endDate) p.append('end_date', endDate);
      return apiFetch<any[]>(`/chart-of-accounts/${id}/ledger?${p}`);
    },
  },

  // Journal Entries
  journalEntries: {
    list: (params?: { branchId?: string; referenceType?: string; startDate?: string; endDate?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM journal_entries WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.branchId) { sql += ` AND branch_id = $${idx++}`; sqlParams.push(params.branchId); }
        if (params?.referenceType) { sql += ` AND reference_type = $${idx++}`; sqlParams.push(params.referenceType); }
        if (params?.startDate) { sql += ` AND entry_date >= $${idx++}`; sqlParams.push(params.startDate); }
        if (params?.endDate) { sql += ` AND entry_date <= $${idx++}`; sqlParams.push(params.endDate); }
        sql += ' ORDER BY entry_date DESC, created_at DESC';
        return ipcQuery<any>(sql, sqlParams);
      }
      const searchParams = new URLSearchParams();
      if (params?.branchId) searchParams.append('branchId', params.branchId);
      if (params?.referenceType) searchParams.append('referenceType', params.referenceType);
      if (params?.startDate) searchParams.append('startDate', params.startDate);
      if (params?.endDate) searchParams.append('endDate', params.endDate);
      return apiFetch<any[]>(`/journal-entries?${searchParams}`);
    },
    get: (id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM journal_entries WHERE id = $1', [id]).then(r => ({ data: r.data?.[0] }));
      return apiFetch<any>(`/journal-entries/${id}`);
    },
    getByReference: (type: string, id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM journal_entries WHERE reference_type = $1 AND reference_id = $2', [type, id]);
      return apiFetch<any[]>(`/journal-entries/reference/${type}/${id}`);
    },
    summary: (params?: { branchId?: string; startDate?: string; endDate?: string }) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT reference_type, COUNT(*) as count, 
           SUM(total_debit) as total_debit, SUM(total_credit) as total_credit
           FROM journal_entries WHERE is_posted = true
           GROUP BY reference_type ORDER BY reference_type`
        );
      }
      const searchParams = new URLSearchParams();
      if (params?.branchId) searchParams.append('branchId', params.branchId);
      if (params?.startDate) searchParams.append('startDate', params.startDate);
      if (params?.endDate) searchParams.append('endDate', params.endDate);
      return apiFetch<any[]>(`/journal-entries/reports/summary?${searchParams}`);
    },
  },

  // Payments & Open Items
  payments: {
    list: (params?: { entityType?: string; entityId?: string; branchId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM payments WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.entityType) { sql += ` AND entity_type = $${idx++}`; sqlParams.push(params.entityType); }
        if (params?.entityId) { sql += ` AND entity_id = $${idx++}`; sqlParams.push(params.entityId); }
        if (params?.branchId) { sql += ` AND branch_id = $${idx++}`; sqlParams.push(params.branchId); }
        sql += ' ORDER BY created_at DESC';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.entityType) sp.append('entityType', params.entityType);
      if (params?.entityId) sp.append('entityId', params.entityId);
      if (params?.branchId) sp.append('branchId', params.branchId);
      return apiFetch<any[]>(`/payments?${sp}`);
    },
    create: (data: any) => {
      return apiFetch<any>('/payments', { method: 'POST', body: JSON.stringify(data) });
    },
    openItems: (entityType: string, entityId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        "SELECT * FROM open_items WHERE entity_type = $1 AND entity_id = $2 AND status != 'cleared' ORDER BY document_date ASC",
        [entityType, entityId]
      );
      if (isDemoMode()) {
        const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId && oi.status !== 'cleared')
          .sort((a: any, b: any) => `${a.documentDate || ''}${a.createdAt || ''}`.localeCompare(`${b.documentDate || ''}${b.createdAt || ''}`));
        return Promise.resolve({ data: items }) as Promise<ApiResponse<any[]>>;
      }
      return apiFetch<any[]>(`/payments/open-items/${entityType}/${entityId}`);
    },
    balance: (entityType: string, entityId: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT COALESCE(SUM(CASE WHEN is_debit THEN remaining_amount ELSE -remaining_amount END), 0) as balance
           FROM open_items WHERE entity_type = $1 AND entity_id = $2 AND status != 'cleared'`,
          [entityType, entityId]
        ).then(r => ({ data: r.data?.[0] }));
      }
      if (isDemoMode()) {
        const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId && oi.status !== 'cleared');
        const balance = items.reduce((sum: number, oi: any) => {
          const remaining = Number(oi.remainingAmount ?? oi.originalAmount ?? 0);
          return sum + (oi.isDebit ? remaining : -remaining);
        }, 0);
        return Promise.resolve({ data: { balance, open_items_count: items.length } }) as Promise<ApiResponse<any>>;
      }
      return apiFetch<any>(`/payments/balance/${entityType}/${entityId}`);
    },
    statement: (entityType: string, entityId: string, dateFrom?: string, dateTo?: string) => {
      if (isElectronMode()) {
        // Build combined query for electron mode
        return (async () => {
          const oiParams: any[] = [entityType, entityId];
          let oiSql = `SELECT id, document_type, document_id, document_number, document_date, due_date,
                        original_amount, remaining_amount, is_debit, status, created_at
                        FROM open_items WHERE entity_type = $1 AND entity_id = $2`;
          let idx = 3;
          if (dateFrom) { oiSql += ` AND document_date >= $${idx++}`; oiParams.push(dateFrom); }
          if (dateTo)   { oiSql += ` AND document_date <= $${idx++}`; oiParams.push(dateTo); }
          oiSql += ' ORDER BY document_date ASC, created_at ASC';

          const pParams: any[] = [entityType, entityId];
          let pSql = `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at
                      FROM payments WHERE entity_type = $1 AND entity_id = $2`;
          idx = 3;
          if (dateFrom) { pSql += ` AND created_at >= $${idx++}`; pParams.push(dateFrom); }
          if (dateTo)   { pSql += ` AND created_at <= $${idx++}`; pParams.push(dateTo + 'T23:59:59'); }
          pSql += ' ORDER BY created_at ASC';

          const [oiRes, pRes, balRes] = await Promise.all([
            ipcQuery<any>(oiSql, oiParams),
            ipcQuery<any>(pSql, pParams),
            ipcQuery<any>(`SELECT * FROM v_entity_balance WHERE entity_type = $1 AND entity_id = $2`, [entityType, entityId]),
          ]);

          return { data: { openItems: oiRes.data || [], payments: pRes.data || [], balance: balRes.data?.[0] || { balance: 0 } } } as ApiResponse<any>;
        })();
      }
      if (isDemoMode()) {
        const openItems = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId)
          .filter((oi: any) => !dateFrom || oi.documentDate >= dateFrom)
          .filter((oi: any) => !dateTo || oi.documentDate <= dateTo)
          .sort((a: any, b: any) => `${a.documentDate || ''}${a.createdAt || ''}`.localeCompare(`${b.documentDate || ''}${b.createdAt || ''}`));

        const payments = JSON.parse(localStorage.getItem('kwanzaerp_payments') || '[]')
          .filter((payment: any) => payment.entityType === entityType && payment.entityId === entityId)
          .filter((payment: any) => !dateFrom || payment.createdAt >= dateFrom)
          .filter((payment: any) => !dateTo || payment.createdAt <= `${dateTo}T23:59:59`)
          .sort((a: any, b: any) => (a.createdAt || '').localeCompare(b.createdAt || ''));

        const balance = openItems.reduce((sum: number, oi: any) => {
          const remaining = Number(oi.remainingAmount ?? oi.originalAmount ?? 0);
          return sum + (oi.isDebit ? remaining : -remaining);
        }, 0);

        return Promise.resolve({
          data: {
            openItems,
            payments,
            balance: { balance, open_items_count: openItems.filter((oi: any) => oi.status !== 'cleared').length },
          },
        }) as Promise<ApiResponse<any>>;
      }
      const sp = new URLSearchParams();
      if (dateFrom) sp.append('dateFrom', dateFrom);
      if (dateTo) sp.append('dateTo', dateTo);
      return apiFetch<any>(`/payments/statement/${entityType}/${entityId}?${sp}`);
    },
    periods: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM accounting_periods ORDER BY year DESC, month DESC');
      return apiFetch<any[]>('/payments/periods');
    },
    closePeriod: (id: string, closedBy: string) => {
      if (isElectronMode()) return ipcUpdate('accounting_periods', id, { status: 'closed', closed_by: closedBy, closed_at: new Date().toISOString() });
      return apiFetch<any>(`/payments/periods/${id}/close`, { method: 'POST', body: JSON.stringify({ closedBy }) });
    },
    stockMovements: (params?: { productId?: string; warehouseId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT sm.*, p.name as product_name, p.sku FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.productId) { sql += ` AND sm.product_id = $${idx++}`; sqlParams.push(params.productId); }
        if (params?.warehouseId) { sql += ` AND sm.warehouse_id = $${idx++}`; sqlParams.push(params.warehouseId); }
        sql += ' ORDER BY sm.created_at DESC LIMIT 500';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.productId) sp.append('productId', params.productId);
      if (params?.warehouseId) sp.append('warehouseId', params.warehouseId);
      return apiFetch<any[]>(`/payments/stock-movements?${sp}`);
    },
    documentFlow: (docType: string, docId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM document_links WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)',
        [docType, docId]
      );
      return apiFetch<any[]>(`/payments/document-flow/${docType}/${docId}`);
    },
  },

  // Tax Engine
  tax: {
    codes: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM tax_codes ORDER BY code');
      return apiFetch<any[]>('/tax/codes');
    },
    createCode: (data: any) => {
      if (isElectronMode()) return ipcInsert('tax_codes', { id: generateId(), ...data });
      return apiFetch<any>('/tax/codes', { method: 'POST', body: JSON.stringify(data) });
    },
    updateCode: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('tax_codes', id, data);
      return apiFetch<any>(`/tax/codes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    taxLines: (docType: string, docId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM tax_summaries WHERE document_type = $1 AND document_id = $2', [docType, docId]
      );
      return apiFetch<any[]>(`/tax/lines/${docType}/${docId}`);
    },
    ivaReport: (year?: number, month?: number) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM tax_summaries WHERE 1=1';
        const params: any[] = [];
        let idx = 1;
        if (year) { sql += ` AND period_year = $${idx++}`; params.push(year); }
        if (month) { sql += ` AND period_month = $${idx++}`; params.push(month); }
        return ipcQuery<any>(sql, params).then(r => ({ data: r.data }));
      }
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<any>(`/tax/iva-report?${sp}`);
    },
    summary: (year?: number, month?: number) => {
      if (isElectronMode()) {
        let sql = `SELECT tax_code, direction, SUM(total_base) as total_base, SUM(total_tax) as total_tax
                   FROM tax_summaries WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;
        if (year) { sql += ` AND period_year = $${idx++}`; params.push(year); }
        if (month) { sql += ` AND period_month = $${idx++}`; params.push(month); }
        sql += ' GROUP BY tax_code, direction';
        return ipcQuery<any>(sql, params);
      }
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<any[]>(`/tax/summary?${sp}`);
    },
  },

  // Audit Trail
  audit: {
    list: (params?: { tableName?: string; action?: string; userId?: string; startDate?: string; endDate?: string; limit?: number }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM audit_logs WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.tableName) { sql += ` AND entity_type = $${idx++}`; sqlParams.push(params.tableName); }
        if (params?.action) { sql += ` AND action = $${idx++}`; sqlParams.push(params.action); }
        if (params?.userId) { sql += ` AND user_id = $${idx++}`; sqlParams.push(params.userId); }
        sql += ` ORDER BY timestamp DESC LIMIT $${idx++}`;
        sqlParams.push(params?.limit || 100);
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.tableName) sp.append('tableName', params.tableName);
      if (params?.action) sp.append('action', params.action);
      if (params?.userId) sp.append('userId', params.userId);
      if (params?.startDate) sp.append('startDate', params.startDate);
      if (params?.endDate) sp.append('endDate', params.endDate);
      if (params?.limit) sp.append('limit', params.limit.toString());
      return apiFetch<any[]>(`/audit?${sp}`);
    },
    recordHistory: (tableName: string, recordId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM audit_logs WHERE entity_type = $1 AND entity_id = $2 ORDER BY timestamp DESC', [tableName, recordId]
      );
      return apiFetch<any[]>(`/audit/record/${tableName}/${recordId}`);
    },
    stats: (days?: number) => {
      if (isElectronMode()) return ipcQuery<any>(
        `SELECT entity_type, action, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= NOW() - INTERVAL '${days || 30} days' 
         GROUP BY entity_type, action ORDER BY count DESC`
      );
      return apiFetch<any[]>(`/audit/stats?days=${days || 30}`);
    },
  },

  // Budgets & Cost Centers
  budgets: {
    costCenters: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM cost_centers ORDER BY name');
      return apiFetch<any[]>('/budgets/cost-centers');
    },
    createCostCenter: (data: any) => {
      if (isElectronMode()) return ipcInsert('cost_centers', { id: generateId(), ...data });
      return apiFetch<any>('/budgets/cost-centers', { method: 'POST', body: JSON.stringify(data) });
    },
    list: (params?: { year?: number; month?: number; costCenterId?: string }) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM budgets ORDER BY year DESC, month DESC');
      const sp = new URLSearchParams();
      if (params?.year) sp.append('year', params.year.toString());
      if (params?.month) sp.append('month', params.month.toString());
      if (params?.costCenterId) sp.append('costCenterId', params.costCenterId);
      return apiFetch<any[]>(`/budgets/budgets?${sp}`);
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('budgets', { id: generateId(), ...data });
      return apiFetch<any>('/budgets/budgets', { method: 'POST', body: JSON.stringify(data) });
    },
    summary: (year?: number) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM budgets WHERE year = $1 ORDER BY month', [year || new Date().getFullYear()]
      );
      return apiFetch<any[]>(`/budgets/summary?year=${year || new Date().getFullYear()}`);
    },
  },

  // Approvals
  approvals: {
    workflows: (documentType?: string) => {
      if (isElectronMode()) {
        if (documentType) return ipcQuery<any>('SELECT * FROM approval_workflows WHERE document_type = $1', [documentType]);
        return ipcQuery<any>('SELECT * FROM approval_workflows ORDER BY created_at DESC');
      }
      const sp = documentType ? `?documentType=${documentType}` : '';
      return apiFetch<any[]>(`/approvals/workflows${sp}`);
    },
    createWorkflow: (data: any) => {
      if (isElectronMode()) return ipcInsert('approval_workflows', { id: generateId(), ...data });
      return apiFetch<any>('/approvals/workflows', { method: 'POST', body: JSON.stringify(data) });
    },
    requests: (params?: { status?: string; documentType?: string; branchId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM approval_requests WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.status) { sql += ` AND status = $${idx++}`; sqlParams.push(params.status); }
        if (params?.documentType) { sql += ` AND document_type = $${idx++}`; sqlParams.push(params.documentType); }
        if (params?.branchId) { sql += ` AND branch_id = $${idx++}`; sqlParams.push(params.branchId); }
        sql += ' ORDER BY created_at DESC';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.status) sp.append('status', params.status);
      if (params?.documentType) sp.append('documentType', params.documentType);
      if (params?.branchId) sp.append('branchId', params.branchId);
      return apiFetch<any[]>(`/approvals/requests?${sp}`);
    },
    submitRequest: (data: any) => {
      if (isElectronMode()) return ipcInsert('approval_requests', { id: generateId(), ...data, status: 'pending', created_at: new Date().toISOString() });
      return apiFetch<any>('/approvals/requests', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, userId: string, userName: string, comments?: string) => {
      if (isElectronMode()) return ipcUpdate('approval_requests', id, {
        status: 'approved', approved_by: userId, approver_name: userName,
        comments: comments || '', approved_at: new Date().toISOString(),
      });
      return apiFetch<any>(`/approvals/requests/${id}/approve`, {
        method: 'POST', body: JSON.stringify({ userId, userName, comments }),
      });
    },
    reject: (id: string, userId: string, userName: string, comments: string) => {
      if (isElectronMode()) return ipcUpdate('approval_requests', id, {
        status: 'rejected', rejected_by: userId, rejector_name: userName,
        comments, rejected_at: new Date().toISOString(),
      });
      return apiFetch<any>(`/approvals/requests/${id}/reject`, {
        method: 'POST', body: JSON.stringify({ userId, userName, comments }),
      });
    },
    pendingCount: () => {
      if (isElectronMode()) return ipcQuery<any>("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'");
      return apiFetch<any[]>('/approvals/pending-count');
    },
  },

  // SAF-T AO
  saft: {
    generate: (year?: number, startDate?: string, endDate?: string) => {
      // SAF-T generation is complex — needs full data export, works same in both modes
      if (isElectronMode()) {
        return (async () => {
          const sales = await ipcQuery<any>('SELECT * FROM sales ORDER BY created_at');
          const products = await ipcQuery<any>('SELECT * FROM products ORDER BY name');
          const clients = await ipcQuery<any>('SELECT * FROM clients ORDER BY name');
          const suppliers = await ipcQuery<any>('SELECT * FROM suppliers ORDER BY name');
          const journals = await ipcQuery<any>('SELECT * FROM journal_entries ORDER BY entry_date');
          return { data: { sales: sales.data, products: products.data, clients: clients.data, suppliers: suppliers.data, journals: journals.data } };
        })();
      }
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (startDate) sp.append('startDate', startDate);
      if (endDate) sp.append('endDate', endDate);
      return apiFetch<any>(`/saft/generate?${sp}`);
    },
    summary: (year?: number) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT 
           (SELECT COUNT(*) FROM sales) as total_sales,
           (SELECT COALESCE(SUM(total), 0) FROM sales) as total_revenue,
           (SELECT COUNT(*) FROM products) as total_products,
           (SELECT COUNT(*) FROM clients) as total_clients`
        ).then(r => ({ data: r.data?.[0] }));
      }
      return apiFetch<any>(`/saft/summary?year=${year || new Date().getFullYear()}`);
    },
  },

  // Dashboard KPIs
  dashboard: {
    kpis: (branchId?: string) => {
      if (isElectronMode()) {
        return (async () => {
          const today = new Date().toISOString().split('T')[0];
          const monthStart = today.slice(0, 7) + '-01';
          
          const branchFilter = branchId ? ` AND branch_id = '${branchId}'` : '';
          
          const todaySales = await ipcQuery<any>(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) = $1${branchFilter}`, [today]
          );
          const monthSales = await ipcQuery<any>(
            `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE created_at >= $1${branchFilter}`, [monthStart]
          );
          const productCount = await ipcQuery<any>(`SELECT COUNT(*) as count FROM products WHERE 1=1${branchFilter}`);
          const lowStock = await ipcQuery<any>(`SELECT COUNT(*) as count FROM products WHERE stock <= min_stock AND min_stock > 0${branchFilter}`);

          return {
            data: {
              todaySalesCount: parseInt(todaySales.data?.[0]?.count || '0'),
              todaySalesTotal: parseFloat(todaySales.data?.[0]?.total || '0'),
              monthSalesCount: parseInt(monthSales.data?.[0]?.count || '0'),
              monthSalesTotal: parseFloat(monthSales.data?.[0]?.total || '0'),
              productCount: parseInt(productCount.data?.[0]?.count || '0'),
              lowStockCount: parseInt(lowStock.data?.[0]?.count || '0'),
            }
          };
        })();
      }
      return apiFetch<any>(`/dashboard${branchId ? `?branchId=${branchId}` : ''}`);
    },
  },

  // Exchange Rates
  exchangeRates: {
    list: (limit?: number) => {
      if (isElectronMode()) return ipcQuery<any>(`SELECT * FROM exchange_rates ORDER BY effective_date DESC LIMIT ${limit || 50}`);
      const sp = limit ? `?limit=${limit}` : '';
      return apiFetch<any[]>(`/exchange-rates${sp}`);
    },
    latest: () => {
      if (isElectronMode()) return ipcQuery<any>(
        `SELECT DISTINCT ON (from_currency, to_currency) * FROM exchange_rates ORDER BY from_currency, to_currency, effective_date DESC`
      );
      return apiFetch<any[]>('/exchange-rates/latest');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('exchange_rates', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiFetch<any>('/exchange-rates', { method: 'POST', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('exchange_rates', id);
      return apiFetch<any>(`/exchange-rates/${id}`, { method: 'DELETE' });
    },
    convert: (from: string, to: string, amount: number, date?: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT rate FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2 ORDER BY effective_date DESC LIMIT 1`,
          [from, to]
        ).then(r => {
          const rate = parseFloat(r.data?.[0]?.rate || '1');
          return { data: { convertedAmount: amount * rate, rate } };
        });
      }
      const sp = new URLSearchParams({ from, to, amount: amount.toString() });
      if (date) sp.append('date', date);
      return apiFetch<any>(`/exchange-rates/convert?${sp}`);
    },
  },

  // SAF-T XML
  saftXml: {
    downloadUrl: (year?: number) => {
      const baseUrl = getApiUrl();
      const sp = year ? `?year=${year}` : '';
      return `${baseUrl}/api/saft-xml/download${sp}`;
    },
  },

  // Users
  users: {
    list: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT id, name, email, role, branch_id, is_active, created_at FROM users ORDER BY name');
      return apiFetch<any[]>('/auth/users');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('users', {
        id: generateId(), ...data,
        password_hash: data.password || data.password_hash || '',
        is_active: true, created_at: new Date().toISOString(),
      });
      return apiFetch<any>('/auth/users', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('users', id, data);
      return apiFetch<any>(`/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('users', id);
      return apiFetch<any>(`/auth/users/${id}`, { method: 'DELETE' });
    },
  },

  // Transactions (Central Transaction Engine)
  transactions: {
    process: (data: any) => {
      return apiFetch<any>('/transactions/process', { method: 'POST', body: JSON.stringify(data) });
    },
    stockMovements: (params?: { productId?: string; warehouseId?: string; referenceType?: string; limit?: number }) => {
      const sp = new URLSearchParams();
      if (params?.productId) sp.append('productId', params.productId);
      if (params?.warehouseId) sp.append('warehouseId', params.warehouseId);
      if (params?.referenceType) sp.append('referenceType', params.referenceType);
      if (params?.limit) sp.append('limit', params.limit.toString());

      if (isElectronMode()) {
        return apiFetch<any[]>(`/transactions/stock-movements?${sp}`).then(result => {
          if (result.data !== undefined) return result;
          let sql = 'SELECT sm.*, p.name as product_name, p.sku FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id WHERE 1=1';
          const sqlParams: any[] = [];
          let idx = 1;
          if (params?.productId) { sql += ` AND sm.product_id = $${idx++}`; sqlParams.push(params.productId); }
          if (params?.warehouseId) { sql += ` AND sm.warehouse_id = $${idx++}`; sqlParams.push(params.warehouseId); }
          if (params?.referenceType) { sql += ` AND sm.reference_type = $${idx++}`; sqlParams.push(params.referenceType); }
          sql += ` ORDER BY sm.created_at DESC LIMIT $${idx}`;
          sqlParams.push(params?.limit || 500);
          return ipcQuery<any>(sql, sqlParams);
        });
      }
      return apiFetch<any[]>(`/transactions/stock-movements?${sp}`);
    },
    createStockMovement: (data: any) => {
      return apiFetch<any>('/transactions/stock-movements', { method: 'POST', body: JSON.stringify(data) });
    },
    openItems: (params?: { entityType?: string; entityId?: string; branchId?: string; status?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM open_items WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.entityType) { sql += ` AND entity_type = $${idx++}`; sqlParams.push(params.entityType); }
        if (params?.entityId) { sql += ` AND entity_id = $${idx++}`; sqlParams.push(params.entityId); }
        if (params?.branchId) { sql += ` AND branch_id = $${idx++}`; sqlParams.push(params.branchId); }
        if (params?.status) { sql += ` AND status = $${idx++}`; sqlParams.push(params.status); }
        else { sql += ` AND status != 'cleared'`; }
        sql += ' ORDER BY document_date ASC';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.entityType) sp.append('entityType', params.entityType);
      if (params?.entityId) sp.append('entityId', params.entityId);
      if (params?.branchId) sp.append('branchId', params.branchId);
      if (params?.status) sp.append('status', params.status);
      return apiFetch<any[]>(`/transactions/open-items?${sp}`);
    },
    documentLinks: (params?: { sourceType?: string; sourceId?: string; targetType?: string; targetId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM document_links WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.sourceType) { sql += ` AND source_type = $${idx++}`; sqlParams.push(params.sourceType); }
        if (params?.sourceId) { sql += ` AND source_id = $${idx++}`; sqlParams.push(params.sourceId); }
        if (params?.targetType) { sql += ` AND target_type = $${idx++}`; sqlParams.push(params.targetType); }
        if (params?.targetId) { sql += ` AND target_id = $${idx++}`; sqlParams.push(params.targetId); }
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.sourceType) sp.append('sourceType', params.sourceType);
      if (params?.sourceId) sp.append('sourceId', params.sourceId);
      if (params?.targetType) sp.append('targetType', params.targetType);
      if (params?.targetId) sp.append('targetId', params.targetId);
      return apiFetch<any[]>(`/transactions/document-links?${sp}`);
    },
  },
};
