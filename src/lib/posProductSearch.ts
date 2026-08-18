import { resolveProductCategoryName } from '@/lib/inventoryFoodCategories';
import { digitProductCodeForMatch } from '@/components/inventory/productLineSearch';
import type { Category, Product } from '@/types/erp';

function posCodeMatches(product: Product, rawTerm: string): boolean {
  const q = rawTerm.trim();
  if (!q) return false;
  const lower = q.toLowerCase();
  if (product.name.toLowerCase().includes(lower)) return true;
  if (product.sku.toLowerCase().includes(lower)) return true;
  if (product.barcode && product.barcode.toLowerCase().includes(lower)) return true;
  const qDigits = digitProductCodeForMatch(q);
  if (qDigits.length < 6) return false;
  const skuDigits = digitProductCodeForMatch(product.sku);
  const barcodeDigits = digitProductCodeForMatch(product.barcode);
  return skuDigits === qDigits
    || barcodeDigits === qDigits
    || skuDigits.includes(qDigits)
    || barcodeDigits.includes(qDigits);
}

/** Short queries can match thousands of rows; the list is not virtualized. */
export const POS_SEARCH_MAX_RESULTS = 50;

/** Products in stock matching code or name (for POS browse filter). */
export function filterPosProductsBySearch(products: Product[], term: string): Product[] {
  const q = term.trim();
  if (!q) return [];

  const lower = q.toLowerCase();
  const available = products.filter((p) => p.isActive && (Number(p.stock) || 0) > 0);

  return available
    .filter((p) => posCodeMatches(p, q))
    .sort((a, b) => {
      const qDigits = digitProductCodeForMatch(q);
      const aSku = a.sku.toLowerCase() === lower
        || a.barcode === q
        || (qDigits.length >= 6 && (
          digitProductCodeForMatch(a.sku) === qDigits
          || digitProductCodeForMatch(a.barcode) === qDigits
        ));
      const bSku = b.sku.toLowerCase() === lower
        || b.barcode === q
        || (qDigits.length >= 6 && (
          digitProductCodeForMatch(b.sku) === qDigits
          || digitProductCodeForMatch(b.barcode) === qDigits
        ));
      if (aSku && !bSku) return -1;
      if (!aSku && bSku) return 1;
      const aName = a.name.toLowerCase().startsWith(lower);
      const bName = b.name.toLowerCase().startsWith(lower);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, POS_SEARCH_MAX_RESULTS);
}

export function getPosNavigableSearchResults(
  products: Product[],
  searchTerm: string,
  selectedCategory: string | null,
  categories: Category[],
): Product[] {
  const term = searchTerm.trim();
  if (!term) return [];

  if (!selectedCategory) {
    return filterPosProductsBySearch(products, term);
  }

  const bucket = buildPosCategoryBuckets(products, categories).find((b) => b.name === selectedCategory);
  if (!bucket) return filterPosProductsBySearch(products, term);

  return bucket.products
    .filter((p) => posCodeMatches(p, term))
    .slice(0, POS_SEARCH_MAX_RESULTS);
}

/** Find a single product by barcode, SKU, or unique name match (POS quick-add). */
export function findPosProductByCode(products: Product[], term: string): Product | null {
  const q = term.trim();
  if (!q) return null;

  const lower = q.toLowerCase();
  const available = products.filter((p) => p.isActive && (Number(p.stock) || 0) > 0);

  const qDigits = digitProductCodeForMatch(q);
  const exact = available.find((p) => {
    if (p.barcode && p.barcode === q) return true;
    if (p.sku.toLowerCase() === lower) return true;
    if (qDigits.length < 6) return false;
    return digitProductCodeForMatch(p.sku) === qDigits
      || digitProductCodeForMatch(p.barcode) === qDigits;
  });
  if (exact) return exact;

  const nameExact = available.find((p) => p.name.toLowerCase() === lower);
  if (nameExact) return nameExact;

  const partial = available.filter((p) => posCodeMatches(p, q));
  if (partial.length === 1) return partial[0];
  return null;
}

export type PosCategoryBucket = {
  name: string;
  color?: string;
  products: Product[];
};

export function buildPosCategoryBuckets(
  products: Product[],
  categories: Category[],
): PosCategoryBucket[] {
  const inStock = products.filter((p) => p.isActive && (Number(p.stock) || 0) > 0);
  const map = new Map<string, PosCategoryBucket>();

  for (const product of inStock) {
    const name = resolveProductCategoryName(product.category, categories);
    if (!map.has(name)) {
      const cat = categories.find((c) => c.name === name);
      map.set(name, { name, color: cat?.color, products: [] });
    }
    map.get(name)!.products.push(product);
  }

  return [...map.values()]
    .map((bucket) => ({
      ...bucket,
      products: [...bucket.products].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
