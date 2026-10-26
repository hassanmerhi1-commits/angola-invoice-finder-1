import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { Product } from '@/types/erp';
import { readProductStock } from '@/lib/inventoryGrid';
import { escapeHtml } from '@/lib/reportExport';

/** Warehouse count sheet always follows the Portuguese A4 template. */
export const COUNT_SHEET_TEMPLATE = {
  reportTitle: 'Qtd por Armazém',
  companyLabel: 'Empresa',
  branchLabel: 'Filial',
  asOfLabel: 'A Data',
  countedByLabel: 'Contado por',
  colCode: 'Código',
  colDescription: 'Descrição',
  colQty: 'Qtd',
  colCount: 'Contagem',
  colDiff: 'Diff',
  filePrefix: 'Qtd_por_Armazem',
} as const;

export type CountSheetRow = {
  sku: string;
  name: string;
  qty: number | null;
};

export type CountSheetHeader = {
  companyName?: string;
  branchName?: string;
  branchCode?: string;
  countedBy?: string;
  date?: Date;
};

export type CountSheetPrintedHeader = {
  title: string;
  company: string;
  branch: string;
  asOf: string;
  countedBy: string;
};

export function formatCountSheetQty(qty: number): string {
  return qty.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildCountSheetRows(
  products: Product[],
  hideSystemStock: boolean,
): CountSheetRow[] {
  return products.map((product) => ({
    sku: String(product.sku || '').trim(),
    name: String(product.name || '').trim().toUpperCase(),
    qty: hideSystemStock ? null : readProductStock(product),
  }));
}

function sheetDate(date = new Date()): string {
  return format(date, 'dd/MM/yyyy');
}

function branchLine(header: CountSheetHeader): string {
  const name = String(header.branchName || '').trim();
  const code = String(header.branchCode || '').trim();
  if (name && code) return `${name} (${code})`;
  return name || code || '—';
}

function labeled(label: string, value: string): string {
  return `${label}: ${value}`;
}

export function buildCountSheetPrintedHeader(header: CountSheetHeader): CountSheetPrintedHeader {
  return {
    title: COUNT_SHEET_TEMPLATE.reportTitle,
    company: labeled(COUNT_SHEET_TEMPLATE.companyLabel, header.companyName?.trim() || '—'),
    branch: labeled(COUNT_SHEET_TEMPLATE.branchLabel, branchLine(header)),
    asOf: labeled(COUNT_SHEET_TEMPLATE.asOfLabel, sheetDate(header.date)),
    countedBy: labeled(COUNT_SHEET_TEMPLATE.countedByLabel, header.countedBy?.trim() || ''),
  };
}

export function countSheetMetaLines(header: CountSheetHeader): string[] {
  const printed = buildCountSheetPrintedHeader(header);
  return [printed.company, printed.branch, printed.asOf, printed.countedBy];
}

function countSheetFileName(header: CountSheetHeader): string {
  const code = String(header.branchCode || 'geral').replace(/[^\w-]+/g, '');
  return `${COUNT_SHEET_TEMPLATE.filePrefix}_${code}_${format(header.date || new Date(), 'yyyy-MM-dd')}.xlsx`;
}

export function buildCountSheetHtml(opts: {
  rows: CountSheetRow[];
  header: CountSheetHeader;
}): string {
  const printed = buildCountSheetPrintedHeader(opts.header);
  const body = opts.rows.map((row) => `
    <tr>
      <td class="code">${escapeHtml(row.sku)}</td>
      <td class="name">${escapeHtml(row.name)}</td>
      <td class="num">${row.qty == null ? '' : escapeHtml(formatCountSheetQty(row.qty))}</td>
      <td class="write"></td>
      <td class="write"></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(printed.title)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 portrait; margin: 7mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111;
      width: 196mm;
    }
    .page-head { margin: 0 0 3.5mm; }
    .page-head .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8mm;
    }
    .page-head h1 {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      line-height: 1.15;
    }
    .page-head .meta {
      margin: 0.6mm 0 0;
      font-size: 7.5pt;
      line-height: 1.25;
    }
    .page-head .meta.right { text-align: right; white-space: nowrap; }
    table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.grid th, table.grid td {
      border: 0.35pt solid #7f8c9b;
      padding: 0.7mm 1mm;
      font-size: 7pt;
      line-height: 1.1;
    }
    table.grid th { background: #d6e3f0; font-weight: 700; text-align: left; }
    table.grid .code { width: 18mm; }
    table.grid .name { width: auto; }
    table.grid .num, table.grid .write { width: 16mm; text-align: right; }
    table.grid .write { background: #fffdf4; }
    @media print { body { width: auto; } }
  </style>
</head>
<body>
  <header class="page-head">
    <div class="row">
      <h1>${escapeHtml(printed.title)}</h1>
      <p class="meta right">${escapeHtml(printed.asOf)}</p>
    </div>
    <div class="row">
      <p class="meta">${escapeHtml(printed.company)}</p>
      <p class="meta right">${escapeHtml(printed.countedBy)}</p>
    </div>
    <p class="meta">${escapeHtml(printed.branch)}</p>
  </header>
  <table class="grid">
    <thead>
      <tr>
        <th class="code">${COUNT_SHEET_TEMPLATE.colCode}</th>
        <th class="name">${COUNT_SHEET_TEMPLATE.colDescription}</th>
        <th class="num">${COUNT_SHEET_TEMPLATE.colQty}</th>
        <th class="write">${COUNT_SHEET_TEMPLATE.colCount}</th>
        <th class="write">${COUNT_SHEET_TEMPLATE.colDiff}</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export function buildCountSheetAoa(
  rows: CountSheetRow[],
  header: CountSheetHeader,
): Array<Array<string | number | null>> {
  const printed = buildCountSheetPrintedHeader(header);
  return [
    [printed.title, null, null, printed.asOf, null],
    [printed.company, null, null, printed.countedBy, null],
    [printed.branch, null, null, null, null],
    [null, null, null, null, null],
    [
      COUNT_SHEET_TEMPLATE.colCode,
      COUNT_SHEET_TEMPLATE.colDescription,
      COUNT_SHEET_TEMPLATE.colQty,
      COUNT_SHEET_TEMPLATE.colCount,
      COUNT_SHEET_TEMPLATE.colDiff,
    ],
    ...rows.map((row) => [
      row.sku,
      row.name,
      row.qty == null ? null : Number(row.qty),
      null,
      null,
    ]),
  ];
}

export function buildCountSheetWorkbook(
  rows: CountSheetRow[],
  header: CountSheetHeader,
): XLSX.WorkBook {
  const printed = buildCountSheetPrintedHeader(header);
  const aoa = buildCountSheetAoa(rows, header);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
  ];
  ws['!cols'] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 9 },
    { wch: 11 },
    { wch: 8 },
  ];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = 5; r <= range.e.r; r += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
  }
  ws['!freeze'] = { xSplit: 0, ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft', state: 'frozen' };
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.32, header: 0.16, footer: 0.16 };
  ws['!pageSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalDpi: 300,
    verticalDpi: 300,
  };
  ws['!printHeader'] = `&L&B${printed.title}&R${printed.asOf}`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Qtd por Armazem');
  return wb;
}

export function downloadCountSheetExcel(
  rows: CountSheetRow[],
  header: CountSheetHeader,
): void {
  const wb = buildCountSheetWorkbook(rows, header);
  XLSX.writeFile(wb, countSheetFileName(header), { bookType: 'xlsx', cellStyles: true });
}
