import { resolveProductCategoryName } from '@/lib/inventoryFoodCategories';
import type { Category, Product } from '@/types/erp';

/** Products in stock matching code or name (for POS browse filter). */
export function filterPosProductsBySearch(products: Product[], term: string): Product[] {
  const q = term.trim();
  if (!q) return [];

  const lower = q.toLowerCase();
  const available = products.filter((p) => p.isActive && (Number(p.stock) || 0) > 0);

  return available
    .filter(
      (p) =>
        p.name.toLowerCase().includes(lower)
        || p.sku.toLowerCase().includes(lower)
        || (p.barcode && p.barcode.toLowerCase().includes(lower)),
    )
    .sort((a, b) => {
      const aSku = a.sku.toLowerCase() === lower || a.barcode === q;
      const bSku = b.sku.toLowerCase() === lower || b.barcode === q;
      if (aSku && !bSku) return -1;
      if (!aSku && bSku) return 1;
      const aName = a.name.toLowerCase().startsWith(lower);
      const bName = b.name.toLowerCase().startsWith(lower);
      if (aName && !bName) return -1;
      if (!aName && bName) return 1;
      return a.name.localeCompare(b.name);
    });
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

  const lower = term.toLowerCase();
  return bucket.products.filter(
    (p) =>
      p.name.toLowerCase().includes(lower)
      || p.sku.toLowerCase().includes(lower)
      || (p.barcode && p.barcode.toLowerCase().includes(lower)),
  );
}

/** Find a single product by barcode, SKU, or unique name match (POS quick-add). */
export function findPosProductByCode(products: Product[], term: string): Product | null {
  const q = term.trim();
  if (!q) return null;

  const lower = q.toLowerCase();
  const available = products.filter((p) => p.isActive && (Number(p.stock) || 0) > 0);

  const exact = available.find(
    (p) =>
      (p.barcode && p.barcode === q)
      || p.sku.toLowerCase() === lower,
  );
  if (exact) return exact;

  const nameExact = available.find((p) => p.name.toLowerCase() === lower);
  if (nameExact) return nameExact;

  const partial = available.filter(
    (p) =>
      p.name.toLowerCase().includes(lower)
      || p.sku.toLowerCase().includes(lower)
      || (p.barcode && p.barcode.includes(q)),
  );
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
