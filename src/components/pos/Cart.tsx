import { CartItem } from '@/types/erp';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { formatTaxLabel } from '@/lib/taxUtils';
import { useTranslation } from '@/i18n';
import { Minus, Plus, Trash2, ShoppingCart } from 'lucide-react';

interface CartProps {
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
}

export function Cart({
  items,
  subtotal,
  taxAmount,
  total,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
}: CartProps) {
  const { t } = useTranslation();
  const taxLabel = formatTaxLabel(items.map((item) => item.product.taxRate), t.pos.tax);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
        <ShoppingCart className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-lg">Carrinho vazio</p>
        <p className="text-sm">Adicione produtos para começar</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 pr-4">
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

      <div className="mt-4 pt-4 border-t space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{subtotal.toLocaleString('pt-AO')} Kz</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{taxLabel}</span>
          <span>{taxAmount.toLocaleString('pt-AO')} Kz</span>
        </div>
        <Separator />
        <div className="flex justify-between text-xl font-bold">
          <span>Total</span>
          <span className="text-primary">{total.toLocaleString('pt-AO')} Kz</span>
        </div>
        
        <Button
          className="w-full h-14 text-lg"
          size="lg"
          onClick={onCheckout}
        >
          Finalizar Venda
        </Button>
      </div>
    </div>
  );
}
