import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Product } from '@/types/erp';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, ChevronUp, Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { readProductStock } from '@/lib/inventoryGrid';
import {
  CustomFilterDialog,
  CustomFilterState,
  FilterCondition,
} from './CustomFilterDialog';

interface ColumnDef {
  key: string;
  label: string;
  minWidth: number;
  type?: string;
  computed?: boolean;
}

interface AdvancedDataGridProps {
  products: Product[];
  onSelectProduct: (product: Product) => void;
  onDoubleClickProduct?: (product: Product) => void;
  selectedProductId?: string;
  hideStock?: boolean;
  isHeadOffice?: boolean;
  branches?: any[];
  allBranchProducts?: Record<string, Product[]>;
  reservedQty?: Record<string, number>;
  /** Rows already sorted by name from API — skip initial O(n log n) sort. */
  preSorted?: boolean;
}

function matchesCondition(val: string, numVal: number, cond: FilterCondition, isNumber: boolean): boolean {
  const op = cond.operator;
  if (op === 'is_blank') return !val || val.trim() === '';
  if (op === 'is_not_blank') return !!val && val.trim() !== '';

  if (isNumber) {
    const target = parseFloat(cond.value);
    if (isNaN(target)) return true;
    switch (op) {
      case 'equals': return numVal === target;
      case 'not_equals': return numVal !== target;
      case 'less_than': return numVal < target;
      case 'less_equal': return numVal <= target;
      case 'greater_than': return numVal > target;
      case 'greater_equal': return numVal >= target;
      default: return true;
    }
  }

  const lower = val.toLowerCase();
  const target = cond.value.toLowerCase();
  switch (op) {
    case 'equals': return lower === target;
    case 'not_equals': return lower !== target;
    case 'contains': return lower.includes(target);
    case 'not_contains': return !lower.includes(target);
    case 'begins_with': return lower.startsWith(target);
    case 'ends_with': return lower.endsWith(target);
    default: return true;
  }
}

export function AdvancedDataGrid({
  products, onSelectProduct, onDoubleClickProduct, selectedProductId, hideStock = false,
  isHeadOffice = false, allBranchProducts = {}, reservedQty = {}, preSorted = false,
}: AdvancedDataGridProps) {
  const { t } = useTranslation();

  const COLUMNS: ColumnDef[] = useMemo(() => ([
    { key: 'sku', label: t.inventoryGridUi.sku, minWidth: 100 },
    { key: 'name', label: t.inventoryGridUi.name, minWidth: 180 },
    { key: 'price', label: t.inventoryGridUi.priceNoTax, minWidth: 100, type: 'number' },
    { key: 'priceWithIVA', label: t.inventoryGridUi.priceWithTax, minWidth: 100, type: 'number', computed: true },
    { key: 'reservedQty', label: t.inventoryGridUi.reservedQty, minWidth: 100, type: 'number', computed: true },
    { key: 'stock', label: isHeadOffice ? t.inventoryGridUi.totalQty : t.inventoryGridUi.branchQty, minWidth: 80, type: 'number' },
    { key: 'firstCost', label: t.inventoryGridUi.firstCost, minWidth: 100, type: 'number' },
    { key: 'lastCost', label: t.inventoryGridUi.lastCost, minWidth: 100, type: 'number' },
    { key: 'avgCost', label: t.inventoryGridUi.avgCost, minWidth: 100, type: 'number' },
    { key: 'profitMargin', label: t.inventoryGridUi.profitMargin, minWidth: 80, type: 'number', computed: true },
    { key: 'taxRate', label: t.inventoryGridUi.taxRate, minWidth: 70, type: 'number' },
    { key: 'unit', label: t.inventoryGridUi.unit, minWidth: 80 },
    { key: 'category', label: t.inventoryGridUi.category, minWidth: 120 },
    { key: 'supplierName', label: t.inventoryGridUi.supplierName, minWidth: 120 },
  ]), [t, isHeadOffice]);
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [simpleFilters, setSimpleFilters] = useState<Record<string, { type: 'all' | 'blanks' | 'nonblanks' | 'value'; value?: string }>>({});
  const [customFilters, setCustomFilters] = useState<Record<string, CustomFilterState>>({});
  const [customDialogCol, setCustomDialogCol] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const ROW_HEIGHT = 28;
  const OVERSCAN = 10;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight || 520));
    ro.observe(el);
    setViewportHeight(el.clientHeight || 520);
    return () => ro.disconnect();
  }, []);

  const onGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const visibleColumns = useMemo(() => {
    if (hideStock) return COLUMNS.filter(c => c.key !== 'stock');
    return COLUMNS;
  }, [hideStock]);

  const getStockTotal = (product: Product): number => readProductStock(product);

  const calculateProfitMargin = (product: Product): number => {
    const cost = product.avgCost || product.lastCost || product.firstCost || product.cost || 0;
    if (product.price <= 0) return 0;
    return ((product.price - cost) / product.price) * 100;
  };

  const getCellRawValue = (product: Product, key: string): { str: string; num: number } => {
    if (key === 'priceWithIVA') {
      const v = product.price * (1 + (product.taxRate || 0) / 100);
      return { str: String(v), num: v };
    }
    if (key === 'profitMargin') {
      const m = calculateProfitMargin(product);
      return { str: String(m), num: m };
    }
    if (key === 'stock') {
      const q = getStockTotal(product);
      return { str: String(q), num: q };
    }
    if (key === 'reservedQty') {
      const r = Number(reservedQty[product.id] ?? product.reservedStock) || 0;
      return { str: String(r), num: r };
    }
    const val = product[key as keyof Product];
    return { str: String(val ?? ''), num: typeof val === 'number' ? val : parseFloat(String(val)) || 0 };
  };

  const hasActiveFilters = Object.keys(simpleFilters).some(k => simpleFilters[k]?.type !== 'all') ||
    Object.keys(customFilters).length > 0;

  const filteredProducts = useMemo(() => {
    const needsCopy =
      hasActiveFilters ||
      !preSorted ||
      sortColumn !== 'name' ||
      sortDirection !== 'asc';
    let result = needsCopy ? [...products] : products;

    // Simple filters (blanks, nonblanks, exact value)
    Object.entries(simpleFilters).forEach(([key, filter]) => {
      if (!filter || filter.type === 'all') return;
      result = result.filter(p => {
        const { str } = getCellRawValue(p, key);
        if (filter.type === 'blanks') return !str || str.trim() === '';
        if (filter.type === 'nonblanks') return !!str && str.trim() !== '';
        if (filter.type === 'value') return str === filter.value;
        return true;
      });
    });

    // Custom filters (two conditions + AND/OR)
    Object.entries(customFilters).forEach(([key, cf]) => {
      const col = COLUMNS.find(c => c.key === key);
      const isNum = col?.type === 'number';
      const has1 = cf.condition1.value || ['is_blank', 'is_not_blank'].includes(cf.condition1.operator);
      const has2 = cf.condition2.value || ['is_blank', 'is_not_blank'].includes(cf.condition2.operator);

      if (!has1 && !has2) return;

      result = result.filter(p => {
        const { str, num } = getCellRawValue(p, key);
        const m1 = has1 ? matchesCondition(str, num, cf.condition1, isNum) : true;
        const m2 = has2 ? matchesCondition(str, num, cf.condition2, isNum) : true;
        if (has1 && has2) return cf.logic === 'and' ? m1 && m2 : m1 || m2;
        return has1 ? m1 : m2;
      });
    });

    if (needsCopy || sortColumn !== 'name' || sortDirection !== 'asc') {
      result.sort((a, b) => {
        const aVal = getCellRawValue(a, sortColumn);
        const bVal = getCellRawValue(b, sortColumn);
        const col = COLUMNS.find(c => c.key === sortColumn);
        if (col?.type === 'number') {
          return sortDirection === 'asc' ? aVal.num - bVal.num : bVal.num - aVal.num;
        }
        return sortDirection === 'asc' ? aVal.str.localeCompare(bVal.str) : bVal.str.localeCompare(aVal.str);
      });
    }

    return result;
  }, [products, simpleFilters, customFilters, sortColumn, sortDirection, reservedQty, hasActiveFilters, preSorted, COLUMNS]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const clearAllFilters = () => {
    setSimpleFilters({});
    setCustomFilters({});
  };

  const formatValue = (product: Product, key: string) => {
    if (key === 'priceWithIVA') {
      const val = product.price * (1 + (product.taxRate || 0) / 100);
      return (val || 0).toLocaleString('pt-AO', { minimumFractionDigits: 2 });
    }
    if (key === 'profitMargin') {
      const margin = calculateProfitMargin(product);
      const color = margin > 0 ? 'text-green-600' : margin < 0 ? 'text-red-600' : '';
      return <span className={color}>{margin.toFixed(1)}%</span>;
    }
    if (key === 'stock') {
      const qty = getStockTotal(product);
      const display =
        Math.abs(qty - Math.round(qty)) < 0.0001
          ? String(Math.round(qty))
          : qty.toLocaleString('pt-AO', { maximumFractionDigits: 3 });
      return (
        <span
          className={cn(
            'font-semibold tabular-nums',
            qty <= 0 ? 'text-destructive' : qty <= 10 ? 'text-amber-600' : '',
          )}
        >
          {display}
        </span>
      );
    }
    if (key === 'reservedQty') {
      const r = Number(reservedQty[product.id] ?? product.reservedStock) || 0;
      return <span className={r > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}>{r}</span>;
    }
    const val = product[key as keyof Product];
    if (key === 'price' || key === 'firstCost' || key === 'lastCost' || key === 'avgCost') {
      return (val as number || 0).toLocaleString('pt-AO', { minimumFractionDigits: 2 });
    }
    if (key === 'taxRate') return `${val}%`;
    return String(val ?? '');
  };

  const uniqueValues = useMemo(() => {
    const values: Record<string, string[]> = {};
    const sample = products.length > 600 ? products.slice(0, 600) : products;
    visibleColumns.forEach(col => {
      if (col.computed) return;
      const set = new Set<string>();
      for (const p of sample) {
        const v = String(p[col.key as keyof Product] ?? '');
        if (v) set.add(v);
        if (set.size >= 24) break;
      }
      values[col.key] = Array.from(set).sort().slice(0, 20);
    });
    return values;
  }, [products, visibleColumns]);

  const virtualWindow = useMemo(() => {
    const total = filteredProducts.length;
    if (total === 0) {
      return { start: 0, end: 0, topPad: 0, bottomPad: 0, rows: [] as Product[] };
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(total, start + count);
    return {
      start,
      end,
      topPad: start * ROW_HEIGHT,
      bottomPad: Math.max(0, (total - end) * ROW_HEIGHT),
      rows: filteredProducts.slice(start, end),
    };
  }, [filteredProducts, scrollTop, viewportHeight]);

  const currentDialogCol = customDialogCol ? COLUMNS.find(c => c.key === customDialogCol) : null;

  return (
    <div className="flex flex-col h-full border-[1.5px] border-[hsl(var(--table-grid-border))] rounded-lg bg-card overflow-hidden">
      {/* Info Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b text-xs">
        <span className="text-muted-foreground">
          {filteredProducts.length} de {products.length} produtos
        </span>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" className="h-6 text-xs text-foreground" onClick={clearAllFilters}>
            <X className="w-3 h-3 mr-1" />
            Limpar Filtros
          </Button>
        )}
      </div>

      {/* Scrollable grid — virtualized rows (only visible slice in DOM) */}
      <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={onGridScroll}>
        <table className="w-full border-collapse" style={{ minWidth: visibleColumns.reduce((s, c) => s + c.minWidth, 0) }}>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {visibleColumns.map(col => {
                const hasFilter = (simpleFilters[col.key] && simpleFilters[col.key].type !== 'all') || customFilters[col.key];
                const isSorted = sortColumn === col.key;
                return (
                  <th key={col.key} style={{ minWidth: col.minWidth }} className="p-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "w-full px-2 py-1 text-xs font-bold text-foreground/80 text-left leading-tight flex items-center justify-between hover:bg-accent",
                            hasFilter && "bg-muted text-foreground font-semibold"
                          )}
                        >
                          <span className="truncate">{col.label}</span>
                          <div className="flex items-center gap-0.5">
                            {hasFilter && <Filter className="w-3 h-3" />}
                            {isSorted ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3 opacity-30" />}
                          </div>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48 bg-popover border border-border shadow-lg z-50">
                        <DropdownMenuItem onClick={() => handleSort(col.key)}>
                          {isSorted && sortDirection === 'asc' ? '↓ Ordenar Desc' : '↑ Ordenar Asc'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => {
                          setSimpleFilters(prev => ({ ...prev, [col.key]: { type: 'all' } }));
                          setCustomFilters(prev => { const n = { ...prev }; delete n[col.key]; return n; });
                        }}>
                          (Todos)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCustomDialogCol(col.key)}>
                          (Personalizado...)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSimpleFilters(prev => ({ ...prev, [col.key]: { type: 'blanks' } }))}>
                          (Em branco)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSimpleFilters(prev => ({ ...prev, [col.key]: { type: 'nonblanks' } }))}>
                          (Não em branco)
                        </DropdownMenuItem>
                        {uniqueValues[col.key]?.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <div className="max-h-48 overflow-y-auto">
                              {uniqueValues[col.key].map(val => (
                                <DropdownMenuItem key={val} onClick={() => setSimpleFilters(prev => ({ ...prev, [col.key]: { type: 'value', value: val } }))}>
                                  {val}
                                </DropdownMenuItem>
                              ))}
                            </div>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtualWindow.topPad > 0 && (
              <tr aria-hidden>
                <td colSpan={visibleColumns.length} style={{ height: virtualWindow.topPad, padding: 0, border: 'none' }} />
              </tr>
            )}
            {virtualWindow.rows.map((product, sliceIdx) => {
              const idx = virtualWindow.start + sliceIdx;
              return (
              <tr
                key={`${product.id}:${product.sku || ''}`}
                data-nexor-context="inventory-row"
                data-nexor-id={product.id}
                onClick={() => onSelectProduct(product)}
                onDoubleClick={() => onDoubleClickProduct?.(product)}
                onContextMenu={() => onSelectProduct(product)}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 transition-colors",
                  selectedProductId === product.id && "nexor-row-selected",
                  idx % 2 === 1 && selectedProductId !== product.id && "bg-muted/30"
                )}
                style={{ height: ROW_HEIGHT }}
              >
                {visibleColumns.map(col => (
                  <td
                    key={col.key}
                    style={{ minWidth: col.minWidth }}
                    className={cn(
                      "px-2 py-0.5 text-xs font-semibold leading-tight truncate",
                      col.type === 'number' && "text-right font-mono"
                    )}
                  >
                    {formatValue(product, col.key)}
                  </td>
                ))}
              </tr>
              );
            })}
            {virtualWindow.bottomPad > 0 && (
              <tr aria-hidden>
                <td colSpan={visibleColumns.length} style={{ height: virtualWindow.bottomPad, padding: 0, border: 'none' }} />
              </tr>
            )}
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum produto encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Custom Filter Dialog */}
      {currentDialogCol && customDialogCol && (
        <CustomFilterDialog
          key={customDialogCol}
          open={!!customDialogCol}
          onOpenChange={(open) => { if (!open) setCustomDialogCol(null); }}
          columnLabel={currentDialogCol.label}
          columnType={currentDialogCol.type}
          onApply={(filter) => {
            setCustomFilters(prev => ({ ...prev, [customDialogCol]: filter }));
            setSimpleFilters(prev => { const n = { ...prev }; delete n[customDialogCol]; return n; });
          }}
          initialFilter={customFilters[customDialogCol]}
        />
      )}
    </div>
  );
}
