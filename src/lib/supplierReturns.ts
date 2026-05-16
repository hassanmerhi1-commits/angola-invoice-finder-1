// Supplier Returns Types and Storage — API-first (Express SQLite), localStorage fallback
import { api } from '@/lib/api/client';
import { lsGet, lsSet } from '@/lib/dbHelper';
import { notifySupplierReturnsChanged } from '@/lib/supplierReturnSync';

export interface SupplierReturn {
  id: string;
  returnNumber: string;
  branchId: string;
  branchName: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  reason: 'damaged' | 'wrong_item' | 'quality' | 'overstock' | 'other';
  reasonDescription: string;
  items: SupplierReturnItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: 'pending' | 'approved' | 'shipped' | 'completed' | 'cancelled';
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  shippedAt?: string;
  completedAt?: string;
  notes?: string;
}

export interface SupplierReturnItem {
  sourceLineId?: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitCost: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  reason?: string;
}

const STORAGE_KEY = 'kwanzaerp_supplier_returns';

function normalizeReturn(row: Record<string, unknown>): SupplierReturn {
  let items: SupplierReturnItem[] = [];
  if (Array.isArray(row.items)) {
    items = row.items as SupplierReturnItem[];
  } else if (row.items_json) {
    try {
      items = JSON.parse(String(row.items_json));
    } catch {
      items = [];
    }
  }

  return {
    id: String(row.id),
    returnNumber: String(row.returnNumber ?? row.return_number ?? ''),
    branchId: String(row.branchId ?? row.branch_id ?? ''),
    branchName: String(row.branchName ?? row.branch_name ?? ''),
    purchaseOrderId: String(row.purchaseOrderId ?? row.purchase_order_id ?? ''),
    purchaseOrderNumber: String(row.purchaseOrderNumber ?? row.purchase_order_number ?? ''),
    supplierId: String(row.supplierId ?? row.supplier_id ?? ''),
    supplierName: String(row.supplierName ?? row.supplier_name ?? ''),
    reason: (row.reason as SupplierReturn['reason']) || 'other',
    reasonDescription: String(row.reasonDescription ?? row.reason_description ?? ''),
    items,
    subtotal: Number(row.subtotal ?? 0),
    taxAmount: Number(row.taxAmount ?? row.tax_amount ?? 0),
    total: Number(row.total ?? 0),
    status: (row.status as SupplierReturn['status']) || 'pending',
    createdBy: String(row.createdBy ?? row.created_by ?? ''),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    approvedBy: row.approvedBy || row.approved_by ? String(row.approvedBy ?? row.approved_by) : undefined,
    approvedAt: row.approvedAt || row.approved_at ? String(row.approvedAt ?? row.approved_at) : undefined,
    shippedAt: row.shippedAt || row.shipped_at ? String(row.shippedAt ?? row.shipped_at) : undefined,
    completedAt: row.completedAt || row.completed_at ? String(row.completedAt ?? row.completed_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function readLocalReturns(branchId?: string): SupplierReturn[] {
  const all = lsGet<SupplierReturn[]>(STORAGE_KEY, []).map((row) =>
    normalizeReturn(row as unknown as Record<string, unknown>),
  );
  return branchId ? all.filter((r) => r.branchId === branchId) : all;
}

function saveLocalReturns(returns: SupplierReturn[]) {
  lsSet(STORAGE_KEY, returns);
}

function mergeLocalReturn(returnDoc: SupplierReturn) {
  const all = readLocalReturns();
  const idx = all.findIndex((r) => r.id === returnDoc.id);
  if (idx >= 0) all[idx] = returnDoc;
  else all.push(returnDoc);
  saveLocalReturns(all);
}

function mergeApiListIntoLocal(normalized: SupplierReturn[], branchId?: string) {
  if (branchId) {
    const otherBranches = readLocalReturns().filter((r) => r.branchId !== branchId);
    saveLocalReturns([...otherBranches, ...normalized]);
    return normalized;
  }
  saveLocalReturns(normalized);
  return normalized;
}

export async function getSupplierReturns(branchId?: string): Promise<SupplierReturn[]> {
  try {
    const response = await api.supplierReturns.list(branchId);
    if (!response.error && Array.isArray(response.data)) {
      const normalized = response.data.map((row) =>
        normalizeReturn(row as Record<string, unknown>),
      );
      return mergeApiListIntoLocal(normalized, branchId);
    }
  } catch (error) {
    console.warn('[supplierReturns] API list failed:', error);
  }
  return readLocalReturns(branchId);
}

export async function saveSupplierReturn(returnDoc: SupplierReturn): Promise<void> {
  try {
    const knownOnServer = readLocalReturns().some((r) => r.id === returnDoc.id);
    let response = knownOnServer
      ? await api.supplierReturns.update(returnDoc.id, returnDoc)
      : await api.supplierReturns.create(returnDoc);

    if (response.error && /exist|duplicate|unique|409/i.test(String(response.error))) {
      response = await api.supplierReturns.update(returnDoc.id, returnDoc);
    }

    if (response.data && !response.error) {
      mergeLocalReturn(normalizeReturn(response.data as Record<string, unknown>));
      notifySupplierReturnsChanged();
      return;
    }
    if (response.error) {
      throw new Error(response.error);
    }
  } catch (error) {
    console.warn('[supplierReturns] API save failed, using localStorage:', error);
  }

  mergeLocalReturn(returnDoc);
  notifySupplierReturnsChanged();
}

export function generateSupplierReturnNumber(branchCode: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Date.now().toString().slice(-4);
  return `DF ${branchCode}/${today}/${seq}`;
}
