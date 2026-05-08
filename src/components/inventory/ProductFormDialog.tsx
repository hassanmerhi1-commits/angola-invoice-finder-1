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

function resolveCategoryName(rawCategory: string | undefined, categories: Array<{ name: string }>) {
  const cleaned = String(rawCategory || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return categories[0]?.name || '';

  const exactMatch = categories.find((category) => category.name.toLowerCase() === cleaned.toLowerCase());
  if (exactMatch) return exactMatch.name;

  const compact = cleaned.toLowerCase().replace(/\s+/g, '');
  const repeatedMatch = categories.find((category) => {
    const token = category.name.toLowerCase().replace(/\s+/g, '');
    return token && compact.includes(token) && compact.replace(new RegExp(token, 'g'), '') === '';
  });

  return repeatedMatch?.name || cleaned;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: ProductFormDialogProps) {
  const { branches } = useBranches();
  const { categories } = useCategories();
  const { suppliers } = useSuppliers();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const activeCategories = useMemo(() => categories.filter(c => c.isActive), [categories]);

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
    taxRate: 14,
    branchId: 'all',
    supplierId: '',
    isActive: true,
  });

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        sku: product.sku,
        barcode: product.barcode || '',
        category: resolveCategoryName(product.category, activeCategories),
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
        category: activeCategories[0]?.name || '',
        price: 0,
        cost: 0,
        stock: 0,
        minStock: 0,
        maxStock: 0,
        unit: 'un',
        taxRate: 14,
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
      category: resolveCategoryName(formData.category, activeCategories),
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

  const margin = formData.price > 0 && formData.cost > 0
    ? (((formData.price - formData.cost) / formData.cost) * 100).toFixed(1)
    : '0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <form onSubmit={handleSubmit} className="flex max-h-[85dvh] flex-col">
          <DialogHeader className="px-6 pt-6 pb-3">
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
                  value={resolveCategoryName(formData.category, activeCategories)}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.name}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: cat.color || '#6b7280' }}
                          />
                          {cat.name}
                        </div>
                      </SelectItem>
                    ))}
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
                <Input
                  id="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.cost}
                  onWheel={preventWheelValueChange}
                  onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="price">Preço de Venda (Kz) *</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.price}
                  onWheel={preventWheelValueChange}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="taxRate">Taxa IVA (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.taxRate}
                  onWheel={preventWheelValueChange}
                  onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="margin">Margem de Lucro</Label>
                <div id="margin" className="h-10 px-3 py-2 bg-muted rounded-md flex items-center font-medium">
                  {margin}%
                </div>
              </div>

              <div>
                <Label htmlFor="stock">Stock Inicial</Label>
                <Input
                  id="stock"
                  type="number"
                  min="0"
                  value={formData.stock}
                  onWheel={preventWheelValueChange}
                  onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="minStock">Stock Mínimo</Label>
                  <Input
                    id="minStock"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={formData.minStock || ''}
                    onWheel={preventWheelValueChange}
                    onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <Label htmlFor="maxStock">Stock Máximo</Label>
                  <Input
                    id="maxStock"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={formData.maxStock || ''}
                    onWheel={preventWheelValueChange}
                    onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value) || 0 })}
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