import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  FileSpreadsheet,
} from 'lucide-react';
import { Product, Branch } from '@/types/erp';
import { useBranches } from '@/hooks/useERP';
import { useToast } from '@/hooks/use-toast';
import { getCaixas, getBankAccounts } from '@/lib/accountingStorage';
import {
  formatFreightBankLabel,
  formatFreightCaixaLabel,
  resolveFreightTreasuryGl,
  type FreightPaymentSource,
} from '@/lib/freightTreasury';
import type { Caixa, BankAccount } from '@/types/accounting';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  parseStockEntryExcelFile,
  downloadStockEntryImportTemplate,
  type ExcelStockEntryLine,
} from '@/lib/excel';
import { ExcelImportDialog } from '@/components/import/ExcelImportDialog';
import { mapApiProductRow } from '@/lib/productSupplierResolve';
import {
  DEFAULT_LINE_ROWS,
  PRODUCT_LINE_SUGGESTION_LIMIT,
  ROWS_APPEND_BATCH,
  ROWS_NEAR_END_BUFFER,
  ensureRowsForIndex,
  filterProductsForSearch,
  findProductForStockEntryImport,
  findProductForBranchSku,
  getProductStockAtBranch,
  newLineRowId,
  normalizeSearchText,
  remapLineProductIdsForBranch,
  sortProductSearchResults,
} from './productLineSearch';

import { ALLOWED_VAT_RATES, normalizeTaxRate, parseTaxRateOrNull } from '@/lib/taxUtils';

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
  taxRate?: number;
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
  taxRate: number | null;
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

const REASON_ICONS: Record<StockEntryReason, typeof PackagePlus> = {
  adjustment: ClipboardList,
  purchase: ShoppingCart,
  transfer_in: ArrowRightLeft,
  initial: Package,
  correction: RotateCcw,
};

const todayIsoDate = () => format(new Date(), 'yyyy-MM-dd');

function CompactField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="text-[10px] font-medium leading-none text-muted-foreground truncate" title={label}>
        {label}
      </span>
      {children}
    </div>
  );
}

const createEmptyLine = (): EntryLineRow => ({
  rowId: newLineRowId(),
  productId: null,
  search: '',
  quantity: 1,
  cost: 0,
  taxRate: null,
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
  freightPaymentSource: 'caixa' as FreightPaymentSource,
  freightCaixaId: '',
  freightBankAccountId: '',
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
  const costRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const vatTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const linesRef = useRef(form.lines);
  linesRef.current = form.lines;
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);
  const [freightTreasuryLoading, setFreightTreasuryLoading] = useState(false);
  const [freightCaixas, setFreightCaixas] = useState<Caixa[]>([]);
  const [freightBankAccounts, setFreightBankAccounts] = useState<BankAccount[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importLookupProducts, setImportLookupProducts] = useState<Product[]>([]);
  const [importCatalogLoading, setImportCatalogLoading] = useState(false);

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
  const entryBranchName =
    branches.find((b) => b.id === entryBranchId)?.name
    || currentBranch?.name
    || '';
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

  // HQ/admins: list every filial caixa/bank (same as Purchase Invoice freight).
  // Filial users: only their branch registers.
  const freightAllBranches = Boolean(canSwitchBranch);

  const refreshFreightTreasury = useCallback(async () => {
    const branchId = String(entryBranchId || '').trim();
    if (!freightAllBranches && !branchId) {
      setFreightCaixas([]);
      setFreightBankAccounts([]);
      return;
    }
    setFreightTreasuryLoading(true);
    try {
      const [loadedCaixas, loadedBanks] = await Promise.all([
        getCaixas(branchId, entryBranchName, {
          ensureIfEmpty: !freightAllBranches,
          allBranches: freightAllBranches,
        }),
        getBankAccounts(freightAllBranches ? undefined : branchId, {
          allBranches: freightAllBranches,
        }),
      ]);
      setFreightCaixas(loadedCaixas);
      setFreightBankAccounts(loadedBanks);
      setForm((prev) => {
        const next = { ...prev };
        if (loadedCaixas.length > 0 && !loadedCaixas.some((c) => c.id === prev.freightCaixaId)) {
          // Prefer a caixa on the selected warehouse branch when listing all.
          const local = loadedCaixas.find((c) => String(c.branchId || '') === branchId);
          next.freightCaixaId = (local || loadedCaixas[0]).id;
        }
        if (loadedBanks.length > 0 && !loadedBanks.some((b) => b.id === prev.freightBankAccountId)) {
          const local = loadedBanks.find((b) => String(b.branchId || '') === branchId);
          next.freightBankAccountId = (local || loadedBanks[0]).id;
        }
        return next;
      });
    } finally {
      setFreightTreasuryLoading(false);
    }
  }, [entryBranchId, entryBranchName, freightAllBranches]);

  useEffect(() => {
    if (!open) return;
    void refreshFreightTreasury();
  }, [open, refreshFreightTreasury]);

  useEffect(() => {
    const landing = (Number(form.freightCost) || 0) + (Number(form.otherCosts) || 0);
    if (!open || landing <= 0) return;
    let cancelled = false;
    void resolveFreightTreasuryGl({
      paymentSource: form.freightPaymentSource,
      caixaId: form.freightCaixaId || undefined,
      bankAccountId: form.freightBankAccountId || undefined,
      branchId: entryBranchId,
      freightSourceAccount: form.freightSourceAccount,
      freightSourceName: form.freightSourceName,
      caixas: freightCaixas,
      bankAccounts: freightBankAccounts,
    }).then((treasury) => {
      if (cancelled) return;
      setForm((p) => {
        if (
          p.freightSourceAccount === treasury.accountCode
          && p.freightSourceName === treasury.accountName
        ) {
          return p;
        }
        return {
          ...p,
          freightSourceAccount: treasury.accountCode || p.freightSourceAccount,
          freightSourceName: treasury.accountName || p.freightSourceName,
        };
      });
    });
    return () => { cancelled = true; };
  }, [
    open,
    form.freightCost,
    form.otherCosts,
    form.freightPaymentSource,
    form.freightCaixaId,
    form.freightBankAccountId,
    entryBranchId,
    freightCaixas,
    freightBankAccounts,
  ]);

  const productsForImport = useMemo(() => {
    const byId = new Map<string, Product>();
    for (const p of [...searchableProducts, ...importLookupProducts]) {
      if (p.isActive === false) continue;
      byId.set(p.id, p);
    }
    return Array.from(byId.values());
  }, [searchableProducts, importLookupProducts]);

  const loadImportCatalog = useCallback(async () => {
    if (!entryBranchId) return [] as Product[];
    setImportCatalogLoading(true);
    try {
      // Light list only — import matching needs sku/name/barcode/cost, not full stock rows.
      // Branch list already includes company-wide catalog masters (0 stock) for filials.
      const branchRes = await api.products.list(entryBranchId, { light: true });
      const merged = new Map<string, Product>();
      for (const row of branchRes.data || []) {
        const product = mapApiProductRow(row as Record<string, unknown>);
        if (product.isActive !== false) merged.set(product.id, product);
      }
      const rows = Array.from(merged.values());
      setImportLookupProducts(rows);
      return rows;
    } catch {
      setImportLookupProducts([]);
      return [];
    } finally {
      setImportCatalogLoading(false);
    }
  }, [entryBranchId]);

  useEffect(() => {
    if (!open || !entryBranchId) {
      setImportLookupProducts([]);
      setImportCatalogLoading(false);
      return;
    }
    void loadImportCatalog();
  }, [open, entryBranchId, loadImportCatalog]);

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
          if (!row) return;
          if (row.productId) {
            qtyRefs.current[row.rowId]?.focus();
            qtyRefs.current[row.rowId]?.select();
            return;
          }
          productInputRefs.current[row.rowId]?.focus();
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

  const focusCostLine = useCallback((rowId: string) => {
    requestAnimationFrame(() => {
      const el = costRefs.current[rowId];
      el?.focus();
      el?.select();
    });
  }, []);

  const focusVatLine = useCallback((rowId: string) => {
    requestAnimationFrame(() => {
      vatTriggerRefs.current[rowId]?.focus();
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
          taxRate: parseTaxRateOrNull(productForLine.taxRate),
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
    (product: Product): Product => {
      const branchId = entryBranchId;
      if (!branchId) return product;
      if ((product.branchId || '') === branchId) return product;
      // Prefer local row; otherwise keep catalog/sede id — server clones on post.
      return findProductForBranchSku(searchableProducts, product.sku, branchId) ?? product;
    },
    [searchableProducts, entryBranchId],
  );

  const stockAtEntryBranch = useCallback(
    (product: Product | undefined) => {
      if (!product) return 0;
      if (!entryBranchId) return product.stock ?? 0;
      return getProductStockAtBranch(searchableProducts, product.sku, entryBranchId);
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
      return filterProductsForSearch(searchableProducts, search, usedElsewhere, entryBranchId)
        .sort((a, b) => sortProductSearchResults(a, b, search, entryBranchId))
        .slice(0, PRODUCT_LINE_SUGGESTION_LIMIT);
    },
    [searchableProducts, form.lines, entryBranchId],
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
      const picked = productsById.get(line.productId);
      if (!picked) continue;
      const product = resolveProductForEntry(picked);
      const branchId = entryBranchId;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        quantity: Math.max(1, line.quantity),
        cost: Math.max(0, line.cost),
        taxRate: parseTaxRateOrNull(line.taxRate) ?? parseTaxRateOrNull(product.taxRate) ?? undefined,
        currentStock: stockAtEntryBranch(picked),
        branchId,
        branchName: resolveBranchName(branchId),
      } as EntryItem);
    }
    return items;
  }, [form.lines, entryBranchId, productsById, resolveBranchName, resolveProductForEntry, stockAtEntryBranch]);

  const selectProductOnRow = useCallback(
    (rowId: string, product: Product) => {
      const resolved = resolveProductForEntry(product);
      setForm((prev) => {
        const mapped = prev.lines.map((l) =>
          l.rowId === rowId
            ? {
                ...l,
                productId: resolved.id,
                search: '',
                quantity: Math.max(1, l.quantity),
                cost: l.cost > 0 ? l.cost : resolved.cost || product.cost || 0,
                taxRate: parseTaxRateOrNull(resolved.taxRate ?? product.taxRate),
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
    [focusQtyLine, resolveProductForEntry],
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
        l.rowId === rowId ? { ...l, productId: null, search: '', cost: 0, taxRate: null } : l,
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

  const updateLineTaxRate = (rowId: string, taxRate: number) => {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l) =>
        l.rowId === rowId ? { ...l, taxRate: normalizeTaxRate(taxRate) } : l,
      ),
    }));
  };

  const addRows = () => {
    setForm((prev) => ({
      ...prev,
      lines: [...prev.lines, ...createInitialLines(ROWS_APPEND_BATCH)],
    }));
  };

  const validateStockEntryImport = useCallback(
    (data: ExcelStockEntryLine[]) => {
      const valid: ExcelStockEntryLine[] = [];
      const errors: { row: number; errors: string[] }[] = [];

      data.forEach((row, index) => {
        const codigo = String(row.codigo || '').trim();
        if (!codigo) {
          errors.push({ row: index + 2, errors: [t.stockEntryUi.importErrorCodeRequired] });
          return;
        }
        // Missing catalog products are auto-created on Import — do not block.
        valid.push({
          codigo,
          descricao: row.descricao,
          quantidade: row.quantidade > 0 ? Math.round(row.quantidade) : 0,
          custo: Math.max(0, row.custo || 0),
        });
      });

      return { valid, errors };
    },
    [t.stockEntryUi],
  );

  const handleImportFromExcel = useCallback(
    async (data: ExcelStockEntryLine[]) => {
      if (!entryBranchId || data.length === 0) return;

      const importQty = (qty: number) => (qty > 0 ? qty : 1);
      let catalog = [...productsForImport];

      const missingRows = data.filter(
        (row) => !findProductForStockEntryImport(catalog, row.codigo, entryBranchId, row.descricao),
      );
      let createdCount = 0;

      if (missingRows.length > 0) {
        const uniqueMissing = new Map<string, ExcelStockEntryLine>();
        for (const row of missingRows) {
          const key = normalizeSearchText(row.codigo);
          if (key && !uniqueMissing.has(key)) uniqueMissing.set(key, row);
        }
        // Do not invent IVA 5% on auto-create — new products without IVA are skipped;
        // existing SKUs keep their stored rate via batch update (no taxRate field).
        const payload = Array.from(uniqueMissing.values()).map((row) => ({
          sku: row.codigo,
          name: String(row.descricao || '').trim() || row.codigo,
          category: 'GERAL',
          price: 0,
          cost: Math.max(0, row.custo || 0),
          stock: 0,
          unit: 'UN',
          isActive: true,
          branchId: entryBranchId,
        }));
        const batch = await api.products.batchImport(payload);
        createdCount = Number(batch.data?.imported || 0);
        // Refresh light catalog so new SKUs resolve for line fill.
        const refreshed = await loadImportCatalog();
        if (refreshed.length > 0) catalog = refreshed;
      }

      const mergedBySku = new Map<string, {
        productId: string | null;
        quantity: number;
        cost: number;
        taxRate: number | null;
        search: string;
      }>();

      for (const row of data) {
        const catalogProduct = findProductForStockEntryImport(
          catalog,
          row.codigo,
          entryBranchId,
          row.descricao,
        );
        const skuKey = normalizeSearchText(catalogProduct?.sku || row.codigo);
        if (!skuKey) continue;

        const qty = importQty(row.quantidade);
        const cost = row.custo > 0 ? row.custo : (catalogProduct?.cost || 0);
        const taxRate = parseTaxRateOrNull(catalogProduct?.taxRate);
        const prev = mergedBySku.get(skuKey);

        if (prev) {
          mergedBySku.set(skuKey, {
            productId: catalogProduct?.id ?? prev.productId,
            quantity: prev.quantity + qty,
            cost: row.custo > 0 ? row.custo : prev.cost,
            taxRate: prev.taxRate ?? taxRate,
            search: prev.search,
          });
        } else {
          mergedBySku.set(skuKey, {
            productId: catalogProduct?.id ?? null,
            quantity: qty,
            cost,
            taxRate,
            search: catalogProduct ? '' : String(row.codigo || '').trim(),
          });
        }
      }

      let firstImportedRowId: string | null = null;

      setForm((prev) => {
        const lines = [...prev.lines];
        const usedRowIds = new Set<string>();

        for (const entry of mergedBySku.values()) {
          let targetIdx = lines.findIndex(
            (l) =>
              !usedRowIds.has(l.rowId)
              && (
                (entry.productId && l.productId === entry.productId)
                || (!entry.productId && normalizeSearchText(l.search) === normalizeSearchText(entry.search))
              ),
          );
          if (targetIdx < 0) {
            targetIdx = lines.findIndex((l) => !l.productId && !String(l.search || '').trim() && !usedRowIds.has(l.rowId));
          }
          if (targetIdx < 0) {
            const fresh = createEmptyLine();
            lines.push(fresh);
            targetIdx = lines.length - 1;
          }

          const rowId = lines[targetIdx].rowId;
          usedRowIds.add(rowId);
          if (!firstImportedRowId) firstImportedRowId = rowId;

          lines[targetIdx] = {
            ...lines[targetIdx],
            productId: entry.productId,
            search: entry.search,
            quantity: entry.quantity,
            cost: entry.cost,
            taxRate: entry.taxRate,
          };
        }

        return { ...prev, lines };
      });

      if (firstImportedRowId) {
        window.setTimeout(() => focusQtyLine(firstImportedRowId!), 80);
      }

      const parts = [
        t.stockEntryUi.importSuccessDesc.replace('{count}', String(mergedBySku.size)),
      ];
      if (createdCount > 0) {
        parts.push(t.stockEntryUi.importCreatedProducts.replace('{count}', String(createdCount)));
      }
      toast({
        title: t.stockEntryUi.importSuccess,
        description: parts.join(' '),
      });
    },
    [entryBranchId, productsForImport, loadImportCatalog, toast, t.stockEntryUi, focusQtyLine],
  );

  const openImportDialog = useCallback(() => {
    if (!entryBranchId) {
      toast({
        variant: 'destructive',
        title: t.stockEntryUi.branchRequiredTitle,
        description: t.stockEntryUi.branchRequiredDesc,
      });
      return;
    }
    // Open immediately, but block file pick until the light catalog finishes —
    // otherwise every row fails as "Product not found" and Import is hidden.
    setImportDialogOpen(true);
    void loadImportCatalog();
  }, [entryBranchId, loadImportCatalog, toast, t.stockEntryUi]);

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
        return;
      }
      if (suggestions.length > 0) {
        const pick = suggestions[pickerHighlightIndex] ?? suggestions[0];
        if (pick) selectProductOnRow(line.rowId, pick);
        return;
      }
      focusProductRow(rowIndex + 1);
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

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, rowId: string) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) {
      if (rowIndex > 0) focusProductRow(rowIndex - 1);
      return;
    }
    focusCostLine(rowId);
  };

  const handleCostKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, rowId: string) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) {
      focusQtyLine(rowId);
      return;
    }
    focusVatLine(rowId);
  };

  const handleVatKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, rowIndex: number, rowId: string) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) {
      focusCostLine(rowId);
      return;
    }
    focusProductRow(rowIndex + 1);
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

    let resolvedFreightAccount = form.freightSourceAccount;
    let resolvedFreightName = form.freightSourceName;
    if (totalLandingCosts > 0) {
      if (form.freightPaymentSource === 'caixa' && !form.freightCaixaId) {
        toast({
          title: t.common.error,
          description: t.stockEntryUi.selectFreightCaixa,
          variant: 'destructive',
        });
        return;
      }
      if (form.freightPaymentSource === 'bank' && freightBankAccounts.length > 0 && !form.freightBankAccountId) {
        toast({
          title: t.common.error,
          description: t.stockEntryUi.selectFreightBank,
          variant: 'destructive',
        });
        return;
      }
      const treasury = await resolveFreightTreasuryGl({
        paymentSource: form.freightPaymentSource,
        caixaId: form.freightCaixaId || undefined,
        bankAccountId: form.freightBankAccountId || undefined,
        branchId: entryBranchId,
        freightSourceAccount: form.freightSourceAccount,
        freightSourceName: form.freightSourceName,
        caixas: freightCaixas,
        bankAccounts: freightBankAccounts,
      });
      resolvedFreightAccount = treasury.accountCode;
      resolvedFreightName = treasury.accountName;
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
        freightSourceAccount: totalLandingCosts > 0 ? resolvedFreightAccount : undefined,
        freightSourceName: totalLandingCosts > 0 ? resolvedFreightName : undefined,
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
        <div className="shrink-0 border-b bg-gradient-to-r from-emerald-50/80 via-background to-background px-2 py-1 sm:px-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white">
                <PackagePlus className="h-3.5 w-3.5" />
              </div>
              <DialogTitle
                className="text-sm font-semibold leading-none truncate"
                title={t.stockEntryUi.description.replace('{branch}', branchLabel)}
              >
                {t.stockEntryUi.title}
              </DialogTitle>
              <Badge variant="outline" className="hidden sm:flex font-mono text-[10px] gap-1 shrink-0 h-5 px-1.5">
                <Hash className="h-3 w-3" />
                {entryNumber}
              </Badge>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2" onClick={openImportDialog}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
                {t.stockEntryUi.importExcel}
              </Button>
              {onAddProduct ? (
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2" onClick={onAddProduct}>
                  <Package className="h-3.5 w-3.5 mr-1" />
                  {t.stockEntryUi.newProduct}
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs px-2" onClick={addRows}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t.stockEntryUi.addLine}
              </Button>
              <Popover open={notesOpen} onOpenChange={setNotesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant={hasNotes ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-7 text-xs gap-1 px-2"
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    {t.stockEntryUi.notesButton}
                    {hasNotes && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
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
                className="h-7 w-7"
                onClick={() => handleDialogOpenChange(false)}
                aria-label={t.common.cancel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {!effectiveWarehouseId && (
          <Alert variant="destructive" className="mx-2 mt-1 shrink-0 py-1 text-xs">
            <AlertCircle className="h-3.5 w-3.5" />
            <AlertDescription>{t.stockEntryUi.branchRequiredDesc}</AlertDescription>
          </Alert>
        )}

        <div className="shrink-0 border-b bg-muted/20 px-2 py-1.5 sm:px-3 space-y-1.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-1.5">
            <CompactField label={t.stockEntryUi.entryReason}>
              <Select
                value={form.entryReason}
                onValueChange={(value: StockEntryReason) =>
                  setForm((p) => ({ ...p, entryReason: value }))
                }
              >
                <SelectTrigger className="bg-background h-7 w-full text-xs" title={t.stockEntryUi.entryReason}>
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
            </CompactField>
            <CompactField label={t.stockEntryUi.entryDate}>
              <Input
                type="date"
                value={form.entryDate}
                onChange={(e) => setForm((p) => ({ ...p, entryDate: e.target.value }))}
                className="bg-background h-7 w-full text-xs"
                title={t.stockEntryUi.entryDate}
              />
            </CompactField>
            <CompactField label={t.stockEntryUi.receiptNumber} className="col-span-2 sm:col-span-1">
              <Input
                value={form.reference}
                onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                placeholder={t.stockEntryUi.receiptNumberPlaceholder}
                className="bg-background h-7 w-full font-mono text-xs"
                title={t.stockEntryUi.receiptNumber}
              />
            </CompactField>
            <CompactField label={t.stockEntryUi.branch}>
              {branchLocked ? (
                <Input
                  readOnly
                  value={branchLabel}
                  className="bg-muted/50 h-7 w-full text-xs"
                  title={t.stockEntryUi.branch}
                />
              ) : (
                <Select
                  value={form.entryBranchId}
                  onValueChange={handleEntryBranchChange}
                >
                  <SelectTrigger className="bg-background h-7 w-full text-xs" title={t.stockEntryUi.branch}>
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
            </CompactField>
            <CompactField label={t.stockEntryUi.currency}>
              <Select
                value={form.currency}
                onValueChange={(v) => {
                  setForm((p) => ({ ...p, currency: v, currencyRate: v === 'KZ' ? 1 : p.currencyRate }));
                  void loadExchangeRate(v);
                }}
              >
                <SelectTrigger className="bg-background h-7 w-full text-xs" title={t.stockEntryUi.currency}>
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
            </CompactField>
            <CompactField label={t.stockEntryUi.exchangeRate}>
              <NumericInput
                min={0}
                value={form.currencyRate}
                onValueChange={(v) => setForm((p) => ({ ...p, currencyRate: v }))}
                className="h-7 w-full bg-background font-mono text-xs"
                disabled={form.currency === 'KZ'}
                title={t.stockEntryUi.exchangeRate}
              />
            </CompactField>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-1.5">
            <CompactField label={t.stockEntryUi.freightLabel}>
              <NumericInput
                min={0}
                value={form.freightCost}
                onValueChange={(v) => setForm((p) => ({ ...p, freightCost: v }))}
                className="h-7 w-full bg-background text-xs"
                title={t.stockEntryUi.freightLabel}
              />
            </CompactField>
            <CompactField label={t.stockEntryUi.otherCostsLabel}>
              <NumericInput
                min={0}
                value={form.otherCosts}
                onValueChange={(v) => setForm((p) => ({ ...p, otherCosts: v }))}
                className="h-7 w-full bg-background text-xs"
                title={t.stockEntryUi.otherCostsLabel}
              />
            </CompactField>
            <CompactField label={t.stockEntryUi.otherCostsDescLabel} className="col-span-2">
              <Input
                value={form.otherCostsDescription}
                onChange={(e) =>
                  setForm((p) => ({ ...p, otherCostsDescription: e.target.value }))
                }
                placeholder={t.stockEntryUi.otherCostsDescPlaceholder}
                className="h-7 w-full bg-background text-xs"
                title={t.stockEntryUi.otherCostsDescLabel}
              />
            </CompactField>
            {totalLandingCosts > 0 && (
              <>
                <CompactField label={t.stockEntryUi.freightPaymentSource}>
                  <Select
                    value={form.freightPaymentSource}
                    onValueChange={(v) =>
                      setForm((p) => ({ ...p, freightPaymentSource: v as FreightPaymentSource }))
                    }
                  >
                    <SelectTrigger className="h-7 w-full bg-background text-xs" title={t.stockEntryUi.freightPaymentSource}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="caixa">{t.stockEntryUi.freightSourceCaixa}</SelectItem>
                      <SelectItem value="bank">{t.stockEntryUi.freightSourceBank}</SelectItem>
                    </SelectContent>
                  </Select>
                </CompactField>
                <CompactField
                  label={
                    form.freightPaymentSource === 'caixa'
                      ? t.stockEntryUi.selectFreightCaixa
                      : t.stockEntryUi.selectFreightBank
                  }
                  className="col-span-2 sm:col-span-3"
                >
                  {form.freightPaymentSource === 'caixa' ? (
                    <Select
                      value={form.freightCaixaId || undefined}
                      onValueChange={(v) => setForm((p) => ({ ...p, freightCaixaId: v }))}
                      disabled={freightTreasuryLoading}
                    >
                      <SelectTrigger className="h-7 w-full bg-background text-xs">
                        <SelectValue
                          placeholder={
                            freightTreasuryLoading
                              ? t.stockEntryUi.freightTreasuryLoading
                              : t.stockEntryUi.selectFreightCaixa
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {freightCaixas.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            {t.stockEntryUi.noFreightCaixas}
                          </SelectItem>
                        ) : (
                          freightCaixas.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {formatFreightCaixaLabel(c, uiLocale, freightAllBranches)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={form.freightBankAccountId || undefined}
                      onValueChange={(v) => setForm((p) => ({ ...p, freightBankAccountId: v }))}
                      disabled={freightTreasuryLoading}
                    >
                      <SelectTrigger className="h-7 w-full bg-background text-xs">
                        <SelectValue placeholder={t.stockEntryUi.selectFreightBank} />
                      </SelectTrigger>
                      <SelectContent>
                        {freightBankAccounts.length === 0 ? (
                          <SelectItem value="__none__" disabled>
                            {t.stockEntryUi.noFreightBanks}
                          </SelectItem>
                        ) : (
                          freightBankAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {formatFreightBankLabel(a, freightAllBranches)}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </CompactField>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden px-1 py-1 sm:px-2">
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
                  <TableHead className="w-[80px]">{t.stockEntryUi.colVat}</TableHead>
                  <TableHead className="w-[88px] text-right">{t.stockEntryUi.colFreight}</TableHead>
                  <TableHead className="w-[96px] text-right">{t.stockEntryUi.colTotal}</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.lines.map((line, rowIndex) => {
                  const product = line.productId ? productsById.get(line.productId) : undefined;
                  const stock = stockAtEntryBranch(product);
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
                          onKeyDown={(e) => handleQtyKeyDown(e, rowIndex, line.rowId)}
                          className="h-7 text-[11px]"
                          disabled={!product}
                          tabIndex={product ? 0 : -1}
                        />
                      </TableCell>
                      <TableCell className="align-middle">
                        <NumericInput
                          ref={(el) => {
                            costRefs.current[line.rowId] = el;
                          }}
                          min={0}
                          value={line.cost}
                          onValueChange={(c) => updateLineCost(line.rowId, c)}
                          onKeyDown={(e) => handleCostKeyDown(e, rowIndex, line.rowId)}
                          className="h-7 text-[11px] font-mono"
                          disabled={!product}
                          tabIndex={product ? 0 : -1}
                        />
                      </TableCell>
                      <TableCell className="align-middle">
                        <Select
                          value={line.taxRate === null || line.taxRate === undefined ? undefined : String(line.taxRate)}
                          onValueChange={(v) => updateLineTaxRate(line.rowId, Number(v))}
                          disabled={!product}
                        >
                          <SelectTrigger
                            ref={(el) => {
                              vatTriggerRefs.current[line.rowId] = el;
                            }}
                            className="h-7 text-[11px] px-1.5"
                            tabIndex={product ? 0 : -1}
                            onKeyDown={(e) => handleVatKeyDown(e, rowIndex, line.rowId)}
                          >
                            <SelectValue placeholder="IVA" />
                          </SelectTrigger>
                          <SelectContent>
                            {ALLOWED_VAT_RATES.map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                {r}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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

        <div className="shrink-0 border-t bg-muted/30 px-2 sm:px-3 py-1.5 flex items-center gap-2 justify-between">
          <div className="flex flex-wrap gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryItems}: </span>
              <span className="font-semibold tabular-nums">{totals.items}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryUnits}: </span>
              <span className="font-semibold tabular-nums">{totals.units}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t.stockEntryUi.summaryGrandTotal}: </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {formatCurrency(totals.value)}
              </span>
            </div>
          </div>
          <div className="flex gap-1.5 justify-end shrink-0">
            <Button variant="outline" size="sm" className="h-7" onClick={() => handleDialogOpenChange(false)} disabled={submitting}>
              {t.common.cancel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-foreground border-foreground hover:bg-muted"
              onClick={() => void handleApply()}
              disabled={fulfilledItems.length === 0 || !effectiveWarehouseId || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  {t.stockEntryUi.applying}
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1" />
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
                      ({stockAtEntryBranch(p)} {p.unit} @ {resolveBranchName(entryBranchId)})
                    </span>
                  </button>
                ))
              )}
            </div>,
            dialogContentRef.current,
          )}
      </DialogContent>
      <ExcelImportDialog<ExcelStockEntryLine>
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title={t.stockEntryUi.importDialogTitle}
        description={t.stockEntryUi.importDialogDesc}
        parseFile={parseStockEntryExcelFile}
        validateData={validateStockEntryImport}
        onImport={handleImportFromExcel}
        downloadTemplate={downloadStockEntryImportTemplate}
        catalogLoading={importCatalogLoading}
        catalogSize={productsForImport.length}
        columns={[
          { key: 'codigo', label: t.stockEntryUi.colCode },
          { key: 'descricao', label: t.stockEntryUi.colProduct },
        ]}
      />
    </Dialog>
  );
}
