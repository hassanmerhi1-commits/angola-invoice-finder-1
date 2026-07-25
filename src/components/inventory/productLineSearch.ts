import type { Product } from '@/types/erp';

export const PRODUCT_LINE_SUGGESTION_LIMIT = 40;
export const DEFAULT_LINE_ROWS = 12;
export const ROWS_APPEND_BATCH = 6;
export const ROWS_NEAR_END_BUFFER = 2;

export const normalizeSearchText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, '');

const DUP_SKU_SUFFIX_RE = /-dup-[a-f0-9]+$/i;

/** Normalize SKU for import matching (strip repair suffix, optional leading zeros on numeric codes). */
export function canonicalProductCodeForMatch(code: string): string {
  const raw = normalizeSearchText(code).replace(DUP_SKU_SUFFIX_RE, '');
  if (/^\d+$/.test(raw)) {
    const trimmed = raw.replace(/^0+/, '');
    return trimmed || '0';
  }
  return raw;
}

function productCodeMatchKeys(code: string): string[] {
  const trimmed = String(code || '').trim();
  if (!trimmed) return [];
  const keys = new Set<string>();
  keys.add(normalizeSearchText(trimmed));
  keys.add(canonicalProductCodeForMatch(trimmed));
  return Array.from(keys).filter(Boolean);
}

/** Numeric product code (digits / separators only) — use strict exact-SKU when complete. */
export const searchLooksLikeNumericCode = (rawTerm: string) => {
  const term = rawTerm.trim();
  if (!term || /\s/.test(term)) return false;
  return /^[\d.\-/]+$/.test(term);
};

export type ProductSearchTier = 'exact' | 'skuPrefix' | 'name';

export const getProductSearchTier = (product: Product, rawTerm: string): ProductSearchTier | null => {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return null;

  const termCompact = normalizeSearchText(term);
  const skuCompact = normalizeSearchText(product.sku);
  const name = String(product.name || '').toLowerCase();

  if (skuCompact === termCompact) return 'exact';
  if (skuCompact.startsWith(termCompact)) return 'skuPrefix';
  if (name.includes(term)) return 'name';
  const barcode = String(product.barcode || '').toLowerCase();
  if (barcode && barcode.includes(term)) return 'name';

  return null;
};

const tierPriority: Record<ProductSearchTier, number> = {
  exact: 0,
  skuPrefix: 1,
  name: 2,
};

export const sortProductSearchResults = (
  a: Product,
  b: Product,
  search: string,
  branchId: string,
): number => {
  const tierA = getProductSearchTier(a, search);
  const tierB = getProductSearchTier(b, search);
  if (tierA && tierB && tierPriority[tierA] !== tierPriority[tierB]) {
    return tierPriority[tierA] - tierPriority[tierB];
  }
  if (branchId) {
    const aBranch = a.branchId === branchId ? 1 : 0;
    const bBranch = b.branchId === branchId ? 1 : 0;
    if (bBranch !== aBranch) return bBranch - aBranch;
  }
  const aStock = (a.stock ?? 0) > 0 ? 1 : 0;
  const bStock = (b.stock ?? 0) > 0 ? 1 : 0;
  if (bStock !== aStock) return bStock - aStock;
  const term = search.trim().toLowerCase();
  const aSku = (a.sku || '').toLowerCase();
  const bSku = (b.sku || '').toLowerCase();
  if (aSku === term && bSku !== term) return -1;
  if (bSku === term && aSku !== term) return 1;
  const aLen = aSku.length;
  const bLen = bSku.length;
  if (aLen !== bLen) return aLen - bLen;
  return aSku.localeCompare(bSku);
};

export const scoreProductForBranch = (product: Product, branchId: string) => {
  let score = 0;
  if (branchId && product.branchId === branchId) score += 4;
  if ((product.stock ?? 0) > 0) score += 2;
  return score;
};

/** One row per SKU — prefer selected branch and stock > 0. */
export const dedupeProductsBySku = (items: Product[], branchId: string): Product[] => {
  const bySku = new Map<string, Product>();
  for (const p of items) {
    const key = normalizeSearchText(p.sku) || p.id;
    const prev = bySku.get(key);
    if (!prev || scoreProductForBranch(p, branchId) > scoreProductForBranch(prev, branchId)) {
      bySku.set(key, p);
    }
  }
  return Array.from(bySku.values());
};

export const filterProductsForSearch = (
  products: Product[],
  search: string,
  usedElsewhere: Set<string>,
  branchId: string,
): Product[] => {
  const term = search.trim();
  if (!term) return [];

  const pool = products.filter((p) => !usedElsewhere.has(p.id));
  const termCompact = normalizeSearchText(term);

  const candidates = pool
    .map((p) => ({ product: p, tier: getProductSearchTier(p, term) }))
    .filter((row): row is { product: Product; tier: ProductSearchTier } => row.tier !== null);

  if (candidates.length === 0) return [];

  if (searchLooksLikeNumericCode(term)) {
    const exactSku = candidates.filter(
      (c) => c.tier === 'exact' && normalizeSearchText(c.product.sku) === termCompact,
    );
    if (exactSku.length > 0) {
      return dedupeProductsBySku(
        exactSku.map((c) => c.product),
        branchId,
      );
    }
  }

  return dedupeProductsBySku(
    candidates.map((c) => c.product),
    branchId,
  );
};

export const newLineRowId = () => `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/** Limit search/picker to the branch selected in the dialog header.
 *  Shared catalog rows (no branch) stay visible — qty may be 0 until purchase/transfer. */
export function filterProductsForBranch(products: Product[], branchId: string): Product[] {
  if (!branchId) return products;
  return products.filter((p) => !p.branchId || p.branchId === branchId || p.branchId === 'all');
}

/** Resolve the product row for a branch + SKU (same code, different branch ids). */
export function findProductForBranchSku(
  products: Product[],
  sku: string,
  branchId: string,
): Product | undefined {
  const skuNorm = normalizeSearchText(sku);
  if (!skuNorm || !branchId) return undefined;
  return products.find(
    (p) => normalizeSearchText(p.sku) === skuNorm && (p.branchId || '') === branchId,
  );
}

/** Stock quantity for a SKU at the target branch (0 if no local row exists yet). */
export function getProductStockAtBranch(
  products: Product[],
  sku: string,
  branchId: string,
): number {
  const row = findProductForBranchSku(products, sku, branchId);
  return row?.stock ?? 0;
}

/** Match product by SKU or barcode (prefers selected branch when duplicates exist). */
export function findProductByCodeOrBarcode(
  products: Product[],
  code: string,
  branchId: string,
): Product | undefined {
  const keys = productCodeMatchKeys(code);
  if (keys.length === 0) return undefined;

  const skuMatches = products.filter((p) => {
    const skuKeys = productCodeMatchKeys(p.sku);
    return skuKeys.some((k) => keys.includes(k));
  });
  if (skuMatches.length > 0) {
    return dedupeProductsBySku(skuMatches, branchId)[0];
  }

  const barcodeMatches = products.filter((p) => {
    if (!p.barcode) return false;
    const barcodeKeys = productCodeMatchKeys(p.barcode);
    return barcodeKeys.some((k) => keys.includes(k));
  });
  if (barcodeMatches.length > 0) {
    return dedupeProductsBySku(barcodeMatches, branchId)[0];
  }

  return undefined;
}

/** Resolve product for stock-entry import (code, then optional description). */
export function findProductForStockEntryImport(
  products: Product[],
  codigo: string,
  branchId: string,
  descricao?: string,
): Product | undefined {
  const byCode = findProductByCodeOrBarcode(products, codigo, branchId);
  if (byCode) return byCode;

  const nameKey = normalizeSearchText(descricao || '');
  if (!nameKey) return undefined;

  const nameMatches = products.filter((p) => normalizeSearchText(p.name) === nameKey);
  if (nameMatches.length === 0) {
    const partial = products.filter((p) => normalizeSearchText(p.name).includes(nameKey));
    if (partial.length === 1) return partial[0];
    return undefined;
  }
  return dedupeProductsBySku(nameMatches, branchId)[0];
}

export function remapLineProductIdsForBranch(
  lines: { rowId: string; productId: string | null; search: string }[],
  productsById: Map<string, Product>,
  allProducts: Product[],
  branchId: string,
) {
  if (!branchId) return lines;
  return lines.map((line) => {
    if (!line.productId) return line;
    const product = productsById.get(line.productId);
    if (!product) return { ...line, productId: null };
    if (product.branchId === branchId) return line;
    const match = findProductForBranchSku(allProducts, product.sku, branchId);
    return {
      ...line,
      productId: match?.id ?? product.id,
      search: match ? '' : line.search || product.sku,
    };
  });
}

export const ensureRowsForIndex = <T>(lines: T[], targetRowIndex: number, createRow: () => T): T[] => {
  const minLength = targetRowIndex + ROWS_NEAR_END_BUFFER + 1;
  if (lines.length >= minLength) return lines;
  const toAdd = Math.max(ROWS_APPEND_BATCH, minLength - lines.length);
  return [...lines, ...Array.from({ length: toAdd }, () => createRow())];
};
