import { useEffect } from 'react';
import { CartItem } from '@/types/erp';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { formatTaxLabel } from '@/lib/taxUtils';
import { useTranslation } from '@/i18n';
import { Minus, Plus, Trash2, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CartProps {
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  branchName?: string;
  layout?: 'panel' | 'dock';
  selectedCartProductId?: string | null;
  focusCartQtyProductId?: string | null;
  onFocusCartQtyHandled?: () => void;
  onSelectCartLine?: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
  checkoutDisabled?: boolean;
}

function getLineAmounts(item: CartItem) {
  const unitExVat = item.product.price;
  const taxRate = item.product.taxRate || 0;
  const unitIncVat = unitExVat * (1 + taxRate / 100);
  const lineExVat = item.subtotal;
  const lineTax = lineExVat * (taxRate / 100);
  const lineIncVat = lineExVat + lineTax;
  return { unitExVat, taxRate, unitIncVat, lineExVat, lineTax, lineIncVat };
}

function CartTotals({
  subtotal,
  taxAmount,
  total,
  taxLabel,
  onCheckout,
  checkoutLabel,
  checkoutDisabled = false,
  compact = false,
}: {
  subtotal: number;
  taxAmount: number;
  total: number;
  taxLabel: string;
  onCheckout: () => void;
  checkoutLabel: string;
  checkoutDisabled?: boolean;
  compact?: boolean;
}) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const fmt = (value: number) => value.toLocaleString(uiLocale);

  return (
    <div className={cn('flex flex-col justify-between', compact ? 'shrink-0 border-l pl-3 min-w-[11rem] max-w-[40vw]' : 'mt-3 pt-3 border-t shrink-0')}>
      <div className={cn('space-y-1', compact ? 'text-sm' : '')}>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{t.common.subtotal}</span>
          <span>{fmt(subtotal)} Kz</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">{taxLabel}</span>
          <span>{fmt(taxAmount)} Kz</span>
        </div>
        <Separator />
        <div className={cn('flex justify-between gap-4 font-bold', compact ? 'text-lg' : 'text-xl')}>
          <span>{t.common.total}</span>
          <span className="text-primary">{fmt(total)} Kz</span>
        </div>
      </div>
      <Button
        className={cn('w-full mt-2', compact ? 'h-11' : 'h-12 text-base')}
        size="lg"
        onClick={onCheckout}
        disabled={total <= 0 || checkoutDisabled}
      >
        {checkoutLabel}
      </Button>
    </div>
  );
}

function CartLineList({
  items,
  selectedCartProductId,
  onSelectCartLine,
  onUpdateQuantity,
  onRemoveItem,
  compact = false,
}: {
  items: CartItem[];
  selectedCartProductId?: string | null;
  onSelectCartLine?: (productId: string) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  compact?: boolean;
}) {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const fmt = (value: number) => value.toLocaleString(uiLocale);

  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 z-10 bg-card border-b">
        <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="px-2 py-1.5 text-left font-semibold min-w-[8rem]">{t.inventoryGridUi.name}</th>
          <th className="px-2 py-1.5 text-center font-semibold w-28">{t.common.quantity}</th>
          <th className="px-2 py-1.5 text-right font-semibold w-24">{t.inventoryGridUi.priceNoTax}</th>
          <th className="px-2 py-1.5 text-center font-semibold w-14">{t.inventoryGridUi.taxRate}</th>
          <th className="px-2 py-1.5 text-right font-semibold w-24">{t.inventoryGridUi.priceWithTax}</th>
          <th className="px-2 py-1.5 text-right font-semibold w-24">{t.common.total}</th>
          <th className="px-1 py-1.5 w-8" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {items.map((item) => {
          const selected = item.product.id === selectedCartProductId;
          const { unitExVat, taxRate, unitIncVat, lineIncVat } = getLineAmounts(item);

          return (
            <tr
              key={item.product.id}
              className={cn(
                'cursor-pointer transition-colors hover:bg-muted/40',
                selected && 'bg-primary/10',
              )}
              onClick={() => onSelectCartLine?.(item.product.id)}
            >
              <td className="px-2 py-2 align-middle">
                <div className="font-medium leading-tight line-clamp-2">{item.product.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{item.product.sku}</div>
              </td>
              <td className="px-2 py-2 align-middle">
                <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn(compact ? 'h-7 w-7' : 'h-8 w-8')}
                    onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                  >
                    <Minus className="w-3 h-3" />
                  </Button>
                  <NumericInput
                    integer
                    min={0}
                    max={item.product.stock}
                    value={item.quantity}
                    onValueChange={(qty) => onUpdateQuantity(item.product.id, qty)}
                    data-cart-qty={item.product.id}
                    className={cn(
                      'text-center tabular-nums',
                      selected
                        ? compact
                          ? 'w-14 h-9 text-lg font-bold'
                          : 'w-16 h-9 text-lg font-bold'
                        : compact
                          ? 'w-12 h-7 text-xs'
                          : 'w-14 h-8 text-sm',
                    )}
                    onFocus={() => onSelectCartLine?.(item.product.id)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn(compact ? 'h-7 w-7' : 'h-8 w-8')}
                    onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                    disabled={item.quantity >= item.product.stock}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </td>
              <td className="px-2 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap">
                {fmt(unitExVat)}
              </td>
              <td className="px-2 py-2 text-center align-middle font-mono tabular-nums">
                {taxRate}%
              </td>
              <td className="px-2 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap">
                {fmt(unitIncVat)}
              </td>
              <td className="px-2 py-2 text-right align-middle font-semibold font-mono tabular-nums whitespace-nowrap">
                {fmt(lineIncVat)}
              </td>
              <td className="px-1 py-2 align-middle">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(item.product.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Cart({
  items,
  subtotal,
  taxAmount,
  total,
  branchName,
  layout = 'panel',
  selectedCartProductId,
  focusCartQtyProductId,
  onFocusCartQtyHandled,
  onSelectCartLine,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
  checkoutDisabled = false,
}: CartProps) {
  const { t } = useTranslation();
  const taxLabel = formatTaxLabel(items.map((item) => item.product.taxRate), t.pos.tax);

  useEffect(() => {
    if (!focusCartQtyProductId) return;
    const el = document.querySelector<HTMLInputElement>(`[data-cart-qty="${focusCartQtyProductId}"]`);
    if (!el) return;
    el.focus();
    el.select();
    onFocusCartQtyHandled?.();
  }, [focusCartQtyProductId, items, onFocusCartQtyHandled]);

  if (items.length === 0) {
    if (layout === 'dock') {
      return (
        <div className="flex h-full min-h-0 items-stretch gap-3">
          <div className="flex flex-1 items-center justify-center text-muted-foreground gap-3 px-4 min-w-0">
            <ShoppingCart className="w-8 h-8 opacity-30 shrink-0" />
            <p className="text-sm font-medium">{t.pos.emptyCart}</p>
          </div>
          <CartTotals
            subtotal={0}
            taxAmount={0}
            total={0}
            taxLabel={taxLabel}
            onCheckout={onCheckout}
            checkoutLabel={t.pos.checkout}
            checkoutDisabled={checkoutDisabled}
            compact
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground flex-1 py-12">
        <ShoppingCart className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">{t.pos.emptyCart}</p>
        <p className="text-sm text-center px-4">{t.pos.addProducts}</p>
        {branchName && <p className="text-xs mt-3 text-muted-foreground/80">{branchName}</p>}
      </div>
    );
  }

  if (layout === 'dock') {
    return (
      <div className="flex h-full min-h-0 items-stretch gap-3">
        <ScrollArea className="flex-1 min-w-0 min-h-0">
          <CartLineList
            items={items}
            selectedCartProductId={selectedCartProductId}
            onSelectCartLine={onSelectCartLine}
            onUpdateQuantity={onUpdateQuantity}
            onRemoveItem={onRemoveItem}
            compact
          />
        </ScrollArea>
        <CartTotals
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          taxLabel={taxLabel}
          onCheckout={onCheckout}
          checkoutLabel={t.pos.checkout}
          compact
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {branchName && <p className="text-xs text-muted-foreground mb-2 shrink-0">{branchName}</p>}
      <ScrollArea className="flex-1 min-h-0 pr-2">
        <CartLineList
          items={items}
          selectedCartProductId={selectedCartProductId}
          onSelectCartLine={onSelectCartLine}
          onUpdateQuantity={onUpdateQuantity}
          onRemoveItem={onRemoveItem}
        />
      </ScrollArea>
      <CartTotals
        subtotal={subtotal}
        taxAmount={taxAmount}
        total={total}
        taxLabel={taxLabel}
        onCheckout={onCheckout}
        checkoutLabel={t.pos.checkout}
        checkoutDisabled={checkoutDisabled}
      />
    </div>
  );
}
