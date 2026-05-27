/**
 * A4 Pro Forma Printer for NEXOR ERP
 * Generates professional A4 pro forma documents
 */

import { ProForma } from '@/types/proforma';
import { Branch } from '@/types/erp';
import { getCompanySettings } from './companySettings';
import { en } from '@/i18n/translations/en';
import { pt } from '@/i18n/translations/pt';

type PrintLanguage = 'en' | 'pt';

export async function generateProFormaA4HTML(
  proforma: ProForma,
  branch: Branch,
  language: PrintLanguage = 'pt'
): Promise<string> {
  const company = getCompanySettings();
  const L = language === 'en' ? en.proFormaUi : pt.proFormaUi;
  const uiLocale = language === 'en' ? 'en-US' : 'pt-AO';

  const formatMoney = (value: number) => {
    return value.toLocaleString(uiLocale, { minimumFractionDigits: 2 });
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(uiLocale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const statusLabels: Record<string, string> = {
    draft: L.statusDraft,
    sent: L.statusSent,
    accepted: L.statusAccepted,
    rejected: L.statusRejected,
    converted: L.statusConverted,
    expired: L.statusExpired,
  };

  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L.printDocumentTitle} - ${proforma.documentNumber}</title>
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
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 3px solid ${company.primaryColor || '#f59e0b'};
    }
    
    .company-info { flex: 1; }
    
    .company-logo {
      max-width: ${company.logoWidth || 150}px;
      max-height: 80px;
      object-fit: contain;
      margin-bottom: 10px;
    }
    
    .company-name {
      font-size: 18px;
      font-weight: bold;
      color: ${company.primaryColor || '#f59e0b'};
      margin-bottom: 5px;
    }
    
    .company-details {
      font-size: 10px;
      color: #666;
      line-height: 1.5;
    }
    
    .document-info { text-align: right; }
    
    .document-type {
      font-size: 28px;
      font-weight: bold;
      color: ${company.primaryColor || '#f59e0b'};
      margin-bottom: 5px;
    }
    
    .document-subtitle {
      font-size: 12px;
      color: #666;
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
    
    .validity-box {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      padding: 8px 12px;
      border-radius: 5px;
      margin-top: 10px;
      font-size: 11px;
    }
    
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
      border-left: 3px solid ${company.primaryColor || '#f59e0b'};
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
    
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 25px;
    }
    
    .items-table th {
      background: ${company.primaryColor || '#f59e0b'};
      color: white;
      padding: 10px 8px;
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .items-table th:nth-child(n+3) { text-align: right; }
    
    .items-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #e0e0e0;
      vertical-align: top;
    }
    
    .items-table td:nth-child(n+3) { text-align: right; }
    
    .item-name { font-weight: 500; }
    .item-sku { font-size: 9px; color: #888; }
    
    .totals-section {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 25px;
    }
    
    .totals-box { width: 280px; }
    
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    
    .total-row:last-child { border-bottom: none; }
    
    .total-row.grand-total {
      background: ${company.primaryColor || '#f59e0b'};
      color: white;
      padding: 12px 10px;
      margin-top: 5px;
      border-radius: 5px;
      font-size: 16px;
      font-weight: bold;
    }
    
    .notes-section {
      margin-top: 25px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 5px;
    }
    
    .section-label {
      font-size: 10px;
      text-transform: uppercase;
      color: #888;
      letter-spacing: 1px;
      margin-bottom: 8px;
      font-weight: bold;
    }
    
    .terms-section {
      margin-top: 20px;
      padding: 15px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 5px;
    }
    
    .footer {
      margin-top: 40px;
      display: flex;
      justify-content: space-between;
    }
    
    .signature-box {
      width: 45%;
      text-align: center;
    }
    
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 60px;
      padding-top: 8px;
      font-size: 10px;
    }
    
    .document-footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
      font-size: 9px;
      color: #888;
    }
    
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      color: rgba(0,0,0,0.05);
      font-weight: bold;
      pointer-events: none;
      z-index: 0;
    }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .invoice { margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="invoice" style="position: relative;">
    <div class="watermark">${L.printWatermark}</div>
    
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
        <div class="document-type">${L.printDocumentTitle}</div>
        <div class="document-subtitle">${L.printDocSubtitle}</div>
        <div class="document-number">${proforma.documentNumber}</div>
        <div class="document-date">
          ${L.printDateLabel} ${formatDate(proforma.createdAt)}
        </div>
        <div class="validity-box">
          <strong>${L.printValidUntil}</strong> ${formatDate(proforma.validUntil)}<br>
          <span style="font-size: 9px; color: #666;">${L.printStatus} ${statusLabels[proforma.status]}</span>
        </div>
      </div>
    </div>

    <div class="parties">
      <div class="party-box">
        <div class="party-label">${L.printSeller}</div>
        <div class="party-name">${branch.name}</div>
        <div class="party-details">
          ${branch.address}<br>
          Tel: ${branch.phone}
        </div>
      </div>
      <div class="party-box">
        <div class="party-label">${L.printClient}</div>
        <div class="party-name">${proforma.customerName}</div>
        <div class="party-details">
          ${proforma.customerNif ? `NIF: ${proforma.customerNif}<br>` : ''}
          ${proforma.customerPhone ? `Tel: ${proforma.customerPhone}<br>` : ''}
          ${proforma.customerEmail ? `Email: ${proforma.customerEmail}<br>` : ''}
          ${proforma.customerAddress || ''}
        </div>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 40%">${L.printColDescription}</th>
          <th style="width: 10%">${L.colQty}</th>
          <th style="width: 15%">${L.printColUnitPrice}</th>
          <th style="width: 10%">${L.vat}</th>
          <th style="width: 12%">${L.printColVatAmount}</th>
          <th style="width: 13%">${L.printTotal}</th>
        </tr>
      </thead>
      <tbody>
        ${proforma.items.map(item => `
          <tr>
            <td>
              <div class="item-name">${item.productName}</div>
              <div class="item-sku">${L.printRef} ${item.sku}</div>
            </td>
            <td>${item.quantity}</td>
            <td>${formatMoney(item.unitPrice)} Kz</td>
            <td>${item.taxRate}%</td>
            <td>${formatMoney(item.taxAmount)} Kz</td>
            <td><strong>${formatMoney(item.subtotal)} Kz</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals-section">
      <div class="totals-box">
        <div class="total-row">
          <span>${L.printSubtotalExVat}</span>
          <span>${formatMoney(proforma.subtotal)} Kz</span>
        </div>
        <div class="total-row">
          <span>${L.printVat}</span>
          <span>${formatMoney(proforma.taxAmount)} Kz</span>
        </div>
        ${proforma.discount > 0 ? `
        <div class="total-row" style="color: #dc2626;">
          <span>${L.printDiscount}</span>
          <span>-${formatMoney(proforma.discount)} Kz</span>
        </div>
        ` : ''}
        <div class="total-row grand-total">
          <span>${L.printTotal}</span>
          <span>${formatMoney(proforma.total)} Kz</span>
        </div>
      </div>
    </div>

    ${proforma.notes ? `
    <div class="notes-section">
      <div class="section-label">${L.printNotes}</div>
      <div>${proforma.notes}</div>
    </div>
    ` : ''}

    <div class="terms-section">
      <div class="section-label">${L.printTerms}</div>
      <div style="font-size: 10px; color: #555;">
        ${proforma.termsAndConditions || L.printDefaultTermsHtml}
      </div>
    </div>

    <div class="footer">
      <div class="signature-box">
        <div class="signature-line">${L.printSellerSignature}</div>
      </div>
      <div class="signature-box">
        <div class="signature-line">${L.printSignature}</div>
      </div>
    </div>

    <div class="document-footer">
      <p>${L.printFooterLine1}</p>
      <p>${L.printFooterLine2}</p>
      <p style="margin-top: 8px;">${L.printProcessedBy} ${company.name} - NIF: ${company.nif}</p>
    </div>
  </div>
</body>
</html>
  `;
}

export async function printProFormaA4(
  proforma: ProForma,
  branch: Branch,
  language: PrintLanguage = 'pt'
): Promise<void> {
  const html = await generateProFormaA4HTML(proforma, branch, language);
  
  const { printHtml } = await import('./printHtml');
  await printHtml(html);
}
