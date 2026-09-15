/**
 * Default retail / grocery category names for the product category picker
 * (merged with categories from the database; duplicates by name are omitted).
 */
export type InventoryUiLanguage = 'en' | 'pt';

export const INVENTORY_FOOD_CATEGORY_PRESETS: readonly { en: string; pt: string }[] = [
  { en: 'Beverages', pt: 'Bebidas' },
  { en: 'Food', pt: 'Alimentação' },
  { en: 'Water', pt: 'Água' },
  { en: 'Soft Drinks', pt: 'Refrigerantes' },
  { en: 'Juices', pt: 'Sumos' },
  { en: 'Alcohol', pt: 'Bebidas alcoólicas' },
  { en: 'Frozen Products', pt: 'Congelados' },
  { en: 'Dairy Products', pt: 'Laticínios' },
  { en: 'Meat & Chicken', pt: 'Carne e frango' },
  { en: 'Fish & Seafood', pt: 'Peixe e marisco' },
  { en: 'Bakery', pt: 'Padaria' },
  { en: 'Snacks', pt: 'Snacks' },
  { en: 'Candy & Chocolates', pt: 'Doces e chocolates' },
  { en: 'Rice & Grains', pt: 'Arroz e cereais' },
  { en: 'Pasta', pt: 'Massas' },
  { en: 'Cooking Oil', pt: 'Óleo alimentar' },
  { en: 'Sugar & Salt', pt: 'Açúcar e sal' },
  { en: 'Spices', pt: 'Especiarias' },
  { en: 'Canned Food', pt: 'Conservas' },
  { en: 'Cleaning Products', pt: 'Produtos de limpeza' },
  { en: 'Hygiene Products', pt: 'Higiene' },
  { en: 'Cosmetics', pt: 'Cosméticos' },
  { en: 'Baby Products', pt: 'Bebé' },
  { en: 'Stationery', pt: 'Papelaria' },
  { en: 'Office Supplies', pt: 'Material de escritório' },
  { en: 'Electronics', pt: 'Electrónica' },
  { en: 'Electrical Materials', pt: 'Material eléctrico' },
  { en: 'Construction Materials', pt: 'Materiais de construção' },
  { en: 'Tools', pt: 'Ferramentas' },
  { en: 'Auto Parts', pt: 'Peças auto' },
  { en: 'Tires', pt: 'Pneus' },
  { en: 'Lubricants', pt: 'Lubrificantes' },
  { en: 'Gas', pt: 'Gás' },
  { en: 'Agriculture Products', pt: 'Produtos agrícolas' },
  { en: 'Animal Feed', pt: 'Ração animal' },
  { en: 'Pharmaceutical', pt: 'Farmácia' },
  { en: 'Medical Supplies', pt: 'Material médico' },
  { en: 'Clothing', pt: 'Vestuário' },
  { en: 'Shoes', pt: 'Calçado' },
  { en: 'Furniture', pt: 'Mobiliário' },
  { en: 'Household Items', pt: 'Artigos para o lar' },
  { en: 'Kitchen Equipment', pt: 'Equipamento de cozinha' },
  { en: 'Plastic Products', pt: 'Plásticos' },
  { en: 'Packaging Materials', pt: 'Embalagens' },
  { en: 'Industrial Equipment', pt: 'Equipamento industrial' },
  { en: 'Hardware', pt: 'Ferragens' },
  { en: 'Telecom Products', pt: 'Telecomunicações' },
];

/** English preset names (stored values / older data). */
export const INVENTORY_FOOD_CATEGORY_NAMES: readonly string[] = INVENTORY_FOOD_CATEGORY_PRESETS.map(
  (p) => p.en,
);

export type CategorySelectOption = { key: string; name: string; label: string };

function presetForName(name: string) {
  const k = String(name || '').trim().toLowerCase();
  if (!k) return undefined;
  return INVENTORY_FOOD_CATEGORY_PRESETS.find(
    (p) => p.en.toLowerCase() === k || p.pt.toLowerCase() === k,
  );
}

function aliasKey(name: string): string {
  const preset = presetForName(name);
  return (preset?.en || name).trim().toLowerCase();
}

export function inventoryFoodCategoryLabel(
  name: string,
  language: InventoryUiLanguage = 'pt',
): string {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
  const preset = presetForName(cleaned);
  if (!preset) return cleaned;
  return language === 'en' ? preset.en : preset.pt;
}

export function mergeInventoryFoodCategorySelectOptions(
  activeCategories: ReadonlyArray<{ id: string; name: string }>,
  language: InventoryUiLanguage = 'pt',
): CategorySelectOption[] {
  const seen = new Set<string>();
  const out: CategorySelectOption[] = [];

  for (const c of activeCategories) {
    const n = String(c.name || '').trim();
    if (!n) continue;
    const k = aliasKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: c.id, name: n, label: inventoryFoodCategoryLabel(n, language) });
  }

  for (const preset of INVENTORY_FOOD_CATEGORY_PRESETS) {
    const k = preset.en.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const name = language === 'en' ? preset.en : preset.pt;
    out.push({ key: `preset:${preset.en}`, name, label: name });
  }

  return out;
}

export function defaultProductCategoryName(
  activeCategories: ReadonlyArray<{ name: string }>,
  language: InventoryUiLanguage = 'pt',
): string {
  const first = activeCategories[0]?.name?.trim();
  if (first) return first;
  const preset = INVENTORY_FOOD_CATEGORY_PRESETS[0];
  if (!preset) return '';
  return language === 'en' ? preset.en : preset.pt;
}

/** Map stored / typed category to the select value for the current language. */
export function resolveProductCategoryName(
  rawCategory: string | undefined,
  categories: ReadonlyArray<{ name: string }>,
  language: InventoryUiLanguage = 'pt',
): string {
  const cleaned = String(rawCategory || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return defaultProductCategoryName(categories, language);

  const exactMatch = categories.find((c) => c.name.toLowerCase() === cleaned.toLowerCase());
  if (exactMatch) return exactMatch.name;

  const preset = presetForName(cleaned);
  if (preset) {
    const dbAlias = categories.find((c) => aliasKey(c.name) === preset.en.toLowerCase());
    if (dbAlias) return dbAlias.name;
    return language === 'en' ? preset.en : preset.pt;
  }

  const compact = cleaned.toLowerCase().replace(/\s+/g, '');
  const repeatedMatch = categories.find((category) => {
    const token = category.name.toLowerCase().replace(/\s+/g, '');
    return token && compact.includes(token) && compact.replace(new RegExp(token, 'g'), '') === '';
  });

  return repeatedMatch?.name || cleaned;
}
