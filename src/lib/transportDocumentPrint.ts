/**
 * A4 print for fiscal transport guides (GT / guia de remessa).
 * Layout is a goods-movement document, not a tax invoice.
 * Prices are optional — typical delivery notes show quantities only.
 */

import type { TransportDocument, TransportDocumentItem } from '@/types/erp';
import { getCompanySettings } from '@/lib/companySettings';
import { escapeHtml } from '@/lib/reportExport';
import { printHtml } from '@/lib/printHtml';
import { en } from '@/i18n/translations/en';
import { pt } from '@/i18n/translations/pt';

export type TransportPrintLanguage = 'en' | 'pt';

export type TransportPrintOptions = {
  includePrices?: boolean;
  language?: TransportPrintLanguage;
};

function formatMoney(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatIsoDate(value: string | undefined, locale: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const day = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-');
    return locale.startsWith('en') ? `${d}/${m}/${y}` : `${d}/${m}/${y}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(raw);
  return parsed.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function itemUnitPrice(item: TransportDocumentItem): number {
  if (typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)) return item.unitPrice;
  if (typeof item.lineTotal === 'number' && item.quantity > 0) return item.lineTotal / item.quantity;
  return 0;
}

function itemLineTotal(item: TransportDocumentItem): number {
  if (typeof item.lineTotal === 'number' && Number.isFinite(item.lineTotal)) return item.lineTotal;
  return itemUnitPrice(item) * (Number(item.quantity) || 0);
}

export function generateTransportDocumentHTML(
  doc: TransportDocument,
  options: TransportPrintOptions = {},
): string {
  const includePrices = options.includePrices === true;
  const language: TransportPrintLanguage = options.language === 'en' ? 'en' : 'pt';
  const L = language === 'en' ? en.fiscalDocumentsUi : pt.fiscalDocumentsUi;
  const locale = language === 'en' ? 'en-US' : 'pt-AO';
  const company = getCompanySettings();
  const accent = company.primaryColor || '#0e7490';

  const typeLabel =
    doc.type === 'delivery' ? L.transportTypeDeliveryFull
    : doc.type === 'transfer' ? L.transportTypeTransferFull
    : doc.type === 'return' ? L.transportTypeReturnFull
    : L.transportTypeConsignment;

  const items = Array.isArray(doc.items) ? doc.items : [];
  const goodsTotal = items.reduce((sum, item) => sum + itemLineTotal(item), 0);
  const hasPricedLines = includePrices && items.some((item) => itemUnitPrice(item) > 0);

  const title = doc.type === 'delivery' ? L.printDocumentTypeDelivery : L.printDocumentType;
  const issued = formatIsoDate(doc.issuedAt || doc.createdAt, locale);
  const loadingDate = formatIsoDate(doc.loadingDate, locale);
  const loadingTime = String(doc.loadingTime || '').slice(0, 5);

  const itemRows = items.map((item, idx) => {
    const qty = Number(item.quantity) || 0;
    const priceCells = hasPricedLines
      ? `<td class="num">${escapeHtml(formatMoney(itemUnitPrice(item), locale))}</td>
         <td class="num">${escapeHtml(formatMoney(itemLineTotal(item), locale))}</td>`
      : '';
    return `
      <tr>
        <td class="num muted">${idx + 1}</td>
        <td>
          <div class="item-name">${escapeHtml(item.productName)}</div>
          ${item.sku ? `<div class="item-sku">${escapeHtml(item.sku)}</div>` : ''}
        </td>
        <td class="num">${escapeHtml(String(qty))}</td>
        <td>${escapeHtml(item.unit || 'UN')}</td>
        ${priceCells}
      </tr>`;
  }).join('');

  const priceHead = hasPricedLines
    ? `<th class="num">${escapeHtml(L.colUnitPrice)}</th>
       <th class="num">${escapeHtml(L.colTotal)}</th>`
    : '';

  const totalsBlock = hasPricedLines
    ? `<div class="totals">
         <div class="total-row">
           <span>${escapeHtml(L.goodsValue)}</span>
           <strong>${escapeHtml(formatMoney(goodsTotal, locale))} Kz</strong>
         </div>
       </div>`
    : '';

  const disclaimer = hasPricedLines ? L.printDisclaimerWithPrice : L.printDisclaimerNoPrice;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - ${escapeHtml(doc.documentNumber)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      color: #111827;
      background: white;
    }
    .page { width: 186mm; min-height: 273mm; }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 3px solid ${accent};
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .logo { max-width: ${company.logoWidth || 140}px; max-height: 52px; object-fit: contain; }
    .company-name { font-size: 16px; font-weight: 700; letter-spacing: 0.02em; }
    .muted { color: #6b7280; }
    .company-details { margin-top: 4px; font-size: 10px; line-height: 1.45; color: #4b5563; }
    .doc-meta { text-align: right; min-width: 210px; }
    .doc-kicker {
      font-size: 10px;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      color: ${accent};
      font-weight: 700;
    }
    .doc-title { font-size: 20px; font-weight: 800; margin: 2px 0 6px; }
    .doc-number { font-size: 14px; font-weight: 700; font-family: ui-monospace, Consolas, monospace; }
    .chip {
      display: inline-block;
      margin-top: 8px;
      padding: 3px 8px;
      border: 1px solid ${accent};
      color: ${accent};
      border-radius: 999px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .box {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 12px;
      min-height: 92px;
    }
    .box h3 {
      font-size: 9px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: ${accent};
      margin-bottom: 6px;
    }
    .box .name { font-weight: 700; font-size: 12px; }
    .meta-line { font-size: 10px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th {
      background: ${accent};
      color: white;
      text-align: left;
      font-size: 9px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 8px;
    }
    th.num, td.num { text-align: right; }
    td { padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .item-name { font-weight: 600; }
    .item-sku { font-size: 9px; color: #6b7280; margin-top: 2px; }
    .totals { display: flex; justify-content: flex-end; margin: 4px 0 16px; }
    .total-row {
      min-width: 240px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      padding: 10px 12px;
      background: ${accent};
      color: white;
      border-radius: 6px;
      font-size: 12px;
    }
    .notes {
      border: 1px dashed #d1d5db;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 18px;
      font-size: 10px;
    }
    .signs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 28px; }
    .sign {
      border-top: 1px solid #9ca3af;
      padding-top: 8px;
      min-height: 72px;
    }
    .sign h4 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
    .sign p { font-size: 9px; color: #6b7280; margin-top: 18px; }
    .disclaimer {
      margin-top: 22px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 9px;
      color: #6b7280;
      text-align: center;
      line-height: 1.45;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div>
        ${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}
        <div class="company-name">${escapeHtml(company.name || '')}</div>
        <div class="company-details">
          ${company.tradeName ? `<div>${escapeHtml(company.tradeName)}</div>` : ''}
          <div>${escapeHtml(company.address || '')}</div>
          <div>${escapeHtml([company.city, company.province, company.country].filter(Boolean).join(', '))}</div>
          <div>${escapeHtml(company.phone || '')}${company.email ? ` · ${escapeHtml(company.email)}` : ''}</div>
          <div><strong>NIF ${escapeHtml(company.nif || '')}</strong></div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-kicker">${escapeHtml(L.printGoodsMovement)}</div>
        <div class="doc-title">${escapeHtml(title)}</div>
        <div class="doc-number">${escapeHtml(doc.documentNumber)}</div>
        <div class="chip">${escapeHtml(typeLabel)}</div>
        <div class="meta-line" style="margin-top:8px">${escapeHtml(L.colDate)}: ${issued}</div>
        ${doc.relatedInvoiceNumber
          ? `<div class="meta-line">${escapeHtml(L.relatedInvoice)}: <strong>${escapeHtml(doc.relatedInvoiceNumber)}</strong></div>`
          : ''}
        ${doc.branchName ? `<div class="meta-line">${escapeHtml(L.branchLabel)} ${escapeHtml(doc.branchName)}</div>` : ''}
      </div>
    </div>

    <div class="grid-2">
      <div class="box">
        <h3>${escapeHtml(L.originTitle)}</h3>
        <div class="name">${escapeHtml(company.name || doc.branchName || '')}</div>
        <div class="meta-line">${escapeHtml(doc.originAddress || company.address || '')}</div>
        <div class="meta-line">${escapeHtml(doc.originCity || company.city || '')}</div>
        ${company.nif ? `<div class="meta-line">NIF ${escapeHtml(company.nif)}</div>` : ''}
      </div>
      <div class="box">
        <h3>${escapeHtml(L.destinationTitle)}</h3>
        <div class="name">${escapeHtml(doc.destinationName || L.finalConsumer)}</div>
        <div class="meta-line">${escapeHtml(doc.destinationAddress || '')}</div>
        <div class="meta-line">${escapeHtml(doc.destinationCity || '')}</div>
        ${doc.destinationNif ? `<div class="meta-line">NIF ${escapeHtml(doc.destinationNif)}</div>` : ''}
      </div>
    </div>

    <div class="grid-3">
      <div class="box" style="min-height:auto">
        <h3>${escapeHtml(L.loadingDateLabel)}</h3>
        <div class="name">${loadingDate}${loadingTime ? ` · ${escapeHtml(loadingTime)}` : ''}</div>
      </div>
      <div class="box" style="min-height:auto">
        <h3>${escapeHtml(L.vehiclePlateLabel)}</h3>
        <div class="name">${escapeHtml(doc.vehiclePlate || '—')}</div>
      </div>
      <div class="box" style="min-height:auto">
        <h3>${escapeHtml(L.transporterLabel)}</h3>
        <div class="name">${escapeHtml(doc.transporterName || '—')}</div>
        ${doc.transporterNif ? `<div class="meta-line">NIF ${escapeHtml(doc.transporterNif)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>${escapeHtml(L.colProduct)}</th>
          <th class="num" style="width:70px">${escapeHtml(L.colQty)}</th>
          <th style="width:70px">${escapeHtml(L.colUnit)}</th>
          ${priceHead}
        </tr>
      </thead>
      <tbody>
        ${itemRows || `<tr><td colspan="${hasPricedLines ? 6 : 4}" class="muted">${escapeHtml(L.noTransport)}</td></tr>`}
      </tbody>
    </table>

    ${totalsBlock}

    ${doc.notes ? `<div class="notes"><strong>${escapeHtml(L.notesLabel)}</strong><div>${escapeHtml(doc.notes)}</div></div>` : ''}

    <div class="signs">
      <div class="sign">
        <h4>${escapeHtml(L.signDispatcher)}</h4>
        <p>${escapeHtml(L.signName)} / ${escapeHtml(L.signDate)}</p>
      </div>
      <div class="sign">
        <h4>${escapeHtml(L.signCarrier)}</h4>
        <p>${escapeHtml(L.signName)} / ${escapeHtml(L.vehiclePlateLabel)}</p>
      </div>
      <div class="sign">
        <h4>${escapeHtml(L.signRecipient)}</h4>
        <p>${escapeHtml(L.signName)} / ${escapeHtml(L.signDate)}</p>
      </div>
    </div>

    <div class="disclaimer">${escapeHtml(disclaimer)}</div>
  </div>
</body>
</html>`;
}

export async function printTransportDocument(
  doc: TransportDocument,
  options: TransportPrintOptions = {},
): Promise<void> {
  const html = generateTransportDocumentHTML(doc, options);
  await printHtml(html);
}
