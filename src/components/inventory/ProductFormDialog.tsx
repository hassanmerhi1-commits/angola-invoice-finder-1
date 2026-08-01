import { useState, useEffect, useMemo } from 'react';
import { Product } from '@/types/erp';
import { useBranches, useCategories, useSuppliers } from '@/hooks/useERP';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { ALLOWED_VAT_RATES } from '@/lib/taxUtils';
import {
  mergeInventoryFoodCategorySelectOptions,
  resolveProductCategoryName,
  defaultProductCategoryName,
} from '@/lib/inventoryFoodCategories';

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSave: (product: Product) => void;
}

const UNITS = [
  { value: 'un', label: 'Unidade' },
  { value: 'kg', label: 'Quilograma' },
  { value: 'g', label: 'Grama' },
  { value: 'l', label: 'Litro' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'cx', label: 'Caixa' },
  { value: 'pct', label: 'Pacote' },
];

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: ProductFormDialogProps) {
  const { branches } = useBranches();
  const { categories } = useCategories();
  const { suppliers, refreshSuppliers } = useSuppliers();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const activeCategories = useMemo(() => categories.filter(c => c.isActive), [categories]);
  const categorySelectOptions = useMemo(
    () => mergeInventoryFoodCategorySelectOptions(activeCategories),
    [activeCategories]
  );

  const [formData, setFormData] = useState({
    name: '',
    sku: '',
    barcode: '',
    category: '',
    price: 0,
    cost: 0,
    stock: 0,
    minStock: 0,
    maxStock: 0,
    unit: 'un',
    taxRate: null as number | null,
    branchId: 'all',
    supplierId: '',
    isActive: true,
  });

  useEffect(() => {
    if (open) void refreshSuppliers();
  }, [open, refreshSuppliers]);

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        sku: product.sku,
        barcode: product.barcode || '',
        category: resolveProductCategoryName(product.category, activeCategories),
        price: product.price,
        cost: product.cost,
        stock: product.stock,
        minStock: product.minStock || 0,
        maxStock: product.maxStock || 0,
        unit: product.unit,
        taxRate: product.taxRate,
        branchId: product.branchId,
        supplierId: product.supplierId || '',
        isActive: product.isActive,
      });
    } else {
      setFormData({
        name: '',
        sku: '',
        barcode: '',
        category: defaultProductCategoryName(activeCategories),
        price: 0,
        cost: 0,
        stock: 0,
        minStock: 0,
        maxStock: 0,
        unit: 'un',
        taxRate: null,
        branchId: 'all',
        supplierId: '',
        isActive: true,
      });
    }
  }, [product, open, activeCategories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.sku.trim()) {
      toast({
        title: t.productFormUi.errorTitle,
        description: t.productFormUi.nameSkuRequired,
        variant: 'destructive',
      });
      return;
    }

    if (formData.taxRate === null || formData.taxRate === undefined) {
      toast({
        title: t.productFormUi.errorTitle,
        description: t.productFormUi.ivaRequired,
        variant: 'destructive',
      });
      return;
    }

    if (formData.price < 0 || formData.cost < 0) {
      toast({
        title: t.productFormUi.errorTitle,
        description: t.productFormUi.priceCostNonNegative,
        variant: 'destructive',
      });
      return;
    }

    const selectedSupplier = suppliers.find(s => s.id === formData.supplierId);
    
    const savedProduct: Product = {
      id: product?.id || `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: formData.name.trim(),
      sku: formData.sku.trim().toUpperCase(),
      barcode: formData.barcode.trim() || undefined,
      category: resolveProductCategoryName(formData.category, activeCategories),
      price: formData.price,
      cost: formData.cost,
      firstCost: product?.firstCost || formData.cost,
      lastCost: formData.cost,
      avgCost: product?.avgCost || formData.cost,
      stock: formData.stock,
      minStock: formData.minStock || undefined,
      maxStock: formData.maxStock || undefined,
      unit: formData.unit,
      taxRate: formData.taxRate,
      branchId: formData.branchId,
      supplierId: formData.supplierId || undefined,
      supplierName: selectedSupplier?.name || undefined,
      isActive: formData.isActive,
      createdAt: product?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(savedProduct);
    onOpenChange(false);
    
    toast({
      title: product ? t.productFormUi.productUpdated : t.productFormUi.productCreated,
      description: t.productFormUi.savedDesc
        .replace('{name}', savedProduct.name)
        .replace('{action}', product ? t.productFormUi.actionUpdated : t.productFormUi.actionCreated),
    });
  };

  const preventWheelValueChange = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  const margin = formData.price > 0
    ? (((formData.price - formData.cost) / formData.price) * 100).toFixed(1)
    : '0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <form onSubmit={handleSubmit} className="flex max-h-[85dvh] flex-col">
          <DialogHeader className="px-6 pt-6 pb-3 pr-12">
            <DialogTitle>{product ? t.productFormUi.editTitle : t.productFormUi.newTitle}</DialogTitle>
            <DialogDescription>
              {t.productFormUi.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="name">{t.productFormUi.productNameLabel} *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.productFormUi.namePlaceholder}
                />
              </div>

              <div>
                <Label htmlFor="sku">SKU *</Label>
                <Input
                  id="sku"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                  placeholder="Ex: ARR-001"
                />
              </div>

              <div>
                <Label htmlFor="barcode">{t.productFormUi.barcodeLabel}</Label>
                <Input
                  id="barcode"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="Ex: 7891234567890"
                />
              </div>

              <div>
                <Label htmlFor="category">Categoria</Label>
                <Select
                  value={resolveProductCategoryName(formData.category, activeCategories)}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(60vh,320px)]">
                    {categorySelectOptions.map((opt) => {
                      const cat = activeCategories.find((c) => c.id === opt.key);
                      return (
                        <SelectItem key={opt.key} value={opt.name}>
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color || '#6b7280' }}
                            />
                            {opt.name}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="supplier">{t.productFormUi.supplierLabel}</Label>
                <Select
                  value={formData.supplierId || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, supplierId: value === 'none' ? '' : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.productFormUi.selectSupplier} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.productFormUi.none}</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="unit">Unidade</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((unit) => (
                      <SelectItem key={unit.value} value={unit.value}>
                        {unit.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="cost">Custo (Kz) *</Label>
                <NumericInput
                  id="cost"
                  min={0}
                  value={formData.cost}
                  onWheel={preventWheelValueChange}
                  onValueChange={(cost) => setFormData({ ...formData, cost })}
                />
              </div>

              <div>
                <Label htmlFor="price">{t.productFormUi.salePriceKz}</Label>
                <NumericInput
                  id="price"
                  min={0}
                  value={formData.price}
                  onWheel={preventWheelValueChange}
                  onValueChange={(price) => setFormData({ ...formData, price })}
                />
              </div>

              <div>
                <Label htmlFor="taxRate">{t.productFormUi.ivaLabel} *</Label>
                <Select
                  value={formData.taxRate === null || formData.taxRate === undefined ? undefined : String(formData.taxRate)}
                  onValueChange={(v) => setFormData({ ...formData, taxRate: Number(v) })}
                >
                  <SelectTrigger id="taxRate">
                    <SelectValue placeholder={t.productFormUi.ivaPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOWED_VAT_RATES.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="margin">Margem de Lucro</Label>
                <div id="margin" className="h-10 px-3 py-2 bg-muted rounded-md flex items-center font-medium">
                  {margin}%
                </div>
              </div>

              <div>
                <Label htmlFor="stock">Stock Inicial</Label>
                <NumericInput
                  id="stock"
                  integer
                  min={0}
                  value={formData.stock}
                  onWheel={preventWheelValueChange}
                  onValueChange={(stock) => setFormData({ ...formData, stock })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="minStock">{t.productFormUi.minStock}</Label>
                  <NumericInput
                    id="minStock"
                    integer
                    min={0}
                    value={formData.minStock || 0}
                    onWheel={preventWheelValueChange}
                    onValueChange={(minStock) => setFormData({ ...formData, minStock })}
                  />
                </div>
                <div>
                  <Label htmlFor="maxStock">{t.productFormUi.maxStock}</Label>
                  <NumericInput
                    id="maxStock"
                    integer
                    min={0}
                    value={formData.maxStock || 0}
                    onWheel={preventWheelValueChange}
                    onValueChange={(maxStock) => setFormData({ ...formData, maxStock })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="branch">Filial</Label>
                <Select
                  value={formData.branchId}
                  onValueChange={(value) => setFormData({ ...formData, branchId: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Filiais</SelectItem>
                    {branches.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 flex items-center gap-3">
                <Switch
                  id="isActive"
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label htmlFor="isActive">{t.common.active}</Label>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4 bg-background">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit">
              {product ? t.common.save : t.common.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}