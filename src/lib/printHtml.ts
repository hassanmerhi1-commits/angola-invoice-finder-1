/**
 * Print self-contained HTML (invoices, receipts, pro forma).
 * Shows in-app preview first, then system print dialog (one OS window).
 */

import { openPrintPreview } from '@/lib/printPreview';

function waitForDocumentReady(doc: Document, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const images = Array.from(doc.querySelectorAll('img'));
    for (const img of images) {
      img.removeAttribute('loading');
    }

    const fontsReady = doc.fonts?.ready ?? Promise.resolve();

    const imagesReady =
      images.length === 0
        ? Promise.resolve()
        : Promise.all(
            images.map(
              (img) =>
                new Promise<void>((done) => {
                  if (img.complete && img.naturalWidth > 0) {
                    done();
                    return;
                  }
                  const finish = () => done();
                  img.addEventListener('load', finish, { once: true });
                  img.addEventListener('error', finish, { once: true });
                }),
            ),
          );

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    void Promise.all([fontsReady, imagesReady]).then(() => finish());
    setTimeout(finish, timeoutMs);
  });
}

function printViaIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Print');
    iframe.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:210mm',
      'min-height:297mm',
      'border:0',
      'margin:0',
      'padding:0',
      'opacity:0',
      'pointer-events:none',
      'z-index:-1',
    ].join(';');

    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!doc || !win) {
      iframe.remove();
      reject(new Error('Could not open print frame'));
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    void waitForDocumentReady(doc).then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            try {
              win.focus();
              win.print();
              resolve();
            } catch (e) {
              reject(e);
            } finally {
              setTimeout(() => {
                try {
                  iframe.remove();
                } catch {
                  /* removed */
                }
              }, 5000);
            }
          }, 200);
        });
      });
    });
  });
}

export type PrintHtmlOptions = {
  /** Skip the in-app preview dialog and open the system print dialog immediately. */
  direct?: boolean;
  /** Electron only: print without showing the OS dialog (requires deviceName). */
  silent?: boolean;
  /** Electron only: target printer by Windows device name. */
  deviceName?: string;
  /** Thermal receipt width in mm (58 or 80). */
  pageWidthMm?: 58 | 80;
  /** Thermal receipt content height in mm — sizes the page so long receipts stay on one continuous slip. */
  pageHeightMm?: number;
  /** Electron only: if false, never open the Windows print dialog on silent failure (POS auto-print). */
  allowDialogFallback?: boolean;
};

export async function printHtml(html: string, options: PrintHtmlOptions = {}): Promise<void> {
  if (!options.direct) {
    const action = await openPrintPreview(html);
    if (action === 'cancel') return;
  }

  const electronPrint = window.electronAPI?.print?.html;
  if (electronPrint) {
    const deviceName = options.deviceName?.trim() || '';
    const wantSilent = options.silent ?? (!!options.direct && !!deviceName);
    const allowDialogFallback = options.allowDialogFallback !== false;
    const printOpts = {
      silent: wantSilent,
      deviceName: deviceName || undefined,
      pageWidthMm: options.pageWidthMm,
      pageHeightMm: options.pageHeightMm,
      allowDialogFallback: wantSilent ? allowDialogFallback : true,
    };

    let result = await electronPrint(html, printOpts);
    if (result.success) return;

    if (wantSilent && allowDialogFallback) {
      console.warn('[printHtml] Silent print failed, retrying with print dialog:', result.error);
      result = await electronPrint(html, {
        silent: false,
        pageWidthMm: options.pageWidthMm,
        pageHeightMm: options.pageHeightMm,
        allowDialogFallback: true,
      });
      if (result.success) return;
    }

    throw new Error(result.error || 'Print failed');
  }

  await printViaIframe(html);
}

export function printCurrentPage(): void {
  window.print();
}
