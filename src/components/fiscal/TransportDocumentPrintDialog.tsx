import { Printer } from 'lucide-react';
import type { TransportDocument } from '@/types/erp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { printTransportDocument } from '@/lib/transportDocumentPrint';

type TransportDocumentPrintDialogProps = {
  open: boolean;
  doc: TransportDocument | null;
  includePrices: boolean;
  onIncludePricesChange: (value: boolean) => void;
  onOpenChange: (open: boolean) => void;
};

export function TransportDocumentPrintDialog({
  open,
  doc,
  includePrices,
  onIncludePricesChange,
  onOpenChange,
}: TransportDocumentPrintDialogProps) {
  const { t, language } = useTranslation();
  const fd = t.fiscalDocumentsUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

  const handlePrint = async () => {
    if (!doc) return;
    await printTransportDocument(doc, {
      includePrices,
      language: language === 'en' ? 'en' : 'pt',
    });
  };

  const typeLabel =
    doc?.type === 'delivery' ? fd.transportTypeDelivery
    : doc?.type === 'transfer' ? fd.transportTypeTransfer
    : doc?.type === 'return' ? fd.transportTypeReturn
    : fd.transportTypeConsignment;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{fd.printTransportTitle}</DialogTitle>
          <DialogDescription>
            {doc?.documentNumber}
            {doc?.relatedInvoiceNumber ? ` · ${fd.relatedInvoice} ${doc.relatedInvoiceNumber}` : ''}
          </DialogDescription>
        </DialogHeader>

        {doc && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{doc.destinationName || fd.finalConsumer}</span>
                <Badge variant="outline">{typeLabel}</Badge>
              </div>
              <p className="text-muted-foreground">
                {doc.originCity} → {doc.destinationCity || doc.destinationAddress}
              </p>
              <p className="text-muted-foreground">
                {fd.transportItemsCount.replace('{count}', String(doc.items?.length || 0))}
              </p>
            </div>

            <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{fd.printIncludePrices}</p>
                <p className="text-xs text-muted-foreground">{fd.includePricesHint}</p>
              </div>
              <Switch checked={includePrices} onCheckedChange={onIncludePricesChange} />
            </label>

            {includePrices && (
              <p className="text-xs text-muted-foreground">
                {fd.goodsValue}: {(doc.items || []).reduce((sum, item) => {
                  const line = Number(item.lineTotal) || (Number(item.unitPrice) || 0) * item.quantity;
                  return sum + line;
                }, 0).toLocaleString(uiLocale)} Kz
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handlePrint()} disabled={!doc}>
            <Printer className="h-4 w-4" />
            {t.common.print}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
