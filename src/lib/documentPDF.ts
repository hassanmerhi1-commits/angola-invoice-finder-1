// NEXOR ERP - A4 Document PDF Generator
// Angolan-standard professional invoice layout matching AGT requirements

import { ERPDocument, DOCUMENT_TYPE_CONFIG, DocumentLine } from '@/types/documents';
import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';
import { recordDocumentPrint, type PrintSource } from '@/lib/recordPrintAudit';

interface PDFOptions {
  showQR?: boolean;
  showTerms?: boolean;
  copies?: number;
  source?: PrintSource;
  reprint?: boolean;
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

function numberToWords(num: number): string {
  if (num === 0) return 'ZERO KWANZAS';
  
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
  
  return 'Total (AKZ): ' + (parts.join(' E ').replace(/\s+/g, ' ').trim()) + ' KWANZAS';
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

export function generateDocumentHTML(doc: ERPDocument, options: PDFOptions = {}): string {
  const config = DOCUMENT_TYPE_CONFIG[doc.documentType];
  const company = getCompanySettings();
  const entityLabel = config.entityType === 'customer' ? 'Cliente' : 'Fornecedor';
  const taxSummary = getTaxSummary(doc.lines);
  const goodsTotal = doc.subtotal;
  const copyLabel = doc.copyLabel || 'Original';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 12mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #333; line-height: 1.35; background: #fff; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  
  /* Page number */
  .page-info { text-align: right; font-size: 8px; color: #666; margin-bottom: 4px; }
  
  /* Header */
  .header { margin-bottom: 14px; }
  .company-block { margin-bottom: 6px; }
  .company-name { font-size: 16px; font-weight: 700; color: #2d7d2d; }
  .company-detail { font-size: 8px; color: #555; line-height: 1.5; }
  .company-detail span { color: #2d7d2d; }
  
  /* Customer block */
  .customer-block { text-align: right; margin-bottom: 10px; }
  .customer-title { font-size: 9px; color: #555; }
  .customer-name { font-size: 11px; font-weight: 700; color: #333; }
  .customer-address { font-size: 9px; color: #555; }
  
  /* Document title */
  .doc-title-section { margin-bottom: 10px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
  .doc-title { font-size: 14px; font-weight: 700; color: #333; }
  .doc-sub { font-size: 9px; color: #666; margin-top: 2px; }
  .copy-label { float: right; font-size: 10px; font-weight: 700; color: #2d7d2d; font-style: italic; }
  
  /* Entity info row */
  .entity-row { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  .entity-row th { background: #2d7d2d; color: white; padding: 3px 5px; font-size: 7px; text-transform: uppercase; font-weight: 600; text-align: left; letter-spacing: 0.3px; }
  .entity-row td { padding: 3px 5px; font-size: 8px; border: 1px solid #ddd; background: #fafafa; }
  
  /* Line items table */
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .items-table th { background: #2d7d2d; color: white; padding: 4px 5px; font-size: 7px; text-transform: uppercase; font-weight: 600; text-align: left; letter-spacing: 0.3px; }
  .items-table th.r { text-align: right; }
  .items-table td { padding: 3px 5px; font-size: 8px; border-bottom: 1px solid #eee; }
  .items-table td.r { text-align: right; font-family: 'Courier New', monospace; }
  .items-table tr:nth-child(even) { background: #f9f9f9; }
  
  /* Transport / notes */
  .transport-info { font-size: 8px; color: #555; margin-bottom: 10px; padding: 4px 0; }
  
  /* UAP line */
  .uap-line { font-size: 6.5px; color: #888; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 4px 0; margin-bottom: 8px; }
  
  /* Bottom section - tax summary + totals side by side */
  .bottom-section { display: flex; gap: 12px; margin-bottom: 10px; }
  .bottom-left { flex: 1; }
  .bottom-right { width: 240px; }
  
  /* Tax summary table */
  .tax-summary { width: 100%; border-collapse: collapse; font-size: 8px; }
  .tax-summary th { background: #f0f0f0; padding: 3px 5px; text-align: left; font-size: 7px; text-transform: uppercase; border: 1px solid #ccc; }
  .tax-summary td { padding: 3px 5px; border: 1px solid #ddd; }
  .tax-summary td.r { text-align: right; font-family: 'Courier New', monospace; }
  .tax-summary-title { font-size: 7px; font-weight: 700; margin-bottom: 3px; padding: 2px 4px; background: #e8e8e8; border: 1px solid #ccc; }
  
  /* Totals on right */
  .totals-table { width: 100%; border-collapse: collapse; font-size: 8px; }
  .totals-table td { padding: 2px 5px; }
  .totals-table td.label { text-align: left; color: #555; }
  .totals-table td.value { text-align: right; font-family: 'Courier New', monospace; }
  .totals-table tr.grand-total { border-top: 2px solid #2d7d2d; }
  .totals-table tr.grand-total td { font-size: 12px; font-weight: 800; padding-top: 6px; color: #2d7d2d; }
  
  /* QR code */
  .qr-placeholder { width: 90px; height: 90px; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center; font-size: 7px; color: #999; margin: 4px auto 0; }
  
  /* Shipping section */
  .shipping-section { margin-bottom: 10px; }
  .shipping-table { width: 100%; border-collapse: collapse; font-size: 8px; }
  .shipping-table th { background: #f0f0f0; padding: 3px 6px; text-align: left; font-size: 7px; text-transform: uppercase; border: 1px solid #ccc; font-weight: 600; }
  .shipping-table td { padding: 3px 6px; border: 1px solid #ddd; font-size: 8px; }
  
  /* Bank details */
  .bank-section { margin-bottom: 10px; }
  .bank-table { width: 100%; border-collapse: collapse; font-size: 8px; }
  .bank-table th { background: #f0f0f0; padding: 3px 6px; text-align: left; font-size: 7px; text-transform: uppercase; border: 1px solid #ccc; font-weight: 600; }
  .bank-table td { padding: 3px 6px; border: 1px solid #ddd; font-size: 8px; }
  
  /* Total in words */
  .total-words { font-size: 8px; font-weight: 600; color: #333; margin-top: 8px; padding: 4px 0; border-top: 1px solid #ccc; }
  
  /* Document hash / audit */
  .audit-line { font-size: 7px; color: #999; text-align: right; margin-top: 4px; }
</style>
</head>
<body>
  <!-- PAGE INFO -->
  <div class="page-info">Pág. 1/1</div>
  
  <!-- HEADER -->
  <div class="header">
    <div class="company-block">
      <div class="company-name">${company.name || company.tradeName || 'NEXOR ERP'}</div>
      ${company.logo ? `<div style="margin-bottom: 4px;"><img src="${company.logo}" alt="Logo" style="max-height: 50px; max-width: 160px; object-fit: contain;"></div>` : ''}
      <div class="company-detail">
        <span>Contribuinte N.º:</span> ${company.nif || ''}<br>
        ${company.address ? `${company.address}<br>` : ''}
        ${company.city ? `${company.city}<br>` : ''}
        ${company.phone ? `Telef. ${company.phone} |<br>` : ''}
        ${company.email || ''}
      </div>
    </div>
    
    <!-- CUSTOMER / SUPPLIER -->
    <div class="customer-block">
      <div class="customer-title">Exmo.(s) Sr.(s)</div>
      <div class="customer-name">${doc.entityName}</div>
      ${doc.entityAddress ? `<div class="customer-address">${doc.entityAddress}</div>` : ''}
    </div>
  </div>
  
  <!-- DOCUMENT TITLE -->
  <div class="doc-title-section">
    <span class="copy-label">${copyLabel}</span>
    <div class="doc-title">${config.label} ${doc.documentNumber}</div>
    <div class="doc-sub">${config.label} ${doc.documentNumber}</div>
  </div>
  
  <!-- ENTITY INFO ROW -->
  <table class="entity-row">
    <thead>
      <tr>
        <th>Entidade</th>
        <th>Contribuinte</th>
        <th>Requisição</th>
        <th>Moeda</th>
        <th>Data</th>
        <th>Vencimento</th>
        <th>Desc. Comercial</th>
        <th>Desc. Financeiro</th>
        <th>Condição Pagamento</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${doc.entityCode || doc.entityId || ''}</td>
        <td>${doc.entityNif || ''}</td>
        <td>${doc.requisition || ''}</td>
        <td>${doc.currency || 'AKZ'}</td>
        <td>${formatDateTime(doc.issueDate)}</td>
        <td>${doc.dueDate ? formatDate(doc.dueDate) : ''}</td>
        <td class="r">${formatCurrency(doc.totalDiscount)}</td>
        <td class="r">0,00</td>
        <td>${doc.paymentCondition || ''}</td>
      </tr>
    </tbody>
  </table>
  
  <!-- LINE ITEMS -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:55px">Artigo</th>
        <th>Descrição</th>
        <th class="r" style="width:50px">Qtd.</th>
        <th class="r" style="width:35px">Un.</th>
        <th class="r" style="width:75px">Pr. Unitário</th>
        <th class="r" style="width:40px">Desc.</th>
        <th class="r" style="width:35px">IVA</th>
        <th class="r" style="width:85px">Valor</th>
      </tr>
    </thead>
    <tbody>
      ${doc.lines.map(line => `
      <tr>
        <td>${line.productSku || ''}</td>
        <td>${line.description}</td>
        <td class="r">${formatCurrency(line.quantity)}</td>
        <td class="r">${line.unit || 'UN'}</td>
        <td class="r">${formatCurrency(line.unitPrice)}</td>
        <td class="r">${line.discount > 0 ? formatCurrency(line.discount) : '0,00'}</td>
        <td class="r">${line.taxRate.toFixed(0)},00</td>
        <td class="r">${formatCurrency(line.lineTotal)}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  
  <!-- TRANSPORT REFERENCES -->
  ${doc.transportRef ? `<div class="transport-info">${doc.transportRef}</div>` : ''}
  
  <!-- UAP SOFTWARE LINE -->
  <div class="uap-line">
    UAP→Processado por programa validado n.º 41/AGT/2019 | Os bens e/ou serviços foram colocados à disposição na data ${formatDateTime(doc.createdAt)} / ©
  </div>
  
  <!-- BOTTOM: TAX SUMMARY + QR + TOTALS -->
  <div class="bottom-section">
    <div class="bottom-left">
      <div class="tax-summary-title">Quadro Resumo de Impostos (IVA Incluído à Taxa)</div>
      <table class="tax-summary">
        <thead>
          <tr>
            <th>Taxa/Valor</th>
            <th>Incid./Qtd.</th>
            <th>Total</th>
            <th>Motivo Isenção</th>
          </tr>
        </thead>
        <tbody>
          ${taxSummary.map(t => `
          <tr>
            <td>IVA (${t.rate.toFixed(0)},00)</td>
            <td class="r">${formatCurrency(t.base)}</td>
            <td class="r">${formatCurrency(t.total)}</td>
            <td></td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      
      ${options.showQR ? `<div class="qr-placeholder">QR AGT</div>` : ''}
    </div>
    
    <div class="bottom-right">
      <table class="totals-table">
        <tr><td class="label">Mercadoria/Serviços</td><td class="value">${formatCurrency(goodsTotal)}</td></tr>
        <tr><td class="label">Desconto Comercial</td><td class="value">${formatCurrency(doc.totalDiscount)}</td></tr>
        <tr><td class="label">Desconto Adicional</td><td class="value">0,00</td></tr>
        <tr><td class="label">Outros Serviços</td><td class="value">0,00</td></tr>
        <tr><td class="label">Adiantamentos</td><td class="value">0,00</td></tr>
        <tr><td class="label">IVA</td><td class="value">${formatCurrency(doc.totalTax)}</td></tr>
        <tr><td class="label">Acerto</td><td class="value">0,00</td></tr>
        <tr class="grand-total">
          <td class="label">Total ( ${doc.currency || 'AKZ'} )</td>
          <td class="value">${formatCurrency(doc.total)}</td>
        </tr>
      </table>
    </div>
  </div>
  
  <!-- SHIPPING / CARGA & DESCARGA -->
  ${(doc.loadAddress || doc.unloadAddress) ? `
  <div class="shipping-section">
    <table class="shipping-table">
      <thead>
        <tr>
          <th style="width:50%">Carga</th>
          <th style="width:50%">Descarga</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            ${doc.loadAddress ? `N/ Morada - ${doc.loadDate ? formatDateTime(doc.loadDate) : ''}<br>${doc.loadAddress}` : ''}
          </td>
          <td>${doc.unloadAddress || 'V/ Morada'}</td>
        </tr>
      </tbody>
    </table>
  </div>
  ` : ''}
  
  <!-- BANK DETAILS -->
  ${doc.bankDetails && doc.bankDetails.length > 0 ? `
  <div class="bank-section">
    <table class="bank-table">
      <thead>
        <tr>
          <th>Banco</th>
          <th>Conta</th>
          <th>IBAN</th>
        </tr>
      </thead>
      <tbody>
        ${doc.bankDetails.map(b => `
        <tr>
          <td>${b.bank}</td>
          <td>${b.account}</td>
          <td>${b.iban}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  
  <!-- TOTAL IN WORDS -->
  <div class="total-words">${numberToWords(doc.total)}</div>
  
  <!-- AUDIT LINE -->
  <div class="audit-line">
    ${doc.saftHash ? doc.saftHash : ''} &nbsp;&nbsp; ${formatDateTime(doc.createdAt)}
  </div>
</body>
</html>`;
}

// Open system print dialog for the document (Electron or browser)
export async function printDocument(doc: ERPDocument, options: PDFOptions = {}) {
  const { source = 'invoices', reprint, showQR, showTerms, copies } = options;
  const html = generateDocumentHTML(doc, { showQR: showQR ?? true, showTerms, copies });
  await printHtml(html);
  void recordDocumentPrint(doc, { format: 'a4', source, reprint });
}

// Download as HTML (can be opened and printed to PDF)
export function downloadDocumentHTML(doc: ERPDocument) {
  const html = generateDocumentHTML(doc, { showQR: true, showTerms: true });
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.documentNumber}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
