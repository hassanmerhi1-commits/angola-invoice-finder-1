import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';

export type FiscalReportKind = 'iva' | 'fiscal' | 'agt';

export type IvaReportPdfData = {
  lines: Array<{
    direction: string;
    tax_code: string;
    tax_rate: number;
    total_base: string | number;
    total_tax: string | number;
    document_count: string | number;
  }>;
  outputTax: number;
  inputTax: number;
  ivaPayable: number;
};

export type FiscalDocsPdfData = {
  lines: Array<{
    docType: string;
    documentCount: number;
    subtotal: number;
    taxAmount: number;
    total: number;
    agtValidatedCount: number;
  }>;
  totals: {
    documentCount: number;
    subtotal: number;
    taxAmount: number;
    total: number;
    agtValidatedCount: number;
  } | null;
};

export type AgtReportPdfData = {
  summary: { total: number; validated: number; failed: number; pending: number };
  byTypeStatus: Array<{ transmission_type: string; agt_status: string; count: number }>;
};

export type FiscalReportPdfLabels = {
  generatedAt: string;
  systemName: string;
  periodLabel: string;
  nif: string;
  company: string;
  // IVA
  ivaReturnTitle: string;
  outputVatTitle: string;
  inputVatTitle: string;
  colCode: string;
  colRateShort: string;
  colTaxBase: string;
  colVat: string;
  colDocs: string;
  totalOutputVat: string;
  totalInputVat: string;
  netVatPayableTitle: string;
  netVatPayableHint: string;
  // Fiscal docs
  fiscalDocsTitle: string;
  colDocType: string;
  colSubtotal: string;
  colTax: string;
  colTotal: string;
  colAgtValidated: string;
  fiscalDocsTotal: string;
  docTypeFt: string;
  docTypeFr: string;
  docTypeFs: string;
  docTypeNc: string;
  docTypeNd: string;
  docTypeGt: string;
  // AGT
  agtReportTitle: string;
  agtTotalSent: string;
  agtValidated: string;
  agtFailed: string;
  agtPending: string;
  agtColTransmissionType: string;
  agtColStatus: string;
  agtColCount: string;
  agtTypeInvoice: string;
  agtTypeCreditNote: string;
  agtTypeDebitNote: string;
  agtTypeVoid: string;
  noReportData: string;
};

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(value: number, locale: string): string {
  return `${value.toLocaleString(locale)} Kz`;
}

function docTypeLabel(docType: string, labels: FiscalReportPdfLabels): string {
  const map: Record<string, string> = {
    FT: labels.docTypeFt,
    FR: labels.docTypeFr,
    FS: labels.docTypeFs,
    NC: labels.docTypeNc,
    ND: labels.docTypeNd,
    GT: labels.docTypeGt,
  };
  return map[docType] || docType;
}

function agtTypeLabel(type: string, labels: FiscalReportPdfLabels): string {
  const map: Record<string, string> = {
    invoice: labels.agtTypeInvoice,
    credit_note: labels.agtTypeCreditNote,
    debit_note: labels.agtTypeDebitNote,
    void: labels.agtTypeVoid,
  };
  return map[type] || type;
}

function reportShell(title: string, labels: FiscalReportPdfLabels, body: string): string {
  const company = getCompanySettings();
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10pt;
      color: #111;
      margin: 0;
      padding: 16mm;
    }
    h1 { font-size: 16pt; margin: 0 0 4px 0; }
    h2 { font-size: 12pt; margin: 20px 0 8px 0; border-bottom: 2px solid #222; padding-bottom: 4px; }
    .meta { color: #444; font-size: 9pt; margin-bottom: 16px; }
    .meta p { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f0f0; font-weight: bold; }
    .text-right { text-align: right; }
    .total-row td { font-weight: bold; background: #f9f9f9; }
    .highlight { font-size: 14pt; font-weight: bold; color: #1d4ed8; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .summary-card {
      border: 1px solid #ddd;
      padding: 10px;
      border-radius: 4px;
    }
    .summary-card .label { font-size: 8pt; color: #666; }
    .summary-card .value { font-size: 14pt; font-weight: bold; }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 8pt;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 10px;
    }
    @media print {
      body { padding: 0; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <p><strong>${escapeHtml(company.tradeName || company.name)}</strong> · ${escapeHtml(labels.nif)}: ${escapeHtml(company.nif)}</p>
    <p>${escapeHtml(labels.periodLabel)}</p>
  </div>
  ${body}
  <div class="footer">
    <p>${escapeHtml(labels.generatedAt)}</p>
    <p>${escapeHtml(labels.systemName)}</p>
  </div>
</body>
</html>`;
}

function buildIvaTable(
  title: string,
  lines: IvaReportPdfData['lines'],
  totalLabel: string,
  totalValue: number,
  labels: FiscalReportPdfLabels,
  locale: string,
): string {
  if (!lines.length) return '';
  const rows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.tax_code)}</td>
      <td class="text-right">${escapeHtml(line.tax_rate)}%</td>
      <td class="text-right">${escapeHtml(formatMoney(Number(line.total_base), locale))}</td>
      <td class="text-right">${escapeHtml(formatMoney(Number(line.total_tax), locale))}</td>
      <td class="text-right">${escapeHtml(line.document_count)}</td>
    </tr>`).join('');
  return `
    <h2>${escapeHtml(title)}</h2>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(labels.colCode)}</th>
          <th class="text-right">${escapeHtml(labels.colRateShort)}</th>
          <th class="text-right">${escapeHtml(labels.colTaxBase)}</th>
          <th class="text-right">${escapeHtml(labels.colVat)}</th>
          <th class="text-right">${escapeHtml(labels.colDocs)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="3">${escapeHtml(totalLabel)}</td>
          <td class="text-right">${escapeHtml(formatMoney(totalValue, locale))}</td>
          <td></td>
        </tr>
      </tbody>
    </table>`;
}

export function buildIvaReportHtml(data: IvaReportPdfData, labels: FiscalReportPdfLabels, locale: string): string | null {
  const output = data.lines.filter((l) => l.direction === 'output');
  const input = data.lines.filter((l) => l.direction === 'input');
  if (!output.length && !input.length) return null;

  const body = `
    ${buildIvaTable(labels.outputVatTitle, output, labels.totalOutputVat, data.outputTax, labels, locale)}
    ${buildIvaTable(labels.inputVatTitle, input, labels.totalInputVat, data.inputTax, labels, locale)}
    <h2>${escapeHtml(labels.netVatPayableTitle)}</h2>
    <p class="highlight">${escapeHtml(formatMoney(data.ivaPayable, locale))}</p>
    <p style="color:#666;font-size:9pt;">${escapeHtml(labels.netVatPayableHint)}: ${escapeHtml(formatMoney(data.outputTax, locale))} − ${escapeHtml(formatMoney(data.inputTax, locale))}</p>
  `;
  return reportShell(labels.ivaReturnTitle, labels, body);
}

export function buildFiscalDocsReportHtml(data: FiscalDocsPdfData, labels: FiscalReportPdfLabels, locale: string): string | null {
  if (!data.lines.some((l) => l.documentCount > 0)) return null;

  const rows = data.lines.map((line) => `
    <tr>
      <td>${escapeHtml(docTypeLabel(line.docType, labels))}</td>
      <td class="text-right">${line.documentCount}</td>
      <td class="text-right">${escapeHtml(formatMoney(line.subtotal, locale))}</td>
      <td class="text-right">${escapeHtml(formatMoney(line.taxAmount, locale))}</td>
      <td class="text-right">${escapeHtml(formatMoney(line.total, locale))}</td>
      <td class="text-right">${line.agtValidatedCount}</td>
    </tr>`).join('');

  const totalRow = data.totals ? `
    <tr class="total-row">
      <td>${escapeHtml(labels.fiscalDocsTotal)}</td>
      <td class="text-right">${data.totals.documentCount}</td>
      <td class="text-right">${escapeHtml(formatMoney(data.totals.subtotal, locale))}</td>
      <td class="text-right">${escapeHtml(formatMoney(data.totals.taxAmount, locale))}</td>
      <td class="text-right">${escapeHtml(formatMoney(data.totals.total, locale))}</td>
      <td class="text-right">${data.totals.agtValidatedCount}</td>
    </tr>` : '';

  const body = `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(labels.colDocType)}</th>
          <th class="text-right">${escapeHtml(labels.colDocs)}</th>
          <th class="text-right">${escapeHtml(labels.colSubtotal)}</th>
          <th class="text-right">${escapeHtml(labels.colTax)}</th>
          <th class="text-right">${escapeHtml(labels.colTotal)}</th>
          <th class="text-right">${escapeHtml(labels.colAgtValidated)}</th>
        </tr>
      </thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`;
  return reportShell(labels.fiscalDocsTitle, labels, body);
}

export function buildAgtReportHtml(data: AgtReportPdfData, labels: FiscalReportPdfLabels): string | null {
  if (!data.summary.total) return null;

  const detailRows = data.byTypeStatus.map((row) => `
    <tr>
      <td>${escapeHtml(agtTypeLabel(row.transmission_type, labels))}</td>
      <td>${escapeHtml(row.agt_status)}</td>
      <td class="text-right">${row.count}</td>
    </tr>`).join('');

  const body = `
    <div class="summary-grid">
      <div class="summary-card"><div class="label">${escapeHtml(labels.agtTotalSent)}</div><div class="value">${data.summary.total}</div></div>
      <div class="summary-card"><div class="label">${escapeHtml(labels.agtValidated)}</div><div class="value">${data.summary.validated}</div></div>
      <div class="summary-card"><div class="label">${escapeHtml(labels.agtFailed)}</div><div class="value">${data.summary.failed}</div></div>
      <div class="summary-card"><div class="label">${escapeHtml(labels.agtPending)}</div><div class="value">${data.summary.pending}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(labels.agtColTransmissionType)}</th>
          <th>${escapeHtml(labels.agtColStatus)}</th>
          <th class="text-right">${escapeHtml(labels.agtColCount)}</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>`;
  return reportShell(labels.agtReportTitle, labels, body);
}

export function fiscalReportFilename(kind: FiscalReportKind, year: number, month: number): string {
  const mm = String(month).padStart(2, '0');
  const prefix = kind === 'iva' ? 'iva-report' : kind === 'fiscal' ? 'fiscal-documents' : 'agt-transmissions';
  return `${prefix}_${year}-${mm}.pdf`;
}

export async function saveFiscalReportPdf(html: string, filename: string): Promise<boolean> {
  const el = typeof window !== 'undefined' ? (window as Window & { electronAPI?: { isElectron?: boolean; pdf?: { saveHtml: (h: string, o: { filename: string }) => Promise<void> } } }).electronAPI : null;
  if (el?.isElectron && el.pdf?.saveHtml) {
    await el.pdf.saveHtml(html, { filename });
    return true;
  }
  await printHtml(html, { direct: true });
  return false;
}

export async function printFiscalReportPdf(html: string): Promise<void> {
  await printHtml(html);
}
