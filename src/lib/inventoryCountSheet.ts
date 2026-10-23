import { format } from 'date-fns';
import { Product } from '@/types/erp';
import { readProductStock } from '@/lib/inventoryGrid';
import { escapeHtml } from '@/lib/reportExport';

export type CountSheetLabels = {
  reportTitle: string;
  asOfDate: string;
  colCode: string;
  colDescription: string;
  colBarcode: string;
  colQty: string;
  colCount: string;
  colDiff: string;
};

export type CountSheetRow = {
  sku: string;
  name: string;
  barcode: string;
  qty: number | null;
};

export function formatCountSheetQty(qty: number, locale: 'pt' | 'en' = 'pt'): string {
  return qty.toLocaleString(locale === 'pt' ? 'pt-AO' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildCountSheetRows(
  products: Product[],
  hideSystemStock: boolean,
): CountSheetRow[] {
  return products.map((product) => ({
    sku: String(product.sku || '').trim(),
    name: String(product.name || '').trim().toUpperCase(),
    barcode: String(product.barcode || '').trim(),
    qty: hideSystemStock ? null : readProductStock(product),
  }));
}

export function countSheetAsOfLabel(template: string, date = new Date()): string {
  return template.replace('{date}', format(date, 'dd/MM/yyyy'));
}

function tableCss(): string {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px 20px; font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #1f2937; background: #fff; }
    .sheet { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .sheet .title { font-size: 18px; font-weight: 700; color: #111827; padding: 0 0 14px 0; border: none; }
    .sheet .as-of { font-size: 12px; font-weight: 600; color: #374151; text-align: right; padding: 0 0 14px 0; border: none; }
    .sheet th {
      background: #bdd7ee;
      color: #1e3a5f;
      font-size: 11px;
      font-weight: 700;
      border: 1px solid #8ea9db;
      padding: 7px 8px;
      text-align: left;
    }
    .sheet td {
      border: 1px solid #b4c6e7;
      padding: 5px 8px;
      font-size: 11px;
      vertical-align: middle;
    }
    .sheet tbody tr:nth-child(even) td { background: #f8fbfe; }
    .col-code { width: 118px; font-variant-numeric: tabular-nums; }
    .col-name { width: auto; }
    .col-barcode { width: 130px; }
    .col-num { width: 88px; text-align: right; font-variant-numeric: tabular-nums; }
    .col-write { background: #fffdf6 !important; }
    .num { mso-number-format: '#,##0.00'; text-align: right; }
    @page { size: A4 portrait; margin: 10mm; }
    @media print { body { padding: 0; } }
  `;
}

export function buildCountSheetHtml(opts: {
  rows: CountSheetRow[];
  labels: CountSheetLabels;
  asOfLabel: string;
  includeBarcode?: boolean;
  locale?: 'pt' | 'en';
}): string {
  const includeBarcode = !!opts.includeBarcode;
  const locale = opts.locale || 'pt';
  const colSpanTitle = includeBarcode ? 3 : 2;
  const colSpanDate = 2;
  const barcodeHeader = includeBarcode
    ? `<th class="col-barcode">${escapeHtml(opts.labels.colBarcode)}</th>`
    : '';

  const body = opts.rows.map((row) => `
    <tr>
      <td class="col-code">${escapeHtml(row.sku)}</td>
      <td class="col-name">${escapeHtml(row.name)}</td>
      ${includeBarcode ? `<td class="col-barcode">${escapeHtml(row.barcode)}</td>` : ''}
      <td class="col-num num">${row.qty == null ? '' : escapeHtml(formatCountSheetQty(row.qty, locale))}</td>
      <td class="col-num col-write"></td>
      <td class="col-num col-write"></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(opts.labels.reportTitle)}</title>
  <style>${tableCss()}</style>
</head>
<body>
  <table class="sheet" cellspacing="0" cellpadding="0">
    <thead>
      <tr>
        <td class="title" colspan="${colSpanTitle}">${escapeHtml(opts.labels.reportTitle)}</td>
        <td class="as-of" colspan="${colSpanDate}">${escapeHtml(opts.asOfLabel)}</td>
      </tr>
      <tr>
        <th class="col-code">${escapeHtml(opts.labels.colCode)}</th>
        <th class="col-name">${escapeHtml(opts.labels.colDescription)}</th>
        ${barcodeHeader}
        <th class="col-num">${escapeHtml(opts.labels.colQty)}</th>
        <th class="col-num">${escapeHtml(opts.labels.colCount)}</th>
        <th class="col-num">${escapeHtml(opts.labels.colDiff)}</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export function downloadCountSheetExcel(html: string, filename: string): void {
  const blob = new Blob([`\uFEFF${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
