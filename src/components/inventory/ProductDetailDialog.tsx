import { useState, useEffect, useMemo } from 'react';
import { Product } from '@/types/erp';
import { useBranches, useCategories, useSuppliers } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  mergeInventoryFoodCategorySelectOptions,
  resolveProductCategoryName,
  defaultProductCategoryName,
} from '@/lib/inventoryFoodCategories';

interface ProductDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSave: (product: Product) => void | Promise<void>;
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

const IVA_RATES = [0, 5, 7, 14];

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

export function ProductDetailDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: ProductDetailDialogProps) {
  const { branches } = useBranches();
  const { categories } = useCategories();
  const { suppliers } = useSuppliers();
  const { currentBranch } = useBranchContext();
  const { t } = useTranslation();

  const activeCategories = useMemo(() => categories.filter(c => c.isActive), [categories]);
  const activeSuppliers = useMemo(() => suppliers.filter(s => s.isActive), [suppliers]);
  const categorySelectOptions = useMemo(
    () => mergeInventoryFoodCategorySelectOptions(activeCategories),
    [activeCategories]
  );

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

  const [formData, setFormData] = useState({
    id: '',
    sku: '',
    name: '',
    category: '',
    unit: 'un',
    iva: 14,
    tipo: 'INVENTARIO',
    fornecedorName: '',
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

  useEffect(() => {
    if (product) {
      setFormData({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: resolveProductCategoryName(product.category, activeCategories),
        unit: product.unit,
        iva: product.taxRate,
        tipo: 'INVENTARIO',
        fornecedorName: product.supplierName || '',
        embalagem: 1,
        qtdMinima: 0,
        qtdMaxima: 0,
        price: product.price,
        price2: product.price2 || 0,
        price3: product.price3 || 0,
        price4: product.price4 || 0,
        priceIVA: +(product.price * (1 + product.taxRate / 100)).toFixed(2),
        cost: product.cost,
        avgCost: product.avgCost || product.cost,
        lastCost: product.lastCost || product.cost,
        stock: product.stock,
        branchId: product.branchId,
        isActive: product.isActive,
        barcode: product.barcode || '',
        barcodes: product.barcode
          ? [{ barPrice: product.barcode, embalagem: 1, priceLC: product.price, plu: '', ultimoCusto: product.lastCost || product.cost }]
          : [{ barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 }],
      });
    } else {
      setFormData({
        id: '',
        sku: '',
        name: '',
        category: defaultProductCategoryName(activeCategories),
        unit: 'un',
        iva: 14,
        tipo: 'INVENTARIO',
        fornecedorName: '',
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
        branchId: currentBranch && !currentBranch.isMain ? currentBranch.id : 'all',
        isActive: true,
        barcode: '',
        barcodes: [{ barPrice: '', embalagem: 1, priceLC: 0, plu: '', ultimoCusto: 0 }],
      });
    }
  }, [product, open, activeCategories, currentBranch?.id, currentBranch?.isMain]);

  const set = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  // Auto-calculate price with IVA when price or IVA changes (bidirectional)
  const updatePrice = (newPrice: number) => {
    set('price', newPrice);
    set('priceIVA', +(newPrice * (1 + formData.iva / 100)).toFixed(2));
  };

  const updatePriceFromIVA = (newPriceIVA: number) => {
    set('priceIVA', newPriceIVA);
    set('price', +(newPriceIVA / (1 + formData.iva / 100)).toFixed(2));
  };

  const updateIVA = (newIVA: number) => {
    set('iva', newIVA);
    set('priceIVA', +(formData.price * (1 + newIVA / 100)).toFixed(2));
  };

  const margin = formData.price > 0 && formData.cost > 0
    ? (((formData.price - formData.cost) / formData.cost) * 100).toFixed(2)
    : '0.00';

  const handleSave = async () => {
    const savedProduct: Product = {
      id: formData.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: formData.name,
      sku: formData.sku || `SKU-${Date.now()}`,
      barcode: formData.barcode || formData.barcodes[0]?.barPrice || undefined,
      category: resolveProductCategoryName(formData.category, activeCategories),
      price: formData.price,
      price2: formData.price2 || undefined,
      price3: formData.price3 || undefined,
      price4: formData.price4 || undefined,
      cost: formData.cost,
      firstCost: product?.firstCost || formData.cost,
      lastCost: formData.lastCost || formData.cost,
      avgCost: formData.avgCost || formData.cost,
      stock: formData.stock,
      unit: formData.unit,
      taxRate: formData.iva,
      branchId: formData.branchId,
      supplierName: formData.fornecedorName || undefined,
      isActive: formData.isActive,
      createdAt: product?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await onSave(savedProduct);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0" onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader className="px-4 py-2 border-b bg-muted/50">
          <DialogTitle className="text-sm">{t.productDetailUi.title}</DialogTitle>
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
                  <Select value={formData.fornecedorName || '__none__'} onValueChange={v => set('fornecedorName', v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t.productDetailUi.select} /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      <SelectItem value="__none__">—</SelectItem>
                      {activeSuppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
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
                <Row label={t.productDetailUi.vat}>
                  <Select value={String(formData.iva)} onValueChange={v => updateIVA(parseInt(v))}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50">
                      {IVA_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                  <Input type="number" step="0.01" value={formData.price} onChange={e => updatePrice(parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <Row label={t.productDetailUi.price1IncVat}>
                  <Input type="number" step="0.01" value={formData.priceIVA} onChange={e => updatePriceFromIVA(parseFloat(e.target.value) || 0)} className="h-7 text-xs font-medium" />
                </Row>
                <div className="border-t border-dashed my-1" />
                <Row label={t.productDetailUi.price2ExVat}>
                  <Input type="number" step="0.01" value={formData.price2} onChange={e => set('price2', parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price2IncVat} value={(formData.price2 * (1 + formData.iva / 100)).toFixed(2)} />
                <Row label={t.productDetailUi.price3ExVat}>
                  <Input type="number" step="0.01" value={formData.price3} onChange={e => set('price3', parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price3IncVat} value={(formData.price3 * (1 + formData.iva / 100)).toFixed(2)} />
                <Row label={t.productDetailUi.price4ExVat}>
                  <Input type="number" step="0.01" value={formData.price4} onChange={e => set('price4', parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
                </Row>
                <ReadOnlyRow label={t.productDetailUi.price4IncVat} value={(formData.price4 * (1 + formData.iva / 100)).toFixed(2)} />

                <h4 className="text-[11px] font-semibold border-b pb-1 mb-1 pt-2">{t.productDetailUi.costAkzTitle}</h4>
                <Row label={t.productDetailUi.currentCost}>
                  <Input type="number" step="0.01" value={formData.cost} onChange={e => set('cost', parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
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
                  <Input type="number" value={formData.stock} onChange={e => set('stock', parseInt(e.target.value) || 0)} className="h-7 text-xs" />
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
          <Button onClick={handleSave} size="sm" className="h-8 gap-1">
            <Check className="w-4 h-4" /> Guardar
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4" /> Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
