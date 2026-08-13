import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Product } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Plus, Trash2, X } from 'lucide-react';
import {
  DEFAULT_LINE_ROWS,
  PRODUCT_LINE_SUGGESTION_LIMIT,
  ROWS_NEAR_END_BUFFER,
  ensureRowsForIndex,
  filterProductsForSearch,
  newLineRowId,
  normalizeSearchText,
  sortProductSearchResults,
} from '@/components/inventory/productLineSearch';

interface BulkPriceCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  isHeadOffice?: boolean;
  onApplied?: (updated: number) => void;
}

type PriceLine = {
  rowId: string;
  productId: string | null;
  sku: string;
  name: string;
  search: string;
  origPrice: number;
  origCost: number;
  price: number;
  cost: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sameMoney = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.005;
const unitCost = (p: Product) => round2(p.avgCost || p.lastCost || p.cost || 0);

const createEmptyLine = (): PriceLine => ({
  rowId: newLineRowId(),
  productId: null,
  sku: '',
  name: '',
  search: '',
  origPrice: 0,
  origCost: 0,
  price: 0,
  cost: 0,
});

const createInitialLines = () => Array.from({ length: DEFAULT_LINE_ROWS }, () => createEmptyLine());

export function BulkPriceCostDialog({
  open,
  onOpenChange,
  products,
  isHeadOffice = false,
  onApplied,
}: BulkPriceCostDialogProps) {
  const { t, language } = useTranslation();
  const ui = t.inventoryPageUi.massPrice;
  const se = t.stockEntryUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [lines, setLines] = useState<PriceLine[]>(createInitialLines);
  const [saving, setSaving] = useState(false);
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerHighlightIndex, setPickerHighlightIndex] = useState(0);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);

  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const productInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const costRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const catalog = useMemo(
    () => products.filter((p) => p.isActive !== false),
    [products],
  );

  useEffect(() => {
    if (!open) return;
    const initial = createInitialLines();
    setLines(initial);
    setSaving(false);
    setPickerRowId(null);
    setPickerHighlightIndex(0);
    setPickerAnchorRect(null);
    const firstId = initial[0].rowId;
    const timer = window.setTimeout(() => {
      productInputRefs.current[firstId]?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open]);

  const isDirty = useCallback(
    (line: PriceLine) =>
      Boolean(line.productId)
      && (!sameMoney(line.price, line.origPrice) || !sameMoney(line.cost, line.origCost)),
    [],
  );

  const dirtyLines = useMemo(() => lines.filter(isDirty), [lines, isDirty]);

  const usedElsewhere = useCallback(
    (rowId: string) => {
      const ids = new Set<string>();
      const skus = new Set<string>();
      for (const line of lines) {
        if (line.rowId === rowId || !line.productId) continue;
        ids.add(line.productId);
        if (line.sku) skus.add(normalizeSearchText(line.sku));
      }
      return { ids, skus };
    },
    [lines],
  );

  const getSuggestionsForRow = useCallback(
    (rowId: string, search: string) => {
      if (!search.trim()) return [];
      const { ids, skus } = usedElsewhere(rowId);
      return filterProductsForSearch(catalog, search, ids, '')
        .filter((p) => !skus.has(normalizeSearchText(p.sku)))
        .sort((a, b) => sortProductSearchResults(a, b, search, ''))
        .slice(0, PRODUCT_LINE_SUGGESTION_LIMIT);
    },
    [catalog, usedElsewhere],
  );

  const activePickerLine = useMemo(
    () => (pickerRowId ? lines.find((l) => l.rowId === pickerRowId) : undefined),
    [pickerRowId, lines],
  );

  const activePickerSuggestions = useMemo(() => {
    if (!activePickerLine || activePickerLine.productId) return [];
    return getSuggestionsForRow(activePickerLine.rowId, activePickerLine.search);
  }, [activePickerLine, getSuggestionsForRow]);

  const showPickerDropdown = Boolean(
    pickerRowId
    && activePickerLine
    && !activePickerLine.productId
    && activePickerLine.search.trim().length > 0,
  );

  const syncPickerAnchor = useCallback((rowId: string | null) => {
    if (!rowId) {
      setPickerAnchorRect(null);
      return;
    }
    const el = productInputRefs.current[rowId];
    setPickerAnchorRect(el ? el.getBoundingClientRect() : null);
  }, []);

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

  const focusPriceLine = useCallback((rowId: string) => {
    requestAnimationFrame(() => {
      const el = priceRefs.current[rowId];
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

  const focusProductRow = useCallback((rowIndex: number) => {
    setLines((prev) => {
      const nextLines = ensureRowsForIndex(prev, rowIndex, createEmptyLine);
      const row = nextLines[rowIndex];
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!row) return;
          if (row.productId) focusPriceLine(row.rowId);
          else productInputRefs.current[row.rowId]?.focus();
        });
      });
      if (nextLines.length === prev.length) return prev;
      return nextLines;
    });
  }, [focusPriceLine]);

  const selectProductOnRow = useCallback(
    (rowId: string, product: Product) => {
      const skuKey = normalizeSearchText(product.sku);
      const already = linesRef.current.some(
        (l) => l.rowId !== rowId && (
          l.productId === product.id
          || (skuKey && normalizeSearchText(l.sku) === skuKey)
        ),
      );
      if (already) {
        toast.info(ui.alreadyOnList);
        return;
      }
      const origPrice = round2(product.price);
      const origCost = unitCost(product);
      setLines((prev) => {
        const mapped = prev.map((l) =>
          l.rowId === rowId
            ? {
                ...l,
                productId: product.id,
                sku: product.sku || '',
                name: product.name || '',
                search: '',
                origPrice,
                origCost,
                price: origPrice,
                cost: origCost,
              }
            : l,
        );
        const rowIndex = mapped.findIndex((l) => l.rowId === rowId);
        return ensureRowsForIndex(mapped, rowIndex + 1, createEmptyLine);
      });
      setPickerRowId(null);
      setPickerHighlightIndex(0);
      setPickerAnchorRect(null);
      focusPriceLine(rowId);
    },
    [focusPriceLine, ui.alreadyOnList],
  );

  const updateLineSearch = (rowId: string, search: string) => {
    setLines((prev) => prev.map((l) => (l.rowId === rowId ? { ...l, search } : l)));
    setPickerRowId(rowId);
    setPickerHighlightIndex(0);
  };

  const clearProductOnRow = (rowId: string) => {
    setLines((prev) =>
      prev.map((l) => (l.rowId === rowId ? { ...createEmptyLine(), rowId } : l)),
    );
    setPickerRowId(rowId);
    requestAnimationFrame(() => productInputRefs.current[rowId]?.focus());
  };

  const patchLine = (rowId: string, field: 'price' | 'cost', value: number) => {
    const nextVal = round2(Math.max(0, value));
    setLines((prev) =>
      prev.map((l) => (l.rowId === rowId ? { ...l, [field]: nextVal } : l)),
    );
  };

  const handleProductKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    line: PriceLine,
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

  const handlePriceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, line: PriceLine) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      focusCostLine(line.rowId);
    }
  };

  const handleCostKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      focusProductRow(rowIndex + 1);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const row = linesRef.current[rowIndex];
      if (row) focusPriceLine(row.rowId);
    }
  };

  const addRows = () => {
    setLines((prev) => [...prev, ...Array.from({ length: 4 }, () => createEmptyLine())]);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (saving) {
      onOpenChange(false);
      return;
    }
    if (dirtyLines.length > 0 && !confirm(ui.discard)) return;
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (saving) return;
    if (dirtyLines.length === 0) {
      toast.info(ui.noChanges);
      return;
    }
    if (!confirm(ui.confirm.replace('{count}', String(dirtyLines.length)))) return;
    setSaving(true);
    try {
      const items = dirtyLines.map((row) => {
        const payload: { id: string; sku: string; price?: number; cost?: number } = {
          id: row.productId as string,
          sku: row.sku,
        };
        if (!sameMoney(row.price, row.origPrice)) payload.price = row.price;
        if (!sameMoney(row.cost, row.origCost)) payload.cost = row.cost;
        return payload;
      });
      const res = await api.products.bulkPriceCost(items);
      if (res.error || !res.data?.success) {
        throw new Error(res.error || ui.failed);
      }
      toast.success(ui.success.replace('{count}', String(res.data.updated)));
      onApplied?.(res.data.updated);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || ui.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className="flex h-[96vh] max-h-[96vh] w-[98vw] max-w-[98vw] flex-col gap-3 overflow-hidden p-4"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.title}</DialogTitle>
          <DialogDescription>{ui.description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{ui.keyboardHint}</p>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {ui.changedCount.replace('{count}', String(dirtyLines.length))}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={addRows}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {se.addLine}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background [&_th]:h-8 [&_th]:px-2 [&_th]:text-xs [&_td]:px-2 [&_td]:py-1">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
              <TableRow>
                <TableHead className="min-w-[240px]">{ui.colProduct}</TableHead>
                <TableHead className="w-[110px] text-right">{ui.priceOld}</TableHead>
                <TableHead className="w-[120px] text-right">{ui.priceNew}</TableHead>
                <TableHead className="w-[110px] text-right">{ui.costOld}</TableHead>
                <TableHead className="w-[120px] text-right">{ui.costNew}</TableHead>
                <TableHead className="w-[80px] text-right">{ui.margin}</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, rowIndex) => {
                const dirtyPrice = Boolean(line.productId) && !sameMoney(line.price, line.origPrice);
                const dirtyCost = Boolean(line.productId) && !sameMoney(line.cost, line.origCost);
                const newMargin = line.price > 0 ? ((line.price - line.cost) / line.price) * 100 : 0;
                return (
                  <TableRow
                    key={line.rowId}
                    className={cn(isDirty(line) && 'bg-amber-50/70 dark:bg-amber-950/20')}
                  >
                    <TableCell className="align-middle min-w-[240px]">
                      {line.productId ? (
                        <p className="text-xs leading-tight whitespace-normal break-words">
                          <span className="font-mono font-semibold">{line.sku}</span>
                          <span className="mx-0.5">—</span>
                          {line.name}
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
                            if (rowIndex >= lines.length - ROWS_NEAR_END_BUFFER - 1) {
                              setLines((prev) => ensureRowsForIndex(prev, rowIndex, createEmptyLine));
                            }
                          }}
                          onKeyDown={(e) => handleProductKeyDown(e, rowIndex, line)}
                          placeholder={se.searchShortPlaceholder}
                          className="h-8 text-xs px-2 py-0 bg-background w-full min-w-0"
                          autoComplete="off"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground align-middle">
                      {line.productId ? fmt(line.origPrice) : '—'}
                    </TableCell>
                    <TableCell className="align-middle">
                      <NumericInput
                        ref={(el) => {
                          priceRefs.current[line.rowId] = el;
                        }}
                        min={0}
                        value={line.price}
                        onValueChange={(v) => patchLine(line.rowId, 'price', v)}
                        onKeyDown={(e) => handlePriceKeyDown(e, line)}
                        disabled={!line.productId}
                        tabIndex={line.productId ? 0 : -1}
                        className={cn(
                          'h-8 text-right text-sm tabular-nums',
                          dirtyPrice && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
                        )}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground align-middle">
                      {line.productId ? fmt(line.origCost) : '—'}
                    </TableCell>
                    <TableCell className="align-middle">
                      <NumericInput
                        ref={(el) => {
                          costRefs.current[line.rowId] = el;
                        }}
                        min={0}
                        value={line.cost}
                        onValueChange={(v) => patchLine(line.rowId, 'cost', v)}
                        onKeyDown={(e) => handleCostKeyDown(e, rowIndex)}
                        disabled={!line.productId}
                        tabIndex={line.productId ? 0 : -1}
                        className={cn(
                          'h-8 text-right text-sm tabular-nums',
                          dirtyCost && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
                        )}
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums text-xs align-middle',
                        line.productId && newMargin < 0 ? 'text-red-600 font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {line.productId ? `${newMargin.toFixed(1)}%` : '—'}
                    </TableCell>
                    <TableCell className="align-middle">
                      {line.productId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => clearProductOnRow(line.rowId)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length <= DEFAULT_LINE_ROWS
                                ? prev
                                : prev.filter((l) => l.rowId !== line.rowId),
                            )
                          }
                          disabled={lines.length <= DEFAULT_LINE_ROWS}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">{isHeadOffice ? ui.hintHq : ui.hintFilial}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyLines.length === 0}>
            {saving ? ui.saving : ui.save}
          </Button>
        </DialogFooter>

        {showPickerDropdown
          && pickerRowId
          && dialogContentRef.current
          && pickerAnchorRect
          && createPortal(
            <div
              role="listbox"
              className="fixed z-[200] rounded-md border bg-popover text-popover-foreground shadow-md max-h-52 overflow-auto pointer-events-auto"
              style={{
                top: pickerAnchorRect.bottom + 2,
                left: pickerAnchorRect.left,
                width: Math.max(320, pickerAnchorRect.width),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {activePickerSuggestions.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-2 py-1.5">
                  {se.noSearchResults}
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
                      idx === pickerHighlightIndex && 'bg-accent',
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
                    <span className="text-muted-foreground ml-1 tabular-nums">
                      ({fmt(p.price)} / {fmt(unitCost(p))})
                    </span>
                  </button>
                ))
              )}
            </div>,
            dialogContentRef.current,
          )}
      </DialogContent>
    </Dialog>
  );
}
