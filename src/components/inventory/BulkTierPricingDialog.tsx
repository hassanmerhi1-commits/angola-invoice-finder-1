import { useState } from 'react';
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
import { api } from '@/lib/api/client';
import { useTranslation } from '@/i18n';
import { toast } from 'sonner';

interface BulkTierPricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful bulk apply so the page can refresh the grid. */
  onApplied?: (updated: number) => void;
}

/**
 * One-time bulk action: sets Price 2/3/4 = Price 1 x (1 + %/100) across the whole catalogue.
 * Empty fields are left untouched; the backend skips products with Price 1 = 0.
 */
export function BulkTierPricingDialog({ open, onOpenChange, onApplied }: BulkTierPricingDialogProps) {
  const { t } = useTranslation();
  const ui = t.inventoryPageUi.tierPricing;
  const [price2Pct, setPrice2Pct] = useState('');
  const [price3Pct, setPrice3Pct] = useState('');
  const [price4Pct, setPrice4Pct] = useState('');
  const [applying, setApplying] = useState(false);

  const reset = () => {
    setPrice2Pct('');
    setPrice3Pct('');
    setPrice4Pct('');
  };

  const parsePct = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  const handleApply = async () => {
    if (applying) return;
    const payload = {
      price2Pct: parsePct(price2Pct),
      price3Pct: parsePct(price3Pct),
      price4Pct: parsePct(price4Pct),
    };
    if (payload.price2Pct == null && payload.price3Pct == null && payload.price4Pct == null) {
      toast.error(ui.noPct);
      return;
    }
    if (!confirm(ui.confirm)) return;
    setApplying(true);
    try {
      const res = await api.products.bulkTierPricing(payload);
      if (res.error || !res.data?.success) {
        throw new Error(res.error || ui.failed);
      }
      toast.success(ui.success.replace('{count}', String(res.data.updated)));
      reset();
      onApplied?.(res.data.updated);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || ui.failed);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!applying) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ui.title}</DialogTitle>
          <DialogDescription>{ui.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <label className="block space-y-1">
            <span className="text-xs font-medium">{ui.price2Pct}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={price2Pct}
              onChange={(e) => setPrice2Pct(e.target.value)}
              placeholder="%"
              className="h-8 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{ui.price3Pct}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={price3Pct}
              onChange={(e) => setPrice3Pct(e.target.value)}
              placeholder="%"
              className="h-8 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{ui.price4Pct}</span>
            <Input
              type="text"
              inputMode="decimal"
              value={price4Pct}
              onChange={(e) => setPrice4Pct(e.target.value)}
              placeholder="%"
              className="h-8 text-sm"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">{ui.hint}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {t.common.cancel}
          </Button>
          <Button onClick={handleApply} disabled={applying}>
            {applying ? ui.applying : ui.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
