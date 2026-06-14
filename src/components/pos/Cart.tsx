import { CartItem } from '@/types/erp';

import { useEffect } from 'react';

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

          <div className="shrink-0 flex flex-col justify-end border-l pl-3 min-w-[11rem] max-w-[40vw]">

            <div className="space-y-1 text-sm opacity-60">

              <div className="flex justify-between gap-4">

                <span className="text-muted-foreground">{t.common.subtotal}</span>

                <span>0</span>

              </div>

              <div className="flex justify-between gap-4 text-lg font-bold">

                <span>{t.common.total}</span>

                <span className="text-primary">0 Kz</span>

              </div>

            </div>

            <Button className="w-full h-11 mt-2" size="lg" onClick={onCheckout} disabled>

              {t.pos.checkout}

            </Button>

          </div>

        </div>

      );

    }



    return (

      <div className={`flex items-center justify-center text-muted-foreground ${

        layout === 'dock' ? 'h-full min-h-[5rem] gap-3 px-4' : 'flex-col flex-1 py-12'

      }`}>

        <ShoppingCart className={layout === 'dock' ? 'w-8 h-8 opacity-30' : 'w-16 h-16 mb-4 opacity-30'} />

        <div className={layout === 'dock' ? 'text-sm' : 'text-center'}>

          <p className={layout === 'dock' ? 'font-medium' : 'text-lg'}>{t.pos.emptyCart}</p>

          {layout !== 'dock' && (

            <p className="text-sm text-center px-4">{t.pos.addProducts}</p>

          )}

          {branchName && layout !== 'dock' && (

            <p className="text-xs mt-3 text-muted-foreground/80">{branchName}</p>

          )}

        </div>

      </div>

    );

  }



  if (layout === 'dock') {

    return (

      <div className="flex h-full min-h-0 items-stretch gap-3">

        <ScrollArea className="flex-1 min-w-0">

          <div className="flex gap-2 pb-1 pr-2">

            {items.map((item) => {
              const selected = item.product.id === selectedCartProductId;
              return (
              <div
                key={item.product.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCartLine?.(item.product.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCartLine?.(item.product.id);
                  }
                }}
                className={cn(
                  'shrink-0 w-[min(14rem,42vw)] rounded-lg p-2.5 space-y-2 border cursor-pointer transition-all',
                  selected
                    ? 'bg-primary/10 border-primary ring-2 ring-primary'
                    : 'bg-muted/50 hover:border-primary/40',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-xs leading-tight line-clamp-2">{item.product.name}</h4>
                    <p className="text-[10px] text-muted-foreground truncate">{item.product.sku}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(item.product.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateQuantity(item.product.id, item.quantity - 1);
                      }}
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
                        selected ? 'w-16 h-9 text-xl font-bold' : 'w-12 h-7 text-xs',
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => onSelectCartLine?.(item.product.id)}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateQuantity(item.product.id, item.quantity + 1);
                      }}
                      disabled={item.quantity >= item.product.stock}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                  <span className="text-xs font-semibold whitespace-nowrap">
                    {item.subtotal.toLocaleString('pt-AO')} Kz
                  </span>
                </div>
              </div>
            );
            })}

          </div>

        </ScrollArea>



        <div className="shrink-0 flex flex-col justify-between border-l pl-3 min-w-[11rem] max-w-[40vw]">

          <div className="space-y-1 text-sm">

            <div className="flex justify-between gap-4">

              <span className="text-muted-foreground">{t.common.subtotal}</span>

              <span>{subtotal.toLocaleString('pt-AO')}</span>

            </div>

            <div className="flex justify-between gap-4">

              <span className="text-muted-foreground">{taxLabel}</span>

              <span>{taxAmount.toLocaleString('pt-AO')}</span>

            </div>

            <Separator />

            <div className="flex justify-between gap-4 text-lg font-bold">

              <span>{t.common.total}</span>

              <span className="text-primary">{total.toLocaleString('pt-AO')} Kz</span>

            </div>

          </div>

          <Button className="w-full h-11 mt-2" size="lg" onClick={onCheckout}>

            {t.pos.checkout}

          </Button>

        </div>

      </div>

    );

  }



  return (

    <div className="flex flex-col h-full min-h-0">

      {branchName && (

        <p className="text-xs text-muted-foreground mb-2 shrink-0">{branchName}</p>

      )}

      <ScrollArea className="flex-1 min-h-0 pr-2">

        <div className="space-y-3">

          {items.map(item => (

            <div

              key={item.product.id}

              className="bg-muted/50 rounded-lg p-3 space-y-2"

            >

              <div className="flex items-start justify-between gap-2">

                <div className="flex-1 min-w-0">

                  <h4 className="font-medium text-sm truncate">{item.product.name}</h4>

                  <p className="text-xs text-muted-foreground">

                    {item.product.price.toLocaleString('pt-AO')} Kz × {item.quantity}

                  </p>

                </div>

                <Button

                  variant="ghost"

                  size="icon"

                  className="h-8 w-8 text-destructive hover:text-destructive"

                  onClick={() => onRemoveItem(item.product.id)}

                >

                  <Trash2 className="w-4 h-4" />

                </Button>

              </div>

              

              <div className="flex items-center justify-between">

                <div className="flex items-center gap-2">

                  <Button

                    variant="outline"

                    size="icon"

                    className="h-8 w-8"

                    onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}

                  >

                    <Minus className="w-4 h-4" />

                  </Button>

                  <NumericInput

                    integer

                    min={0}

                    max={item.product.stock}

                    value={item.quantity}

                    onValueChange={(qty) => onUpdateQuantity(item.product.id, qty)}

                    className="w-16 h-8 text-center"

                  />

                  <Button

                    variant="outline"

                    size="icon"

                    className="h-8 w-8"

                    onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}

                    disabled={item.quantity >= item.product.stock}

                  >

                    <Plus className="w-4 h-4" />

                  </Button>

                </div>

                <span className="font-semibold">

                  {item.subtotal.toLocaleString('pt-AO')} Kz

                </span>

              </div>

            </div>

          ))}

        </div>

      </ScrollArea>



      <div className="mt-3 pt-3 border-t space-y-2 shrink-0">

        <div className="flex justify-between text-sm">

          <span className="text-muted-foreground">{t.common.subtotal}</span>

          <span>{subtotal.toLocaleString('pt-AO')} Kz</span>

        </div>

        <div className="flex justify-between text-sm">

          <span className="text-muted-foreground">{taxLabel}</span>

          <span>{taxAmount.toLocaleString('pt-AO')} Kz</span>

        </div>

        <Separator />

        <div className="flex justify-between text-xl font-bold">

          <span>{t.common.total}</span>

          <span className="text-primary">{total.toLocaleString('pt-AO')} Kz</span>

        </div>



        <Button

          className="w-full h-12 text-base"

          size="lg"

          onClick={onCheckout}

        >

          {t.pos.checkout}

        </Button>

      </div>

    </div>

  );

}


