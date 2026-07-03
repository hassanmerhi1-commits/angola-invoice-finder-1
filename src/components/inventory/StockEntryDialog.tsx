import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  PackagePlus,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  ClipboardList,
  ShoppingCart,
  ArrowRightLeft,
  Package,
  RotateCcw,
  Loader2,
  X,
  Hash,
  StickyNote,
  Search,
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
  ensureRowsForIndex,
  filterProductsForBranch,
  filterProductsForSearch,
  findProductForBranchSku,
  newLineRowId,
  remapLineProductIdsForBranch,
  sortProductSearchResults,
} from './productLineSearch';

const ENTRY_CURRENCIES = ['KZ', 'USD', 'EUR'] as const;

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
  branchId: string;
  branchName: string;
  freightAllocation?: number;
  effectiveCost?: number;
}

interface EntryLineRow {
  rowId: string;
  productId: string | null;
  search: string;
  quantity: number;
  cost: number;
}

interface StockEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  searchProducts?: Product[];
  currentBranch: Branch | null;
  warehouseId: string | null;
  canSwitchBranch?: boolean;
  onAddProduct?: () => void;
  initialProduct?: Product | null;
  onApplyEntry: (
    items: EntryItem[],
    meta: {
      reason: StockEntryReason;
      reference: string;
      entryDate: string;
      warehouseId: string;
      branchName: string;
      currency: string;
      currencyRate: number;
      notes: string;
      totalLandingCosts?: number;
      freightSourceAccount?: string;
      freightSourceName?: string;
    },
  ) => void | Promise<void>;
}

function FreightAccountPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const accounts = useMemo(() => {
    try {
      const data = localStorage.getItem('kwanzaerp_chart_of_accounts');
      const all: Array<{ code: string; name: string; is_active: boolean }> = data ? JSON.parse(data) : [];
      return all.filter((a) => a.is_active !== false).sort((a, b) => a.code.localeCompare(b.code));
    } catch {
      return [];
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[70vh]">
        <DialogHeader>
          <DialogTitle>{t.stockEntryUi.choosePaymentAccount}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t.stockEntryUi.accountSearchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <ScrollArea className="h-[350px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.stockEntryUi.colAccountCode}</TableHead>
                <TableHead>{t.stockEntryUi.colAccountName}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow
                  key={a.code}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => {
                    onSelect(a.code, a.name);
                    onClose();
                  }}
                >
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const REASON_ICONS: Record<StockEntryReason, typeof PackagePlus> = {
  adjustment: ClipboardList,
  purchase: ShoppingCart,
  transfer_in: ArrowRightLeft,
  initial: Package,
  correction: RotateCcw,
};

const todayIsoDate = () => format(new Date(), 'yyyy-MM-dd');

const createEmptyLine = (): EntryLineRow => ({
  rowId: newLineRowId(),
  productId: null,
  search: '',
  quantity: 1,
  cost: 0,
});

const createInitialLines = (count = DEFAULT_LINE_ROWS): EntryLineRow[] =>
  Array.from({ length: count }, () => createEmptyLine());

const emptyForm = () => ({
  entryReason: 'adjustment' as StockEntryReason,
  entryDate: todayIsoDate(),
  entryBranchId: '',
  currency: 'KZ',
  currencyRate: 1,
  reference: '',
  notes: '',
  lines: createInitialLines(),
  freightCost: 0,
  otherCosts: 0,
  otherCostsDescription: '',
  freightSourceAccount: '451',
  freightSourceName: 'Caixa',
});

export function StockEntryDialog({
  open,
  onOpenChange,
  products,
  searchProducts,
  currentBranch,
  warehouseId,
  canSwitchBranch = false,
  onAddProduct,
  initialProduct,
  onApplyEntry,
}: StockEntryDialogProps) {
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
  const [freightAccountPickerOpen, setFreightAccountPickerOpen] = useState(false);

  const catalogProducts = useMemo(() => {
    if (searchProducts && searchProducts.length > 0) return searchProducts;
    return products;
  }, [searchProducts, products]);

  const searchableProducts = useMemo(
    () => catalogProducts.filter((p) => p.isActive !== false),
    [catalogProducts],
  );

  const branchLocked = Boolean(warehouseId) && !canSwitchBranch;
  const effectiveWarehouseId = canSwitchBranch
    ? (form.entryBranchId || warehouseId)
    : (warehouseId || form.entryBranchId);
  const entryBranchId = effectiveWarehouseId || currentBranch?.id || '';

  const branchScopedProducts = useMemo(
    () => filterProductsForBranch(searchableProducts, entryBranchId),
    [searchableProducts, entryBranchId],
  );

  const productsById = useMemo(
    () => new Map(catalogProducts.map((p) => [p.id, p])),
    [catalogProducts],
  );

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      if (b.id) map.set(b.id, b.name);
    }
    return map;
  }, [branches]);

  const resetForm = useCallback(() => {
    setForm(emptyForm());
    setSubmitting(false);
    setNotesOpen(false);
    setPickerRowId(null);
    setPickerHighlightIndex(0);
    setPickerAnchorRect(null);
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

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetForm();
      onOpenChange(next);
    },
    [onOpenChange, resetForm],
  );

  useEffect(() => {
    if (!open) {
      resetForm();
      return;
    }
    const openBranchId = warehouseId || currentBranch?.id || '';
    const lines = createInitialLines();
    if (initialProduct) {
      const resolved = openBranchId
        ? findProductForBranchSku(
            catalogProducts.filter((p) => p.isActive !== false),
            initialProduct.sku,
            openBranchId,
          )
        : initialProduct;
      const productForLine =
        resolved
        ?? ((initialProduct.branchId || '') === openBranchId ? initialProduct : null);
      if (productForLine) {
        lines[0] = {
          rowId: lines[0].rowId,
          productId: productForLine.id,
          search: '',
          quantity: 1,
          cost: productForLine.cost || 0,
        };
      }
    }
    setForm({
      ...emptyForm(),
      entryBranchId: openBranchId,
      lines,
    });
    setPickerRowId(null);
    setPickerHighlightIndex(0);
    setPickerAnchorRect(null);
    const firstRowId = lines[0].rowId;
    const timer = window.setTimeout(() => {
      if (initialProduct?.id) {
        focusQtyLine(firstRowId);
      } else {
        productInputRefs.current[firstRowId]?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [open, warehouseId, currentBranch?.id, initialProduct?.id, resetForm, focusQtyLine]);

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

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === form.entryBranchId) ?? currentBranch,
    [branches, form.entryBranchId, currentBranch],
  );

  const resolveBranchName = useCallback(
    (branchId?: string | null) => {
      const id = branchId || form.entryBranchId || currentBranch?.id;
      if (!id) return t.stockEntryUi.thisBranch;
      return branchNameById.get(id) || id;
    },
    [branchNameById, form.entryBranchId, currentBranch?.id, t.stockEntryUi.thisBranch],
  );

  const entryNumber = useMemo(() => {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `ENT-${selectedBranch?.code || 'XX'}-${date}-${seq}`;
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

  const resolveProductForEntry = useCallback(
    (product: Product): Product | null => {
      const branchId = entryBranchId;
      if (!branchId) return product;
      if ((product.branchId || '') === branchId) return product;
      const skuNorm = (product.sku || '').trim().toLowerCase();
      if (!skuNorm) return null;
      return findProductForBranchSku(searchableProducts, product.sku, branchId) ?? null;
    },
    [searchableProducts, entryBranchId],
  );

  const handleEntryBranchChange = useCallback(
    (branchId: string) => {
      setForm((prev) => ({
        ...prev,
        entryBranchId: branchId,
        lines: remapLineProductIdsForBranch(
          prev.lines,
          productsById,
          searchableProducts,
          branchId,
        ),
      }));
    },
    [productsById, searchableProducts],
  );

  const getSuggestionsForRow = useCallback(
    (rowId: string, search: string) => {
      if (!search.trim()) return [];
      const usedElsewhere = new Set(
        form.lines
          .filter((l) => l.rowId !== rowId && l.productId)
          .map((l) => l.productId as string),
      );
      return filterProductsForSearch(branchScopedProducts, search, usedElsewhere, entryBranchId)
        .sort((a, b) => sortProductSearchResults(a, b, search, entryBranchId))
        .slice(0, PRODUCT_LINE_SUGGESTION_LIMIT);
    },
    [branchScopedProducts, form.lines, entryBranchId],
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

  const fulfilledItems = useMemo((): EntryItem[] => {
    const items: EntryItem[] = [];
    for (const line of form.lines) {
      if (!line.productId) continue;
      const product = productsById.get(line.productId);
      if (!product) continue;
      const branchId = entryBranchId;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantity: Math.max(1, line.quantity),
        cost: Math.max(0, line.cost),
        currentStock: product.stock ?? 0,
        branchId,
        branchName: resolveBranchName(branchId),
      });
    }
    return items;
  }, [form.lines, entryBranchId, productsById, resolveBranchName]);

  const selectProductOnRow = useCallback(
    (rowId: string, product: Product) => {
      const resolved = resolveProductForEntry(product);
      if (!resolved) {
        toast({
          title: t.stockEntryUi.productNotInBranchTitle,
          description: t.stockEntryUi.productNotInBranchDesc.replace(
            '{branch}',
            resolveBranchName(entryBranchId),
          ),
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
                quantity: Math.max(1, l.quantity),
                cost: l.cost > 0 ? l.cost : resolved.cost || 0,
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
    [focusQtyLine, resolveProductForEntry, toast, t, resolveBranchName, entryBranchId],
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
        l.rowId === rowId ? { ...l, productId: null, search: '', cost: 0 } : l,
      ),
    }));
    setPickerRowId(rowId);
    requestAnimationFrame(() => productInputRefs.current[rowId]?.focus());
  };

  const updateLineQuantity = (rowId: string, quantity: number) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.rowId === rowId ? { ...l, quantity: Math.max(1, quantity) } : l,
      ),
    }));
  };

  const updateLineCost = (rowId: string, cost: number) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.rowId === rowId ? { ...l, cost: Math.max(0, cost) } : l,
      ),
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
    line: EntryLineRow,
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

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      focusProductRow(rowIndex + 1);
    } else if (e.key === 'Tab' && e.shiftKey && rowIndex > 0) {
      e.preventDefault();
      focusProductRow(rowIndex - 1);
    }
  };

  const itemsValue = useMemo(
    () => fulfilledItems.reduce((sum, i) => sum + i.quantity * i.cost, 0),
    [fulfilledItems],
  );

  const totalLandingCosts = form.freightCost + form.otherCosts;

  const freightAllocations = useMemo(() => {
    if (itemsValue === 0 || totalLandingCosts === 0) return {};
    const allocations: Record<string, number> = {};
    fulfilledItems.forEach((item) => {
      const itemValue = item.quantity * item.cost;
      const proportion = itemValue / itemsValue;
      allocations[item.productId] = (totalLandingCosts * proportion) / item.quantity;
    });
    return allocations;
  }, [fulfilledItems, itemsValue, totalLandingCosts]);

  const totals = useMemo(
    () => ({
      items: fulfilledItems.length,
      units: fulfilledItems.reduce((sum, i) => sum + i.quantity, 0),
      value: itemsValue + totalLandingCosts,
    }),
    [fulfilledItems, itemsValue, totalLandingCosts],
  );

  const hasNotes = form.notes.trim().length > 0;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(language === 'pt' ? 'pt-AO' : 'en-GB', {
      style: 'currency',
      currency: 'AOA',
      maximumFractionDigits: 0,
    }).format(value);

  const buildNotes = () => {
    const parts = [form.notes.trim()];
    if (form.otherCostsDescription.trim() && form.otherCosts > 0) {
      parts.push(form.otherCostsDescription.trim());
    }
    return parts.filter(Boolean).join(' — ');
  };

  const handleApply = async () => {
    if (!effectiveWarehouseId) {
      toast({
        title: t.stockEntryUi.branchRequiredTitle,
        description: t.stockEntryUi.branchRequiredDesc,
        variant: 'destructive',
      });
      return;
    }

    if (fulfilledItems.length === 0) {
      toast({
        title: t.stockEntryUi.noItemsTitle,
        description: t.stockEntryUi.addAtLeastOne,
        variant: 'destructive',
      });
      return;
    }

    const itemsWithFreight = fulfilledItems.map((item) => ({
      ...item,
      freightAllocation: freightAllocations[item.productId] || 0,
      effectiveCost: item.cost + (freightAllocations[item.productId] || 0),
    }));

    setSubmitting(true);
    try {
      await onApplyEntry(itemsWithFreight, {
        reason: form.entryReason,
        reference: form.reference || entryNumber,
        entryDate: form.entryDate,
        warehouseId: effectiveWarehouseId,
        branchName: selectedBranch?.name || t.stockEntryUi.thisBranch,
        currency: form.currency,
        currencyRate: form.currencyRate,
        notes: buildNotes(),
        totalLandingCosts,
        freightSourceAccount: totalLandingCosts > 0 ? form.freightSourceAccount : undefined,
        freightSourceName: totalLandingCosts > 0 ? form.freightSourceName : undefined,
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: t.stockEntryUi.saveFailed,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const branchLabel = selectedBranch?.name || t.stockEntryUi.thisBranch;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
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
        <div className="shrink-0 border-b bg-gradient-to-r from-emerald-50/80 via-background to-background px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold leading-tight">
                  {t.stockEntryUi.title}
                </DialogTitle>
                <p className="text-sm text-muted-foreground truncate">
                  {t.stockEntryUi.description.replace('{branch}', branchLabel)}
                </p>
              </div>
              <Badge variant="outline" className="hidden sm:flex font-mono text-xs gap-1 shrink-0">
                <Hash className="h-3 w-3" />
                {entryNumber}
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
                    {t.stockEntryUi.notesButton}
                    {hasNotes && (
                      <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="z-[250] w-80 sm:w-96" align="end">
                  <Label className="text-sm font-medium">{t.stockEntryUi.notes}</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder={t.stockEntryUi.notesPlaceholder}
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
                onClick={() => handleDialogOpenChange(false)}
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
            <AlertDescription>{t.stockEntryUi.branchRequiredDesc}</AlertDescription>
          </Alert>
        )}

        <div className="shrink-0 border-b bg-muted/20 px-4 py-2 sm:px-6 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.entryReason}</Label>
              <Select
                value={form.entryReason}
                onValueChange={(value: StockEntryReason) =>
                  setForm((p) => ({ ...p, entryReason: value }))
                }
              >
                <SelectTrigger className="bg-background h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {entryReasons.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.entryDate}</Label>
              <Input
                type="date"
                value={form.entryDate}
                onChange={(e) => setForm((p) => ({ ...p, entryDate: e.target.value }))}
                className="bg-background h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.receiptNumber}</Label>
              <Input
                value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                placeholder={t.stockEntryUi.receiptNumberPlaceholder}
                className="bg-background h-9 font-mono text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.branch}</Label>
              {branchLocked ? (
                <Input
                  readOnly
                  value={branchLabel}
                  className="bg-muted/50 h-9 text-sm"
                />
              ) : (
                <Select
                  value={form.entryBranchId}
                  onValueChange={handleEntryBranchChange}
                >
                  <SelectTrigger className="bg-background h-9">
                    <SelectValue placeholder={t.stockEntryUi.selectBranchPlaceholder} />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {branches.filter((b) => b.id).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.currency}</Label>
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
                  {ENTRY_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.exchangeRate}</Label>
              <NumericInput
                min={0}
                value={form.currencyRate}
                onValueChange={(v) => setForm((p) => ({ ...p, currencyRate: v }))}
                className="h-9 bg-background font-mono text-sm"
                disabled={form.currency === 'KZ'}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.freightLabel}</Label>
              <NumericInput
                min={0}
                value={form.freightCost}
                onValueChange={(v) => setForm((p) => ({ ...p, freightCost: v }))}
                className="h-9 bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.otherCostsLabel}</Label>
              <NumericInput
                min={0}
                value={form.otherCosts}
                onValueChange={(v) => setForm((p) => ({ ...p, otherCosts: v }))}
                className="h-9 bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t.stockEntryUi.otherCostsDescLabel}</Label>
              <Input
                value={form.otherCostsDescription}
                onChange={(e) =>
                  setForm((p) => ({ ...p, otherCostsDescription: e.target.value }))
                }
                placeholder={t.stockEntryUi.otherCostsDescPlaceholder}
                className="h-9 bg-background text-sm"
              />
            </div>
            {totalLandingCosts > 0 && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t.stockEntryUi.freightPaymentSource}</Label>
                <div className="flex gap-1">
                  <Input
                    readOnly
                    value={`${form.freightSourceAccount} — ${form.freightSourceName}`}
                    className="h-9 bg-background text-xs font-mono flex-1 min-w-0"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t.stockEntryUi.choosePaymentAccount}
                    onClick={() => setFreightAccountPickerOpen(true)}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {totalLandingCosts > 0 && fulfilledItems.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t.stockEntryUi.landingCostsHint
                .replace('{count}', String(fulfilledItems.length))
                .replace(
                  '{perUnit}',
                  formatCurrency(totalLandingCosts / Math.max(1, totals.units)),
                )}
            </p>
          )}

        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden px-4 sm:px-6 py-2">
          <div className="shrink-0 flex items-center justify-between mb-2 gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t.stockEntryUi.linesTitle}</h3>
              <p className="text-[11px] text-muted-foreground">{t.stockEntryUi.pickerKeyboardHint}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {onAddProduct ? (
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={onAddProduct}>
                  <Package className="h-3.5 w-3.5 mr-1" />
                  {t.stockEntryUi.newProduct}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addRows}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t.stockEntryUi.addLine}
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto border rounded-md bg-background [&_th]:h-7 [&_th]:px-1.5 [&_th]:text-[11px] [&_td]:px-1.5 [&_td]:py-0.5">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="min-w-[200px]">{t.stockEntryUi.colSelectProduct}</TableHead>
                  <TableHead className="w-[110px]">{t.stockEntryUi.branch}</TableHead>
                  <TableHead className="w-[48px] text-center">{t.stockEntryUi.colUnit}</TableHead>
                  <TableHead className="w-[100px]">{t.stockEntryUi.colStock}</TableHead>
                  <TableHead className="w-[88px]">{t.stockEntryUi.colQty}</TableHead>
                  <TableHead className="w-[96px]">{t.stockEntryUi.colCost}</TableHead>
                  <TableHead className="w-[88px] text-right">{t.stockEntryUi.colFreight}</TableHead>
                  <TableHead className="w-[96px] text-right">{t.stockEntryUi.colTotal}</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.lines.map((line, rowIndex) => {
                  const product = line.productId ? productsById.get(line.productId) : undefined;
                  const stock = product?.stock ?? 0;
                  const stockAfter = product ? stock + line.quantity : null;
                  const freightPerUnit = line.productId
                    ? freightAllocations[line.productId] || 0
                    : 0;
                  const effectiveCost = (line.cost || 0) + freightPerUnit;
                  const lineTotal = product ? line.quantity * effectiveCost : 0;

                  return (
                    <TableRow
                      key={line.rowId}
                      className={cn(product && 'bg-emerald-50/40 dark:bg-emerald-950/15')}
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
                            placeholder={t.stockEntryUi.searchShortPlaceholder}
                            className="h-7 text-[11px] px-2 py-0 bg-background w-full min-w-0"
                            autoComplete="off"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-xs truncate align-middle">
                        {product ? resolveBranchName(entryBranchId) : '—'}
                      </TableCell>
                      <TableCell className="text-center text-xs align-middle">
                        {product?.unit ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs align-middle">
                        {product ? (
                          <>
                            {stock}
                            <span className="text-muted-foreground mx-0.5">→</span>
                            <span className="text-emerald-600">{stockAfter}</span>
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
                          value={line.quantity}
                          onValueChange={(q) => updateLineQuantity(line.rowId, q)}
                          onKeyDown={(e) => handleQtyKeyDown(e, rowIndex)}
                          className="h-7 text-[11px]"
                          disabled={!product}
                          tabIndex={product ? 0 : -1}
                        />
                      </TableCell>
                      <TableCell className="align-middle">
                        <NumericInput
                          min={0}
                          value={line.cost}
                          onValueChange={(c) => updateLineCost(line.rowId, c)}
                          className="h-7 text-[11px] font-mono"
                          disabled={!product}
                          tabIndex={product ? 0 : -1}
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums align-middle">
                        {product && freightPerUnit > 0
                          ? formatCurrency(freightPerUnit * line.quantity)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-emerald-700 align-middle">
                        {product ? formatCurrency(lineTotal) : '—'}
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
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={submitting}>
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
                  {t.stockEntryUi.applying}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t.stockEntryUi.confirm.replace('{count}', String(fulfilledItems.length))}
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
                  {t.stockEntryUi.noSearchResults}
                </p>
              ) : (
                activePickerSuggestions.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={idx === pickerHighlightIndex}
                    className={cn(
                      'w-full cursor-pointer text-left px-2 py-1.5 text-[11px] leading-tight border-b last:border-b-0 hover:bg-muted',
                      idx === pickerHighlightIndex && 'nexor-row-selected',
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
                      ({p.stock ?? 0} {p.unit}
                      {p.branchId ? ` · ${resolveBranchName(p.branchId)}` : ''})
                    </span>
                  </button>
                ))
              )}
            </div>,
            dialogContentRef.current,
          )}
      </DialogContent>
      <FreightAccountPickerDialog
        open={freightAccountPickerOpen}
        onClose={() => setFreightAccountPickerOpen(false)}
        onSelect={(code, name) =>
          setForm((p) => ({ ...p, freightSourceAccount: code, freightSourceName: name }))
        }
      />
    </Dialog>
  );
}
