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
import { Download, FileDown, Printer } from 'lucide-react';
import { useTranslation } from '@/i18n';
import {
  registerExportPreviewHandler,
  type ExportPreviewAction,
  type ExportPreviewKind,
  type ExportPreviewRequest,
} from '@/lib/printPreview';

type PendingPreview = {
  request: ExportPreviewRequest;
  resolve: (action: ExportPreviewAction) => void;
};

export function PrintPreviewHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingPreview | null>(null);

  const finish = useCallback((action: ExportPreviewAction) => {
    setPending((current) => {
      current?.resolve(action);
      return null;
    });
  }, []);

  useEffect(() => {
    registerExportPreviewHandler(
      (request) =>
        new Promise<ExportPreviewAction>((resolve) => {
          setPending({ request, resolve });
        }),
    );
    return () => registerExportPreviewHandler(null);
  }, []);

  const kind: ExportPreviewKind = pending?.request.kind ?? 'print';

  const title =
    kind === 'pdf'
      ? t.printPreviewUi.titlePdf
      : kind === 'excel'
        ? t.printPreviewUi.titleExcel
        : t.printPreviewUi.title;

  const description =
    kind === 'pdf'
      ? t.printPreviewUi.descriptionPdf
      : kind === 'excel'
        ? t.printPreviewUi.descriptionExcel
        : t.printPreviewUi.description;

  const confirmLabel =
    kind === 'pdf'
      ? t.printPreviewUi.confirmPdf
      : kind === 'excel'
        ? t.printPreviewUi.confirmExcel
        : t.printPreviewUi.confirmPrint;

  const ConfirmIcon = kind === 'excel' ? Download : kind === 'pdf' ? FileDown : Printer;

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) finish('cancel');
      }}
    >
      <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {pending && (
          <iframe
            title={title}
            srcDoc={pending.request.html}
            className="w-full flex-1 min-h-[60vh] rounded-md border bg-white"
          />
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => finish('cancel')}>
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={() => finish('confirm')}>
            <ConfirmIcon className="w-4 h-4 mr-2" />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
