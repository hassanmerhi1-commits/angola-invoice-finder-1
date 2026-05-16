import { useEffect, useState } from 'react';
import { CartItem, Sale } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Banknote, CreditCard, ArrowRightLeft, Check } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CartItem[];
  total: number;
  taxAmount: number;
  onCompleteSale: (
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
  ) => void;
}

export function CheckoutDialog({
  open,
  onOpenChange,
  items,
  total,
  taxAmount,
  onCompleteSale,
}: CheckoutDialogProps) {
  const { t, language } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [amountPaid, setAmountPaid] = useState<string>(total.toString());
  const [customerNif, setCustomerNif] = useState('');
  const [customerName, setCustomerName] = useState('');
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  useEffect(() => {
    if (open) {
      setPaymentMethod('cash');
      setAmountPaid(total.toString());
      setCustomerNif('');
      setCustomerName('');
    }
  }, [open, total]);

  const handlePaymentMethodChange = (value: Sale['paymentMethod']) => {
    setPaymentMethod(value);
    if (value === 'card' || value === 'transfer') {
      setAmountPaid(total.toString());
    }
  };

  const paidAmount =
    paymentMethod === 'cash' ? parseFloat(amountPaid || '0') : total;
  const change = paidAmount - total;
  const isValid =
    paymentMethod === 'cash' ? paidAmount >= total : total > 0;

  const handleComplete = () => {
    onCompleteSale(
      paymentMethod,
      paidAmount,
      customerNif || undefined,
      customerName || undefined,
    );
  };

  const quickAmounts = [
    Math.ceil(total / 100) * 100,
    Math.ceil(total / 500) * 500,
    Math.ceil(total / 1000) * 1000,
    Math.ceil(total / 5000) * 5000,
  ].filter((v, i, a) => a.indexOf(v) === i && v >= total).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.checkoutUi.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>{t.checkoutUi.itemsCount.replace('{count}', String(items.length))}</span>
              <span>{t.checkoutUi.unitsCount.replace('{count}', String(items.reduce((sum, i) => sum + i.quantity, 0)))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t.pos.tax}</span>
              <span>{taxAmount.toLocaleString(locale)} Kz</span>
            </div>
            <Separator />
            <div className="flex justify-between text-xl font-bold">
              <span>{t.common.total}</span>
              <span className="text-primary">{total.toLocaleString(locale)} Kz</span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-3">
            <Label>{t.checkoutUi.paymentForm}</Label>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(v) => handlePaymentMethodChange(v as Sale['paymentMethod'])}
              className="grid grid-cols-3 gap-2"
            >
              <div>
                <RadioGroupItem value="cash" id="cash" className="peer sr-only" />
                <Label
                  htmlFor="cash"
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                >
                  <Banknote className="mb-2 h-6 w-6" />
                  <span className="text-sm">{t.pos.cash}</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="card" id="card" className="peer sr-only" />
                <Label
                  htmlFor="card"
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                >
                  <CreditCard className="mb-2 h-6 w-6" />
                  <span className="text-sm">{t.pos.card}</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="transfer" id="transfer" className="peer sr-only" />
                <Label
                  htmlFor="transfer"
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer"
                >
                  <ArrowRightLeft className="mb-2 h-6 w-6" />
                  <span className="text-sm">{t.pos.transfer}</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Amount Paid (for cash) */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <Label>{t.checkoutUi.amountReceived}</Label>
              <Input
                type="number"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="text-xl h-14 text-center font-bold"
                placeholder="0"
              />
              <div className="flex gap-2">
                {quickAmounts.map(amount => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setAmountPaid(amount.toString())}
                  >
                    {amount.toLocaleString(locale)}
                  </Button>
                ))}
              </div>
              {change > 0 && (
                <div className="bg-green-500/10 text-green-600 rounded-lg p-3 text-center">
                  <span className="text-sm">{t.checkoutUi.change}: </span>
                  <span className="text-xl font-bold">{change.toLocaleString(locale)} Kz</span>
                </div>
              )}
            </div>
          )}

          {/* Customer Info (optional) */}
          <div className="space-y-3">
            <Label className="text-muted-foreground">{t.checkoutUi.customerInfoOptional}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder={t.checkoutUi.nif}
                value={customerNif}
                onChange={(e) => setCustomerNif(e.target.value)}
              />
              <Input
                placeholder={t.checkoutUi.name}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
          </div>

          {/* Complete Button */}
          <Button
            className="w-full h-14 text-lg"
            size="lg"
            onClick={handleComplete}
            disabled={!isValid}
          >
            <Check className="w-5 h-5 mr-2" />
            {t.checkoutUi.confirmPayment}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
