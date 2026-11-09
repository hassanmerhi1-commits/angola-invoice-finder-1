// NEXOR ERP - A4 Document PDF Generator
// Angolan-standard professional invoice layout matching AGT requirements

import { ERPDocument, DOCUMENT_TYPE_CONFIG, DocumentLine } from '@/types/documents';
import type { Sale } from '@/types/erp';
import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';
import { recordDocumentPrint, type PrintSource } from '@/lib/recordPrintAudit';

interface PDFOptions {
  showQR?: boolean;
  showTerms?: boolean;
  copies?: number;
  source?: PrintSource;
  reprint?: boolean;
  /** Already-rendered AGT QR. Empty means the page prints with no QR box. */
  qrCodeDataUrl?: string;
  /** Normalized software number, e.g. 398/AGT/2026. */
  softwareNumber?: string;
  bankLines?: string[];
  customerCountry?: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function numberToWords(num: number, currency: string): string {
  const unit = currency === 'AKZ' || currency === 'AOA' || !currency ? 'AOA' : currency;
  if (num === 0) return `Total (${unit}): ZERO KWANZAS`;
  
  const units = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
  const teens = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'CATORZE', 'QUINZE', 'DEZASSEIS', 'DEZASSETE', 'DEZOITO', 'DEZANOVE'];
  const tens = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
  const hundreds = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];
  
  function convertGroup(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'CEM';
    
    let result = '';
    if (n >= 100) {
      result += hundreds[Math.floor(n / 100)];
      n %= 100;
      if (n > 0) result += ' E ';
    }
    if (n >= 20) {
      result += tens[Math.floor(n / 10)];
      n %= 10;
      if (n > 0) result += ' E ';
    }
    if (n >= 10) {
      result += teens[n - 10];
      return result;
    }
    if (n > 0) {
      result += units[n];
    }
    return result;
  }
  
  const intPart = Math.floor(num);
  const parts: string[] = [];
  
  if (intPart >= 1000000000) {
    const billions = Math.floor(intPart / 1000000000);
    parts.push(convertGroup(billions) + (billions === 1 ? ' BILIÃO' : ' BILIÕES'));
  }
  if (intPart >= 1000000) {
    const millions = Math.floor((intPart % 1000000000) / 1000000);
    if (millions > 0) parts.push(convertGroup(millions) + (millions === 1 ? ' MILHÃO' : ' MILHÕES'));
  }
  if (intPart >= 1000) {
    const thousands = Math.floor((intPart % 1000000) / 1000);
    if (thousands > 0) parts.push((thousands === 1 ? '' : convertGroup(thousands) + ' ') + 'MIL');
  }
  const remainder = intPart % 1000;
  if (remainder > 0) parts.push(convertGroup(remainder));
  
  return `Total (${unit}): ` + (parts.join(' E ').replace(/\s+/g, ' ').trim()) + ' KWANZAS';
}

/** Date column. A date-only issueDate is midnight UTC, which prints as 01:00 in Angola. */
function documentIssueStamp(doc: ERPDocument): string {
  const datePart = String(doc.issueDate || '').slice(0, 10);
  const timePart = String(doc.issueTime || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && /^\d{2}:\d{2}(:\d{2})?$/.test(timePart)) {
    const [year, month, day] = datePart.split('-');
    const time = timePart.length === 5 ? `${timePart}:00` : timePart;
    return `${day}/${month}/${year} ${time}`;
  }
  const source = doc.createdAt || doc.issueDate;
  return source ? formatDateTime(source) : '';
}

// Group tax lines by rate for the tax summary table
function getTaxSummary(lines: DocumentLine[]): Array<{ rate: number; base: number; total: number }> {
  const map = new Map<number, { base: number; total: number }>();
  for (const line of lines) {
    const existing = map.get(line.taxRate) || { base: 0, total: 0 };
    const lineBase = line.quantity * line.unitPrice * (1 - line.discount / 100);
    existing.base += lineBase;
    existing.total += line.taxAmount;
    map.set(line.taxRate, existing);
  }
  return Array.from(map.entries()).map(([rate, data]) => ({ rate, ...data }));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isoDay(value: string | undefined): string {
  const raw = String(value || '').trim();
  const ymd = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd) return ymd[1];
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function issueClock(doc: ERPDocument): string {
  const time = String(doc.issueTime || '').trim();
  if (/^\d{2}:\d{2}/.test(time)) return time.length === 5 ? `${time}:00` : time.slice(0, 8);
  if (!doc.createdAt) return '';
  return formatDateTime(doc.createdAt).slice(11);
}

function taxDesignation(rate: number): string {
  if (rate <= 0) return 'ISENTO';
  if (rate === 5 || rate === 7) return 'CESTA BÁSICA';
  if (rate === 14) return 'NORMAL IVA';
  return `IVA ${rate.toFixed(0)}`;
}

function lineNet(line: DocumentLine): number {
  return Math.round((Number(line.lineTotal) - Number(line.taxAmount || 0)) * 100) / 100;
}

export function generateDocumentHTML(doc: ERPDocument, options: PDFOptions = {}): string {
  const config = DOCUMENT_TYPE_CONFIG[doc.documentType];
  const company = getCompanySettings();
  const taxSummary = getTaxSummary(doc.lines);
  const goodsTotal = Number(doc.subtotal) || 0;
  const discountTotal = Number(doc.totalDiscount) || 0;
  const netGoods = Math.round((goodsTotal - discountTotal) * 100) / 100;
  const isPurchaseDraft = doc.documentType === 'fatura_compra'
    && (doc.status === 'draft' || doc.status === 'pending');
  const copyLabels = isPurchaseDraft
    ? ['Rascunho']
    : doc.documentType === 'fatura_venda'
      ? ['Original', 'Duplicado'].slice(0, Math.max(1, options.copies ?? 2))
      : [doc.copyLabel || 'Original'];
  const refLabel = doc.entityType === 'supplier' ? 'FORNECEDOR V/REF' : 'CLIENTE V/REF';
  const country = options.customerCountry || 'AO';
  const banks = options.bankLines || [];

  const documentHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .sheet { min-height: 270mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .grow { flex: 1; }
  .head { display: flex; align-items: flex-start; gap: 12px; }
  .logo img { max-height: 78px; max-width: 130px; object-fit: contain; }
  .company { flex: 1; line-height: 1.35; }
  .company-name { font-size: 15px; font-weight: 800; text-transform: uppercase; margin-bottom: 2px; }
  .docno { text-align: right; min-width: 220px; padding-top: 6px; }
  .copy { margin-bottom: 12px; }
  .docno-line { font-weight: 700; font-size: 13px; }
  .party { display: flex; gap: 16px; margin-top: 16px; }
  .party-left { width: 42%; }
  .party-right { flex: 1; }
  .nota { margin-bottom: 14px; }
  .warehouse { font-weight: 700; margin-top: 8px; }
  .exmo { text-align: center; font-weight: 700; margin-bottom: 2px; }
  .who { font-weight: 700; }
  .meta { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .meta th, .meta td { border: none; border-bottom: 1px solid #111; text-align: left; padding: 2px 10px 3px 0; font-size: 11px; }
  .meta th { font-size: 10px; font-weight: 700; }
  .items { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .items th { border-bottom: 1px solid #111; font-size: 9px; text-align: left; padding: 3px 4px; }
  .items td { padding: 2px 4px; font-size: 10px; vertical-align: top; }
  .r { text-align: right; }
  .foot { margin-top: 8px; }
  .soft-row { display: flex; justify-content: space-between; gap: 12px; font-size: 8px; margin: 6px 0 4px; }
  .totals-wrap { display: flex; gap: 18px; align-items: flex-start; }
  .tax { flex: 1.15; }
  .sum { flex: 0.85; }
  .tax-title { font-weight: 800; font-size: 12px; margin-bottom: 2px; }
  .grid { width: 100%; border-collapse: collapse; }
  .grid th, .grid td { border: 1px solid #111; padding: 3px 5px; font-size: 10px; }
  .grid th { text-align: left; font-size: 9px; }
  .sum td:first-child { font-weight: 700; width: 46%; }
  .grand td { font-weight: 800; font-size: 12px; }
  .exempt { margin-top: 10px; border-bottom: 1px solid #111; font-weight: 700; min-height: 22px; }
  .qr { width: 28mm; height: 28mm; display: block; margin: 6px 0 0 auto; }
  .banks-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 14px; }
  .banks { font-size: 11px; line-height: 1.45; }
  .operator { border: 1px solid #111; padding: 6px 10px; min-width: 190px; }
  .goods { text-align: center; margin-top: 16px; font-size: 11px; }
  .draft-wrap { position: relative; }
  .draft-mark { position: absolute; inset: 40px 10px; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 20; overflow: hidden; }
  .draft-mark span { font-size: 64px; font-weight: 900; color: rgba(185,28,28,0.16); transform: rotate(-32deg); letter-spacing: 8px; text-transform: uppercase; white-space: nowrap; }
  .draft-banner { text-align: center; font-weight: 900; font-size: 12px; letter-spacing: 2px; color: #991b1b; border: 2px solid #991b1b; padding: 4px 8px; margin: 6px 0 10px; text-transform: uppercase; }
</style>
</head>
<body>
  ${isPurchaseDraft ? `
  <div class="draft-wrap">
  <div class="draft-mark"><span>RASCUNHO</span></div>
  <div class="draft-banner">RASCUNHO — não lançado em stock nem contabilidade</div>
  ` : ''}
  <!--SHEET_START-->
  <div class="sheet">
    <div class="head">
      <div class="logo">${company.logo ? `<img src="${company.logo}" alt="">` : ''}</div>
      <div class="company">
        <div class="company-name">${escapeHtml(company.name || company.tradeName || '')}</div>
        ${company.phone ? `<div>Tel: ${escapeHtml(company.phone)}</div>` : ''}
        ${company.email ? `<div>Email: ${escapeHtml(company.email)}</div>` : ''}
        ${company.website ? `<div>Website: ${escapeHtml(company.website)}</div>` : ''}
        <div>NIF: ${escapeHtml(company.nif || '')}</div>
        ${company.city ? `<div>${escapeHtml(company.city)}</div>` : ''}
      </div>
      <div class="docno">
        <div class="copy">___COPY_LABEL___</div>
        <div class="docno-line">${escapeHtml(config.label)} No : ${escapeHtml(doc.documentNumber)}</div>
      </div>
    </div>

    <div class="party">
      <div class="party-left">
        <div class="nota"><b>NOTA:</b> ${escapeHtml(doc.notes || '')}</div>
        ${doc.branchName ? `<div class="warehouse">ARMAZÉM: ${escapeHtml(doc.branchName)}</div>` : ''}
      </div>
      <div class="party-right">
        <div class="exmo">Exmo(s) Senhor(es)</div>
        <div class="who">${escapeHtml(doc.entityName || '')}</div>
        <div>NIF: ${escapeHtml(doc.entityNif || '')}</div>
        <div>ENDEREÇO: ${escapeHtml(doc.entityAddress || '')}</div>
        <div>TELE: ${escapeHtml(doc.entityPhone || '')}</div>
        <div>${escapeHtml(country)}</div>
      </div>
    </div>

    <table class="meta">
      <thead>
        <tr>
          <th>${refLabel}</th>
          <th>Hora</th>
          <th>DATA EMISSÃO</th>
          <th>DATA VENCIMENTO</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(printableEntityCode(doc))}</td>
          <td>${escapeHtml(issueClock(doc))}</td>
          <td>${escapeHtml(isoDay(doc.issueDate) || isoDay(doc.createdAt))}</td>
          <td>${escapeHtml(doc.dueDate ? isoDay(doc.dueDate) : '')}</td>
        </tr>
      </tbody>
    </table>

    <div class="grow">
      <table class="items">
        <thead>
          <tr>
            <th>REFERÊNCIA</th>
            <th>DESCRIÇÃO</th>
            <th class="r">QTD.</th>
            <th>UNI</th>
            <th class="r">P.UNIT</th>
            <th class="r">DESC.%</th>
            <th class="r">TAXA%</th>
            <th class="r">TOTAL</th>
            <th class="r">IVA VALOR</th>
          </tr>
        </thead>
        <tbody>
          ${doc.lines.map((line) => `
          <tr>
            <td>${escapeHtml(line.productSku || '')}</td>
            <td>${escapeHtml(line.description || '')}</td>
            <td class="r">${formatCurrency(line.quantity)}</td>
            <td>${escapeHtml(line.unit || 'UN')}</td>
            <td class="r">${formatCurrency(line.unitPrice)}</td>
            <td class="r">${formatCurrency(line.discount || 0)}</td>
            <td class="r">${formatCurrency(line.taxRate || 0)}</td>
            <td class="r">${formatCurrency(lineNet(line))}</td>
            <td class="r">${formatCurrency(line.taxAmount || 0)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="foot">
      <div class="soft-row">
        <span>${escapeHtml(softwareValidationFooter(options.softwareNumber || ''))}</span>
        <span>${escapeHtml(doc.saftHash || '')}</span>
      </div>
      <div class="totals-wrap">
        <div class="tax">
          <div class="tax-title">RESUMO DE IMPOSTOS</div>
          <table class="grid">
            <thead>
              <tr>
                <th>DESIGNAÇÃO</th>
                <th class="r">TAXA%</th>
                <th class="r">INCIDÊNCIA</th>
                <th class="r">IMPOSTO</th>
              </tr>
            </thead>
            <tbody>
              ${taxSummary.map((row) => `
              <tr>
                <td>${escapeHtml(taxDesignation(row.rate))}</td>
                <td class="r">${formatCurrency(row.rate)}</td>
                <td class="r">${formatCurrency(row.base)}</td>
                <td class="r">${formatCurrency(row.total)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="exempt">Motivo de Isenção</div>
        </div>
        <div class="sum">
          <table class="grid">
            <tr><td>VALOR</td><td class="r">${formatCurrency(goodsTotal)}</td></tr>
            <tr><td>DESCONTO</td><td class="r">${formatCurrency(discountTotal)}</td></tr>
            <tr><td>SUB TOTAL</td><td class="r">${formatCurrency(netGoods)}</td></tr>
            <tr><td>IMPOSTO</td><td class="r">${formatCurrency(doc.totalTax || 0)}</td></tr>
            <tr class="grand"><td>TOTAL</td><td class="r">KZ ${formatCurrency(doc.total || 0)}</td></tr>
          </table>
          ${options.showQR && options.qrCodeDataUrl ? `<img class="qr" src="${options.qrCodeDataUrl}" alt="QR AGT">` : ''}
        </div>
      </div>
      <div class="banks-row">
        <div class="banks">
          ${banks.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
        </div>
        <div class="operator">Operador: ${escapeHtml(doc.createdByName || '')}</div>
      </div>
      <div class="goods">Os bens/serviços foram colocados à disposição do adquirente na data de factura</div>
    </div>
  </div>
  <!--SHEET_END-->
  ${isPurchaseDraft ? '</div>' : ''}
</body>
</html>`;
  const start = documentHtml.indexOf('<!--SHEET_START-->');
  const end = documentHtml.indexOf('<!--SHEET_END-->');
  const sheet = documentHtml.slice(start + '<!--SHEET_START-->'.length, end);
  const sheets = copyLabels
    .map((label) => sheet.replace('___COPY_LABEL___', escapeHtml(label)))
    .join('');
  return documentHtml.slice(0, start) + sheets + documentHtml.slice(end + '<!--SHEET_END-->'.length);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeInternalId(value: string): boolean {
  const v = value.trim();
  return UUID_RE.test(v) || /^[0-9a-f]{32}$/i.test(v);
}

/** Customer/supplier account code. Never the database id. */
function printableEntityCode(doc: ERPDocument): string {
  const code = String(doc.entityCode || '').trim();
  if (code && !looksLikeInternalId(code)) return code;
  return '';
}

/** FE/398/AGT/2026 and 398/AGT/2026 both print as 398/AGT/2026. */
function printedSoftwareNumber(): string {
  const raw = String(getCompanySettings().agtCertificateNumber || '').trim();
  const match = raw.match(/(\d+)\/AGT\/(\d{4})/i);
  return match ? `${match[1]}/AGT/${match[2]}` : '';
}

function softwareValidationFooter(number: string): string {
  const version = String(getCompanySettings().softwareVersion || '').trim();
  const prefix = version ? `${version} - ` : '';
  const processed = number
    ? `Processado por programa validado n.º ${number}`
    : 'Processado por programa validado pela AGT';
  return `${prefix}${processed} - NEXOR ERP`;
}

let agtSoftwareNumberPromise: Promise<string> | null = null;

/** Company settings first, then the AGT configuration, normalized to NNN/AGT/YYYY. */
async function resolveSoftwareNumber(): Promise<string> {
  const fromCompany = printedSoftwareNumber();
  if (fromCompany) return fromCompany;
  if (!agtSoftwareNumberPromise) {
    agtSoftwareNumberPromise = import('@/lib/api/client').then(async ({ api }) => {
      const res = await api.agt.getConfig();
      const raw = String(res.data?.softwareCertificateNumber || '');
      const match = raw.match(/(\d+)\/AGT\/(\d{4})/i);
      return match ? `${match[1]}/AGT/${match[2]}` : '';
    }).catch((err) => {
      agtSoftwareNumberPromise = null;
      console.warn('[documentPDF] software number lookup skipped:', err);
      return '';
    });
  }
  return agtSoftwareNumberPromise;
}

function nifDigits(value: string | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

let chartRowsPromise: Promise<Array<Record<string, unknown>>> | null = null;

function loadChartRows(): Promise<Array<Record<string, unknown>>> {
  if (!chartRowsPromise) {
    chartRowsPromise = import('@/lib/api/client').then(async ({ api }) => {
      const res = await api.chartOfAccounts.list();
      if (res.error || !Array.isArray(res.data)) {
        throw new Error(res.error || 'chart unavailable');
      }
      return res.data as Array<Record<string, unknown>>;
    }).catch((err) => {
      chartRowsPromise = null;
      throw err;
    });
  }
  return chartRowsPromise;
}

function matchEntityAccount(rows: Array<Record<string, unknown>>, doc: ERPDocument): string {
  const prefix = doc.entityType === 'supplier' ? '32' : doc.entityType === 'customer' ? '31' : '';
  if (!prefix) return '';
  const nif = nifDigits(doc.entityNif);
  const name = String(doc.entityName || '').trim().toLowerCase();
  if (!nif && (!name || name === 'consumidor final')) return '';
  let byName = '';
  for (const row of rows) {
    const code = String(row.code || '').trim();
    if (!/^\d{8}$/.test(code) || !code.startsWith(prefix) || row.is_header) continue;
    const description = String(row.description || '');
    const rowNif = nifDigits((description.match(/NIF:\s*([^\s]+)/i) || [])[1] || '');
    if (nif && rowNif && rowNif === nif) return code;
    if (!byName && name && name !== 'consumidor final' && String(row.name || '').trim().toLowerCase() === name) {
      byName = code;
    }
  }
  return byName;
}

let clientRowsPromise: Promise<Array<Record<string, unknown>>> | null = null;
let bankRowsPromise: Promise<Array<Record<string, unknown>>> | null = null;

function loadClientRows(): Promise<Array<Record<string, unknown>>> {
  if (!clientRowsPromise) {
    clientRowsPromise = import('@/lib/api/client').then(async ({ api }) => {
      const res = await api.clients.list();
      if (res.error || !Array.isArray(res.data)) throw new Error(res.error || 'clients unavailable');
      return res.data as Array<Record<string, unknown>>;
    }).catch((err) => {
      clientRowsPromise = null;
      throw err;
    });
  }
  return clientRowsPromise;
}

function loadBankRows(): Promise<Array<Record<string, unknown>>> {
  if (!bankRowsPromise) {
    bankRowsPromise = import('@/lib/api/client').then(async ({ api }) => {
      const res = await api.bankAccounts.list();
      if (res.error || !Array.isArray(res.data)) throw new Error(res.error || 'banks unavailable');
      return res.data as Array<Record<string, unknown>>;
    }).catch((err) => {
      bankRowsPromise = null;
      throw err;
    });
  }
  return bankRowsPromise;
}

function textOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function countryCode(value: string): string {
  const raw = value.trim();
  if (!raw || raw.toLowerCase() === 'angola') return 'AO';
  return raw;
}

function matchClient(rows: Array<Record<string, unknown>>, doc: ERPDocument): Record<string, unknown> | undefined {
  const id = String(doc.entityId || '').trim();
  const nif = nifDigits(doc.entityNif);
  if (id) {
    const byId = rows.find((row) => String(row.id || '') === id);
    if (byId) return byId;
  }
  if (!nif) return undefined;
  return rows.find((row) => nifDigits(textOf(row, 'nif')) === nif);
}

function bankLine(row: Record<string, unknown>): string {
  return [
    textOf(row, 'bankName', 'bank_name', 'bank'),
    textOf(row, 'accountNumber', 'account_number', 'account'),
    textOf(row, 'iban'),
  ].filter(Boolean).join(' - ');
}

interface PreparedPrint {
  doc: ERPDocument;
  bankLines: string[];
  customerCountry: string;
}

/** Account code, customer address, and the bank lines the invoice prints. */
async function preparePrintedDocument(doc: ERPDocument): Promise<PreparedPrint> {
  let next = doc;
  if (!printableEntityCode(next)) {
    try {
      const code = matchEntityAccount(await loadChartRows(), next);
      if (code) next = { ...next, entityCode: code };
    } catch (err) {
      console.warn('[documentPDF] customer account lookup skipped:', err);
    }
  }

  let customerCountry = 'AO';
  try {
    const client = matchClient(await loadClientRows(), next);
    if (client) {
      const address = [textOf(client, 'address'), textOf(client, 'city')].filter(Boolean).join(', ');
      customerCountry = countryCode(textOf(client, 'country'));
      next = {
        ...next,
        entityAddress: next.entityAddress || address,
        entityPhone: next.entityPhone || textOf(client, 'phone'),
      };
    }
  } catch (err) {
    console.warn('[documentPDF] customer details lookup skipped:', err);
  }

  const fromDoc = (next.bankDetails || []).map((bank) => bankLine(bank as unknown as Record<string, unknown>)).filter(Boolean);
  let bankLines = fromDoc;
  if (bankLines.length === 0) {
    try {
      const rows = await loadBankRows();
      bankLines = rows
        .filter((row) => {
          const flag = row.is_active ?? row.isActive;
          if (flag === undefined || flag === null || flag === '') return true;
          return flag === true || flag === 1 || flag === '1' || flag === 't';
        })
        .map(bankLine)
        .filter(Boolean);
    } catch (err) {
      console.warn('[documentPDF] bank lookup skipped:', err);
    }
  }
  if (bankLines.length === 0) {
    const company = getCompanySettings();
    const line = [company.bankName, company.iban].filter(Boolean).join(' - ');
    if (line) bankLines = [line];
  }

  return { doc: next, bankLines, customerCountry };
}

async function documentQrDataUrl(doc: ERPDocument): Promise<string> {
  const fiscal = doc.documentType === 'fatura_venda'
    || doc.documentType === 'nota_credito'
    || doc.documentType === 'nota_debito';
  if (!fiscal || !doc.documentNumber) return '';
  try {
    const { generateAGTQRCodeDataURL } = await import('@/lib/agtQRCode');
    const net = Math.round((Number(doc.subtotal) - Number(doc.totalDiscount || 0)) * 100) / 100;
    const rawType = String(doc.invoiceType || '').toUpperCase();
    const invoiceType = (['FT', 'FR', 'FS', 'TV'].includes(rawType) ? rawType : undefined) as Sale['invoiceType'];
    const sale = {
      id: doc.id,
      invoiceNumber: doc.documentNumber,
      branchId: doc.branchId,
      cashierId: doc.createdBy || '',
      items: [],
      subtotal: net,
      taxAmount: doc.totalTax,
      discount: doc.totalDiscount,
      total: doc.total,
      paymentMethod: doc.paymentMethod === 'cheque' ? 'transfer' : (doc.paymentMethod || 'cash'),
      amountPaid: doc.amountPaid,
      change: 0,
      customerNif: doc.entityNif,
      customerName: doc.entityName,
      status: 'completed',
      invoiceType,
      saftHash: doc.saftHash,
      agtCode: doc.agtCode,
      createdAt: doc.createdAt,
    } as Sale;
    return await generateAGTQRCodeDataURL(sale);
  } catch (err) {
    console.warn('[documentPDF] QR skipped:', err);
    return '';
  }
}

// Open system print dialog for the document (Electron or browser)
export async function printDocument(doc: ERPDocument, options: PDFOptions = {}) {
  const { source = 'invoices', reprint, showQR, showTerms, copies } = options;
  const [prepared, softwareNumber] = await Promise.all([
    preparePrintedDocument(doc),
    resolveSoftwareNumber(),
  ]);
  const wantQr = showQR ?? true;
  const qrCodeDataUrl = wantQr ? await documentQrDataUrl(prepared.doc) : '';
  const html = generateDocumentHTML(prepared.doc, {
    showQR: wantQr,
    showTerms,
    copies,
    qrCodeDataUrl,
    softwareNumber,
    bankLines: prepared.bankLines,
    customerCountry: prepared.customerCountry,
  });
  await printHtml(html);
  void recordDocumentPrint(prepared.doc, { format: 'a4', source, reprint });
}

// Download as HTML (can be opened and printed to PDF)
export async function downloadDocumentHTML(doc: ERPDocument) {
  const [prepared, softwareNumber] = await Promise.all([
    preparePrintedDocument(doc),
    resolveSoftwareNumber(),
  ]);
  const qrCodeDataUrl = await documentQrDataUrl(prepared.doc);
  const html = generateDocumentHTML(prepared.doc, {
    showQR: true,
    showTerms: true,
    qrCodeDataUrl,
    softwareNumber,
    bankLines: prepared.bankLines,
    customerCountry: prepared.customerCountry,
  });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.documentNumber}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
