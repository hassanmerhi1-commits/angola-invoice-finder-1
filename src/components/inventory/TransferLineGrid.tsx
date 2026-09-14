import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { Product } from '@/types/erp';
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
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  DEFAULT_LINE_ROWS,
  PRODUCT_LINE_SUGGESTION_LIMIT,
  ROWS_APPEND_BATCH,
  ROWS_NEAR_END_BUFFER,
  ensureRowsForIndex,
  filterProductsForSearch,
  newLineRowId,
  sortProductSearchResults,
} from '@/components/inventory/productLineSearch';

export type TransferLineItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  availableStock: number;
};

type LineRow = {
  rowId: string;
  productId: string | null;
  search: string;
  quantity: number;
};

const createEmptyLine = (): LineRow => ({
  rowId: newLineRowId(),
  productId: null,
  search: '',
  quantity: 1,
});

const createInitialLines = (count = DEFAULT_LINE_ROWS): LineRow[] =>
  Array.from({ length: count }, () => createEmptyLine());

interface TransferLineGridProps {
  products: Product[];
  branchId: string;
  stockByProductId: Map<string, number>;
  enabled: boolean;
  onItemsChange: (items: TransferLineItem[]) => void;
  autoFocus?: boolean;
  className?: string;
  onAddProduct?: () => void;
  seedProduct?: Product | null;
  onSeedConsumed?: () => void;
}

export function TransferLineGrid({
  products,
  branchId,
  stockByProductId,
  enabled,
  onItemsChange,
  autoFocus = false,
  className,
  onAddProduct,
  seedProduct = null,
  onSeedConsumed,
}: TransferLineGridProps) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<LineRow[]>(() => createInitialLines());
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerHighlightIndex, setPickerHighlightIndex] = useState(0);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);
  const productInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const rootRef = useRef<HTMLDivElement | null>(null);

  const catalog = useMemo(() => {
    if (seedProduct && !products.some((p) => p.id === seedProduct.id)) {
      return [...products, seedProduct];
    }
    return products;
  }, [products, seedProduct]);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of catalog) map.set(product.id, product);
    return map;
  }, [catalog]);

  const stockOf = useCallback(
    (product: Product | undefined) => {
      if (!product) return 0;
      const live = stockByProductId.get(product.id);
      return live == null ? Number(product.stock) || 0 : live;
    },
    [stockByProductId],
  );

  const searchableProducts = useMemo(
    () => catalog.filter((product) => product.isActive !== false && stockOf(product) > 0),
    [catalog, stockOf],
  );

  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        if (!line.productId) return line;
        const product = productsById.get(line.productId);
        const available = stockOf(product);
        const capped = available > 0 ? Math.min(Math.max(1, line.quantity), available) : 0;
        if (capped === line.quantity) return line;
        changed = true;
        return { ...line, quantity: capped };
      });
      return changed ? next : prev;
    });
  }, [productsById, stockOf]);

  const fulfilledItems = useMemo((): TransferLineItem[] => {
    const items: TransferLineItem[] = [];
    for (const line of lines) {
      if (!line.productId) continue;
      const product = productsById.get(line.productId);
      if (!product) continue;
      const availableStock = stockOf(product);
      const quantity = Math.min(Math.max(1, line.quantity), Math.max(1, availableStock));
      if (availableStock < 1) continue;
      items.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity,
        availableStock,
      });
    }
    return items;
  }, [lines, productsById, stockOf]);

  useEffect(() => {
    onItemsChange(fulfilledItems);
  }, [fulfilledItems, onItemsChange]);

  const getSuggestionsForRow = useCallback(
    (rowId: string, search: string) => {
      if (!search.trim() || !branchId) return [];
      const usedElsewhere = new Set(
        linesRef.current
          .filter((line) => line.rowId !== rowId && line.productId)
          .map((line) => line.productId as string),
      );
      return filterProductsForSearch(searchableProducts, search, usedElsewhere, branchId)
        .sort((a, b) => sortProductSearchResults(a, b, search, branchId))
        .slice(0, PRODUCT_LINE_SUGGESTION_LIMIT);
    },
    [searchableProducts, branchId],
  );

  const activePickerLine = useMemo(
    () => (pickerRowId ? lines.find((line) => line.rowId === pickerRowId) : undefined),
    [pickerRowId, lines],
  );

  const activePickerSuggestions = useMemo(() => {
    if (!activePickerLine || activePickerLine.productId) return [];
    return getSuggestionsForRow(activePickerLine.rowId, activePickerLine.search);
  }, [activePickerLine, getSuggestionsForRow]);

  const showPickerDropdown = Boolean(
    enabled &&
      pickerRowId &&
      activePickerLine &&
      !activePickerLine.productId &&
      activePickerLine.search.trim().length > 0,
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

  const focusProductRow = useCallback((rowIndex: number) => {
    setLines((prev) => {
      const nextLines = ensureRowsForIndex(prev, rowIndex, createEmptyLine);
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
      return nextLines.length === prev.length ? prev : nextLines;
    });
  }, []);

  const focusQtyLine = useCallback((rowId: string) => {
    requestAnimationFrame(() => {
      const el = qtyRefs.current[rowId];
      el?.focus();
      el?.select();
    });
  }, []);

  const selectProductOnRow = useCallback(
    (rowId: string, product: Product) => {
      setLines((prev) => {
        const mapped = prev.map((line) =>
          line.rowId === rowId
            ? {
                ...line,
                productId: product.id,
                search: '',
                quantity: Math.min(Math.max(1, line.quantity), Math.max(1, stockOf(product))),
              }
            : line,
        );
        const rowIndex = mapped.findIndex((line) => line.rowId === rowId);
        return ensureRowsForIndex(mapped, rowIndex + 1, createEmptyLine);
      });
      setPickerRowId(null);
      setPickerHighlightIndex(0);
      setPickerAnchorRect(null);
      focusQtyLine(rowId);
    },
    [focusQtyLine, stockOf],
  );

  useEffect(() => {
    if (!enabled || !seedProduct) return;
    if (stockOf(seedProduct) <= 0) {
      onSeedConsumed?.();
      return;
    }
    const empty = linesRef.current.find((line) => !line.productId);
    if (!empty) {
      onSeedConsumed?.();
      return;
    }
    selectProductOnRow(empty.rowId, seedProduct);
    onSeedConsumed?.();
  }, [enabled, seedProduct, selectProductOnRow, onSeedConsumed, stockOf]);

  const updateLineSearch = (rowId: string, search: string) => {
    setLines((prev) => prev.map((line) => (line.rowId === rowId ? { ...line, search } : line)));
    setPickerRowId(rowId);
    setPickerHighlightIndex(0);
  };

  const clearProductOnRow = (rowId: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.rowId === rowId ? { ...line, productId: null, search: '', quantity: 1 } : line,
      ),
    );
    setPickerRowId(rowId);
    requestAnimationFrame(() => productInputRefs.current[rowId]?.focus());
  };

  const updateLineQuantity = (rowId: string, quantity: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.rowId !== rowId) return line;
        const product = line.productId ? productsById.get(line.productId) : undefined;
        const available = stockOf(product);
        const max = available > 0 ? available : 1;
        return { ...line, quantity: Math.min(Math.max(1, quantity), max) };
      }),
    );
  };

  const addRows = () => {
    setLines((prev) => [...prev, ...createInitialLines(ROWS_APPEND_BATCH)]);
  };

  useEffect(() => {
    if (!autoFocus || !enabled) return;
    const first = linesRef.current[0];
    if (!first) return;
    const timer = window.setTimeout(() => {
      productInputRefs.current[first.rowId]?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [autoFocus, enabled]);

  const handleProductKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    line: LineRow,
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

  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (rowIndex > 0) focusProductRow(rowIndex - 1);
        return;
      }
      focusProductRow(rowIndex + 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      focusProductRow(rowIndex + 1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusProductRow(rowIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) focusProductRow(rowIndex - 1);
    }
  };

  const totals = useMemo(
    () => ({
      items: fulfilledItems.length,
      units: fulfilledItems.reduce((sum, item) => sum + item.quantity, 0),
    }),
    [fulfilledItems],
  );

  return (
    <div ref={rootRef} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{t.stockTransferUi.pickerKeyboardHint}</p>
        <div className="flex items-center gap-3 text-xs">
          <span>
            <span className="text-muted-foreground">{t.stockTransferUi.summaryItems}: </span>
            <span className="font-semibold tabular-nums">{totals.items}</span>
          </span>
          <span>
            <span className="text-muted-foreground">{t.stockTransferUi.summaryUnits}: </span>
            <span className="font-semibold tabular-nums">{totals.units}</span>
          </span>
          {onAddProduct ? (
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={onAddProduct} disabled={!enabled}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t.stockTransferUi.newProduct}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={addRows} disabled={!enabled}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t.stockTransferUi.addLine}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-background [&_th]:h-7 [&_th]:px-1.5 [&_th]:text-[11px] [&_td]:px-1.5 [&_td]:py-0.5">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            <TableRow>
              <TableHead className="min-w-[220px]">{t.stockTransferUi.colProduct}</TableHead>
              <TableHead className="w-[88px]">{t.stockTransferUi.colSku}</TableHead>
              <TableHead className="w-[100px]">{t.stockTransferUi.colAvailable}</TableHead>
              <TableHead className="w-[88px]">{t.stockTransferUi.colQuantity}</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, rowIndex) => {
              const product = line.productId ? productsById.get(line.productId) : undefined;
              const available = stockOf(product);
              const stockAfter = product ? Math.max(0, available - line.quantity) : null;

              return (
                <TableRow
                  key={line.rowId}
                  className={cn(product && 'bg-sky-50/40 dark:bg-sky-950/15')}
                >
                  <TableCell className="min-w-[220px] align-middle">
                    {product ? (
                      <p className="whitespace-normal break-words text-[11px] leading-tight">
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
                            setLines((prev) => ensureRowsForIndex(prev, rowIndex, createEmptyLine));
                          }
                        }}
                        onKeyDown={(e) => handleProductKeyDown(e, rowIndex, line)}
                        placeholder={
                          enabled
                            ? t.stockTransferUi.searchShortPlaceholder
                            : t.stockTransferUi.selectSourceFirst
                        }
                        disabled={!enabled}
                        className="h-7 w-full min-w-0 bg-background px-2 py-0 text-[11px]"
                        autoComplete="off"
                      />
                    )}
                  </TableCell>
                  <TableCell className="align-middle font-mono text-[11px]">
                    {product?.sku ?? '—'}
                  </TableCell>
                  <TableCell className="align-middle text-xs tabular-nums">
                    {product ? (
                      <>
                        {available}
                        <span className="mx-0.5 text-muted-foreground">→</span>
                        <span className="text-sky-700">{stockAfter}</span>
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
                      max={available > 0 ? available : 1}
                      value={line.quantity}
                      onValueChange={(qty) => updateLineQuantity(line.rowId, qty)}
                      onKeyDown={(e) => handleQtyKeyDown(e, rowIndex)}
                      className="h-7 text-[11px]"
                      disabled={!product || !enabled}
                      tabIndex={product ? 0 : -1}
                    />
                  </TableCell>
                  <TableCell className="align-middle">
                    {product && (
                      <Button
                        type="button"
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

      {showPickerDropdown &&
        pickerRowId &&
        pickerAnchorRect &&
        rootRef.current &&
        createPortal(
          <div
            role="listbox"
            className="pointer-events-auto fixed z-[200] max-h-52 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
            style={{
              top: pickerAnchorRect.bottom + 2,
              left: pickerAnchorRect.left,
              width: Math.max(320, pickerAnchorRect.width),
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {activePickerSuggestions.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {t.stockTransferUi.noSearchResults}
              </p>
            ) : (
              activePickerSuggestions.map((product, idx) => (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={idx === pickerHighlightIndex}
                  className={cn(
                    'w-full cursor-pointer border-b px-2 py-1.5 text-left text-[11px] leading-tight last:border-b-0 hover:bg-muted',
                    idx === pickerHighlightIndex && 'nexor-row-selected',
                  )}
                  onMouseEnter={() => setPickerHighlightIndex(idx)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectProductOnRow(pickerRowId, product);
                  }}
                >
                  <span className="font-mono">{product.sku}</span>
                  <span className="mx-0.5">—</span>
                  {product.name}
                  <span className="ml-1 text-muted-foreground">
                    {t.stockTransferUi.stockAvailable.replace('{stock}', String(stockOf(product)))}
                  </span>
                </button>
              ))
            )}
          </div>,
          rootRef.current,
        )}
    </div>
  );
}
