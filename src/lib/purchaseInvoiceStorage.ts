/**
 * Purchase Invoice (Fatura de Compra) Storage — API-First
 */

import { Product, Branch } from '@/types/erp';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { branchIdsEquivalent, resolveUserBranch } from '@/lib/branchAccess';
import { lsGet, lsSet } from '@/lib/dbHelper';

const STORAGE_KEY = 'kwanzaerp_purchase_invoices';
const LEGACY_MIGRATED_KEY = 'kwanzaerp_purchase_invoices_migrated_to_api';

/** Production: SQLite via Express API. Demo/browser: localStorage only. */
function usePurchaseInvoiceApi(): boolean {
  return !isDemoMode();
}

async function migrateLegacyPurchaseInvoicesToApi(): Promise<void> {
  if (!usePurchaseInvoiceApi()) return;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_MIGRATED_KEY) === '1') {
    return;
  }
  const legacy = lsGet<PurchaseInvoice[]>(STORAGE_KEY, []);
  if (!legacy.length) {
    localStorage?.setItem(LEGACY_MIGRATED_KEY, '1');
    return;
  }
  const existing = await api.purchaseInvoices.list();
  if (existing.data && existing.data.length > 0) {
    localStorage?.setItem(LEGACY_MIGRATED_KEY, '1');
    return;
  }
  for (const inv of legacy) {
    const normalized = normalizeInvoiceWarehouse(inv);
    await api.purchaseInvoices.save(normalized);
  }
  lsSet(STORAGE_KEY, []);
  localStorage?.setItem(LEGACY_MIGRATED_KEY, '1');
  console.log(`[PurchaseInvoice] Migrated ${legacy.length} legacy invoice(s) to API storage`);
}

export interface PurchaseInvoiceLine {
  id: string;
  productId: string;
  productCode: string;
  description: string;
  quantity: number;
  packaging: number;
  unitPrice: number;
  discountPct: number;
  discountPct2: number;
  totalQty: number;
  total: number;
  ivaRate: number;
  ivaAmount: number;
  totalWithIva: number;
  warehouseId: string;
  warehouseName: string;
  currentStock: number;
  unit: string;
  barcode?: string;
  // Multi-price levels (read-only from product master)
  price1?: number;
  price2?: number;
  price3?: number;
  price4?: number;
  lastCost?: number;
  avgCost?: number;
}

export interface PurchaseInvoiceJournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  currency: string;
  note: string;
  debit: number;
  credit: number;
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  supplierAccountCode: string;
  supplierName: string;
  supplierId?: string;
  supplierNif?: string;
  supplierPhone?: string;
  supplierBalance: number;
  ref?: string;
  supplierInvoiceNo?: string;
  contact?: string;
  department?: string;
  ref2?: string;
  date: string;
  paymentDate: string;
  project?: string;
  currency: string;
  warehouseId: string;
  warehouseName: string;
  priceType: 'last_price' | 'average_price' | 'manual';
  address?: string;
  purchaseAccountCode: string;
  ivaAccountCode: string;
  transactionType: string;
  currencyRate: number;
  taxRate2: number;
  orderNo?: string;
  surchargePercent: number;
  changePrice: boolean;
  isPending: boolean;
  extraNote?: string;
  /** Freight / landing costs allocated into product unit cost on post. */
  freightCost?: number;
  freightOtherCosts?: number;
  freightSourceAccount?: string;
  freightSourceName?: string;
  freightPaymentSource?: 'caixa' | 'bank';
  freightCaixaId?: string;
  freightBankAccountId?: string;
  lines: PurchaseInvoiceLine[];
  journalLines: PurchaseInvoiceJournalLine[];
  subtotal: number;
  ivaTotal: number;
  total: number;
  status: 'draft' | 'confirmed' | 'cancelled';
  /** Devolução de compra: quando 'full', não permitir novas devoluções nesta fatura. */
  purchaseReturnsStatus?: 'none' | 'partial' | 'full';
  purchaseReturnsClosedAt?: string;
  branchId: string;
  branchName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Branch scope (works for any number of filiais) ----------

export type BranchRef = { id: string; code?: string; name?: string; isMain?: boolean };

function normId(s: string | undefined | null): string {
  return (s ?? '').trim();
}

function normalizeLineWarehouse(
  line: PurchaseInvoiceLine,
  fallbackWhId: string,
  fallbackWhName: string,
): PurchaseInvoiceLine {
  const wid = normId(line.warehouseId) || normId(fallbackWhId);
  const wname = line.warehouseName || fallbackWhName;
  return { ...line, warehouseId: wid, warehouseName: wname };
}

/** Ensure header/lines have warehouse when only branch was set (legacy saves). */
export function normalizeInvoiceWarehouse(inv: PurchaseInvoice): PurchaseInvoice {
  const headerWh = normId(inv.warehouseId) || normId(inv.branchId);
  const headerWhName = inv.warehouseName || inv.branchName || '';
  const branchId = normId(inv.branchId) || headerWh;
  return {
    ...inv,
    warehouseId: headerWh,
    warehouseName: headerWhName,
    branchId: branchId || inv.branchId,
    branchName: inv.branchName || headerWhName,
    lines: inv.lines.map((l) => normalizeLineWarehouse(l, headerWh, headerWhName)),
  };
}

/**
 * Merge DB + localStorage for the same invoice id. localStorage used to fully replace DB,
 * which dropped warehouseId when LS held an older snapshot — branch filters / devoluções broke.
 * Prefer non-empty warehouse (and line warehouse) from either side; overlay LS for other fields.
 */
/** Stale localStorage often has draft while SQLite has confirmed — devolução only lists confirmed. */
function pickMergedInvoiceStatus(
  older: PurchaseInvoice | undefined,
  newer: PurchaseInvoice,
): PurchaseInvoice['status'] {
  const a = older?.status;
  const b = newer.status;
  if (a === 'cancelled' || b === 'cancelled') return 'cancelled';
  if (a === 'confirmed' || b === 'confirmed') return 'confirmed';
  return (b || a || 'draft') as PurchaseInvoice['status'];
}

function mergePurchaseInvoiceRecords(db: PurchaseInvoice | undefined, ls: PurchaseInvoice): PurchaseInvoice {
  const nLs = normalizeInvoiceWarehouse(ls);
  if (!db) return nLs;
  const nDb = normalizeInvoiceWarehouse(db);

  const whId = normId(nLs.warehouseId) || normId(nDb.warehouseId);
  const whName = nLs.warehouseName || nDb.warehouseName || nLs.branchName || nDb.branchName || '';
  const brId = normId(nLs.branchId) || normId(nDb.branchId) || whId;
  const brName = nLs.branchName || nDb.branchName || whName;

  const lineIds = [...new Set([...nDb.lines.map((l) => l.id), ...nLs.lines.map((l) => l.id)])];
  const byId = new Map<string, PurchaseInvoiceLine>();
  for (const id of lineIds) {
    const dbL = nDb.lines.find((l) => l.id === id);
    const lsL = nLs.lines.find((l) => l.id === id);
    if (!dbL && lsL) {
      byId.set(id, normalizeLineWarehouse({ ...lsL }, whId, whName));
    } else if (dbL && !lsL) {
      byId.set(id, normalizeLineWarehouse({ ...dbL }, whId, whName));
    } else if (dbL && lsL) {
      const lw = normId(lsL.warehouseId) || normId(dbL.warehouseId) || whId;
      const lwn = lsL.warehouseName || dbL.warehouseName || whName;
      byId.set(id, { ...dbL, ...lsL, warehouseId: lw, warehouseName: lwn });
    }
  }

  const order = nLs.lines.length
    ? [...nLs.lines.map((l) => l.id), ...lineIds.filter((id) => !nLs.lines.some((l) => l.id === id))]
    : nDb.lines.map((l) => l.id);
  const mergedLines = order.map((id) => byId.get(id)).filter(Boolean) as PurchaseInvoiceLine[];

  const rankReturns = (s: PurchaseInvoice['purchaseReturnsStatus'] | undefined) =>
    s === 'full' ? 3 : s === 'partial' ? 2 : s === 'none' ? 1 : 0;
  const prs =
    rankReturns(nLs.purchaseReturnsStatus) >= rankReturns(nDb.purchaseReturnsStatus)
      ? nLs.purchaseReturnsStatus ?? nDb.purchaseReturnsStatus
      : nDb.purchaseReturnsStatus ?? nLs.purchaseReturnsStatus;
  const prc = [nLs.purchaseReturnsClosedAt, nDb.purchaseReturnsClosedAt]
    .filter(Boolean)
    .sort()
    .pop();

  const merged: PurchaseInvoice = {
    ...nDb,
    ...nLs,
    warehouseId: whId,
    warehouseName: whName,
    branchId: brId,
    branchName: brName,
    lines: mergedLines,
    purchaseReturnsStatus: prs,
    purchaseReturnsClosedAt: prc,
    status: pickMergedInvoiceStatus(nDb, nLs),
  };

  return merged;
}

/**
 * Whether this purchase invoice's stock belongs to `branchId` (header, lines, or catalog alias).
 * Use for devoluções / listas — not hardcoded to filial 01/02.
 */
function branchRefMatchesId(ref: BranchRef | undefined, id: string): boolean {
  if (!ref) return false;
  const nid = normId(id);
  if (!nid) return false;
  if (branchIdsEquivalent(ref.id, nid)) return true;
  const code = (ref.code || '').trim();
  if (code && (code === nid || code.toLowerCase() === nid.toLowerCase())) return true;
  const name = (ref.name || '').trim();
  if (name && name.toLowerCase() === nid.toLowerCase()) return true;
  return false;
}

/** Match a sale / movement row to a branch (header warehouse/branch ids only). */
export function scopeBelongsToBranch(
  scopeIds: (string | null | undefined)[],
  branchId: string,
  branchCatalog?: BranchRef[],
): boolean {
  const ids = scopeIds.map(normId).filter(Boolean);
  if (!branchId || ids.length === 0) return !branchId;
  const stub = {
    id: '_',
    invoiceNumber: '',
    supplierAccountCode: '',
    supplierName: '',
    date: '',
    paymentDate: '',
    currency: 'AOA',
    warehouseId: ids[0] || '',
    warehouseName: '',
    priceType: 'last_price' as const,
    purchaseAccountCode: '',
    ivaAccountCode: '',
    transactionType: 'ALL',
    currencyRate: 1,
    taxRate2: 0,
    surchargePercent: 0,
    changePrice: false,
    isPending: false,
    lines: ids.slice(1).map((warehouseId, i) => ({
      id: `_${i}`,
      productId: '',
      productCode: '',
      description: '',
      quantity: 0,
      packaging: 1,
      unitPrice: 0,
      discountPct: 0,
      taxRate: 0,
      warehouseId,
    })),
    journalLines: [],
    subtotal: 0,
    ivaTotal: 0,
    total: 0,
    status: 'draft',
    branchId: ids[0] || '',
    branchName: '',
    supplierBalance: 0,
    createdBy: '',
    createdByName: '',
    createdAt: '',
    updatedAt: '',
  };
  return invoiceBelongsToBranch(stub, branchId, branchCatalog);
}

export function invoiceBelongsToBranch(
  inv: PurchaseInvoice,
  branchId: string,
  branchCatalog?: BranchRef[],
): boolean {
  const want = normId(branchId);
  if (!want) return true;

  const headerIds = [inv.warehouseId, inv.branchId].map(normId).filter(Boolean);
  const lineIds = inv.lines.map((l) => normId(l.warehouseId)).filter(Boolean);
  const allIds = new Set([...headerIds, ...lineIds]);

  for (const id of allIds) {
    if (branchIdsEquivalent(id, want)) return true;
  }

  const invNames = [inv.branchName, inv.warehouseName]
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean);

  if (branchCatalog?.length) {
    const target = branchCatalog.find((b) => branchRefMatchesId(b, want));
    if (target) {
      const targetName = (target.name || '').trim().toLowerCase();
      for (const id of allIds) {
        const meta = branchCatalog.find((b) => branchRefMatchesId(b, id));
        if (!meta) continue;
        if (branchIdsEquivalent(meta.id, target.id)) return true;
        const c1 = (meta.code || '').trim();
        const c2 = (target.code || '').trim();
        if (c1 && c2 && c1 === c2) return true;
        if (meta.isMain && target.isMain) return true;
        if (targetName && invNames.some((n) => n === targetName)) return true;
      }
      if (targetName && invNames.some((n) => n === targetName)) return true;
    }
  }

  return false;
}

// ---------- CRUD ----------

export async function getPurchaseInvoices(
  branchId?: string,
  branchCatalog?: BranchRef[],
): Promise<PurchaseInvoice[]> {
  const catalog = branchCatalog as Branch[] | undefined;
  const resolvedBranch = branchId
    ? (resolveUserBranch(catalog || [], branchId)?.id || branchId)
    : undefined;

  if (usePurchaseInvoiceApi()) {
    await migrateLegacyPurchaseInvoicesToApi();
    const res = await api.purchaseInvoices.list(resolvedBranch ? { branchId: resolvedBranch } : undefined);
    if (res.error) {
      console.error('[PurchaseInvoice] API list failed:', res.error);
      throw new Error(res.error);
    }
    let docs = (res.data || []).map((row) =>
      normalizeInvoiceWarehouse(mapPIFromApiRow(row)),
    );
    if (resolvedBranch) {
      docs = docs.filter((d) => invoiceBelongsToBranch(d, resolvedBranch, branchCatalog));
    }
    return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  let docs = lsGet<PurchaseInvoice[]>(STORAGE_KEY, []).map(normalizeInvoiceWarehouse);
  if (resolvedBranch) {
    docs = docs.filter((d) => invoiceBelongsToBranch(d, resolvedBranch, branchCatalog));
  }
  return docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getPurchaseInvoiceById(id: string): Promise<PurchaseInvoice | undefined> {
  if (usePurchaseInvoiceApi()) {
    const direct = await fetchPurchaseInvoiceFromServer(id);
    if (direct) return direct;
  }
  const all = await getPurchaseInvoices();
  return all.find(d => d.id === id);
}

/** Fetch one purchase invoice by id from the server API (no list scan). */
export async function fetchPurchaseInvoiceFromServer(id: string): Promise<PurchaseInvoice | null> {
  if (!usePurchaseInvoiceApi()) return null;
  try {
    const res = await api.purchaseInvoices.get(id);
    if (res.error || !res.data) return null;
    return normalizeInvoiceWarehouse(mapPIFromApiRow(res.data));
  } catch {
    return null;
  }
}

/** Allocate next FC number from server sequence (FC-BRANCH-YYYY-NNNNN). */
export async function allocatePurchaseInvoiceNumber(branchId: string): Promise<string> {
  const { api } = await import('@/lib/api/client');
  const res = await api.transactions.allocateNumber('purchase_invoice', branchId);
  if (res.error) throw new Error(res.error);
  const num = res.data?.documentNumber;
  if (!num) throw new Error('Failed to allocate purchase invoice number');
  return num;
}

/** Preview next FC number without consuming it. */
export async function peekPurchaseInvoiceNumber(branchId: string): Promise<string | null> {
  const { api } = await import('@/lib/api/client');
  const res = await api.transactions.peekNextNumber('purchase_invoice', branchId);
  if (res.error || !res.data?.documentNumber) return null;
  return res.data.documentNumber;
}

/** @deprecated Use allocatePurchaseInvoiceNumber — local fallback for offline demo only */
export function generatePurchaseInvoiceNumber(branchCode: string): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const seq = Date.now().toString().slice(-4);
  return `FC-${branchCode}-${date}-${seq}`;
}

export type PurchaseInvoiceAccounting = {
  success: boolean;
  error?: string | null;
  errors?: string[];
  warnings?: string[];
  stockMovementIds: string[];
  openItemId?: string | null;
  journalEntryId?: string | null;
};

export type SavePurchaseInvoiceResult = {
  invoice: PurchaseInvoice;
  accounting?: PurchaseInvoiceAccounting;
};

export async function savePurchaseInvoice(
  invoice: PurchaseInvoice,
  opts?: { metadataOnly?: boolean },
): Promise<SavePurchaseInvoiceResult> {
  const payload = normalizeInvoiceWarehouse({
    ...invoice,
    updatedAt: new Date().toISOString(),
  });

  if (usePurchaseInvoiceApi()) {
    const body = opts?.metadataOnly
      ? { ...payload, metadataOnly: true }
      : payload;
    const res = await api.purchaseInvoices.save(body);
    if (res.error) throw new Error(res.error);
    const row = res.data as Record<string, unknown> | undefined;
    if (!row?.id) {
      const verify = await api.purchaseInvoices.get(payload.id);
      if (verify.error || !verify.data) {
        throw new Error(
          'A fatura de compra não foi gravada no servidor. Verifique a filial (armazém) e tente novamente.',
        );
      }
      const accounting = (verify.data as Record<string, unknown>)?.accounting as PurchaseInvoiceAccounting | undefined;
      return {
        invoice: mapPIFromApiRow(verify.data as Record<string, unknown>),
        accounting,
      };
    }
    const accounting = row?.accounting as PurchaseInvoiceAccounting | undefined;
    return {
      invoice: mapPIFromApiRow(row),
      accounting,
    };
  }

  const all = lsGet<PurchaseInvoice[]>(STORAGE_KEY, []);
  const idx = all.findIndex((d) => d.id === payload.id);
  if (idx >= 0) all[idx] = payload;
  else all.push(payload);
  lsSet(STORAGE_KEY, all);
  return { invoice: payload };
}

export async function deletePurchaseInvoice(id: string): Promise<void> {
  if (usePurchaseInvoiceApi()) {
    const res = await api.purchaseInvoices.delete(id);
    if (res.error) throw new Error(res.error);
    return;
  }
  lsSet(STORAGE_KEY, lsGet<PurchaseInvoice[]>(STORAGE_KEY, []).filter((d) => d.id !== id));
}

// ---------- Line calculations ----------

export function calculateLine(line: Partial<PurchaseInvoiceLine>): PurchaseInvoiceLine {
  const qty = line.quantity || 0;
  const pkg = line.packaging || 1;
  const price = line.unitPrice || 0;
  const disc1 = line.discountPct || 0;
  const disc2 = line.discountPct2 || 0;
  const ivaRate = line.ivaRate || 0;

  const totalQty = qty * pkg;
  const gross = totalQty * price;
  const afterDisc1 = gross * (1 - disc1 / 100);
  const afterDisc2 = afterDisc1 * (1 - disc2 / 100);
  const ivaAmount = afterDisc2 * (ivaRate / 100);
  const totalWithIva = afterDisc2 + ivaAmount;

  return {
    id: line.id || `line_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    productId: line.productId || '',
    productCode: line.productCode || '',
    description: line.description || '',
    quantity: qty,
    packaging: pkg,
    unitPrice: price,
    discountPct: disc1,
    discountPct2: disc2,
    totalQty,
    total: Math.round(afterDisc2 * 100) / 100,
    ivaRate,
    ivaAmount: Math.round(ivaAmount * 100) / 100,
    totalWithIva: Math.round(totalWithIva * 100) / 100,
    warehouseId: line.warehouseId || '',
    warehouseName: line.warehouseName || '',
    currentStock: line.currentStock || 0,
    unit: line.unit || 'UN',
    barcode: line.barcode,
  };
}

export function calculateInvoiceTotals(lines: PurchaseInvoiceLine[]) {
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const ivaTotal = lines.reduce((s, l) => s + l.ivaAmount, 0);
  const total = lines.reduce((s, l) => s + l.totalWithIva, 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    ivaTotal: Math.round(ivaTotal * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

// ---------- Phase 2: Stock update via API ----------

export async function applyStockUpdate(invoice: PurchaseInvoice): Promise<void> {
  for (const line of invoice.lines) {
    if (!line.productId || line.totalQty <= 0) continue;
    
    try {
      await api.transactions.createStockMovement({
        productId: line.productId,
        warehouseId: invoice.branchId,
        movementType: 'IN',
        quantity: line.totalQty,
        unitCost: line.unitPrice,
        referenceType: 'purchase',
        referenceId: invoice.id,
        referenceNumber: invoice.invoiceNumber,
        notes: `Fatura de Compra ${invoice.invoiceNumber} - ${invoice.supplierName}`,
        createdBy: invoice.createdBy,
      });
    } catch {
      // Fallback: direct stock update
      await api.products.updateStock(line.productId, line.totalQty);
    }
  }
}

// ---------- Phase 5: Selling price from purchase line (PVP / price type) ----------

export function resolveSellingPriceFromPurchaseLine(
  line: PurchaseInvoiceLine,
  product: { price?: number; price1?: number },
  priceType: PurchaseInvoice['priceType'],
  landedUnitCost: number,
  newAvgCost: number,
): number {
  const p1 = Number(line.price1) || 0;
  if (p1 > 0) return p1;
  if (priceType === 'average_price' && newAvgCost > 0) return newAvgCost;
  if (priceType === 'last_price' && landedUnitCost > 0) return landedUnitCost;
  return Number(product.price) || 0;
}

function productToUpdatePayload(product: Record<string, unknown>, patch: Record<string, unknown>) {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? '',
    category: product.category ?? 'GERAL',
    price: Number(product.price) || 0,
    price2: Number(product.price2) || 0,
    price3: Number(product.price3) || 0,
    price4: Number(product.price4) || 0,
    cost: Number(product.cost) || 0,
    unit: product.unit ?? 'UN',
    taxRate: Number(product.tax_rate ?? product.taxRate) || 14,
    branchId: product.branch_id ?? product.branchId,
    isActive: product.is_active !== 0 && product.isActive !== false,
    supplierId: product.supplier_id ?? product.supplierId,
    supplierName: product.supplier_name ?? product.supplierName,
    ...patch,
    preserveStock: true,
  };
}

export async function applyPriceUpdate(invoice: PurchaseInvoice): Promise<void> {
  const hasSellingOnLines = invoice.lines.some(
    (line) => Number(line.price1) > 0 || Number(line.price) > 0,
  );
  if (!invoice.changePrice && !hasSellingOnLines) return;

  const branchId =
    String(invoice.warehouseId || invoice.branchId || '').trim() || undefined;

  for (const line of invoice.lines) {
    if (!line.productId) continue;

    try {
      const getRes = await api.products.get(line.productId);
      let product: any = getRes.data;
      if (!product) {
        const listRes = await api.products.list(branchId);
        const rows = listRes.data || [];
        product = rows.find((p: any) => p.id === line.productId);
      }
      if (!product) continue;

      const landedUnitCost = Number(line.unitPrice) || 0;
      const currentStock = Number(product.stock ?? product.stock_qty) || 0;
      const qtyIn = Number(line.totalQty ?? line.quantity) || 0;
      const previousStock = Math.max(currentStock - qtyIn, 0);
      const previousAverageCost =
        Number(product.avgCost ?? product.avg_cost ?? product.cost) || 0;
      const previousTotalValue = previousStock * previousAverageCost;
      const newItemsTotalValue = qtyIn * landedUnitCost;
      const newTotalStock = previousStock + qtyIn;
      const newAvgCost =
        newTotalStock > 0
          ? (previousTotalValue + newItemsTotalValue) / newTotalStock
          : landedUnitCost;

      const sellingPrice = resolveSellingPriceFromPurchaseLine(
        line,
        product,
        invoice.priceType,
        landedUnitCost,
        newAvgCost,
      );
      if (!invoice.changePrice && sellingPrice <= 0) continue;

      const updateRes = await api.products.update(
        line.productId,
        productToUpdatePayload(product, {
          cost: newAvgCost,
          avgCost: newAvgCost,
          lastCost: landedUnitCost,
          firstCost: Number(product.firstCost ?? product.first_cost) || landedUnitCost,
          price: sellingPrice,
          price2: Number(line.price2) || Number(product.price2) || 0,
          price3: Number(line.price3) || Number(product.price3) || 0,
          price4: Number(line.price4) || Number(product.price4) || 0,
        }),
      );
      if (updateRes.error) {
        console.error('[PurchaseInvoice] Price update failed:', updateRes.error);
      }
    } catch (err) {
      console.error('[PurchaseInvoice] Price update failed:', err);
    }
  }
}

// ---------- Phase 3: Auto journal entry ----------

export function generateAutoJournalLines(invoice: PurchaseInvoice): PurchaseInvoiceJournalLine[] {
  const lines: PurchaseInvoiceJournalLine[] = [];

  if (invoice.subtotal > 0) {
    lines.push({
      id: `jl_${Date.now()}_1`,
      accountCode: invoice.purchaseAccountCode || '212',
      accountName: 'Compra de Mercadorias',
      currency: invoice.currency,
      note: `FC ${invoice.invoiceNumber} - ${invoice.supplierName}`,
      debit: invoice.subtotal,
      credit: 0,
    });
  }

  if (invoice.ivaTotal > 0) {
    lines.push({
      id: `jl_${Date.now()}_2`,
      accountCode: invoice.ivaAccountCode || '3451',
      accountName: 'IVA Dedutível',
      currency: invoice.currency,
      note: `IVA - FC ${invoice.invoiceNumber}`,
      debit: invoice.ivaTotal,
      credit: 0,
    });
  }

  lines.push({
    id: `jl_${Date.now()}_3`,
    accountCode: invoice.supplierAccountCode,
    accountName: invoice.supplierName,
    currency: invoice.currency,
    note: `FC ${invoice.invoiceNumber}`,
    debit: 0,
    credit: invoice.total,
  });

  return lines;
}

// ---------- Phase 6: Update supplier balance via API ----------

export async function applySupplierBalanceUpdate(invoice: PurchaseInvoice): Promise<void> {
  if (invoice.total <= 0) return;
  
  try {
    const response = await api.suppliers.list();
    const suppliers = response.data || [];
    const supplier = suppliers.find(
      (s: any) => s.id === invoice.supplierAccountCode || s.name === invoice.supplierName || s.nif === invoice.supplierNif
    );
    if (!supplier) {
      console.warn(`[PurchaseInvoice] Supplier not found: ${invoice.supplierName}`);
      return;
    }
    const newBalance = (supplier.balance || 0) + invoice.total;
    await api.suppliers.update(supplier.id, { balance: newBalance });
    console.log(`[PurchaseInvoice] Updated supplier ${supplier.name} balance: ${supplier.balance} → ${newBalance}`);
  } catch (err) {
    console.error('[PurchaseInvoice] Supplier balance update failed:', err);
  }
}

/** Read freight fields from invoice header or journal lines (6.2.6 debit). */
export function resolvePurchaseInvoiceFreight(inv: Pick<PurchaseInvoice, 'freightCost' | 'freightOtherCosts' | 'freightSourceAccount' | 'freightSourceName' | 'journalLines'>): {
  freightCost: number;
  freightOtherCosts: number;
  freightSourceAccount: string;
  freightSourceName: string;
} {
  const freightCost = Number(inv.freightCost || 0);
  const freightOtherCosts = Number(inv.freightOtherCosts || 0);
  let freightSourceAccount = String(inv.freightSourceAccount || '').trim();
  let freightSourceName = String(inv.freightSourceName || '').trim();

  if (freightCost > 0 || freightOtherCosts > 0) {
    return { freightCost, freightOtherCosts, freightSourceAccount, freightSourceName };
  }

  const journal = Array.isArray(inv.journalLines) ? inv.journalLines : [];
  const landingFromJournal = journal
    .filter((line) => String(line.accountCode || '').trim() === '752')
    .reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const freightCredit = journal.find(
    (line) => Number(line.credit || 0) > 0 && String(line.accountCode || '').trim() !== '321',
  );

  return {
    freightCost: Math.round(landingFromJournal * 100) / 100,
    freightOtherCosts: 0,
    freightSourceAccount: freightSourceAccount || String(freightCredit?.accountCode || '').trim(),
    freightSourceName: freightSourceName || String(freightCredit?.accountName || '').trim(),
  };
}

/** API returns camelCase; map legacy snake_case if needed. */
function mapPIFromApiRow(row: PurchaseInvoice | Record<string, unknown>): PurchaseInvoice {
  if (row && typeof row === 'object' && 'invoiceNumber' in row && !('invoice_number' in row)) {
    return row as PurchaseInvoice;
  }
  return mapPIFromDb(row);
}

// DB row mappers (API / legacy)
function mapPIFromDb(row: any): PurchaseInvoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number || row.invoiceNumber || '',
    supplierAccountCode: row.supplier_account_code || row.supplierAccountCode || '',
    supplierName: row.supplier_name || row.supplierName || '',
    supplierId: row.supplier_id || row.supplierId || '',
    supplierNif: row.supplier_nif,
    supplierPhone: row.supplier_phone,
    supplierBalance: Number(row.supplier_balance || 0),
    ref: row.ref,
    supplierInvoiceNo: row.supplier_invoice_no,
    contact: row.contact,
    department: row.department,
    ref2: row.ref2,
    date: row.date || '',
    paymentDate: row.payment_date || '',
    project: row.project,
    currency: row.currency || 'AOA',
    warehouseId: row.warehouse_id || row.warehouseId || row.branch_id || row.branchId || '',
    warehouseName: row.warehouse_name || row.warehouseName || row.branch_name || row.branchName || '',
    priceType: row.price_type || 'last_price',
    address: row.address,
    purchaseAccountCode: row.purchase_account_code || '212',
    ivaAccountCode: row.iva_account_code || '3451',
    transactionType: row.transaction_type || 'ALL',
    currencyRate: Number(row.currency_rate || 1),
    taxRate2: Number(row.tax_rate_2 || 0),
    orderNo: row.order_no,
    surchargePercent: Number(row.surcharge_percent || 0),
    changePrice: !!row.change_price,
    isPending: !!row.is_pending,
    extraNote: row.extra_note,
    freightCost: Number(row.freight_cost ?? row.freightCost ?? 0),
    freightOtherCosts: Number(row.freight_other_costs ?? row.freightOtherCosts ?? 0),
    freightSourceAccount: row.freight_source_account || row.freightSourceAccount || '',
    freightSourceName: row.freight_source_name || row.freightSourceName || '',
    freightPaymentSource: (row.freight_payment_source || row.freightPaymentSource || 'caixa') as 'caixa' | 'bank',
    freightCaixaId: row.freight_caixa_id || row.freightCaixaId || '',
    freightBankAccountId: row.freight_bank_account_id || row.freightBankAccountId || '',
    lines: Array.isArray(row.lines)
      ? row.lines
      : row.lines_json
        ? JSON.parse(row.lines_json)
        : [],
    journalLines: Array.isArray(row.journalLines)
      ? row.journalLines
      : row.journal_lines_json
        ? JSON.parse(row.journal_lines_json)
        : [],
    subtotal: Number(row.subtotal || 0),
    ivaTotal: Number(row.iva_total || 0),
    total: Number(row.total || 0),
    status: row.status || 'draft',
    purchaseReturnsStatus: row.purchase_returns_status || row.purchaseReturnsStatus || 'none',
    purchaseReturnsClosedAt: row.purchase_returns_closed_at || row.purchaseReturnsClosedAt,
    branchId: row.branch_id || row.branchId || '',
    branchName: row.branch_name || row.branchName || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function mapPIToDb(invoice: PurchaseInvoice): any {
  return {
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    supplier_account_code: invoice.supplierAccountCode,
    supplier_name: invoice.supplierName,
    supplier_id: invoice.supplierId || '',
    supplier_nif: invoice.supplierNif || '',
    supplier_phone: invoice.supplierPhone || '',
    supplier_balance: invoice.supplierBalance,
    ref: invoice.ref || '',
    supplier_invoice_no: invoice.supplierInvoiceNo || '',
    date: invoice.date || '',
    payment_date: invoice.paymentDate || '',
    currency: invoice.currency,
    warehouse_id: invoice.warehouseId || '',
    warehouse_name: invoice.warehouseName,
    price_type: invoice.priceType,
    purchase_account_code: invoice.purchaseAccountCode,
    iva_account_code: invoice.ivaAccountCode,
    transaction_type: invoice.transactionType,
    currency_rate: invoice.currencyRate,
    tax_rate_2: invoice.taxRate2,
    surcharge_percent: invoice.surchargePercent,
    change_price: invoice.changePrice ? 1 : 0,
    is_pending: invoice.isPending ? 1 : 0,
    extra_note: invoice.extraNote || '',
    freight_cost: Number(invoice.freightCost || 0),
    freight_other_costs: Number(invoice.freightOtherCosts || 0),
    freight_source_account: invoice.freightSourceAccount || '',
    freight_source_name: invoice.freightSourceName || '',
    freight_payment_source: invoice.freightPaymentSource || 'caixa',
    freight_caixa_id: invoice.freightCaixaId || null,
    freight_bank_account_id: invoice.freightBankAccountId || null,
    lines_json: JSON.stringify(invoice.lines),
    journal_lines_json: JSON.stringify(invoice.journalLines),
    subtotal: invoice.subtotal,
    iva_total: invoice.ivaTotal,
    total: invoice.total,
    status: invoice.status,
    purchase_returns_status: invoice.purchaseReturnsStatus || 'none',
    purchase_returns_closed_at: invoice.purchaseReturnsClosedAt || null,
    branch_id: invoice.branchId || '',
    branch_name: invoice.branchName,
    created_by: invoice.createdBy,
    created_by_name: invoice.createdByName,
    created_at: invoice.createdAt,
    updated_at: invoice.updatedAt,
  };
}

function mapPIFromDocumentDb(row: any): PurchaseInvoice {
  const lines = row.lines_json ? JSON.parse(row.lines_json) : [];
  const subtotal = Number(row.subtotal || 0);
  const total = Number(row.total || 0);
  const ivaTotal = Number(row.total_tax || 0);
  const docWh = row.warehouse_id || row.branch_id || '';
  const docWhName = row.warehouse_name || row.branch_name || '';

  return {
    id: row.id,
    invoiceNumber: row.document_number || '',
    supplierAccountCode: row.account_code || '',
    supplierName: row.entity_name || '',
    supplierNif: row.entity_nif || '',
    supplierPhone: row.entity_phone || '',
    supplierBalance: 0,
    ref: '',
    supplierInvoiceNo: row.internal_notes?.replace('Nº Fatura Fornecedor: ', '') || '',
    contact: '',
    department: '',
    ref2: '',
    date: row.issue_date || row.created_at || '',
    paymentDate: row.due_date || '',
    project: '',
    currency: row.currency || 'AOA',
    warehouseId: docWh,
    warehouseName: docWhName,
    priceType: 'manual',
    address: row.entity_address || '',
    purchaseAccountCode: lines[0]?.accountCode || '212',
    ivaAccountCode: '3451',
    transactionType: 'ALL',
    currencyRate: 1,
    taxRate2: 0,
    orderNo: '',
    surchargePercent: 0,
    changePrice: true,
    isPending: false,
    extraNote: row.notes || '',
    lines: lines.map((line: any) => ({
      id: line.id,
      productId: line.productId || '',
      productCode: line.productSku || '',
      description: line.description || '',
      quantity: Number(line.quantity || 0),
      packaging: 1,
      unitPrice: Number(line.unitPrice || 0),
      discountPct: Number(line.discount || 0),
      discountPct2: 0,
      totalQty: Number(line.quantity || 0),
      total: Number((line.lineTotal || 0) - (line.taxAmount || 0)),
      ivaRate: Number(line.taxRate || 0),
      ivaAmount: Number(line.taxAmount || 0),
      totalWithIva: Number(line.lineTotal || 0),
      warehouseId: line.warehouseId || line.warehouse_id || docWh,
      warehouseName: line.warehouseName || line.warehouse_name || docWhName,
      currentStock: 0,
      unit: line.unit || 'UN',
      barcode: undefined,
    })),
    journalLines: [],
    subtotal,
    ivaTotal,
    total,
    status: row.status || 'confirmed',
    branchId: row.branch_id || '',
    branchName: row.branch_name || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || row.created_at || '',
  };
}
