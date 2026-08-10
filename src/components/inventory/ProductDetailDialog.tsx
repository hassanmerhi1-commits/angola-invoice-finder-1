import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Product } from '@/types/erp';
import { useBranches, useCategories, useSuppliers } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Check, X, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useBranchContext } from '@/contexts/BranchContext';
import { ALLOWED_VAT_RATES, parseTaxRateOrNull } from '@/lib/taxUtils';
import {
  mergeInventoryFoodCategorySelectOptions,
  resolveProductCategoryName,
  defaultProductCategoryName,
} from '@/lib/inventoryFoodCategories';

import {
  enrichProductSupplier,
  resolveSupplierIdForProduct,
  mapApiProductRow,
  legacySupplierSelectValue,
  isLegacySupplierSelectValue,
  legacySupplierNameFromSelectValue,
  supplierIdsMatch,
} from '@/lib/productSupplierResolve';
import { buildSellingPriceBySku, withSellingPriceFromMap } from '@/lib/productDedupe';
import { readSellingPriceHintsSession } from '@/lib/sellingPriceHints';

interface ProductDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  /** Full catalog for resolving supplier from sibling branch rows (same SKU). */
  catalogProducts?: Product[];
  onSave: (product: Product) => void | Promise<void>;
  /** Called when a fresh API product row is loaded — keep the inventory grid in sync. */
  onProductLoaded?: (product: Product) => void;
  /** Pre-select supplier when creating from purchase invoice flow. */
  defaultSupplierName?: string;
  /** Inventory branch scope (overrides global top-nav branch when creating). */
  scopeBranchId?: string | null;
}

const UNITS = [
  { value: 'un', labelKey: 'un' },
  { value: 'kg', labelKey: 'kg' },
  { value: 'g', labelKey: 'g' },
  { value: 'l', labelKey: 'l' },
  { value: 'ml', labelKey: 'ml' },
  { value: 'cx', labelKey: 'cx' },
  { value: 'emb', labelKey: 'emb' },
  { value: 'pct', labelKey: 'pct' },
] as const;

// Simple row component for the form grid
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-1 min-h-[28px]">
      <Label className="text-[11px] truncate">{label}</Label>
      {children}
    </div>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Row label={label}>
      <div className="h-7 px-2 bg-muted rounded flex items-center text-xs font-mono text-right justify-end">
        {value}
      </div>
    </Row>
  );
}

function resolveProductSupplierId(
  product: Product | null | undefined,
  suppliers: { id: string; name: string }[],
  defaultSupplierName = '',
): string {
  const resolved = resolveSupplierIdForProduct(product, suppliers, defaultSupplierName);
  if (resolved) {
    const matched = suppliers.find((s) => supplierIdsMatch(s.id, resolved));
    if (matched) return matched.id;
  }
  const name = String(product?.supplierName ?? defaultSupplierName ?? '').trim();
  if (name) {
    const byName = suppliers.find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (byName) return byName.id;
    return legacySupplierSelectValue(name);
  }
  return '';
}

export function ProductDetailDialog({
  open,
  onOpenChange,
  product,
  catalogProducts = [],
  onSave,
  onProductLoaded,
  defaultSupplierName = '',
  scopeBranchId = null,
}: ProductDetailDialogProps) {
  const { branches } = useBranches();
  const { categories } = useCategories();
  const { suppliers, refreshSuppliers } = useSuppliers();
  const { currentBranch } = useBranchContext();
  const { t } = useTranslation();

  const [loadedProduct, setLoadedProduct] = useState<Product | null>(null);

  const effectiveProduct = useMemo(() => {
    const base = loadedProduct ?? product;
    if (!base) return null;
    const enriched = enrichProductSupplier(base, catalogProducts.length > 0 ? catalogProducts : [base]);
    // Fresh API row is the source of truth (cost + price1) — never re-blend a real,
    // non-zero price1 with stale session selling-price hints. But when Price 1 is blank
    // (0) for this row and the tier system relies on Price 2 / a sibling branch's price
    // — exactly what the inventory grid falls back to server-side (sqlGridDisplayPriceExpr)
    // — replicate that same zero-fill here. Otherwise the grid shows a filled-in price and
    // the detail dialog shows a bare 0 / different number for the same product.
    const ownPrice = Number(enriched.price) || 0;
    if (ownPrice > 0) return enriched;
    const ownTierFallback = Number(enriched.price2) || 0;
    if (ownTierFallback > 0) return { ...enriched, price: ownTierFallback };
    const hints = readSellingPriceHintsSession();
    const priceBySku = buildSellingPriceBySku(
      catalogProducts.length > 0 ? catalogProducts : [enriched],
      hints,
    );
    return withSellingPriceFromMap(enriched, priceBySku);
  }, [loadedProduct, product, catalogProducts]);

  const activeCategories = useMemo(() => categories.filter(c => c.isActive), [categories]);
  const supplierSelectOptions = useMemo(() => {
    const base = suppliers.filter((s) => s.isActive);
    const linkedId = String(effectiveProduct?.supplierId ?? '').trim();
    if (linkedId && !base.some((s) => supplierIdsMatch(s.id, linkedId))) {
      const linked = suppliers.find((s) => supplierIdsMatch(s.id, linkedId));
      if (linked) base.push(linked);
    }
    const resolvedId = resolveSupplierIdForProduct(effectiveProduct, base);
    if (resolvedId && !base.some((s) => s.id === resolvedId)) {
      const linked = suppliers.find((s) => s.id === resolvedId);
      if (linked) base.push(linked);
    }
    const legacyName = String(effectiveProduct?.supplierName ?? '').trim();
    if (
      legacyName
      && !base.some((s) => s.name.trim().toLowerCase() === legacyName.toLowerCase())
      && !resolvedId
    ) {
      base.push({
        id: legacySupplierSelectValue(legacyName),
        name: legacyName,
        isActive: true,
      } as (typeof base)[number]);
    }
    return base;
  }, [suppliers, effectiveProduct]);
  const categorySelectOptions = useMemo(
    () => mergeInventoryFoodCategorySelectOptions(activeCategories),
    [activeCategories]
  );

  useEffect(() => {
    if (!open) {
      setLoadedProduct(null);
      forceCloseRef.current = false;
      return;
    }
    void refreshSuppliers();
    if (!product?.id) {
      setLoadedProduct(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.products.get(product.id);
        if (!cancelled && !forceCloseRef.current && res.data) {
          const mapped = mapApiProductRow(res.data as Record<string, unknown>);
          setLoadedProduct(mapped);
          onProductLoaded?.(mapped);
        }
      } catch {
        if (!cancelled) setLoadedProduct(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, product?.id, refreshSuppliers, onProductLoaded]);

  // Fetch latest USD→AOA exchange rate for dual-currency cost display
  const [usdRate, setUsdRate] = useState<number>(0);
  useEffect(() => {
    if (!open) return;
    api.exchangeRates.latest()
      .then(res => {
        const rates = res.data as any[];
        const usd = rates?.find((r: any) => (r.from_currency || r.fromCurrency) === 'USD' && (r.to_currency || r.toCurrency) === 'AOA');
        if (usd) setUsdRate(parseFloat(usd.rate));
      })
      .catch(() => {});
  }, [open]);

  const formSnapshotRef = useRef('');
  /** Avoid re-filling the form when api.products.get returns after the user already edited. */
  const formInitKeyRef = useRef('');
  const apiHydratedIdRef = useRef<string | null>(null);
  const forceCloseRef = useRef(false);
  /** Mirrors the latest committed formData so effects can read it without re-running on every keystroke. */
  const formDataRef = useRef<Record<string, any> | null>(null);
  const [discardCloseOpen, setDiscardCloseOpen] = useState(false);
  /**
   * Per-tier percentage over Price 1, used as a UI helper: Price N = Price 1 x (1 + pct/100).
   * Only set while the user drives a tier from its % field; cleared when they type an exact
   * price into the box. Not persisted — on reopen the % is derived from the stored prices.
   */
  const [tierPct, setTierPct] = useState<{ 2?: number; 3?: number; 4?: number }>({});

  const [formData, setFormData] = useState({
    id: '',
    sku: '',
    name: '',
    category: '',
    unit: 'un',
    iva: null as number | null,
    vatOverride: false,
    tipo: 'INVENTARIO',
    fornecedorName: '',
    supplierId: '',
    embalagem: 1,
    qtdMinima: 0,
    qtdMaxima: 0,
    // Prices
    price: 0,
    price2: 0,
    price3: 0,
    price4: 0,
    priceIVA: 0,
    // Costs
    cost: 0,
    avgCost: 0,
    lastCost: 0,
    // Stock
    stock: 0,
    branchId: 'all',
    isActive: true,
    barcode: '',
    // Barcodes table
    barcodes: [
      { barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 },
    ],
  });

  const buildFormFromProduct = useCallback(
    (src: Product) => {
      const supplierId = resolveProductSupplierId(src, supplierSelectOptions);
      return {
        id: src.id,
        sku: src.sku,
        name: src.name,
        category: resolveProductCategoryName(src.category, activeCategories),
        unit: src.unit,
        iva: parseTaxRateOrNull(src.taxRate),
        vatOverride: !!src.vatOverride,
        tipo: 'INVENTARIO',
        fornecedorName:
          src.supplierName ||
          supplierSelectOptions.find((s) => s.id === supplierId)?.name ||
          '',
        supplierId,
        embalagem: 1,
        qtdMinima: 0,
        qtdMaxima: 0,
        price: src.price,
        price2: src.price2 || 0,
        price3: src.price3 || 0,
        price4: src.price4 || 0,
        priceIVA: +(src.price * (1 + src.taxRate / 100)).toFixed(2),
        cost: src.cost,
        avgCost: src.avgCost || src.cost,
        lastCost: src.lastCost || src.cost,
        stock: src.stock,
        branchId: src.branchId,
        isActive: src.isActive,
        barcode: src.barcode || '',
        barcodes: src.barcode
          ? [
              {
                barPrice: src.barcode,
                embalagem: 1,
                priceLC: src.price,
                plu: '',
                ultimoCusto: src.lastCost || src.cost,
              },
            ]
          : [{ barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 }],
      };
    },
    [activeCategories, supplierSelectOptions],
  );

  useEffect(() => {
    if (!open) {
      formSnapshotRef.current = '';
      formInitKeyRef.current = '';
      apiHydratedIdRef.current = null;
      return;
    }
    const initKey = effectiveProduct?.id || 'new';
    if (formInitKeyRef.current === initKey) return;
    formInitKeyRef.current = initKey;
    setTierPct({});

    if (effectiveProduct) {
      const next = buildFormFromProduct(effectiveProduct);
      formSnapshotRef.current = JSON.stringify(next);
      setFormData(next);
    } else {
      const supplierId = resolveProductSupplierId(null, supplierSelectOptions, defaultSupplierName);
      const next = {
        id: '',
        sku: '',
        name: '',
        category: defaultProductCategoryName(activeCategories),
        unit: 'un',
        iva: null,
        vatOverride: false,
        tipo: 'INVENTARIO',
        fornecedorName: defaultSupplierName.trim() || supplierSelectOptions.find((s) => s.id === supplierId)?.name || '',
        supplierId,
        embalagem: 1,
        qtdMinima: 0,
        qtdMaxima: 0,
        price: 0,
        price2: 0,
        price3: 0,
        price4: 0,
        priceIVA: 0,
        cost: 0,
        avgCost: 0,
        lastCost: 0,
        stock: 0,
        branchId:
          scopeBranchId ||
          (currentBranch && !currentBranch.isMain ? currentBranch.id : 'all'),
        isActive: true,
        barcode: '',
        barcodes: [{ barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 }],
      };
      formSnapshotRef.current = JSON.stringify(next);
      setFormData(next);
    }
  }, [
    effectiveProduct?.id,
    open,
    buildFormFromProduct,
    defaultSupplierName,
    scopeBranchId,
  ]);

  // Keep a ref mirror of the latest committed form so the hydration effect can read it without
  // re-running on every keystroke. Defined before the hydration effect so it flushes first.
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Apply API row once per open (before user edits) — do not re-run when suppliers list loads.
  // Side effects (ref mutations) are kept OUT of the setState updater so this stays correct under
  // React StrictMode, which double-invokes state updater functions in development.
  useEffect(() => {
    if (!open || !loadedProduct?.id) return;
    if (formInitKeyRef.current !== loadedProduct.id) return;
    if (apiHydratedIdRef.current === loadedProduct.id) return;
    // Only overwrite the form if the user hasn't edited it since it was initialized.
    const current = formDataRef.current;
    if (current != null && formSnapshotRef.current !== JSON.stringify(current)) return;
    const next = buildFormFromProduct(loadedProduct);
    apiHydratedIdRef.current = loadedProduct.id;
    formSnapshotRef.current = JSON.stringify(next);
    formDataRef.current = next;
    setTierPct({});
    setFormData(next);
  }, [loadedProduct, open, buildFormFromProduct]);

  const set = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const isFormDirty = useMemo(() => {
    if (!open || !formSnapshotRef.current) return false;
    return JSON.stringify(formData) !== formSnapshotRef.current;
  }, [open, formData]);

  const closeDialog = useCallback(() => {
    setDiscardCloseOpen(false);
    formSnapshotRef.current = '';
    formInitKeyRef.current = '';
    apiHydratedIdRef.current = null;
    onOpenChange(false);
  }, [onOpenChange]);

  const requestClose = useCallback(() => {
    if (!forceCloseRef.current && isFormDirty) {
      setDiscardCloseOpen(true);
      return;
    }
    closeDialog();
  }, [isFormDirty, closeDialog]);

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        onOpenChange(true);
        return;
      }
      requestClose();
    },
    [onOpenChange, requestClose],
  );

  // Changing Price 1 re-derives any tier that is currently driven by a % over Price 1.
  const updatePrice = (newPrice: number) => {
    setFormData((prev) => {
      const next: typeof prev = {
        ...prev,
        price: newPrice,
        priceIVA: +(newPrice * (1 + (prev.iva ?? 0) / 100)).toFixed(2),
      };
      ([2, 3, 4] as const).forEach((lvl) => {
        const pct = tierPct[lvl];
        if (pct != null) {
          (next as any)[`price${lvl}`] = +(newPrice * (1 + pct / 100)).toFixed(2);
        }
      });
      return next;
    });
  };

  const updatePriceFromIVA = (newPriceIVA: number) => {
    setFormData((prev) => ({
      ...prev,
      priceIVA: newPriceIVA,
      price: +(newPriceIVA / (1 + (prev.iva ?? 0) / 100)).toFixed(2),
    }));
  };

  const updateIVA = (newIVA: number) => {
    setFormData((prev) => ({
      ...prev,
      iva: newIVA,
      // Changing IVA on a branch product should stick (server also locks vat_override).
      vatOverride: prev.vatOverride || newIVA !== prev.iva,
      priceIVA: +(prev.price * (1 + newIVA / 100)).toFixed(2),
    }));
  };

  const margin = formData.price > 0 && formData.cost > 0
    ? (((formData.price - formData.cost) / formData.cost) * 100).toFixed(2)
    : '0.00';

  // Price 1 markup is over cost (base margin). Tiers 2/3/4 are a % over Price 1.
  const markupOverCost = (priceVal: number) =>
    formData.cost > 0 && priceVal > 0
      ? +(((priceVal - formData.cost) / formData.cost) * 100).toFixed(2)
      : 0;
  const pctOverPrice1 = (priceVal: number) =>
    formData.price > 0 && priceVal > 0
      ? +(((priceVal - formData.price) / formData.price) * 100).toFixed(2)
      : 0;

  // Value shown in each "%" field.
  const markupForLevel = (level: 1 | 2 | 3 | 4) => {
    if (level === 1) return markupOverCost(formData.price);
    const stored = tierPct[level];
    if (stored != null) return stored;
    const priceVal = (formData as any)[`price${level}`] as number;
    return pctOverPrice1(priceVal);
  };

  // Editing a "%" field: level 1 derives Price 1 from cost; tiers derive from Price 1.
  const updateMarkupForLevel = (level: 1 | 2 | 3 | 4, markupPct: number) => {
    if (level === 1) {
      const newPrice = +(formData.cost * (1 + (markupPct || 0) / 100)).toFixed(2);
      setFormData((prev) => ({
        ...prev,
        price: newPrice,
        priceIVA: +(newPrice * (1 + (prev.iva ?? 0) / 100)).toFixed(2),
      }));
      return;
    }
    const newPrice = +(formData.price * (1 + (markupPct || 0) / 100)).toFixed(2);
    setTierPct((prev) => ({ ...prev, [level]: markupPct }));
    const key = `price${level}` as 'price2' | 'price3' | 'price4';
    setFormData((prev) => ({ ...prev, [key]: newPrice }));
  };

  // Typing an exact value into a tier price box overrides its %.
  const setTierPrice = (level: 2 | 3 | 4, value: number) => {
    setTierPct((prev) => {
      const nextPct = { ...prev };
      delete nextPct[level];
      return nextPct;
    });
    const key = `price${level}` as 'price2' | 'price3' | 'price4';
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (saving) return;
    const skuTrim = String(formData.sku || '').trim();
    if (!skuTrim) {
      toast.error(t.productFormUi.nameSkuRequired);
      return;
    }
    if (formData.iva === null || formData.iva === undefined) {
      toast.error(t.productFormUi.ivaRequired);
      return;
    }

    const resolvedBranchId = (() => {
      if (!effectiveProduct && scopeBranchId) return scopeBranchId;
      if (currentBranch && !currentBranch.isMain) return currentBranch.id;
      if (formData.branchId && formData.branchId !== 'all') return formData.branchId;
      const main = branches.find((b) => b.isMain) ?? branches[0];
      return main?.id || scopeBranchId || '';
    })();

    const rawSupplierId = formData.supplierId;
    const selectedSupplier = isLegacySupplierSelectValue(rawSupplierId)
      ? undefined
      : supplierSelectOptions.find((s) => s.id === rawSupplierId);
    const resolvedSupplierName = isLegacySupplierSelectValue(rawSupplierId)
      ? legacySupplierNameFromSelectValue(rawSupplierId)
      : selectedSupplier?.name || formData.fornecedorName || undefined;
    const resolvedSupplierId = isLegacySupplierSelectValue(rawSupplierId)
      ? undefined
      : rawSupplierId || undefined;

    const isEdit = Boolean(effectiveProduct?.id || product?.id);
    const stockFromDb =
      loadedProduct?.stock ??
      effectiveProduct?.stock ??
      product?.stock ??
      formData.stock;

    const savedProduct: Product & { preserveStock?: boolean } = {
      id: formData.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: formData.name,
      sku: skuTrim,
      barcode: formData.barcode || formData.barcodes[0]?.barPrice || undefined,
      category: resolveProductCategoryName(formData.category, activeCategories),
      price: formData.price,
      price2: formData.price2 || undefined,
      price3: formData.price3 || undefined,
      price4: formData.price4 || undefined,
      cost: formData.cost,
      firstCost: effectiveProduct?.firstCost || product?.firstCost || formData.cost,
      lastCost: effectiveProduct?.lastCost || formData.lastCost || formData.cost,
      avgCost: formData.avgCost || formData.cost,
      stock: isEdit ? stockFromDb : formData.stock,
      preserveStock: isEdit,
      unit: formData.unit,
      taxRate: formData.iva,
      vatOverride: formData.vatOverride,
      // Only force when the user actually changed IVA in this session (incl. to 5%).
      forceVatChange:
        !!effectiveProduct?.id
        && formData.iva != null
        && Number(formData.iva) !== Number(effectiveProduct?.taxRate),
      branchId: resolvedBranchId,
      supplierId: resolvedSupplierId,
      supplierName: resolvedSupplierName,
      isActive: formData.isActive,
      createdAt: effectiveProduct?.createdAt || product?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    formSnapshotRef.current = JSON.stringify(formData);
    forceCloseRef.current = true;
    setDiscardCloseOpen(false);
    onOpenChange(false);

    setSaving(true);
    try {
      await onSave(savedProduct);
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : t.productFormUi.productSaveFailed;
      toast.error(message);
      forceCloseRef.current = false;
      onOpenChange(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 p-0 [&>button[data-dialog-close]]:hidden"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <DialogHeader className="flex flex-row items-center justify-between gap-2 space-y-0 border-b bg-muted/50 px-4 py-2 pr-4">
          <DialogTitle className="text-sm">{t.productDetailUi.title}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={requestClose}
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <Tabs defaultValue="info" className="flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 px-4 h-8">
            <TabsTrigger value="info" className="text-xs h-7">{t.productDetailUi.tabInfo}</TabsTrigger>
            <TabsTrigger value="barcodes" className="text-xs h-7">{t.productDetailUi.tabBarcodes}</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="m-0 p-0 overflow-y-auto max-h-[65vh]" onWheel={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-0 text-xs">
              {/* ── Column 1: Informações Gerais ── */}
              <div className="border-r p-3 space-y-1">
                <Row label={t.productDetailUi.code}>
                  <Input value={formData.sku} onChange={e => set('sku', e.target.value)} className="h-7 text-xs" />
                </Row>
                <Row label={t.common.description}>
                  <Input value={formData.name} onChange={e => set('name', e.target.value)} className="h-7 text-xs" />
                </Row>
                <Row label={t.inventory.category}>
                  <Select value={resolveProductCategoryName(formData.category, activeCategories)} onValueChange={v => set('category', v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50 max-h-[min(60vh,320px)]">
                      {categorySelectOptions.map((c) => (
                        <SelectItem key={c.key} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={t.productFormUi.supplierLabel}>
                  <Select
                    value={formData.supplierId || '__none__'}
                    onValueChange={(v) => {
                      const id = v === '__none__' ? '' : v;
                      const supplier = supplierSelectOptions.find((s) => s.id === id);
                      setFormData((prev) => ({
                        ...prev,
                        supplierId: id,
                        fornecedorName: supplier?.name || (isLegacySupplierSelectValue(id) ? legacySupplierNameFromSelectValue(id) : ''),
                      }));
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t.productDetailUi.select} /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      <SelectItem value="__none__">—</SelectItem>
                      {supplierSelectOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={t.productDetailUi.packaging}>
                  <Input type="number" value={formData.embalagem} onChange={e => set('embalagem', parseInt(e.target.value) || 1)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.minQty}>
                  <Input type="number" value={formData.qtdMinima} onChange={e => set('qtdMinima', parseInt(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.maxQty}>
                  <Input type="number" value={formData.qtdMaxima} onChange={e => set('qtdMaxima', parseInt(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <Row label={t.inventory.unit}>
                  <Select value={formData.unit} onValueChange={v => set('unit', v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      {UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {t.productDetailUi.units[u.labelKey as keyof typeof t.productDetailUi.units] as string}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={`${t.productDetailUi.vat} *`}>
                  <Select
                    value={formData.iva === null || formData.iva === undefined ? undefined : String(formData.iva)}
                    onValueChange={(v) => updateIVA(parseInt(v, 10))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder={t.productFormUi.ivaPlaceholder} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      {ALLOWED_VAT_RATES.map((r) => (
                        <SelectItem key={r} value={String(r)}>
                          {r}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={t.productDetailUi.vatLock}>
                  <div className="flex items-center gap-2 h-7">
                    <Switch
                      checked={!!formData.vatOverride}
                      onCheckedChange={(v) => set('vatOverride', v)}
                    />
                    <span className="text-[11px] text-muted-foreground leading-tight">
                      {t.productDetailUi.vatLockHint}
                    </span>
                  </div>
                </Row>
                <Row label={t.productDetailUi.type}>
                  <Select value={formData.tipo} onValueChange={v => set('tipo', v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      <SelectItem value="INVENTARIO">{t.productDetailUi.inventoryType}</SelectItem>
                      <SelectItem value="SERVICO">{t.productDetailUi.serviceType}</SelectItem>
                      <SelectItem value="CONSUMIVEL">{t.productDetailUi.consumableType}</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                <Row label={t.productFormUi.barcodeLabel}>
                  <Input value={formData.barcode} onChange={e => set('barcode', e.target.value)} className="h-7 text-xs" />
                </Row>
              </div>

              {/* ── Column 2: Preços & Custos ── */}
              <div className="border-r p-3 space-y-1">
              <h4 className="text-[11px] font-semibold border-b pb-1 mb-1">{t.productDetailUi.pricesTitle}</h4>
                <Row label={t.productDetailUi.price1ExVat}>
                  <NumericInput value={formData.price} onValueChange={updatePrice} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.price1IncVat}>
                  <NumericInput value={formData.priceIVA} onValueChange={updatePriceFromIVA} className="h-7 text-xs font-medium" />
                </Row>
                <Row label="Markup 1 % (cost)">
                  <NumericInput value={markupForLevel(1)} onValueChange={(v) => updateMarkupForLevel(1, v)} className="h-7 text-xs" />
                </Row>
                <div className="border-t border-dashed my-1" />
                <Row label={t.productDetailUi.price2ExVat}>
                  <NumericInput value={formData.price2} onValueChange={(v) => setTierPrice(2, v)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price2IncVat} value={(formData.price2 * (1 + (formData.iva ?? 0) / 100)).toFixed(2)} />
                <Row label="% over Price 1">
                  <NumericInput value={markupForLevel(2)} onValueChange={(v) => updateMarkupForLevel(2, v)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.price3ExVat}>
                  <NumericInput value={formData.price3} onValueChange={(v) => setTierPrice(3, v)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price3IncVat} value={(formData.price3 * (1 + (formData.iva ?? 0) / 100)).toFixed(2)} />
                <Row label="% over Price 1">
                  <NumericInput value={markupForLevel(3)} onValueChange={(v) => updateMarkupForLevel(3, v)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.price4ExVat}>
                  <NumericInput value={formData.price4} onValueChange={(v) => setTierPrice(4, v)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price4IncVat} value={(formData.price4 * (1 + (formData.iva ?? 0) / 100)).toFixed(2)} />
                <Row label="% over Price 1">
                  <NumericInput value={markupForLevel(4)} onValueChange={(v) => updateMarkupForLevel(4, v)} className="h-7 text-xs" />
                </Row>

                <h4 className="text-[11px] font-semibold border-b pb-1 mb-1 pt-2">{t.productDetailUi.costAkzTitle}</h4>
                <Row label={t.productDetailUi.currentCost}>
                  <NumericInput value={formData.cost} onValueChange={(v) => set('cost', v)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.initialCost} value={(product?.firstCost || formData.cost).toFixed(2)} />
                <ReadOnlyRow label={t.productDetailUi.avgCost} value={formData.avgCost.toFixed(2)} />
                <ReadOnlyRow label={t.productDetailUi.lastCost} value={formData.lastCost.toFixed(2)} />

                {usdRate > 0 && (
                  <>
                    <h4 className="text-[11px] font-semibold border-b pb-1 mb-1 pt-2">{t.productDetailUi.costUsdTitle}</h4>
                    <ReadOnlyRow label={t.productDetailUi.currentCost} value={(formData.cost / usdRate).toFixed(4)} />
                    <ReadOnlyRow label={t.productDetailUi.initialCost} value={((product?.firstCost || formData.cost) / usdRate).toFixed(4)} />
                    <ReadOnlyRow label={t.productDetailUi.avgCost} value={(formData.avgCost / usdRate).toFixed(4)} />
                    <ReadOnlyRow label={t.productDetailUi.lastCost} value={(formData.lastCost / usdRate).toFixed(4)} />
                  </>
                )}

                <h4 className="text-[11px] font-semibold border-b pb-1 mb-1 pt-2">{t.productDetailUi.marginPackagingTitle}</h4>
                <ReadOnlyRow label="Markup %" value={`${margin}%`} />
                <ReadOnlyRow label={t.productDetailUi.netMargin} value={formData.price > 0 ? (((formData.price - formData.cost) / formData.price) * 100).toFixed(2) + '%' : '0.00%'} />
                <ReadOnlyRow label={t.productDetailUi.packagingCost} value={(formData.cost * (formData.embalagem || 1)).toFixed(2)} />
                {usdRate > 0 && (
                  <ReadOnlyRow label={t.productDetailUi.packagingCostUsd} value={((formData.cost * (formData.embalagem || 1)) / usdRate).toFixed(4)} />
                )}
              </div>

              {/* ── Column 3: Stock & Filial ── */}
              <div className="p-3 space-y-1">
                <h4 className="text-[11px] font-semibold border-b pb-1 mb-1">{t.productDetailUi.stockBranchTitle}</h4>
                <Row label={t.inventory.stock}>
                  <NumericInput integer value={formData.stock} onValueChange={(v) => set('stock', v)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.branch}>
                  <Select value={formData.branchId} onValueChange={v => set('branchId', v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      <SelectItem value="all">{t.productDetailUi.all}</SelectItem>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Row>
                <div className="flex items-center gap-2 pt-2">
                  <Switch checked={formData.isActive} onCheckedChange={v => set('isActive', v)} />
                  <Label className="text-[11px]">{t.productDetailUi.activeProduct}</Label>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="barcodes" className="m-0 p-4 overflow-y-auto max-h-[65vh]" onWheel={e => e.stopPropagation()}>
            <table className="w-full text-xs border">
              <thead>
                <tr className="bg-muted">
                  <th className="border p-2 text-left">{t.productDetailUi.invBarcode}</th>
                  <th className="border p-2 text-left">{t.productDetailUi.packaging}</th>
                  <th className="border p-2 text-left">{t.productDetailUi.priceLc}</th>
                  <th className="border p-2 text-left">PLU</th>
                  <th className="border p-2 text-left">{t.productDetailUi.lastCostCol}</th>
                </tr>
              </thead>
              <tbody>
                {formData.barcodes.map((bc, idx) => (
                  <tr key={idx}>
                    <td className="border p-1">
                      <Input value={bc.barPrice} onChange={e => {
                        const b = [...formData.barcodes]; b[idx] = { ...bc, barPrice: e.target.value };
                        set('barcodes', b);
                      }} className="h-6 text-xs" />
                    </td>
                    <td className="border p-1">
                      <Input type="number" value={bc.embalagem} onChange={e => {
                        const b = [...formData.barcodes]; b[idx] = { ...bc, embalagem: parseInt(e.target.value) || 1 };
                        set('barcodes', b);
                      }} className="h-6 text-xs" />
                    </td>
                    <td className="border p-1">
                      <Input type="number" value={bc.priceLC} onChange={e => {
                        const b = [...formData.barcodes]; b[idx] = { ...bc, priceLC: parseFloat(e.target.value) || 0 };
                        set('barcodes', b);
                      }} className="h-6 text-xs" />
                    </td>
                    <td className="border p-1">
                      <Input value={bc.plu} onChange={e => {
                        const b = [...formData.barcodes]; b[idx] = { ...bc, plu: e.target.value };
                        set('barcodes', b);
                      }} className="h-6 text-xs" />
                    </td>
                    <td className="border p-1">
                      <Input type="number" value={bc.ultimoCusto} onChange={e => {
                        const b = [...formData.barcodes]; b[idx] = { ...bc, ultimoCusto: parseFloat(e.target.value) || 0 };
                        set('barcodes', b);
                      }} className="h-6 text-xs" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => set('barcodes', [...formData.barcodes, { barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 }])}>
              <Plus className="w-3 h-3 mr-1" /> {t.productDetailUi.addBarcode}
            </Button>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/50">
          <Button variant="outline" onClick={handleSave} size="sm" className="h-8 gap-1 text-foreground border-foreground hover:bg-muted" disabled={saving}>
            <Check className="w-4 h-4" /> {saving ? t.common.saving : t.common.save}
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={requestClose}>
            <X className="w-4 h-4" /> {t.common.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={discardCloseOpen} onOpenChange={setDiscardCloseOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.common.confirmDiscardTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.common.confirmDiscardDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.keepEditing}</AlertDialogCancel>
          <AlertDialogAction onClick={closeDialog}>{t.common.discardAndClose}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
