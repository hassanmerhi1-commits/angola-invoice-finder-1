import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from '@/i18n';
import StockAdjustmentHistoryReport from '@/components/reports/StockAdjustmentHistoryReport';

interface StockAdjustmentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StockAdjustmentHistoryDialog({
  open,
  onOpenChange,
}: StockAdjustmentHistoryDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.adjustmentHistoryUi.title}</DialogTitle>
        </DialogHeader>
        {open ? <StockAdjustmentHistoryReport key="adj-history-open" /> : null}
      </DialogContent>
    </Dialog>
  );
}
