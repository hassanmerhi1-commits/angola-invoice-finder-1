import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  PackageMinus,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  AlertCircle,
  Loader2,
  X,
  Hash,
  StickyNote,
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { useBranches } from '@/hooks/useERP';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  DEFAULT_LINE_ROWS,
  PRODUCT_LINE_SUGGESTION_LIMIT,
  ROWS_APPEND_BATCH,
  ROWS_NEAR_END_BUFFER,
  dedupeProductsBySku,
  ensureRowsForIndex,
  filterProductsForSearch,
  newLineRowId,
  sortProductSearchResults,
} from './productLineSearch';

const EXIT_CURRENCIES = ['KZ', 'USD', 'EUR'] as const;
const DEFAULT_EXIT_ROWS = DEFAULT_LINE_ROWS;
const SUGGESTION_LIMIT = PRODUCT_LINE_SUGGESTION_LIMIT;

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
  branchId: string;
  branchName: string;
}

interface ExitLineRow {
  rowId: string;
  productId: string | null;
  search: string;
  quantity: number;
}

interface StockExitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  searchProducts?: Product[];
  currentBranch: Branch | null;
  warehouseId: string | null;
  initialProduct?: Product | null;
  onApplyExit: (
    items: ExitItem[],
    meta: {
      reasonCode: StockExitReasonCode;
      reasonLabel: string;
      notes: string;
      reference: string;
      exitDate: string;
      warehouseId: string;
      branchName: string;
      currency: string;
      currencyRate: number;
    },
  ) => void | Promise<void>;
}

const todayIsoDate = () => format(new Date(), 'yyyy-MM-dd');

const createEmptyLine = (): ExitLineRow => ({
  rowId: newLineRowId(),
  productId: null,
  search: '',
  quantity: 1,
});

const createInitialLines = (count = DEFAULT_EXIT_ROWS): ExitLineRow[] =>
  Array.from({ length: count }, () => createEmptyLine());

const emptyForm = () => ({
  reason: 'expired' as StockExitReasonCode,
  exitDate: todayIsoDate(),
  exitBranchId: '',
  currency: 'KZ',
  currencyRate: 1,
  reference: '',
  notes: '',
  lines: createInitialLines(),
});

export function StockExitDialog({
  open,
  onOpenChange,
  products,
  searchProducts,
  currentBranch,
  warehouseId,
  initialProduct,
  onApplyExit,
}: StockExitDialogProps) {
  const { toast } = useToast();
  const { t, language } = useTranslation();
  const { branches } = useBranches();
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerHighlightIndex, setPickerHighlightIndex] = useState(0);
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const productInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const linesRef = useRef(form.lines);
  linesRef.current = form.lines;
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);

  const catalogProducts = useMemo(() => {
    if (searchProducts && searchProducts.length > 0) return searchProducts;
    return products;
  }, [searchProducts, products]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      if (b.id) map.set(b.id, b.name);
    }
    return map;
  }, [branches]);

  const productsById = useMemo(
    () => new Map(catalogProducts.map((p) => [p.id, p])),
    [catalogProducts],
  );

  const searchableProducts = useMemo(
    () => catalogProducts.filter((p) => p.isActive !== false),
    [catalogProducts],
  );

  const resolveProductForExit = useCallback(
    (product: Product): Product => {
      if ((product.stock ?? 0) > 0) return product;

      const branchId = form.exitBranchId || warehouseId || currentBranch?.id || '';
      const skuNorm = (product.sku || '').trim().toLowerCase();
      if (!branchId || !skuNorm) return product;

      const forBranch = searchableProducts.find(
        (p) =>
          (p.sku || '').trim().toLowerCase() === skuNorm
          && (p.branchId || '') === branchId
          && (p.stock ?? 0) > 0,
      );
      return forBranch ?? product;
    },
    [searchableProducts, form.exitBranchId, warehouseId, currentBranch?.id],
  );

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setSubmitting(false);
    setNotesOpen(false);
    setPickerRowId(null);
    setPickerHighlightIndex(0);
  }, []);

  const focusProductRow = useCallback((rowIndex: number) => {
    setForm((prev) => {
      const nextLines = ensureRowsForIndex(prev.lines, rowIndex, createEmptyLine);
      const row = nextLines[rowIndex];
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (row) productInputRefs.current[row.rowId]?.focus();
        });
      });
      if (nextLines.length === prev.lines.length) return prev;
      return { ...prev, lines: nextLines };
    });
  }, []);

  const focusQtyLine = useCallback((rowId: string) => {
    requestAnimationFrame(() => {
      const el = qtyRefs.current[rowId];
      el?.focus();
      el?.select();
    });
  }, []);

  const syncPickerAnchor = useCallback((rowId: string | null) => {
    if (!rowId) {
      setPickerAnchorRect(null);
      return;
    }
    const el = productInputRefs.current[rowId];
    setPickerAnchorRect(el ? el.getBoundingClientRect() : null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
      setPickerAnchorRect(null);
      return;
    }
    const lines = createInitialLines();
    if (initialProduct && (initialProduct.stock ?? 0) > 0) {
      lines[0] = {
        rowId: lines[0].rowId,
        productId: initialProduct.id,
        search: '',
        quantity: 1,
      };
    }
    setForm({
      ...emptyForm(),
      exitBranchId: warehouseId || currentBranch?.id || '',
      lines,
    });
    setPickerRowId(null);
    setPickerHighlightIndex(0);
    setPickerAnchorRect(null);
    const firstRowId = lines[0].rowId;
    const timer = window.setTimeout(() => {
      if (initialProduct && (initialProduct.stock ?? 0) > 0) {
        qtyRefs.current[firstRowId]?.focus();
      } else {
        productInputRefs.current[firstRowId]?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [open, warehouseId, currentBranch?.id, initialProduct?.id, resetForm]);

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

  const hasNotes = form.notes.trim().length > 0;

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === form.exitBranchId) ?? currentBranch,
    [branches, form.exitBranchId, currentBranch],
  );

  const resolveBranchName = useCallback(
    (branchId?: string | null) => {
      const id = branchId || form.exitBranchId || currentBranch?.id;
      if (!id) return t.stockExitUi.thisBranch;
      return branchNameById.get(id) || id;
    },
    [branchNameById, form.exitBranchId, currentBranch?.id, t.stockExitUi.thisBranch],
  );

  const effectiveWarehouseId = form.exitBranchId || warehouseId;

  const exitNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `SAI-${selectedBranch?.code || 'XX'}-${date}-${seq}`;
  }, [selectedBranch, open]);

  const loadExchangeRate = useCallback(async (currency: string) => {
    if (currency === 'KZ') {
      setForm((p) => ({ ...p, currencyRate: 1 }));
      return;
    }
    try {
      const res = await api.exchangeRates.latest();
      const rates = (res.data as { from_currency?: string; fromCurrency?: string; to_currency?: string; toCurrency?: string; rate: number | string }[]) || [];
      const match = rates.find(
        (r) =>
          (r.from_currency || r.fromCurrency) === currency &&
          (r.to_currency || r.toCurrency) === 'AOA',
      );
      if (match) {
        const rate = parseFloat(String(match.rate));
        if (rate > 0) setForm((p) => ({ ...p, currencyRate: rate }));
      }
    } catch {
      /* keep manual rate */
    }
  }, []);

  const getSuggestionsForRow = useCallback(
    (rowId: string, search: string) => {
      if (!search.trim()) return [];
      const usedElsewhere = new Set(
        form.lines
          .filter((l) => l.rowId !== rowId && l.productId)
          .map((l) => l.productId as string),
      );
      const exitBranchId = form.exitBranchId || warehouseId || currentBranch?.id || '';
      return filterProductsForSearch(searchableProducts, search, usedElsewhere, exitBranchId)
        .sort((a, b) => sortProductSearchResults(a, b, search, exitBranchId))
        .slice(0, SUGGESTION_LIMIT);
    },
    [searchableProducts, form.lines, form.exitBranchId, warehouseId, currentBranch?.id],
  );

  const activePickerLine = useMemo(
    () => (pickerRowId ? form.lines.find((l) => l.rowId === pickerRowId) : undefined),
    [pickerRowId, form.lines],
  );

  const activePickerSuggestions = useMemo(() => {
    if (!activePickerLine || activePickerLine.productId) return [];
    return getSuggestionsForRow(activePickerLine.rowId, activePickerLine.search);
  }, [activePickerLine, getSuggestionsForRow]);

  const showPickerDropdown = Boolean(
    pickerRowId &&
      activePickerLine &&
      !activePickerLine.productId &&
      activePickerLine.search.trim().length > 0,
  );

  useLayoutEffect(() => {
    if (!showPickerDropdown || !pickerRowId) {
      setPickerAnchorRect(null);
      return;
    }
    syncPickerAnchor(pickerRowId);
  }, [showPickerDropdown, pickerRowId, activePickerLine?.search, syncPickerAnchor]);

  useEffect(() => {
    if (!showPickerDropdown || !pickerRowId) return;
    const onReposition = () => syncPickerAnchor(pickerRowId);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [showPickerDropdown, pickerRowId, syncPickerAnchor]);

  const fulfilledItems = useMemo((): ExitItem[] => {
    const items: ExitItem[] = [];
    for (const line of form.lines) {
      if (!line.productId) continue;
      const product = productsById.get(line.productId);
      if (!product) continue;
      const stock = product.stock ?? 0;
      const branchId = product.branchId || form.exitBranchId || currentBranch?.id || '';
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        currentStock: stock,
        quantity: Math.min(Math.max(1, line.quantity), stock),
        cost: product.cost || 0,
        branchId,
        branchName: resolveBranchName(branchId),
      });
    }
    return items;
  }, [form.lines, form.exitBranchId, productsById, currentBranch?.id, resolveBranchName]);

  const selectProductOnRow = useCallback(
    (rowId: string, product: Product) => {
      const resolved = resolveProductForExit(product);
      const stock = resolved.stock ?? 0;
      if (stock <= 0) {
        toast({
          title: t.stockExitUi.noStockTitle,
          description: t.stockExitUi.noStockDesc.replace('{sku}', resolved.sku || ''),
          variant: 'destructive',
        });
        return;
      }
      setForm((prev) => {
        const mapped = prev.lines.map((l) =>
          l.rowId === rowId
            ? {
                ...l,
                productId: resolved.id,
                search: '',
                quantity: Math.min(Math.max(1, l.quantity), stock),
              }
            : l,
        );
        const rowIndex = mapped.findIndex((l) => l.rowId === rowId);
        return {
          ...prev,
          lines: ensureRowsForIndex(mapped, rowIndex + 1, createEmptyLine),
        };
      });
      setPickerRowId(null);
      setPickerHighlightIndex(0);
      setPickerAnchorRect(null);
      focusQtyLine(rowId);
    },
    [focusQtyLine, resolveProductForExit, toast, t.stockExitUi],
  );

  const updateLineSearch = (rowId: string, search: string) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.rowId === rowId ? { ...l, search } : l)),
    }));
    setPickerRowId(rowId);
    setPickerHighlightIndex(0);
  };

  const clearProductOnRow = (rowId: string) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.rowId === rowId ? { ...l, productId: null, search: '' } : l,
      ),
    }));
    setPickerRowId(rowId);
    requestAnimationFrame(() => productInputRefs.current[rowId]?.focus());
  };

  const updateLineQuantity = (rowId: string, quantity: number) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => {
        if (l.rowId !== rowId) return l;
        if (!l.productId) return { ...l, quantity: Math.max(1, quantity) };
        const product = productsById.get(l.productId);
        const max = product?.stock ?? 0;
        return { ...l, quantity: Math.min(Math.max(1, quantity), max) };
      }),
    }));
  };

  const addRows = () => {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, ...createInitialLines(ROWS_APPEND_BATCH)],
    }));
  };

  const handleProductKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    line: ExitLineRow,
  ) => {
    const suggestions =
      pickerRowId === line.rowId ? getSuggestionsForRow(line.rowId, line.search) : [];

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (rowIndex > 0) focusProductRow(rowIndex - 1);
      } else {
        focusProductRow(rowIndex + 1);
      }
      return;
    }

    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setPickerHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setPickerHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        const pick = suggestions[pickerHighlightIndex] ?? suggestions[0];
        if (pick) selectProductOnRow(line.rowId, pick);
      }
      return;
    }
    if (e.key === 'Escape') {
      setPickerRowId(null);
    }
  };

  const handleQtyKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
  ) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      focusProductRow(rowIndex + 1);
    } else if (e.key === 'Tab' && e.shiftKey && rowIndex > 0) {
      e.preventDefault();
      focusProductRow(rowIndex - 1);
    }
  };

  const totals = useMemo(
    () => ({
      items: fulfilledItems.length,
      units: fulfilledItems.reduce((sum, i) => sum + i.quantity, 0),
      value: fulfilledItems.reduce((sum, i) => sum + i.quantity * i.cost, 0),
    }),
    [fulfilledItems],
  );

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', {
      style: 'currency',
      currency: 'AOA',
      maximumFractionDigits: 0,
    }).format(value);

  const handleApply = async () => {
    if (!effectiveWarehouseId) {
      toast({
        title: t.stockExitUi.branchRequiredTitle,
        description: t.stockExitUi.branchRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    if (fulfilledItems.length === 0) {
      toast({
        title: t.stockExitUi.noItemsTitle,
        description: t.stockEntryUi.addAtLeastOne,
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
      await onApplyExit(fulfilledItems, {
        reasonCode: form.reason,
        reasonLabel,
        notes: form.notes,
        reference: form.reference || exitNumber,
        exitDate: form.exitDate,
        warehouseId: effectiveWarehouseId,
        branchName: selectedBranch?.name || t.stockExitUi.thisBranch,
        currency: form.currency,
        currencyRate: form.currencyRate,
      });
      resetForm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const branchLabel = selectedBranch?.name || t.stockExitUi.thisBranch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className={cn(
          'fixed inset-0 left-0 top-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0',
          'flex-col gap-0 overflow-hidden rounded-none border-0 p-0',
          'data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0',
          'data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0',
          '[&>button]:hidden',
        )}
      >
        <div className="shrink-0 border-b bg-gradient-to-r from-red-500/10 via-background to-background px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-white shadow-sm">
                <PackageMinus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold leading-tight">
                  {t.stockExitUi.title}
                </DialogTitle>
                <p className="text-sm text-muted-foreground truncate">
                  {t.stockExitUi.description.replace('{branch}', branchLabel)}
                </p>
              </div>
              <Badge variant="outline" className="hidden sm:flex font-mono text-xs gap-1 shrink-0">
                <Hash className="h-3 w-3" />
                {exitNumber}
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Popover open={notesOpen} onOpenChange={setNotesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={hasNotes ? 'secondary' : 'outline'}
                    size="sm"
                    className="gap-1.5"
                  >
                    <StickyNote className="h-4 w-4" />
                    {t.stockExitUi.notesButton}
                    {hasNotes && (
                      <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="z-[250] w-80 sm:w-96" align="end">
                  <Label className="text-sm font-medium">
                    {t.stockExitUi.notes}
                    {form.reason === 'loss' ? ' *' : ''}
                  </Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder={t.stockExitUi.detailedReasonPlaceholder}
                    rows={5}
                    className="mt-2 resize-none"
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => onOpenChange(false)}
                aria-label={t.common.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {!effectiveWarehouseId && (
          <Alert variant="destructive" className="mx-4 sm:mx-6 mt-2 shrink-0 py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t.stockExitUi.branchRequiredDesc}</AlertDescription>
          </Alert>
        )}

        {form.reason === 'loss' && (
          <Alert variant="destructive" className="mx-4 sm:mx-6 mt-2 shrink-0 py-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{t.stockExitUi.lossWarning}</AlertDescription>
          </Alert>
        )}

        <div className="shrink-0 border-b bg-muted/20 px-4 py-2 sm:px-6 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.exitReason}</Label>
              <Select
                value={form.reason}
                onValueChange={(v) => setForm((p) => ({ ...p, reason: v as StockExitReasonCode }))}
              >
                <SelectTrigger className="bg-background h-9">
                  <SelectValue placeholder={t.stockExitUi.selectReason} />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {EXIT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span className={r.color}>{r.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.exitDate}</Label>
              <Input
                type="date"
                value={form.exitDate}
                onChange={(e) => setForm((p) => ({ ...p, exitDate: e.target.value }))}
                className="bg-background h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.reference}</Label>
              <Input
                value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                placeholder={exitNumber}
                className="bg-background h-9 font-mono text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.branch}</Label>
              <Select
                value={form.exitBranchId}
                onValueChange={(v) => setForm((p) => ({ ...p, exitBranchId: v }))}
              >
                <SelectTrigger className="bg-background h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {branches.filter((b) => b.id).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.currency}</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => {
                  setForm((p) => ({ ...p, currency: v, currencyRate: v === 'KZ' ? 1 : p.currencyRate }));
                  void loadExchangeRate(v);
                }}
              >
                <SelectTrigger className="bg-background h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {EXIT_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockExitUi.exchangeRate}</Label>
              <NumericInput
                min={0}
                value={form.currencyRate}
                onValueChange={(v) => setForm((p) => ({ ...p, currencyRate: v }))}
                className="h-9 bg-background font-mono text-sm"
                disabled={form.currency === 'KZ'}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden px-4 sm:px-6 py-2">
          <div className="shrink-0 flex items-center justify-between mb-2 gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t.stockExitUi.linesTitle}</h3>
              <p className="text-[11px] text-muted-foreground">{t.stockExitUi.pickerKeyboardHint}</p>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={addRows}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t.stockExitUi.addLine}
            </Button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto border rounded-md bg-background [&_th]:h-7 [&_th]:px-1.5 [&_th]:text-[11px] [&_td]:px-1.5 [&_td]:py-0.5">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="min-w-[200px]">{t.stockExitUi.colSelectProduct}</TableHead>
                  <TableHead className="w-[110px]">{t.stockExitUi.branch}</TableHead>
                  <TableHead className="w-[48px] text-center">{t.stockExitUi.colUnit}</TableHead>
                  <TableHead className="w-[100px]">{t.stockExitUi.colCurrentStock}</TableHead>
                  <TableHead className="w-[88px]">{t.stockExitUi.colQtyOut}</TableHead>
                  <TableHead className="w-[96px] text-right">{t.stockExitUi.colUnitCost}</TableHead>
                  <TableHead className="w-[96px] text-right">{t.stockExitUi.colLossValue}</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.lines.map((line, rowIndex) => {
                  const product = line.productId ? productsById.get(line.productId) : undefined;
                  const stock = product?.stock ?? 0;
                  const stockAfter = product
                    ? Math.max(0, stock - Math.min(line.quantity, stock))
                    : null;
                  const qty = product ? Math.min(line.quantity, stock) : line.quantity;
                  const lossValue = product ? qty * (product.cost || 0) : 0;

                  return (
                    <TableRow
                      key={line.rowId}
                      className={cn(product && 'bg-red-50/40 dark:bg-red-950/15')}
                    >
                      <TableCell className="align-middle min-w-[200px]">
                        {product ? (
                          <p className="text-[11px] leading-tight whitespace-normal break-words">
                            <span className="font-mono font-semibold">{product.sku}</span>
                            <span className="mx-0.5">—</span>
                            {product.name}
                          </p>
                        ) : (
                          <Input
                            ref={(el) => {
                              productInputRefs.current[line.rowId] = el;
                            }}
                            value={line.search}
                            onChange={(e) => updateLineSearch(line.rowId, e.target.value)}
                            onFocus={() => {
                              setPickerRowId(line.rowId);
                              if (rowIndex >= linesRef.current.length - ROWS_NEAR_END_BUFFER - 1) {
                                setForm((prev) => ({
                                  ...prev,
                                  lines: ensureRowsForIndex(prev.lines, rowIndex, createEmptyLine),
                                }));
                              }
                            }}
                            onKeyDown={(e) => handleProductKeyDown(e, rowIndex, line)}
                            placeholder={t.stockExitUi.searchShortPlaceholder}
                            className="h-7 text-[11px] px-2 py-0 bg-background w-full min-w-0"
                            autoComplete="off"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-xs truncate align-middle">
                        {product ? resolveBranchName(product.branchId) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-xs align-middle">
                        {product?.unit ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs align-middle">
                        {product ? (
                          <>
                            {stock}
                            <span className="text-muted-foreground mx-0.5">→</span>
                            <span className="text-destructive">{stockAfter}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        <NumericInput
                          ref={(el) => {
                            qtyRefs.current[line.rowId] = el;
                          }}
                          integer
                          min={1}
                          max={product ? stock : undefined}
                          value={line.quantity}
                          onValueChange={(q) => updateLineQuantity(line.rowId, q)}
                          onKeyDown={(e) => handleQtyKeyDown(e, rowIndex)}
                          className="h-7 text-[11px]"
                          disabled={!product}
                          tabIndex={product ? 0 : -1}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums align-middle">
                        {product ? formatCurrency(product.cost || 0) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-destructive align-middle">
                        {product ? `-${formatCurrency(lossValue)}` : '—'}
                      </TableCell>
                      <TableCell className="align-middle">
                        {product && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => clearProductOnRow(line.rowId)}
                            tabIndex={-1}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="shrink-0 border-t bg-muted/30 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t.stockExitUi.summaryItems}: </span>
              <span className="font-semibold tabular-nums">{totals.items}</span>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-5" />
            <div>
              <span className="text-muted-foreground">{t.stockExitUi.summaryUnits}: </span>
              <span className="font-semibold tabular-nums">{totals.units}</span>
            </div>
            <Separator orientation="vertical" className="hidden sm:block h-5" />
            <div>
              <span className="text-muted-foreground">{t.stockExitUi.summaryLossValue}: </span>
              <span className="font-bold text-destructive tabular-nums">
                -{formatCurrency(totals.value)}
              </span>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t.common.cancel}
            </Button>
            <Button
              variant="outline"
              className="text-foreground border-foreground hover:bg-muted min-w-[160px]"
              onClick={() => void handleApply()}
              disabled={fulfilledItems.length === 0 || !effectiveWarehouseId || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t.stockExitUi.applying}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t.stockExitUi.confirm.replace('{count}', String(fulfilledItems.length))}
                </>
              )}
            </Button>
          </div>
        </div>

        {showPickerDropdown &&
          pickerRowId &&
          dialogContentRef.current &&
          pickerAnchorRect &&
          createPortal(
            <div
              role="listbox"
              className="fixed z-[200] rounded-md border bg-popover text-popover-foreground shadow-md max-h-52 overflow-auto pointer-events-auto"
              style={{
                top: pickerAnchorRect.bottom + 2,
                left: pickerAnchorRect.left,
                width: Math.max(300, pickerAnchorRect.width),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {activePickerSuggestions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-1.5">
                  {t.stockExitUi.noSearchResults}
                </p>
              ) : (
                activePickerSuggestions.map((p, idx) => {
                  const outOfStock = (p.stock ?? 0) <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="option"
                      aria-selected={idx === pickerHighlightIndex}
                      className={cn(
                        'w-full cursor-pointer text-left px-2 py-1.5 text-[11px] leading-tight border-b last:border-b-0 hover:bg-muted',
                        outOfStock && 'opacity-60',
                        idx === pickerHighlightIndex && 'bg-primary/15',
                      )}
                      onMouseEnter={() => setPickerHighlightIndex(idx)}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectProductOnRow(pickerRowId, p);
                      }}
                    >
                      <span className="font-mono">{p.sku}</span>
                      <span className="mx-0.5">—</span>
                      {p.name}
                      <span className="text-muted-foreground ml-1">
                        ({p.stock} {p.unit}
                        {p.branchId ? ` · ${resolveBranchName(p.branchId)}` : ''}
                        {outOfStock ? ` · ${t.stockExitUi.noStockShort}` : ''})
                      </span>
                    </button>
                  );
                })
              )}
            </div>,
            dialogContentRef.current,
          )}
      </DialogContent>
    </Dialog>
  );
}
