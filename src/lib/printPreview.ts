/** In-app print preview (Electron has no Chrome print-preview UI). */

export type PrintPreviewAction = 'print' | 'cancel';

type PrintPreviewHandler = (html: string) => Promise<PrintPreviewAction>;

let handler: PrintPreviewHandler | null = null;

export function registerPrintPreviewHandler(fn: PrintPreviewHandler | null) {
  handler = fn;
}

export async function openPrintPreview(html: string): Promise<PrintPreviewAction> {
  if (!handler) return 'print';
  return handler(html);
}
