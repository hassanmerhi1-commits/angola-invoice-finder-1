/**
 * Unified report preview + print / PDF / Excel export.
 */

import { exportToExcel, exportToExcelMultiSheet } from '@/lib/excel';
import { openExportPreview } from '@/lib/printPreview';
import { printHtml } from '@/lib/printHtml';

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; padding: 16px; }
  .rpt-head { text-align: center; margin-bottom: 14px; }
  .rpt-head h1 { font-size: 15pt; margin: 0; }
  .rpt-head h2 { font-size: 11pt; margin: 4px 0; font-weight: normal; }
  .rpt-head p { font-size: 9pt; color: #444; margin: 0; }
  .rpt-meta { font-size: 8pt; color: #555; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 3px 5px; }
  th { background: #f0f0f0; font-size: 8pt; }
  .r { text-align: right; }
  .c { text-align: center; }
  .b { font-weight: bold; }
  .sub { background: #f6f6f6; font-weight: 600; }
  .tot { background: #e8e8e8; font-weight: bold; border-top: 2px solid #000; }
  .hdr { background: #ddd; font-weight: bold; font-size: 10pt; }
  .muted { color: #555; }
  .line-row td { border-left: none; border-right: none; border-bottom: 1px solid #eee; }
  .line-sub td { background: #f4f4f4; font-weight: 600; }
  .line-tot td { background: #333; color: #fff; font-weight: bold; }
  @media print { body { padding: 0; } }
`;

export type BuildReportHtmlOptions = {
  title: string;
  subtitle?: string;
  companyName?: string;
  periodLabel?: string;
  branchLabel?: string;
  generatedAt?: string;
  landscape?: boolean;
  bodyHtml: string;
};

function identityMetaHtml(opts: BuildReportHtmlOptions): string {
  const bits: string[] = [];
  if (opts.periodLabel) bits.push(escapeHtml(opts.periodLabel));
  if (opts.branchLabel) bits.push(escapeHtml(opts.branchLabel));
  if (opts.generatedAt) bits.push(escapeHtml(opts.generatedAt));
  if (!bits.length) return '';
  return `<p class="rpt-meta">${bits.join(' · ')}</p>`;
}

export function buildReportHtml(opts: BuildReportHtmlOptions): string {
  const page = opts.landscape ? 'A4 landscape' : 'A4 portrait';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
    <style>
      ${BASE_STYLES}
      @page { size: ${page}; margin: 10mm; }
    </style></head>
    <body>
      <div class="rpt-head">
        ${opts.companyName ? `<h1>${escapeHtml(opts.companyName)}</h1>` : ''}
        <h2>${escapeHtml(opts.title)}</h2>
        ${opts.subtitle ? `<p>${escapeHtml(opts.subtitle)}</p>` : ''}
        ${identityMetaHtml(opts)}
      </div>
      ${opts.bodyHtml}
    </body></html>`;
}

export function buildDataTableHtml(
  data: Record<string, unknown>[],
  opts: {
    title: string;
    subtitle?: string;
    companyName?: string;
    periodLabel?: string;
    branchLabel?: string;
    generatedAt?: string;
    landscape?: boolean;
  },
): string {
  if (data.length === 0) {
    return buildReportHtml({ ...opts, bodyHtml: '<p class="muted">—</p>' });
  }
  const keys = Object.keys(data[0]);
  const head = keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('');
  const body = data
    .map((row) => {
      const cells = keys
        .map((k) => {
          const v = row[k];
          const isNum = typeof v === 'number';
          return `<td class="${isNum ? 'r' : ''}">${escapeHtml(v as string | number)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return buildReportHtml({
    ...opts,
    bodyHtml: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  });
}

export type LineItemRow = {
  code?: string;
  description: string;
  value?: string | number;
  value2?: string | number;
  isHeader?: boolean;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
};

export function buildLineItemsTableHtml(
  items: LineItemRow[],
  opts: {
    title: string;
    subtitle?: string;
    companyName?: string;
    periodLabel?: string;
    branchLabel?: string;
    generatedAt?: string;
    colCode?: string;
    colDescription: string;
    colValue: string;
    colValue2?: string;
  },
): string {
  const rows = items
    .map((item) => {
      const pad = item.indent ? ` style="padding-left:${item.indent * 16 + 8}px"` : '';
      const cls = item.isTotal ? 'line-tot' : item.isSubtotal ? 'line-sub' : item.isHeader ? 'hdr' : 'line-row';
      const code = item.code ? escapeHtml(item.code) : '';
      const v1 = item.isHeader ? '' : escapeHtml(item.value ?? '');
      const v2 = item.colValue2 && !item.isHeader ? escapeHtml(item.value2 ?? '') : '';
      return `<tr class="${cls}">
        <td class="muted" style="width:48px">${code}</td>
        <td${pad}>${escapeHtml(item.description)}</td>
        <td class="r" style="width:120px">${v1}</td>
        ${opts.colValue2 ? `<td class="r muted" style="width:120px">${v2}</td>` : ''}
      </tr>`;
    })
    .join('');

  return buildReportHtml({
    title: opts.title,
    subtitle: opts.subtitle,
    companyName: opts.companyName,
    periodLabel: opts.periodLabel,
    branchLabel: opts.branchLabel,
    generatedAt: opts.generatedAt,
    bodyHtml: `<table>
      <thead><tr>
        <th>${escapeHtml(opts.colCode || '')}</th>
        <th>${escapeHtml(opts.colDescription)}</th>
        <th class="r">${escapeHtml(opts.colValue)}</th>
        ${opts.colValue2 ? `<th class="r">${escapeHtml(opts.colValue2)}</th>` : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`,
  });
}

export async function printReport(html: string): Promise<void> {
  await printHtml(html);
}

export async function saveReportPdf(
  html: string,
  filename: string,
  options?: { landscape?: boolean },
): Promise<void> {
  const action = await openExportPreview({ html, kind: 'pdf' });
  if (action === 'cancel') return;

  const el = typeof window !== 'undefined' ? (window as Window & { electronAPI?: ElectronPrintApi }).electronAPI : undefined;
  if (el?.isElectron && el?.pdf?.saveHtml) {
    await el.pdf.saveHtml(html, {
      filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
      landscape: options?.landscape,
    });
    return;
  }
  await printHtml(html, { direct: true });
}

type ElectronPrintApi = {
  isElectron?: boolean;
  pdf?: {
    saveHtml: (html: string, opts: { filename: string; landscape?: boolean }) => Promise<void>;
  };
};

export async function exportReportExcel(
  data: Record<string, unknown>[],
  filename: string,
  preview: {
    title: string;
    subtitle?: string;
    companyName?: string;
    periodLabel?: string;
    branchLabel?: string;
    generatedAt?: string;
    landscape?: boolean;
  },
): Promise<void> {
  if (data.length === 0) return;
  const html = buildDataTableHtml(data, preview);
  const action = await openExportPreview({ html, kind: 'excel' });
  if (action === 'cancel') return;
  exportToExcel(data, filename);
}

/** Multi-sheet workbook export with a simple HTML preview of the first sheet. */
export async function exportReportExcelMulti(
  sheets: Array<{ name: string; data: Record<string, unknown>[] }>,
  filename: string,
  preview: {
    title: string;
    subtitle?: string;
    companyName?: string;
    periodLabel?: string;
    branchLabel?: string;
    generatedAt?: string;
    landscape?: boolean;
  },
): Promise<void> {
  if (!sheets.length) return;
  const first = sheets.find((s) => s.data.length > 0) || sheets[0];
  const html = buildDataTableHtml(first.data.length ? first.data : [{ Note: preview.subtitle || '—' }], preview);
  const action = await openExportPreview({ html, kind: 'excel' });
  if (action === 'cancel') return;
  exportToExcelMultiSheet(sheets, filename);
}
