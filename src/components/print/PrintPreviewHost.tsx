import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { registerPrintPreviewHandler, type PrintPreviewAction } from '@/lib/printPreview';

type PendingPreview = {
  html: string;
  resolve: (action: PrintPreviewAction) => void;
};

export function PrintPreviewHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingPreview | null>(null);

  const finish = useCallback((action: PrintPreviewAction) => {
    setPending((current) => {
      current?.resolve(action);
      return null;
    });
  }, []);

  useEffect(() => {
    registerPrintPreviewHandler(
      (html) =>
        new Promise<PrintPreviewAction>((resolve) => {
          setPending({ html, resolve });
        }),
    );
    return () => registerPrintPreviewHandler(null);
  }, []);

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) finish('cancel');
      }}
    >
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t.printPreviewUi.title}</DialogTitle>
          <DialogDescription>{t.printPreviewUi.description}</DialogDescription>
        </DialogHeader>

        {pending && (
          <iframe
            title={t.printPreviewUi.title}
            srcDoc={pending.html}
            className="w-full flex-1 min-h-[60vh] rounded-md border bg-white"
          />
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => finish('cancel')}>
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={() => finish('print')}>
            <Printer className="w-4 h-4 mr-2" />
            {t.printPreviewUi.confirmPrint}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
