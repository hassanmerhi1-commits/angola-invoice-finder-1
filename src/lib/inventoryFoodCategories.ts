/**
 * Default category names for a new install.
 * Merged with categories from the database; duplicates by name are omitted.
 */
export type InventoryUiLanguage = 'en' | 'pt';

/** Same names as backend/src/lib/defaultCategoryNames.js. Keep both lists identical. */
export const INVENTORY_FOOD_CATEGORY_PRESETS: readonly { en: string; pt: string }[] = [
  'ACUCAR E SAL',
  'AGUA',
  'ANTISEPTICOS',
  'APERITIVOS',
  'ARROZ',
  'AZEITONAS E PICKLES',
  'BOLACHA',
  'CAFE E CHA',
  'CALDOS',
  'CHOCOLATE',
  'CONSERVA DE CARNE',
  'CONSERVA DE LEGUMES',
  'CONSERVA DE PEIXE',
  'DETERGENTE',
  'DISCARTAVEIS',
  'DIVERSOS',
  'FARINHA',
  'FRALDAS',
  'GUARDNAPOS E PH',
  'LEITE',
  'MAIONESE E KETCHUP',
  'MASSAS',
  'MATERIAL DE ESCRITORIO',
  'OLEO E AZEITE',
  'PASTA DENETE E ESCOVA DENTE',
  'PERFUMS',
  'PLASTICO',
  'REBUCADOS',
  'SABONETE',
  'SUMOS',
].map((name) => ({ en: name, pt: name }));

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
