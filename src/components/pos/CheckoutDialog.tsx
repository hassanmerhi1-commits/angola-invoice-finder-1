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
import { Banknote, CreditCard, ArrowRightLeft, Check, Percent, ShieldCheck, Lock, FileText, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { resolveSaleInvoiceType, normalizeCustomerNif, fiscalInvoiceTypeLabel, fsMaxAmount } from '@/lib/fiscalInvoiceType';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CartItem[];
  total: number;
  taxAmount: number;
  defaultCustomerNif?: string;
  defaultCustomerName?: string;
  /** Registered ERP client — required for on-account (credit) sales */
  registeredClientId?: string;
  onCompleteSale: (
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number,
    customerNif?: string,
    customerName?: string,
    discountPct?: number,
    clientId?: string,
  ) => void | Promise<void>;
}

export function CheckoutDialog({
  open,
  onOpenChange,
  items,
  total,
  taxAmount,
  defaultCustomerNif,
  defaultCustomerName,
  registeredClientId,
  onCompleteSale,
}: CheckoutDialogProps) {
  const { t, language } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [customerNif, setCustomerNif] = useState('');
  const [customerName, setCustomerName] = useState('');
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  // Discount (whole-sale %) gated behind an admin/manager password authorization.
  const [discountInput, setDiscountInput] = useState('');
  const [discountApproved, setDiscountApproved] = useState(false);
  const [approverName, setApproverName] = useState('');
  const [supervisorPassword, setSupervisorPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rawPct = parseFloat(discountInput || '0');
  const discountPct = Number.isFinite(rawPct) ? Math.min(Math.max(rawPct, 0), 100) : 0;
  const appliedPct = discountApproved ? discountPct : 0;
  const discountAmount = total * (appliedPct / 100);
  const effectiveTotal = total - discountAmount;
  const effectiveTax = taxAmount * (1 - appliedPct / 100);

  const [amountPaid, setAmountPaid] = useState<string>(total.toString());

  useEffect(() => {
    if (open) {
      setPaymentMethod('cash');
      setAmountPaid(total.toString());
      setCustomerNif(defaultCustomerNif || '');
      setCustomerName(defaultCustomerName || '');
      setDiscountInput('');
      setDiscountApproved(false);
      setApproverName('');
      setSupervisorPassword('');
      setVerifying(false);
      setSubmitting(false);
    }
  }, [open, total, defaultCustomerNif, defaultCustomerName]);

  // Keep the cash amount in sync with the discounted total until the cashier edits it.
  useEffect(() => {
    setAmountPaid(effectiveTotal.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedPct]);

  const handlePaymentMethodChange = (value: Sale['paymentMethod']) => {
    setPaymentMethod(value);
    if (value === 'card' || value === 'transfer') {
      setAmountPaid(effectiveTotal.toString());
    } else if (value === 'credit') {
      setAmountPaid('0');
    }
  };

  const handleDiscountChange = (value: string) => {
    setDiscountInput(value);
    // Any change to the percentage invalidates a prior authorization.
    if (discountApproved) {
      setDiscountApproved(false);
      setApproverName('');
    }
  };

  const handleAuthorizeDiscount = async () => {
    if (discountPct <= 0) return;
    if (!supervisorPassword) {
      toast.error(t.checkoutUi.discountPasswordRequired);
      return;
    }
    setVerifying(true);
    try {
      const result = await api.auth.verifyElevated(supervisorPassword, {
        reason: t.checkoutUi.discountAuthReason.replace('{pct}', String(discountPct)),
      });
      if (result.data?.ok) {
        setDiscountApproved(true);
        setApproverName(result.data.approver?.name || '');
        setSupervisorPassword('');
        toast.success(t.checkoutUi.discountApproved);
      } else {
        toast.error(result.error || t.checkoutUi.discountAuthFailed);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.checkoutUi.discountAuthFailed);
    } finally {
      setVerifying(false);
    }
  };

  const paidAmount =
    paymentMethod === 'cash'
      ? parseFloat(amountPaid || '0')
      : paymentMethod === 'credit'
        ? 0
        : effectiveTotal;
  const change = paymentMethod === 'cash' ? paidAmount - effectiveTotal : 0;
  const needsAuthorization = discountPct > 0 && !discountApproved;
  const creditBlocked = paymentMethod === 'credit' && !registeredClientId;
  const isValid =
    !needsAuthorization &&
    !creditBlocked &&
    (paymentMethod === 'cash'
      ? paidAmount >= effectiveTotal
      : paymentMethod === 'credit'
        ? effectiveTotal > 0 && !!registeredClientId
        : effectiveTotal > 0);

  const normalizedCustomerNif = normalizeCustomerNif(customerNif);
  const previewInvoiceType = resolveSaleInvoiceType({
    customerNif: normalizedCustomerNif || undefined,
    paymentMethod,
    total: effectiveTotal,
  });

  const handleComplete = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCompleteSale(
        paymentMethod,
        paidAmount,
        normalizedCustomerNif || undefined,
        customerName || undefined,
        appliedPct,
        paymentMethod === 'credit' ? registeredClientId : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const quickAmounts = [
    Math.ceil(effectiveTotal / 100) * 100,
    Math.ceil(effectiveTotal / 500) * 500,
    Math.ceil(effectiveTotal / 1000) * 1000,
    Math.ceil(effectiveTotal / 5000) * 5000,
  ].filter((v, i, a) => a.indexOf(v) === i && v >= effectiveTotal).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,900px)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t.checkoutUi.title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4">
          {/* Order Summary */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>{t.checkoutUi.itemsCount.replace('{count}', String(items.length))}</span>
              <span>{t.checkoutUi.unitsCount.replace('{count}', String(items.reduce((sum, i) => sum + i.quantity, 0)))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{t.pos.tax}</span>
              <span>{effectiveTax.toLocaleString(locale)} Kz</span>
            </div>
            {appliedPct > 0 && (
              <div className="flex justify-between text-sm text-green-600 font-medium">
                <span>{t.checkoutUi.discountLine.replace('{pct}', String(appliedPct))}</span>
                <span>-{discountAmount.toLocaleString(locale)} Kz</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-xl font-bold">
              <span>{t.common.total}</span>
              <span className="text-primary">{effectiveTotal.toLocaleString(locale)} Kz</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground">{t.checkoutUi.documentType}</span>
              <Badge variant="outline">
                {fiscalInvoiceTypeLabel(previewInvoiceType, t.posUi)}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {t.checkoutUi.documentTypeHint.replace('{max}', fsMaxAmount().toLocaleString(locale))}
            </p>
          </div>

          {/* Payment Method */}
          <div className="space-y-3">
            <Label>{t.checkoutUi.paymentForm}</Label>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(v) => handlePaymentMethodChange(v as Sale['paymentMethod'])}
              className="grid grid-cols-2 gap-2"
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
              <div>
                <RadioGroupItem
                  value="credit"
                  id="credit"
                  className="peer sr-only"
                  disabled={!registeredClientId}
                />
                <Label
                  htmlFor="credit"
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary',
                    registeredClientId ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  )}
                >
                  <FileText className="mb-2 h-6 w-6" />
                  <span className="text-sm text-center">{t.pos.credit}</span>
                </Label>
              </div>
            </RadioGroup>
            {!registeredClientId && (
              <p className="text-xs text-muted-foreground">{t.checkoutUi.creditRequiresClient}</p>
            )}
            {paymentMethod === 'credit' && registeredClientId && (
              <p className="text-xs text-muted-foreground">{t.checkoutUi.creditHint}</p>
            )}
          </div>

          {/* Discount (admin authorized) */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Percent className="w-4 h-4" />
              {t.checkoutUi.discountLabel}
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={discountInput}
                onChange={(e) => handleDiscountChange(e.target.value)}
                className="h-10 w-28 text-center"
                placeholder="0"
              />
              <span className="text-sm text-muted-foreground">%</span>
              {discountApproved && appliedPct > 0 && (
                <Badge variant="secondary" className="ml-auto gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                  {approverName
                    ? t.checkoutUi.discountApprovedBy.replace('{name}', approverName)
                    : t.checkoutUi.discountApproved}
                </Badge>
              )}
            </div>
            {needsAuthorization && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  {t.checkoutUi.discountAuthHint}
                </p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={supervisorPassword}
                    onChange={(e) => setSupervisorPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAuthorizeDiscount();
                      }
                    }}
                    className="h-10 flex-1"
                    placeholder={t.checkoutUi.discountPasswordPlaceholder}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 shrink-0"
                    disabled={verifying || discountPct <= 0}
                    onClick={() => void handleAuthorizeDiscount()}
                  >
                    {verifying ? t.checkoutUi.discountVerifying : t.checkoutUi.discountAuthorize}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Amount Paid (for cash) */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <Label>{t.checkoutUi.amountReceived}</Label>
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
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
        </div>

        <div className="shrink-0 border-t bg-background px-6 py-4">
          <Button
            className="h-14 w-full text-lg"
            size="lg"
            onClick={() => void handleComplete()}
            disabled={!isValid || submitting}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Check className="mr-2 h-5 w-5" />
            )}
            {submitting ? t.checkoutUi.processingPayment : t.checkoutUi.confirmPayment}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
