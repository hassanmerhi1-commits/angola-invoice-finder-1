import { useState, useMemo, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  PackageMinus,
  Search,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  AlertCircle,
  X,
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';

export type StockExitReasonCode =
  | 'expired'
  | 'damaged'
  | 'loss'
  | 'internal_use'
  | 'sample'
  | 'donation'
  | 'adjustment';

const exitReasonColors: Record<string, string> = {
  expired: 'text-amber-600',
  damaged: 'text-red-600',
  loss: 'text-destructive',
  internal_use: 'text-blue-600',
  sample: 'text-purple-600',
  donation: 'text-emerald-600',
  adjustment: 'text-muted-foreground',
};

export interface ExitItem {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  currentStock: number;
  quantity: number;
  cost: number;
}

interface StockExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  currentBranch: Branch | null;
  warehouseId: string | null;
  initialProduct?: Product | null;
  onApplyExit: (
    items: ExitItem[],
    meta: { reasonCode: StockExitReasonCode; reasonLabel: string; notes: string; reference: string },
  ) => void | Promise<void>;
}

const emptyForm = () => ({
  searchTerm: '',
  reason: 'expired' as StockExitReasonCode,
  reference: '',
  notes: '',
  items: [] as ExitItem[],
  newItemQty: {} as Record<string, number>,
});

export function StockExitDialog({
  open,
  onOpenChange,
  products,
  currentBranch,
  warehouseId,
  initialProduct,
  onApplyExit,
}: StockExitDialogProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const EXIT_REASONS = useMemo(
    () => [
      { value: 'expired' as const, label: t.stockExitUi.reasonExpired, color: exitReasonColors.expired },
      { value: 'damaged' as const, label: t.stockExitUi.reasonDamaged, color: exitReasonColors.damaged },
      { value: 'loss' as const, label: t.stockExitUi.reasonLoss, color: exitReasonColors.loss },
      { value: 'internal_use' as const, label: t.stockExitUi.reasonInternalUse, color: exitReasonColors.internal_use },
      { value: 'sample' as const, label: t.stockExitUi.reasonSample, color: exitReasonColors.sample },
      { value: 'donation' as const, label: t.stockExitUi.reasonDonation, color: exitReasonColors.donation },
      { value: 'adjustment' as const, label: t.stockExitUi.reasonAdjustment, color: exitReasonColors.adjustment },
    ],
    [language, t.stockExitUi],
  );

  const filteredProducts = useMemo(() => {
    const withStock = products.filter((p) => p.isActive !== false && (p.stock ?? 0) > 0);
    if (!form.searchTerm.trim()) {
      return withStock.slice(0, 15);
    }
    const term = form.searchTerm.toLowerCase();
    return withStock
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(term) ||
          p.name.toLowerCase().includes(term) ||
          p.barcode?.toLowerCase().includes(term),
      )
      .slice(0, 15);
  }, [products, form.searchTerm]);

  const exitNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `SAI-${currentBranch?.code || 'XX'}-${date}-${seq}`;
  }, [currentBranch, open]);

  const handleAddItem = (product: Product) => {
    const qty = form.newItemQty[product.id] || 1;
    const stock = product.stock ?? 0;
    const existing = form.items.find((i) => i.productId === product.id);

    setForm((prev) => {
      const nextItems = existing
        ? prev.items.map((i) =>
            i.productId === product.id
              ? { ...i, quantity: Math.min(i.quantity + qty, stock), currentStock: stock }
              : i,
          )
        : [
            ...prev.items,
            {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              unit: product.unit,
              currentStock: stock,
              quantity: Math.min(qty, stock),
              cost: product.cost || 0,
            },
          ];
      return {
        ...prev,
        items: nextItems,
        newItemQty: { ...prev.newItemQty, [product.id]: 1 },
        searchTerm: '',
      };
    });
  };

  const handleRemoveItem = (productId: string) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }));
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    const item = form.items.find((i) => i.productId === productId);
    if (!item) return;

    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }

    const validQty = Math.min(quantity, item.currentStock);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((i) =>
        i.productId === productId ? { ...i, quantity: validQty } : i,
      ),
    }));
  };

  const totals = useMemo(
    () => ({
      items: form.items.length,
      units: form.items.reduce((sum, i) => sum + i.quantity, 0),
      value: form.items.reduce((sum, i) => sum + i.quantity * i.cost, 0),
    }),
    [form.items],
  );

  const handleApply = async () => {
    if (!warehouseId) {
      toast({
        title: t.stockExitUi.branchRequiredTitle,
        description: t.stockExitUi.branchRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    if (form.items.length === 0) {
      toast({
        title: t.stockExitUi.noItemsTitle,
        description: t.stockExitUi.addAtLeastOne,
        variant: 'destructive',
      });
      return;
    }

    if (form.reason === 'loss' && !form.notes.trim()) {
      toast({
        title: t.stockExitUi.notesRequiredTitle,
        description: t.stockExitUi.notesRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    const reasonLabel = EXIT_REASONS.find((r) => r.value === form.reason)?.label || form.reason;

    setSubmitting(true);
    try {
      await onApplyExit(form.items, {
        reasonCode: form.reason,
        reasonLabel,
        notes: form.notes,
        reference: form.reference || exitNumber,
      });
      resetForm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', {
      style: 'currency',
      currency: 'AOA',
    }).format(value);

  const branchLabel = currentBranch?.name || t.stockExitUi.thisBranch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col [&>button]:hidden">
        <div className="flex items-start justify-between gap-4 pr-1">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="w-5 h-5 text-destructive" />
              {t.stockExitUi.title}
            </DialogTitle>
            <DialogDescription>
              {t.stockExitUi.description.replace('{branch}', branchLabel)}
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            onClick={() => onOpenChange(false)}
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!warehouseId && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t.stockExitUi.branchRequiredDesc}</AlertDescription>
          </Alert>
        )}

        <div className="flex-1 overflow-hidden flex flex-col gap-4 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>{t.stockExitUi.exitNo}</Label>
              <Input value={exitNumber} readOnly className="font-mono bg-muted text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {t.stockExitUi.exitReason} *
              </Label>
              <Select
                value={form.reason}
                onValueChange={(v) => setForm((p) => ({ ...p, reason: v as StockExitReasonCode }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.stockExitUi.selectReason} />
                </SelectTrigger>
                <SelectContent className="bg-background border shadow-lg z-50">
                  {EXIT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className={r.color}>{r.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.stockExitUi.reference}</Label>
              <Input
                value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                placeholder={t.stockExitUi.referencePlaceholder}
              />
            </div>
          </div>

          {form.reason === 'loss' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t.stockExitUi.lossWarning}</AlertDescription>
            </Alert>
          )}

          {initialProduct && (initialProduct.stock ?? 0) > 0 &&
            !form.items.some((i) => i.productId === initialProduct.id) && (
            <div className="flex items-center justify-between gap-2 p-3 border rounded-lg bg-destructive/5">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t.stockExitUi.selectedProduct}</p>
                <p className="font-mono text-sm truncate">
                  {initialProduct.sku} — {initialProduct.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.stockExitUi.currentStock}: {initialProduct.stock}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => handleAddItem(initialProduct)}>
                <Plus className="w-4 h-4 mr-1" />
                {t.stockExitUi.addSelected}
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t.stockExitUi.addProducts}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t.stockExitUi.searchPlaceholder}
                value={form.searchTerm}
                onChange={(e) => setForm((p) => ({ ...p, searchTerm: e.target.value }))}
                className="pl-10"
              />
            </div>

            {filteredProducts.length > 0 ? (
              <div className="border rounded-lg max-h-44 overflow-auto">
                {filteredProducts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 hover:bg-muted border-b last:border-b-0 gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm mr-2">{p.sku}</span>
                      <span className="text-sm truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({t.stockExitUi.currentStock}: {p.stock})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <NumericInput
                        integer
                        min={1}
                        max={p.stock}
                        value={form.newItemQty[p.id] ?? 1}
                        onValueChange={(qty) =>
                          setForm((prev) => ({
                            ...prev,
                            newItemQty: { ...prev.newItemQty, [p.id]: qty },
                          }))
                        }
                        className="w-20 h-8"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        onClick={() => handleAddItem(p)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground px-1">{t.stockExitUi.noStockProducts}</p>
            )}
          </div>

          <ScrollArea className="flex-1 min-h-[140px] border rounded-lg">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[90px]">{t.stockExitUi.colCode}</TableHead>
                  <TableHead>{t.stockExitUi.colProduct}</TableHead>
                  <TableHead className="w-[44px] text-center">{t.stockExitUi.colUnit}</TableHead>
                  <TableHead className="w-[80px] text-center">{t.stockExitUi.colCurrentStock}</TableHead>
                  <TableHead className="w-[100px] text-center">{t.stockExitUi.colQtyOut}</TableHead>
                  <TableHead className="w-[100px] text-right">{t.stockExitUi.colUnitCost}</TableHead>
                  <TableHead className="w-[100px] text-right">{t.stockExitUi.colLossValue}</TableHead>
                  <TableHead className="w-[44px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                      <PackageMinus className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>{t.stockExitUi.emptyTitle}</p>
                      <p className="text-xs">{t.stockExitUi.emptyHint}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  form.items.map((item) => (
                    <TableRow key={item.productId} className="bg-red-50/50 dark:bg-red-950/20">
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="truncate max-w-[160px]">{item.name}</TableCell>
                      <TableCell className="text-center text-xs">{item.unit}</TableCell>
                      <TableCell className="text-center text-xs">{item.currentStock}</TableCell>
                      <TableCell>
                        <NumericInput
                          integer
                          min={1}
                          max={item.currentStock}
                          value={item.quantity}
                          onValueChange={(qty) => handleUpdateQuantity(item.productId, qty)}
                          className="h-8 text-center"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatCurrency(item.cost)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-destructive">
                        -{formatCurrency(item.quantity * item.cost)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => handleRemoveItem(item.productId)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          <div className="grid grid-cols-3 gap-3 p-3 border rounded-lg bg-red-50/80 dark:bg-red-950/30 text-center">
            <div>
              <p className="text-xs text-muted-foreground">{t.stockExitUi.summaryItems}</p>
              <p className="text-lg font-bold">{totals.items}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.stockExitUi.summaryUnits}</p>
              <p className="text-lg font-bold">{totals.units}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.stockExitUi.summaryLossValue}</p>
              <p className="text-lg font-bold text-destructive">-{formatCurrency(totals.value)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {t.stockExitUi.notes}
              {form.reason === 'loss' ? ' *' : ''}
            </Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              placeholder={t.stockExitUi.detailedReasonPlaceholder}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => void handleApply()}
            variant="destructive"
            disabled={form.items.length === 0 || !warehouseId || submitting}
          >
            <Save className="w-4 h-4 mr-2" />
            {submitting
              ? t.stockExitUi.applying
              : t.stockExitUi.confirm.replace('{count}', String(form.items.length))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
