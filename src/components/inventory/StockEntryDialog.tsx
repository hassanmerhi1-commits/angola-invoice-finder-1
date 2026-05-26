import { useState, useMemo, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  PackagePlus,
  Search,
  Plus,
  Trash2,
  Save,
  Building2,
  Truck,
  AlertCircle,
  ClipboardList,
  ShoppingCart,
  ArrowRightLeft,
  Package,
  RotateCcw,
  ChevronDown,
  Loader2,
  X,
  Hash,
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { useBranches } from '@/hooks/useERP';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';

export type StockEntryReason =
  | 'adjustment'
  | 'purchase'
  | 'transfer_in'
  | 'initial'
  | 'correction';

export interface EntryItem {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  cost: number;
  currentStock: number;
  freightAllocation?: number;
  effectiveCost?: number;
}

interface StockEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  currentBranch: Branch | null;
  warehouseId: string | null;
  initialProduct?: Product | null;
  onApplyEntry: (
    items: EntryItem[],
    meta: {
      reason: StockEntryReason;
      sourceBranchId: string;
      sourceBranchName: string;
      reference: string;
      notes: string;
    },
  ) => void | Promise<void>;
}

const REASON_ICONS: Record<StockEntryReason, typeof PackagePlus> = {
  adjustment: ClipboardList,
  purchase: ShoppingCart,
  transfer_in: ArrowRightLeft,
  initial: Package,
  correction: RotateCcw,
};

const emptyForm = () => ({
  searchTerm: '',
  searchFocused: false,
  entryReason: 'adjustment' as StockEntryReason,
  sourceBranch: '',
  reference: '',
  notes: '',
  items: [] as EntryItem[],
  newItemQty: {} as Record<string, number>,
  freightCost: 0,
  otherCosts: 0,
  otherCostsDescription: '',
  freightOpen: false,
});

export function StockEntryDialog({
  open,
  onOpenChange,
  products,
  currentBranch,
  warehouseId,
  initialProduct,
  onApplyEntry,
}: StockEntryDialogProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const { branches } = useBranches();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const sourceBranches = useMemo(
    () => branches.filter((b) => b.id !== currentBranch?.id),
    [branches, currentBranch],
  );

  const entryReasons = useMemo(
    () =>
      (
        [
          { value: 'adjustment' as const, label: t.stockEntryUi.reasonAdjustment },
          { value: 'purchase' as const, label: t.stockEntryUi.reasonPurchase },
          { value: 'transfer_in' as const, label: t.stockEntryUi.reasonTransferIn },
          { value: 'initial' as const, label: t.stockEntryUi.reasonInitial },
          { value: 'correction' as const, label: t.stockEntryUi.reasonCorrection },
        ] as const
      ).map((r) => ({ ...r, Icon: REASON_ICONS[r.value] })),
    [language, t.stockEntryUi],
  );

  const filteredProducts = useMemo(() => {
    const active = products.filter((p) => p.isActive !== false);
    const inList = new Set(form.items.map((i) => i.productId));
    const pool = active.filter((p) => !inList.has(p.id));
    if (!form.searchTerm.trim()) {
      return pool.slice(0, 12);
    }
    const term = form.searchTerm.toLowerCase();
    return pool
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(term) ||
          p.name.toLowerCase().includes(term) ||
          p.barcode?.toLowerCase().includes(term),
      )
      .slice(0, 12);
  }, [products, form.searchTerm, form.items]);

  const entryNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `ENT-${currentBranch?.code || 'XX'}-${date}-${seq}`;
  }, [currentBranch, open]);

  const handleAddItem = (product: Product) => {
    const qty = form.newItemQty[product.id] || 1;
    const existing = form.items.find((i) => i.productId === product.id);

    setForm((prev) => {
      const nextItems = existing
        ? prev.items.map((i) =>
            i.productId === product.id ? { ...i, quantity: i.quantity + qty } : i,
          )
        : [
            ...prev.items,
            {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              unit: product.unit,
              quantity: qty,
              cost: product.cost || 0,
              currentStock: product.stock ?? 0,
            },
          ];
      return {
        ...prev,
        items: nextItems,
        newItemQty: { ...prev.newItemQty, [product.id]: 1 },
        searchTerm: '',
        searchFocused: false,
      };
    });
  };

  const handleRemoveItem = (productId: string) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }));
  };

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      handleRemoveItem(productId);
      return;
    }
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
    }));
  };

  const handleUpdateCost = (productId: string, cost: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((i) =>
        i.productId === productId ? { ...i, cost: Math.max(0, cost) } : i,
      ),
    }));
  };

  const itemsValue = useMemo(
    () => form.items.reduce((sum, i) => sum + i.quantity * i.cost, 0),
    [form.items],
  );

  const totalLandingCosts = form.freightCost + form.otherCosts;

  const freightAllocations = useMemo(() => {
    if (itemsValue === 0 || totalLandingCosts === 0) return {};
    const allocations: Record<string, number> = {};
    form.items.forEach((item) => {
      const itemValue = item.quantity * item.cost;
      const proportion = itemValue / itemsValue;
      allocations[item.productId] = (totalLandingCosts * proportion) / item.quantity;
    });
    return allocations;
  }, [form.items, itemsValue, totalLandingCosts]);

  const totals = useMemo(
    () => ({
      items: form.items.length,
      units: form.items.reduce((sum, i) => sum + i.quantity, 0),
      value: itemsValue + totalLandingCosts,
    }),
    [form.items, itemsValue, totalLandingCosts],
  );

  const needsSourceBranch = form.entryReason === 'transfer_in';
  const showPicker = form.searchFocused || form.searchTerm.trim().length > 0;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', {
      style: 'currency',
      currency: 'AOA',
      maximumFractionDigits: 0,
    }).format(value);

  const handleApply = async () => {
    if (!warehouseId) {
      toast({
        title: t.stockEntryUi.branchRequiredTitle,
        description: t.stockEntryUi.branchRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    if (form.items.length === 0) {
      toast({
        title: t.stockEntryUi.noItemsTitle,
        description: t.stockEntryUi.addAtLeastOne,
        variant: 'destructive',
      });
      return;
    }

    if (needsSourceBranch && !form.sourceBranch) {
      toast({
        title: t.stockEntryUi.sourceBranchRequiredTitle,
        description: t.stockEntryUi.selectSourceBranchDesc,
        variant: 'destructive',
      });
      return;
    }

    const sourceBranchName =
      branches.find((b) => b.id === form.sourceBranch)?.name || t.stockEntryUi.notApplicable;

    const itemsWithFreight = form.items.map((item) => ({
      ...item,
      freightAllocation: freightAllocations[item.productId] || 0,
      effectiveCost: item.cost + (freightAllocations[item.productId] || 0),
    }));

    setSubmitting(true);
    try {
      await onApplyEntry(itemsWithFreight, {
        reason: form.entryReason,
        sourceBranchId: form.sourceBranch,
        sourceBranchName,
        reference: form.reference || entryNumber,
        notes: form.notes,
      });
      resetForm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const branchLabel = currentBranch?.name || t.stockEntryUi.thisBranch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[min(92vh,860px)] p-0 gap-0 overflow-hidden flex flex-col [&>button]:hidden">
        {/* Header */}
        <div className="shrink-0 border-b bg-gradient-to-r from-emerald-500/10 via-background to-background px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <PackagePlus className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold leading-tight">
                  {t.stockEntryUi.title}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">
                  {t.stockEntryUi.description.replace('{branch}', branchLabel)}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="secondary" className="font-normal gap-1">
                    <Building2 className="h-3 w-3" />
                    {branchLabel}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs gap-1">
                    <Hash className="h-3 w-3" />
                    {entryNumber}
                  </Badge>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8"
              onClick={() => onOpenChange(false)}
              aria-label={t.common.cancel}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!warehouseId && (
          <Alert variant="destructive" className="mx-5 mt-3 shrink-0">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t.stockEntryUi.branchRequiredDesc}</AlertDescription>
          </Alert>
        )}

        {/* Body: sidebar + main */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left — document */}
          <aside className="w-[min(100%,300px)] shrink-0 border-r bg-muted/25 flex flex-col overflow-y-auto">
            <div className="p-4 space-y-4">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.stockEntryUi.entryReason}
                </Label>
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  {entryReasons.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          entryReason: value,
                          sourceBranch: value === 'transfer_in' ? p.sourceBranch : '',
                        }))
                      }
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                        form.entryReason === value
                          ? 'border-emerald-600 bg-emerald-600/10 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-600/40'
                          : 'border-border bg-background hover:bg-accent/60',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          form.entryReason === value ? 'text-emerald-600' : 'text-muted-foreground',
                        )}
                      />
                      <span className="font-medium leading-snug">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {needsSourceBranch && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  <Label className="text-sm">
                    {t.stockEntryUi.sourceBranch} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.sourceBranch}
                    onValueChange={(v) => setForm((p) => ({ ...p, sourceBranch: v }))}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder={t.stockEntryUi.selectSource} />
                    </SelectTrigger>
                    <SelectContent className="z-[200]">
                      {sourceBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-sm">{t.stockEntryUi.reference}</Label>
                <Input
                  value={form.reference}
                  onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                  placeholder={t.stockEntryUi.referencePlaceholder}
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">{t.stockEntryUi.notes}</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder={t.stockEntryUi.notesPlaceholder}
                  rows={3}
                  className="bg-background resize-none"
                />
              </div>

              <Collapsible
                open={form.freightOpen}
                onOpenChange={(freightOpen) => setForm((p) => ({ ...p, freightOpen }))}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between h-9 px-2 text-sm font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      {t.stockEntryUi.freightOptional}
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform',
                        form.freightOpen && 'rotate-180',
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t.stockEntryUi.freightLabel}</Label>
                      <NumericInput
                        min={0}
                        value={form.freightCost}
                        onValueChange={(v) => setForm((p) => ({ ...p, freightCost: v }))}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t.stockEntryUi.otherCostsLabel}</Label>
                      <NumericInput
                        min={0}
                        value={form.otherCosts}
                        onValueChange={(v) => setForm((p) => ({ ...p, otherCosts: v }))}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <Input
                    value={form.otherCostsDescription}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, otherCostsDescription: e.target.value }))
                    }
                    placeholder={t.stockEntryUi.otherCostsDescPlaceholder}
                    className="h-9 text-sm bg-background"
                  />
                  {totalLandingCosts > 0 && form.items.length > 0 && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t.stockEntryUi.landingCostsHint
                        .replace('{count}', String(form.items.length))
                        .replace(
                          '{perUnit}',
                          formatCurrency(totalLandingCosts / Math.max(1, totals.units)),
                        )}
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          </aside>

          {/* Right — products & lines */}
          <div className="flex flex-1 flex-col min-w-0 min-h-0">
            {/* Search */}
            <div className="shrink-0 p-4 pb-2 space-y-2 border-b bg-background/80">
              {initialProduct &&
                !form.items.some((i) => i.productId === initialProduct.id) && (
                  <div className="flex items-center gap-3 rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/5 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.stockEntryUi.selectedProduct}
                      </p>
                      <p className="text-sm font-medium truncate">{initialProduct.name}</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {initialProduct.sku} · {t.stockEntryUi.currentStock}:{' '}
                        {initialProduct.stock ?? 0}
                      </p>
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => handleAddItem(initialProduct)}>
                      <Plus className="h-4 w-4 mr-1" />
                      {t.stockEntryUi.addSelected}
                    </Button>
                  </div>
                )}

              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t.stockEntryUi.addProducts}
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t.stockEntryUi.searchPlaceholder}
                  value={form.searchTerm}
                  onChange={(e) => setForm((p) => ({ ...p, searchTerm: e.target.value }))}
                  onFocus={() => setForm((p) => ({ ...p, searchFocused: true }))}
                  onBlur={() => {
                    window.setTimeout(
                      () => setForm((p) => ({ ...p, searchFocused: false })),
                      150,
                    );
                  }}
                  className="pl-10 h-10 bg-background"
                />
              </div>
              {!showPicker && (
                <p className="text-xs text-muted-foreground">{t.stockEntryUi.searchHint}</p>
              )}
            </div>

            {showPicker && filteredProducts.length > 0 && (
              <div className="shrink-0 max-h-36 overflow-y-auto border-b bg-popover/50 px-2 py-1">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent transition-colors"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleAddItem(p)}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                      <p className="text-sm truncate">{p.name}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-normal text-xs">
                      {p.stock ?? 0} {p.unit}
                    </Badge>
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <NumericInput
                        integer
                        min={1}
                        value={form.newItemQty[p.id] ?? 1}
                        onValueChange={(qty) =>
                          setForm((prev) => ({
                            ...prev,
                            newItemQty: { ...prev.newItemQty, [p.id]: qty },
                          }))
                        }
                        className="w-16 h-8"
                      />
                      <Button
                        type="button"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleAddItem(p)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Line items */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  {t.stockEntryUi.linesTitle}
                  {form.items.length > 0 && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      ({form.items.length})
                    </span>
                  )}
                </h3>
                {form.items.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setForm((p) => ({ ...p, items: [] }))}
                  >
                    {t.stockEntryUi.clearAll}
                  </Button>
                )}
              </div>

              {form.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 rounded-xl border border-dashed bg-muted/20 text-center">
                  <PackagePlus className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="font-medium text-muted-foreground">{t.stockEntryUi.emptyTitle}</p>
                  <p className="text-sm text-muted-foreground/80 mt-1 max-w-xs">
                    {t.stockEntryUi.emptyHint}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {form.items.map((item) => {
                    const freightPerUnit = freightAllocations[item.productId] || 0;
                    const effectiveCost = item.cost + freightPerUnit;
                    const stockAfter = item.currentStock + item.quantity;
                    const lineTotal = item.quantity * effectiveCost;

                    return (
                      <li
                        key={item.productId}
                        className="rounded-xl border bg-card shadow-sm overflow-hidden"
                      >
                        <div className="flex items-start gap-2 px-3 py-2.5 border-b bg-muted/30">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">{item.name}</p>
                            <p className="text-xs font-mono text-muted-foreground mt-0.5">{item.sku}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveItem(item.productId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3">
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase text-muted-foreground">
                              {t.stockEntryUi.colStock}
                            </span>
                            <p className="text-sm font-medium tabular-nums">
                              {item.currentStock}
                              <span className="text-muted-foreground mx-1">→</span>
                              <span className="text-emerald-600 dark:text-emerald-400" title={t.stockEntryUi.stockAfter}>
                                {stockAfter}
                              </span>
                            </p>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              {t.stockEntryUi.colQty}
                            </Label>
                            <NumericInput
                              integer
                              min={1}
                              value={item.quantity}
                              onValueChange={(qty) => handleUpdateQuantity(item.productId, qty)}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">
                              {t.stockEntryUi.colCost}
                            </Label>
                            <NumericInput
                              min={0}
                              value={item.cost}
                              onValueChange={(c) => handleUpdateCost(item.productId, c)}
                              className="h-9 font-mono text-sm"
                            />
                          </div>
                          <div className="space-y-1 sm:text-right">
                            <span className="text-[10px] uppercase text-muted-foreground block">
                              {t.stockEntryUi.colTotal}
                            </span>
                            <p className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400">
                              {formatCurrency(lineTotal)}
                            </p>
                            {freightPerUnit > 0 && (
                              <p className="text-[10px] text-muted-foreground">
                                {t.stockEntryUi.freightPerUnit
                                  .replace('{amount}', formatCurrency(freightPerUnit))
                                  .replace('{unit}', item.unit)}
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t bg-muted/30 px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryItems}: </span>
              <span className="font-semibold tabular-nums">{totals.items}</span>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-5" />
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryUnits}: </span>
              <span className="font-semibold tabular-nums">{totals.units}</span>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-5" />
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryGrandTotal}: </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {formatCurrency(totals.value)}
              </span>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t.common.cancel}
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
              onClick={() => void handleApply()}
              disabled={form.items.length === 0 || !warehouseId || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t.stockEntryUi.applying}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t.stockEntryUi.confirm.replace('{count}', String(form.items.length))}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
