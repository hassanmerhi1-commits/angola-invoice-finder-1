/**
 * Default retail / grocery category names for the product category picker
 * (merged with categories from the database; duplicates by name are omitted).
 */
export const INVENTORY_FOOD_CATEGORY_NAMES: readonly string[] = [
  'Beverages',
  'Food',
  'Water',
  'Soft Drinks',
  'Juices',
  'Alcohol',
  'Frozen Products',
  'Dairy Products',
  'Meat & Chicken',
  'Fish & Seafood',
  'Bakery',
  'Snacks',
  'Candy & Chocolates',
  'Rice & Grains',
  'Pasta',
  'Cooking Oil',
  'Sugar & Salt',
  'Spices',
  'Canned Food',
  'Cleaning Products',
  'Hygiene Products',
  'Cosmetics',
  'Baby Products',
  'Stationery',
  'Office Supplies',
  'Electronics',
  'Electrical Materials',
  'Construction Materials',
  'Tools',
  'Auto Parts',
  'Tires',
  'Lubricants',
  'Gas',
  'Agriculture Products',
  'Animal Feed',
  'Pharmaceutical',
  'Medical Supplies',
  'Clothing',
  'Shoes',
  'Furniture',
  'Household Items',
  'Kitchen Equipment',
  'Plastic Products',
  'Packaging Materials',
  'Industrial Equipment',
  'Hardware',
  'Telecom Products',
] as const;

export type CategorySelectOption = { key: string; name: string };

export function mergeInventoryFoodCategorySelectOptions(
  activeCategories: ReadonlyArray<{ id: string; name: string }>
): CategorySelectOption[] {
  const seen = new Set<string>();
  const out: CategorySelectOption[] = [];

  for (const c of activeCategories) {
    const n = String(c.name || '').trim();
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: c.id, name: n });
  }

  for (const name of INVENTORY_FOOD_CATEGORY_NAMES) {
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `preset:${name}`, name });
  }

  return out;
}

export function defaultProductCategoryName(
  activeCategories: ReadonlyArray<{ name: string }>
): string {
  const first = activeCategories[0]?.name?.trim();
  if (first) return first;
  return INVENTORY_FOOD_CATEGORY_NAMES[0] || '';
}

/** Map stored / typed category to a canonical label (DB row, preset list, or as-is). */
export function resolveProductCategoryName(
  rawCategory: string | undefined,
  categories: ReadonlyArray<{ name: string }>
): string {
  const cleaned = String(rawCategory || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return defaultProductCategoryName(categories);

  const exactMatch = categories.find((c) => c.name.toLowerCase() === cleaned.toLowerCase());
  if (exactMatch) return exactMatch.name;

  const presetMatch = INVENTORY_FOOD_CATEGORY_NAMES.find((p) => p.toLowerCase() === cleaned.toLowerCase());
  if (presetMatch) return presetMatch;

  const compact = cleaned.toLowerCase().replace(/\s+/g, '');
  const repeatedMatch = categories.find((category) => {
    const token = category.name.toLowerCase().replace(/\s+/g, '');
    return token && compact.includes(token) && compact.replace(new RegExp(token, 'g'), '') === '';
  });

  return repeatedMatch?.name || cleaned;
}
