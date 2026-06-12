import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n';

type VoidInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentNumber: string;
  saving?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
};

export function VoidInvoiceDialog({
  open,
  onOpenChange,
  documentNumber,
  saving,
  onConfirm,
}: VoidInvoiceDialogProps) {
  const { t } = useTranslation();
  const ui = t.voidInvoiceUi;
  const [reason, setReason] = useState('');

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason('');
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) return;
    await onConfirm(trimmed);
    setReason('');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ui.title}</DialogTitle>
          <DialogDescription>
            {ui.description.replace('{number}', documentNumber)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">{ui.reasonLabel}</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={ui.reasonPlaceholder}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">{ui.hint}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={saving || reason.trim().length < 3}
          >
            {saving ? t.common.saving : ui.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
