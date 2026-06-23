/**
 * A4 Invoice Printer for NEXOR ERP
 * Generates professional A4 invoices with company branding and AGT QR code
 */

import { Sale, Branch } from '@/types/erp';
import { getCompanySettings, CompanySettings } from './companySettings';
import { buildAGTQRCodeString, saleToAGTQRData, getInvoiceHash } from './agtQRCode';
import { normalizeTaxRate } from './taxUtils';

export interface A4InvoiceOptions {
  showBankDetails?: boolean;
  showNotes?: boolean;
  copies?: number;
  documentType?: 'FT' | 'FR' | 'FS' | 'NC' | 'ND' | 'OR'; // Factura, Factura-Recibo, Fatura Simplificada, ...
}

const documentTypeNames: Record<string, string> = {
  FT: 'FACTURA',
  FR: 'FACTURA-RECIBO',
  FS: 'FACTURA SIMPLIFICADA',
  NC: 'NOTA DE CRÉDITO',
  ND: 'NOTA DE DÉBITO',
  OR: 'ORÇAMENTO',
};

export async function generateA4InvoiceHTML(
  sale: Sale,
  branch: Branch,
  options: A4InvoiceOptions & { qrCodeDataURL?: string } = {}
): Promise<string> {
  const company = getCompanySettings();
  const {
    showBankDetails = true,
    showNotes = true,
    documentType = 'FR',
    qrCodeDataURL,
  } = options;

  const qrData = saleToAGTQRData(sale, branch);
  const hash = getInvoiceHash(sale);
  
  const formatMoney = (value: number) => {
    return value.toLocaleString('pt-AO', { minimumFractionDigits: 2 });
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('pt-AO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString('pt-AO', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Numerário',
    card: 'Cartão',
    transfer: 'Transferência Bancária',
    mixed: 'Misto',
  };

  return `
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentTypeNames[documentType]} - ${sale.invoiceNumber}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #1a1a1a;
      background: white;
    }
    
    .invoice {
      width: 210mm;
      min-height: 297mm;
      padding: 15mm;
      background: white;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid ${company.primaryColor || '#2563eb'};
    }
    
    .company-info {
      flex: 1;
    }
    
    .company-logo {
      max-width: ${company.logoWidth || 150}px;
      max-height: 80px;
      object-fit: contain;
      margin-bottom: 10px;
    }
    
    .company-name {
      font-size: 18px;
      font-weight: bold;
      color: ${company.primaryColor || '#2563eb'};
      margin-bottom: 5px;
    }
    
    .company-details {
      font-size: 10px;
      color: #666;
      line-height: 1.5;
    }
    
    .document-info {
      text-align: right;
    }
    
    .document-type {
      font-size: 24px;
      font-weight: bold;
      color: ${company.primaryColor || '#2563eb'};
      margin-bottom: 10px;
    }
    
    .document-number {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .document-date {
      font-size: 11px;
      color: #666;
    }
    
    /* Customer Section */
    .parties {
      display: flex;
      gap: 30px;
      margin-bottom: 25px;
    }
    
    .party-box {
      flex: 1;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 5px;
      border-left: 3px solid ${company.primaryColor || '#2563eb'};
    }
    
    .party-label {
      font-size: 9px;
      text-transform: uppercase;
      color: #888;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    
    .party-name {
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .party-details {
      font-size: 10px;
      color: #555;
    }
    
    /* Items Table */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 25px;
    }
    
    .items-table th {
      background: ${company.primaryColor || '#2563eb'};
      color: white;
      padding: 10px 8px;
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .items-table th:nth-child(n+3) {
      text-align: right;
    }
    
    .items-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #e0e0e0;
      vertical-align: top;
    }
    
    .items-table td:nth-child(n+3) {
      text-align: right;
    }
    
    .item-name {
      font-weight: 500;
    }
    
    .item-sku {
      font-size: 9px;
      color: #888;
    }
    
    .items-table tbody tr:hover {
      background: #fafafa;
    }
    
    /* Totals */
    .totals-section {
      display: flex;
      justify-content: space-between;
      gap: 30px;
    }
    
    .payment-info {
      flex: 1;
    }
    
    .payment-box {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
    }
    
    .payment-label {
      font-size: 9px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 5px;
    }
    
    .payment-value {
      font-size: 12px;
      font-weight: 500;
    }
    
    .totals-box {
      width: 250px;
    }
    
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .total-row:last-child {
      border-bottom: none;
    }
    
    .total-row.grand-total {
      background: ${company.primaryColor || '#2563eb'};
      color: white;
      padding: 12px 10px;
      margin-top: 5px;
      border-radius: 5px;
      font-size: 14px;
      font-weight: bold;
    }
    
    /* QR Code Section */
    .qr-section {
      display: flex;
      align-items: flex-start;
      gap: 20px;
      margin-top: 25px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 5px;
    }
    
    .qr-code {
      flex-shrink: 0;
    }
    
    .qr-info {
      flex: 1;
      font-size: 9px;
      color: #666;
    }
    
    .qr-info p {
      margin-bottom: 3px;
    }
    
    .qr-info .hash {
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      color: #333;
    }
    
    /* Notes & Bank Details */
    .footer-section {
      margin-top: 25px;
      display: flex;
      gap: 30px;
    }
    
    .notes-box, .bank-box {
      flex: 1;
      font-size: 9px;
    }
    
    .section-label {
      font-size: 9px;
      text-transform: uppercase;
      color: #888;
      letter-spacing: 1px;
      margin-bottom: 8px;
      font-weight: bold;
    }
    
    /* Document Footer */
    .document-footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 9px;
      color: #888;
    }
    
    .document-footer p {
      margin-bottom: 3px;
    }
    
    .software-info {
      margin-top: 10px;
      font-size: 8px;
    }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .invoice { margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <!-- Header -->
    <div class="header">
      <div class="company-info">
        ${company.logo ? `<img src="${company.logo}" alt="Logo" class="company-logo">` : ''}
        <div class="company-name">${company.name}</div>
        <div class="company-details">
          ${company.tradeName ? `<div>${company.tradeName}</div>` : ''}
          <div>${company.address}</div>
          <div>${company.city}${company.province ? `, ${company.province}` : ''} - ${company.country}</div>
          <div>Tel: ${company.phone}${company.email ? ` | Email: ${company.email}` : ''}</div>
          <div><strong>NIF: ${company.nif}</strong></div>
        </div>
      </div>
      <div class="document-info">
        <div class="document-type">${documentTypeNames[documentType]}</div>
        <div class="document-number">${sale.invoiceNumber}</div>
        <div class="document-date">
          Data: ${formatDate(sale.createdAt)}<br>
          Hora: ${new Date(sale.createdAt).toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div style="font-size:10px;color:#666;margin-top:5px;">Original</div>
      </div>
    </div>

    <!-- Parties -->
    <div class="parties">
      <div class="party-box">
        <div class="party-label">Vendedor</div>
        <div class="party-name">${branch.name}</div>
        <div class="party-details">
          ${branch.address}<br>
          Tel: ${branch.phone}
        </div>
      </div>
      <div class="party-box">
        <div class="party-label">Cliente</div>
        <div class="party-name">${sale.customerName || 'Consumidor Final'}</div>
        <div class="party-details">
          NIF: ${sale.customerNif || '999999990'}
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 32%">Descrição</th>
          <th style="width: 8%">Qtd</th>
          <th style="width: 14%">Preço Unit. (s/IVA)</th>
          <th style="width: 14%">Base Tributável</th>
          <th style="width: 8%">IVA%</th>
          <th style="width: 12%">Valor IVA</th>
          <th style="width: 12%">Total c/IVA</th>
        </tr>
      </thead>
      <tbody>
        ${sale.items.map(item => {
          const itemTaxRate = normalizeTaxRate((item as any).taxRate);
          const basePrice = item.unitPrice;
          const baseTributavel = item.subtotal / (1 + itemTaxRate / 100);
          const taxAmount = item.subtotal - baseTributavel;
          return `
          <tr>
            <td>
              <div class="item-name">${item.productName}</div>
              <div class="item-sku">Ref: ${item.productId.slice(0, 8).toUpperCase()}</div>
            </td>
            <td>${item.quantity}</td>
            <td>${formatMoney(basePrice)} Kz</td>
            <td>${formatMoney(baseTributavel)} Kz</td>
            <td>${itemTaxRate}%</td>
            <td>${formatMoney(taxAmount)} Kz</td>
            <td><strong>${formatMoney(item.subtotal)} Kz</strong></td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>

    <!-- Quadro Resumo de Impostos (AGT) -->
    <table class="items-table" style="margin-bottom: 15px; font-size: 10px;">
      <thead>
        <tr>
          <th colspan="2">Quadro Resumo de Impostos</th>
          <th>Base Incidência</th>
          <th>Taxa</th>
          <th>Valor IVA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${(() => {
          const taxMap = new Map<number, { base: number; iva: number; total: number }>();
          sale.items.forEach(item => {
            const rate = normalizeTaxRate((item as any).taxRate);
            const total = item.subtotal;
            const base = total / (1 + rate / 100);
            const iva = total - base;
            const existing = taxMap.get(rate) || { base: 0, iva: 0, total: 0 };
            existing.base += base;
            existing.iva += iva;
            existing.total += total;
            taxMap.set(rate, existing);
          });
          return Array.from(taxMap.entries()).sort((a, b) => a[0] - b[0]).map(([rate, vals]) => `
            <tr>
              <td colspan="2">${rate === 0 ? 'Isento' : 'IVA ' + rate + '%'}</td>
              <td>${formatMoney(vals.base)} Kz</td>
              <td>${rate}%</td>
              <td>${formatMoney(vals.iva)} Kz</td>
              <td><strong>${formatMoney(vals.total)} Kz</strong></td>
            </tr>
          `).join('');
        })()}
      </tbody>
    </table>

    <!-- Totals Section -->
    <div class="totals-section">
      <div class="payment-info">
        <div class="payment-box">
          <div class="payment-label">Forma de Pagamento</div>
          <div class="payment-value">${paymentMethodLabels[sale.paymentMethod]}</div>
        </div>
        ${sale.paymentMethod === 'cash' && sale.change > 0 ? `
        <div class="payment-box" style="margin-top: 10px;">
          <div style="display: flex; justify-content: space-between;">
            <div>
              <div class="payment-label">Valor Recebido</div>
              <div class="payment-value">${formatMoney(sale.amountPaid)} Kz</div>
            </div>
            <div>
              <div class="payment-label">Troco</div>
              <div class="payment-value">${formatMoney(sale.change)} Kz</div>
            </div>
          </div>
        </div>
        ` : ''}
      </div>
      
      <div class="totals-box">
        <div class="total-row">
          <span>Subtotal (s/ IVA):</span>
          <span>${formatMoney(sale.subtotal + (sale.discount || 0))} Kz</span>
        </div>
        ${sale.discount > 0 ? `
        <div class="total-row" style="color: #dc2626;">
          <span>Desconto:</span>
          <span>-${formatMoney(sale.discount)} Kz</span>
        </div>
        ` : ''}
        <div class="total-row">
          <span>Total IVA:</span>
          <span>${formatMoney(sale.taxAmount)} Kz</span>
        </div>
        <div class="total-row grand-total">
          <span>TOTAL A PAGAR (c/ IVA):</span>
          <span>${formatMoney(sale.total)} Kz</span>
        </div>
        ${(() => {
          const usdRate = company.exchangeRateUSD;
          const eurRate = company.exchangeRateEUR;
          if (!usdRate && !eurRate) return '';
          const lines: string[] = [];
          if (usdRate && usdRate > 0) {
            lines.push(`<div class="total-row" style="font-size:10px;color:#555;"><span>Equivalente USD (1 USD = ${formatMoney(usdRate)} Kz):</span><span>$ ${(sale.total / usdRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`);
          }
          if (eurRate && eurRate > 0) {
            lines.push(`<div class="total-row" style="font-size:10px;color:#555;"><span>Equivalente EUR (1 EUR = ${formatMoney(eurRate)} Kz):</span><span>€ ${(sale.total / eurRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`);
          }
          return lines.join('');
        })()}
      </div>
    </div>

    <!-- QR Code Section -->
    <div class="qr-section">
      <div class="qr-code">
        ${qrCodeDataURL ? `<img src="${qrCodeDataURL}" alt="AGT QR Code" style="width: 100px; height: 100px;">` : '<div style="width:100px;height:100px;background:#eee;display:flex;align-items:center;justify-content:center;font-size:10px;color:#888;">QR Code</div>'}
      </div>
      <div class="qr-info">
        <p><strong>Informação Fiscal (AGT)</strong></p>
        <p class="hash">Hash: ${hash}</p>
        <p>ATCUD: ${qrData.atcud}</p>
        <p>NIF Emissor: ${company.nif}</p>
        <p>Tipo de Documento: ${documentType} (${documentTypeNames[documentType]})</p>
        ${sale.agtCode ? `<p>CUCE: ${sale.agtCode}</p>` : ''}
        <p style="margin-top: 8px; color: #888;">
          Documento processado por programa certificado pela AGT nº ${company.agtCertificateNumber || 'N/A'}
        </p>
      </div>
    </div>

    <!-- Notes & Bank Details -->
    ${showNotes || showBankDetails ? `
    <div class="footer-section">
      ${showNotes && company.invoiceNotes ? `
      <div class="notes-box">
        <div class="section-label">Observações</div>
        <p>${company.invoiceNotes}</p>
      </div>
      ` : ''}
      ${showBankDetails && company.bankName ? `
      <div class="bank-box">
        <div class="section-label">Dados para Transferência</div>
        <p><strong>Banco:</strong> ${company.bankName}</p>
        ${company.iban ? `<p><strong>IBAN:</strong> ${company.iban}</p>` : ''}
      </div>
      ` : ''}
    </div>
    ` : ''}

    <!-- Document Footer -->
    <div class="document-footer">
      <p>${company.footerText || 'Obrigado pela preferência!'}</p>
      <p>${company.website ? `www: ${company.website}` : ''} ${company.email ? `| email: ${company.email}` : ''}</p>
      <div class="software-info">
        Documento emitido por ${company.tradeName || company.name || 'NEXOR ERP'} v${company.softwareVersion || '1.0.0'} - Software certificado AGT
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function printA4Invoice(
  sale: Sale,
  branch: Branch,
  options: A4InvoiceOptions = {}
): Promise<void> {
  // Pre-generate QR code as data URL before opening print window
  const { generateAGTQRCodeDataURL } = await import('./agtQRCode');
  const qrCodeDataURL = await generateAGTQRCodeDataURL(sale, branch, { size: 100, margin: 1 });
  
  const html = await generateA4InvoiceHTML(sale, branch, { ...options, qrCodeDataURL });
  
  const { printHtml } = await import('./printHtml');
  await printHtml(html);
}

export async function downloadA4InvoicePDF(
  sale: Sale,
  branch: Branch,
  options: A4InvoiceOptions = {}
): Promise<void> {
  // Open print dialog with PDF save option
  await printA4Invoice(sale, branch, options);
}
