import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { NumericInput } from '@/components/ui/numeric-input';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BulkPriceCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  isHeadOffice?: boolean;
  onApplied?: (updated: number) => void;
}

type EditRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  origPrice: number;
  origCost: number;
  price: number;
  cost: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sameMoney = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.005;
const unitCost = (p: Product) => round2(p.avgCost || p.lastCost || p.cost || 0);

const ROW_HEIGHT = 64;
const OVERSCAN = 8;
const GRID_COLS = 'grid-cols-[8rem_minmax(12rem,1.4fr)_13rem_13rem_6.5rem]';

export function BulkPriceCostDialog({
  open,
  onOpenChange,
  products,
  isHeadOffice = false,
  onApplied,
}: BulkPriceCostDialogProps) {
  const { t, language } = useTranslation();
  const ui = t.inventoryPageUi.massPrice;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [rows, setRows] = useState<EditRow[]>([]);
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(560);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setChangedOnly(false);
    setSaving(false);
    setScrollTop(0);
    setRows(
      products.map((p) => {
        const price = round2(p.price);
        const cost = unitCost(p);
        return {
          id: p.id,
          sku: p.sku || '',
          name: p.name || '',
          category: p.category || '',
          origPrice: price,
          origCost: cost,
          price,
          cost,
        };
      }),
    );
    // Snapshot catalog when the dialog opens — do not reset mid-edit if the grid refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight || 560));
    ro.observe(el);
    setViewportHeight(el.clientHeight || 560);
    return () => ro.disconnect();
  }, [open]);

  const isDirty = useCallback(
    (row: EditRow) => !sameMoney(row.price, row.origPrice) || !sameMoney(row.cost, row.origCost),
    [],
  );

  const dirtyRows = useMemo(() => rows.filter(isDirty), [rows, isDirty]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (changedOnly && !isDirty(row)) return false;
      if (!q) return true;
      return (
        row.sku.toLowerCase().includes(q)
        || row.name.toLowerCase().includes(q)
        || row.category.toLowerCase().includes(q)
      );
    });
  }, [rows, search, changedOnly, isDirty]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(filtered.length, start + visibleCount);
  const visible = filtered.slice(start, end);

  const patchRow = (id: string, field: 'price' | 'cost', value: number) => {
    const nextVal = round2(Math.max(0, value));
    setRows((prev) => {
      const idx = prev.findIndex((row) => row.id === id);
      if (idx < 0) return prev;
      const current = prev[idx];
      if (current[field] === nextVal) return prev;
      const next = prev.slice();
      next[idx] = { ...current, [field]: nextVal };
      return next;
    });
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
    if (dirtyRows.length > 0 && !confirm(ui.discard)) return;
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (saving) return;
    if (dirtyRows.length === 0) {
      toast.info(ui.noChanges);
      return;
    }
    if (!confirm(ui.confirm.replace('{count}', String(dirtyRows.length)))) return;
    setSaving(true);
    try {
      const items = dirtyRows.map((row) => {
        const payload: { id: string; sku: string; price?: number; cost?: number } = {
          id: row.id,
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
      <DialogContent className="flex h-[96vh] max-h-[96vh] w-[98vw] max-w-[98vw] flex-col gap-3 overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle>{ui.title}</DialogTitle>
          <DialogDescription>{ui.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
              setScrollTop(0);
            }}
            placeholder={ui.search}
            className="h-9 max-w-md text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={changedOnly}
              onCheckedChange={(v) => {
                setChangedOnly(v === true);
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
                setScrollTop(0);
              }}
            />
            {ui.changedOnly}
          </label>
          <span className="text-sm text-muted-foreground">
            {ui.changedCount.replace('{count}', String(dirtyRows.length))}
            {' · '}
            {filtered.length}/{rows.length}
          </span>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto rounded-md border"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div className={cn('sticky top-0 z-10 grid gap-2 border-b bg-muted/90 px-3 py-2 text-xs font-medium backdrop-blur-sm', GRID_COLS)}>
            <span>{ui.sku}</span>
            <span>{ui.name}</span>
            <span className="text-right">{ui.priceOldNew}</span>
            <span className="text-right">{ui.costOldNew}</span>
            <span className="text-right">{ui.margin}</span>
          </div>
          <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
            {visible.map((row, i) => {
              const dirtyPrice = !sameMoney(row.price, row.origPrice);
              const dirtyCost = !sameMoney(row.cost, row.origCost);
              const oldMargin = row.origPrice > 0 ? ((row.origPrice - row.origCost) / row.origPrice) * 100 : 0;
              const newMargin = row.price > 0 ? ((row.price - row.cost) / row.price) * 100 : 0;
              return (
                <div
                  key={row.id}
                  className={cn(
                    'absolute left-0 right-0 grid items-stretch gap-2 border-b px-3 py-1',
                    GRID_COLS,
                    isDirty(row) ? 'bg-amber-50/70 dark:bg-amber-950/25' : 'bg-background',
                  )}
                  style={{ top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                >
                  <div className="flex min-w-0 flex-col justify-center">
                    <span className="truncate font-mono text-xs" title={row.sku}>{row.sku}</span>
                    <span className="truncate text-[11px] text-muted-foreground" title={row.category}>{row.category}</span>
                  </div>
                  <div className="flex min-w-0 items-center">
                    <span className="truncate text-sm" title={row.name}>{row.name}</span>
                  </div>
                  <div className="flex min-w-0 flex-col justify-center gap-0.5">
                    <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                      <span>{ui.old}</span>
                      <span className="tabular-nums">{fmt(row.origPrice)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="shrink-0 text-[11px] text-muted-foreground">{ui.newLabel}</span>
                      <NumericInput
                        min={0}
                        value={row.price}
                        onValueChange={(v) => patchRow(row.id, 'price', v)}
                        className={cn('h-7 flex-1 px-1.5 text-right text-sm tabular-nums', dirtyPrice && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40')}
                      />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col justify-center gap-0.5">
                    <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                      <span>{ui.old}</span>
                      <span className="tabular-nums">{fmt(row.origCost)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="shrink-0 text-[11px] text-muted-foreground">{ui.newLabel}</span>
                      <NumericInput
                        min={0}
                        value={row.cost}
                        onValueChange={(v) => patchRow(row.id, 'cost', v)}
                        className={cn('h-7 flex-1 px-1.5 text-right text-sm tabular-nums', dirtyCost && 'border-amber-500 bg-amber-50 dark:bg-amber-950/40')}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-center text-xs tabular-nums">
                    <span className="text-[11px] text-muted-foreground">{oldMargin.toFixed(1)}%</span>
                    <span className={cn('font-medium', newMargin < 0 ? 'text-red-600' : dirtyPrice || dirtyCost ? 'text-foreground' : 'text-muted-foreground')}>
                      {newMargin.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{isHeadOffice ? ui.hintHq : ui.hintFilial}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleSave} disabled={saving || dirtyRows.length === 0}>
            {saving ? ui.saving : ui.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
