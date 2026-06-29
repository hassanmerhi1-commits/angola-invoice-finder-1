import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Wallet, DoorOpen } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface PosOpenCaixaDialogProps {
  open: boolean;
  branchName?: string;
  cashierName?: string;
  submitting?: boolean;
  onConfirm: (openingCash: number) => void | Promise<void>;
}

/**
 * Mandatory shift-open gate for the POS: the cashier must count and enter the cash
 * already in the drawer before any sale. The dialog cannot be dismissed.
 */
export function PosOpenCaixaDialog({
  open,
  branchName,
  cashierName,
  submitting,
  onConfirm,
}: PosOpenCaixaDialogProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (open) setAmount('');
  }, [open]);

  const handleConfirm = () => {
    const value = parseFloat(amount);
    void onConfirm(Number.isFinite(value) && value >= 0 ? value : 0);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md [&_[data-dialog-close]]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="w-5 h-5 text-primary" />
            {t.posUi.caixa.openTitle}
          </DialogTitle>
          <DialogDescription>{t.posUi.caixa.openDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {branchName && <Badge variant="outline">{branchName}</Badge>}
          {cashierName && (
            <Badge variant="outline">
              {t.posUi.endOfDayCashier}: {cashierName}
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pos-opening-cash">{t.posUi.caixa.openingCashLabel}</Label>
          <div className="relative">
            <Wallet className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="pos-opening-cash"
              type="number"
              min={0}
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitting) handleConfirm();
              }}
              placeholder="0"
              className="pl-9"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t.posUi.caixa.openingCashHint}</p>
        </div>

        <div>
          <Button className="w-full" onClick={handleConfirm} disabled={submitting}>
            <DoorOpen className="w-4 h-4 mr-2" />
            {t.posUi.caixa.openButton}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
