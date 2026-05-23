import type { Product } from '@/types/erp';

export function supplierIdsMatch(a?: string | null, b?: string | null): boolean {
  const left = String(a ?? '').trim().toLowerCase();
  const right = String(b ?? '').trim().toLowerCase();
  return left.length > 0 && left === right;
}

/** Pick supplier fields from any catalog row sharing the same SKU. */
export function enrichProductSupplier(
  product: Product,
  catalog: Product[] = [],
): Product {
  const skuKey = (product.sku || '').trim().toLowerCase();
  let supplierId = String(product.supplierId ?? '').trim() || undefined;
  let supplierName = String(product.supplierName ?? '').trim() || undefined;

  const pool = skuKey
    ? catalog.filter((row) => (row.sku || '').trim().toLowerCase() === skuKey)
    : [product];

  for (const row of pool) {
    if (!supplierId && row.supplierId) supplierId = String(row.supplierId).trim();
    if (!supplierName && row.supplierName) supplierName = String(row.supplierName).trim();
    if (supplierId && supplierName) break;
  }

  if (supplierId === product.supplierId && supplierName === product.supplierName) {
    return product;
  }
  return { ...product, supplierId, supplierName };
}

export const LEGACY_SUPPLIER_VALUE_PREFIX = '__legacy_supplier__:';

export function legacySupplierSelectValue(name: string): string {
  return `${LEGACY_SUPPLIER_VALUE_PREFIX}${name.trim()}`;
}

export function isLegacySupplierSelectValue(value?: string | null): boolean {
  return String(value ?? '').startsWith(LEGACY_SUPPLIER_VALUE_PREFIX);
}

export function legacySupplierNameFromSelectValue(value: string): string {
  return value.slice(LEGACY_SUPPLIER_VALUE_PREFIX.length);
}

export function resolveSupplierIdForProduct(
  product: Product | null | undefined,
  suppliers: { id: string; name: string }[],
  defaultSupplierName = '',
): string {
  if (!product) {
    const name = defaultSupplierName.trim();
    if (!name) return '';
    const byName = suppliers.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    return byName?.id || '';
  }

  const directId = String(product.supplierId ?? '').trim();
  if (directId) {
    const byId = suppliers.find((s) => supplierIdsMatch(s.id, directId));
    if (byId) return byId.id;
  }

  const name = String(product.supplierName ?? '').trim();
  if (name) {
    const byName = suppliers.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (byName) return byName.id;
  }

  return directId;
}

export function mapApiProductRow(p: Record<string, unknown>): Product {
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
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    sku: String(p.sku ?? ''),
    barcode: String(p.barcode ?? ''),
    category: String(p.category ?? 'GERAL'),
    price: Number(p.price ?? 0) || 0,
    price2: p.price2 != null ? Number(p.price2) : p.price_2 != null ? Number(p.price_2) : undefined,
    price3: p.price3 != null ? Number(p.price3) : p.price_3 != null ? Number(p.price_3) : undefined,
    price4: p.price4 != null ? Number(p.price4) : p.price_4 != null ? Number(p.price_4) : undefined,
    cost: Number(p.cost ?? 0) || 0,
    firstCost: Number(p.first_cost ?? p.firstCost ?? p.cost ?? 0) || 0,
    lastCost: Number(p.last_cost ?? p.lastCost ?? p.cost ?? 0) || 0,
    avgCost: Number(p.avg_cost ?? p.avgCost ?? p.cost ?? 0) || 0,
    stock: Number(p.stock ?? 0) || 0,
    unit: String(p.unit ?? 'UN'),
    taxRate: Number(p.tax_rate ?? p.taxRate ?? 0) || 0,
    branchId: String(p.branch_id ?? p.branchId ?? ''),
    supplierId: p.supplier_id != null ? String(p.supplier_id) : p.supplierId != null ? String(p.supplierId) : undefined,
    supplierName: p.supplier_name != null ? String(p.supplier_name) : p.supplierName != null ? String(p.supplierName) : undefined,
    isActive,
    createdAt: String(p.created_at ?? p.createdAt ?? ''),
    updatedAt: p.updated_at != null ? String(p.updated_at) : p.updatedAt != null ? String(p.updatedAt) : undefined,
  };
}
