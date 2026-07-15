/** In-app export preview before print / PDF / Excel download. */

export type ExportPreviewKind = 'print' | 'pdf' | 'excel';

export type ExportPreviewAction = 'confirm' | 'cancel';

/** @deprecated Use ExportPreviewAction */
export type PrintPreviewAction = 'print' | 'cancel';

export type ExportPreviewRequest = {
  html: string;
  kind: ExportPreviewKind;
};

type ExportPreviewHandler = (request: ExportPreviewRequest) => Promise<ExportPreviewAction>;

let handler: ExportPreviewHandler | null = null;

export function registerExportPreviewHandler(fn: ExportPreviewHandler | null) {
  handler = fn;
}

/** @deprecated Use registerExportPreviewHandler */
export function registerPrintPreviewHandler(fn: ((html: string) => Promise<PrintPreviewAction>) | null) {
  if (!fn) {
    registerExportPreviewHandler(null);
    return;
  }
  registerExportPreviewHandler(async (request) => {
    const legacy = await fn(request.html);
    return legacy === 'print' ? 'confirm' : 'cancel';
  });
}

export async function openExportPreview(request: ExportPreviewRequest): Promise<ExportPreviewAction> {
  if (!handler) return 'confirm';
  return handler(request);
}

/** Used by printHtml — always print kind. */
export async function openPrintPreview(html: string): Promise<PrintPreviewAction> {
  const action = await openExportPreview({ html, kind: 'print' });
  return action === 'confirm' ? 'print' : 'cancel';
}
