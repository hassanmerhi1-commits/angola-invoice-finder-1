/**
 * A4 Pro Forma — same page for the on-screen view and the print.
 * Layout follows the Distri-Good / SMART ERP proforma: company block,
 * customer on the right, line table, tax summary and totals at the foot.
 */

import { ProForma, ProFormaItem } from '@/types/proforma';
import { Branch } from '@/types/erp';
import { getCompanySettings } from './companySettings';
import { IVA_EXEMPTION_REASON } from './taxUtils';

type PrintLanguage = 'en' | 'pt';

type BankLine = {
  bankName?: string;
  bank_name?: string;
  accountNumber?: string;
  account_number?: string;
  iban?: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-AO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function lineNet(item: ProFormaItem): number {
  const discountPct = Number(item.discount) || 0;
  return item.quantity * item.unitPrice * (1 - discountPct / 100);
}

function lineTax(item: ProFormaItem): number {
  return lineNet(item) * ((Number(item.taxRate) || 0) / 100);
}

function taxGroups(items: ProFormaItem[]) {
  const groups = new Map<number, { rate: number; base: number; tax: number }>();
  for (const item of items || []) {
    const rate = Number(item.taxRate) || 0;
    const base = lineNet(item);
    const tax = lineTax(item);
    const row = groups.get(rate) || { rate, base: 0, tax: 0 };
    row.base += base;
    row.tax += tax;
    groups.set(rate, row);
  }
  return [...groups.values()].sort((a, b) => a.rate - b.rate);
}

async function loadBankLines(branchId?: string): Promise<BankLine[]> {
  try {
    const { api } = await import('./api/client');
    const res = await api.bankAccounts.list(branchId);
    return Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

function bankRows(banks: BankLine[], fallbackName?: string, fallbackIban?: string): string[] {
  const lines = (banks || [])
    .filter((bank) => bank && (bank.bankName || bank.bank_name || bank.accountNumber || bank.account_number || bank.iban))
    .map((bank) => {
      const name = bank.bankName || bank.bank_name || '';
      const number = bank.accountNumber || bank.account_number || '';
      const iban = bank.iban || '';
      return `${name}  -  ${number}${iban ? ` - ${iban}` : ''}`;
    });
  if (lines.length > 0) return lines;
  if (fallbackName || fallbackIban) {
    return [`${fallbackName || ''}  -  ${fallbackIban || ''}`];
  }
  return [];
}

export async function generateProFormaA4HTML(
  proforma: ProForma,
  branch: Branch,
  _language: PrintLanguage = 'pt',
  banks?: BankLine[],
): Promise<string> {
  const company = getCompanySettings();
  const companyName = (company.tradeName || company.name || branch?.name || '').toUpperCase();
  const bankList = banks ?? await loadBankLines(branch?.id);
  const groups = taxGroups(proforma.items || []);
  const hasExempt = groups.some((group) => group.rate === 0);
  const cert = company.agtCertificateNumber || '396/AGT/2023';
  const operator = proforma.createdByName || proforma.createdBy || '';
  const customerName = proforma.customerName || 'Consumidor Final';
  const known = (value?: string) => (value && String(value).trim() ? String(value).trim() : 'Desconhecido');

  const itemRows = (proforma.items || []).map((item) => {
    const net = lineNet(item);
    const tax = lineTax(item);
    const unit = (item.unit || 'UN').toUpperCase();
    return `
      <tr>
        <td class="mono">${escapeHtml(item.sku || '')}</td>
        <td>${escapeHtml(item.productName || '')}</td>
        <td class="num">${money(item.quantity)}</td>
        <td class="center">${escapeHtml(unit)}</td>
        <td class="num">${money(item.unitPrice)}</td>
        <td class="num">${money(item.discount || 0)}</td>
        <td class="num">${money(item.taxRate || 0)}</td>
        <td class="num">${money(net)}</td>
        <td class="num">${money(tax)}</td>
      </tr>`;
  }).join('');

  const taxRows = (groups.length ? groups : [{ rate: 0, base: 0, tax: 0 }]).map((group) => `
    <tr>
      <td>${group.rate === 0 ? 'ISENTO' : 'IVA'}</td>
      <td class="center">${money(group.rate).replace('.00', '')}</td>
      <td class="num">${money(group.base)}</td>
      <td class="num">${money(group.tax)}</td>
    </tr>`).join('');

  const banksHtml = bankRows(bankList, company.bankName, company.iban)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('');

  const logo = company.logo
    ? `<img src="${escapeHtml(company.logo)}" alt="${escapeHtml(companyName)}">`
    : escapeHtml((companyName || 'NX').slice(0, 2));

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <title>Factura Proforma ${escapeHtml(proforma.documentNumber)}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; margin: 0; background: #fff; }
    .page { width: 190mm; min-height: 277mm; margin: 0 auto; padding: 4mm 2mm 8mm; display: flex; flex-direction: column; }
    .header { display: grid; grid-template-columns: 32mm 1fr 62mm; gap: 6mm; align-items: start; }
    .logo { width: 28mm; height: 22mm; display: flex; align-items: center; justify-content: center; overflow: hidden; font-weight: 900; font-size: 18px; }
    .logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .supplier h1 { font-size: 14px; margin: 0 0 2px; line-height: 1.1; text-transform: uppercase; }
    .supplier div { line-height: 1.3; }
    .meta { text-align: right; font-size: 11px; padding-top: 2mm; }
    .meta .copy { font-weight: 700; margin-bottom: 6px; }
    .meta .docno { font-weight: 700; }
    .rule { border-top: 1px solid #333; margin: 4px 0; }
    .mid { display: grid; grid-template-columns: 1fr 78mm; gap: 8mm; margin-top: 2mm; align-items: start; }
    .small-label { font-size: 10px; font-weight: 700; }
    .customer { line-height: 1.3; }
    .customer .who { text-align: center; font-weight: 700; border-bottom: 1px solid #333; margin-bottom: 3px; padding-bottom: 2px; }
    .date-grid { display: grid; grid-template-columns: 1fr 1.3fr 1.4fr; text-align: center; font-size: 10px; margin-top: 3mm; }
    .date-grid strong { display: block; border-bottom: 1px solid #777; margin-bottom: 2px; font-size: 9px; }
    table { width: 100%; border-collapse: collapse; }
    .items { margin-top: 4mm; }
    .items th { font-size: 9px; text-align: left; border-bottom: 1px solid #333; padding: 3px 3px; white-space: nowrap; }
    .items td { font-size: 10px; padding: 3px 3px; vertical-align: top; }
    .mono { font-family: "Courier New", monospace; }
    .num { text-align: right; font-family: "Courier New", monospace; white-space: nowrap; }
    .center { text-align: center; }
    .spacer { flex: 1 1 auto; min-height: 12mm; }
    .bottom { margin-top: auto; }
    .soft { font-size: 8px; margin-bottom: 2mm; }
    .tax-and-total { display: grid; grid-template-columns: 1fr 72mm; gap: 12mm; align-items: start; }
    .tax-title { font-size: 9px; font-weight: 700; border-bottom: 1px solid #333; margin-bottom: 2px; }
    .tax th, .tax td { border: 1px solid #333; padding: 3px 4px; font-size: 9px; }
    .tax th { font-weight: 700; text-align: left; }
    .totals td { border: 1px solid #333; padding: 4px 6px; font-size: 10px; }
    .totals .label { font-weight: 700; }
    .totals .value { text-align: right; font-family: "Courier New", monospace; font-weight: 700; }
    .grand td { font-size: 13px; font-weight: 900; }
    .note-line { margin-top: 8mm; border-bottom: 1px solid #333; width: 92mm; font-size: 9px; font-weight: 700; min-height: 14px; }
    .note-reason { font-weight: 400; margin-left: 6px; }
    .banks { margin-top: 6mm; font-weight: 700; line-height: 1.45; }
    .operator { margin-top: 4mm; border: 1px solid #333; padding: 4px 6px; width: 64mm; margin-left: auto; font-size: 10px; }
    .footer-msg { text-align: center; margin-top: 8mm; font-weight: 700; font-size: 11px; }
    @media print { body { margin: 0; } .page { margin: 0; min-height: 277mm; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo">${logo}</div>
      <div class="supplier">
        <h1>${escapeHtml(companyName)}</h1>
        <div>Tel: ${escapeHtml(company.phone || '')}</div>
        <div>Email: ${escapeHtml(company.email || '')}</div>
        <div>Website: ${escapeHtml(company.website || '')}</div>
        <div>NIF: ${escapeHtml(company.nif || '')}</div>
        <div>${escapeHtml(company.city || company.address || '')}</div>
      </div>
      <div class="meta">
        <div class="copy">Original</div>
        <div class="docno">Factura Proforma No : ${escapeHtml(proforma.documentNumber || '')}</div>
      </div>
    </div>

    <div class="rule"></div>

    <div class="mid">
      <div>
        <div class="small-label">ARMAZEM: ${escapeHtml(branch?.name || proforma.branchName || '')}</div>
        <div class="small-label" style="margin-top:4mm">CLIENTE V/REF</div>
      </div>
      <div class="customer">
        <div class="who">Exmo(s) Senhor(es)</div>
        <div>${escapeHtml(customerName)}</div>
        <div>NIF: ${escapeHtml(known(proforma.customerNif))}</div>
        <div>ENDERECO: ${escapeHtml(known(proforma.customerAddress))}</div>
        <div>TELE: ${escapeHtml(proforma.customerPhone || '00')}</div>
        <div>AO</div>
        <div class="date-grid">
          <div><strong>Hora</strong>${escapeHtml(isoTime(proforma.createdAt))}</div>
          <div><strong>DATA EMISSAO</strong>${escapeHtml(isoDate(proforma.createdAt))}</div>
          <div><strong>DATA VENCIMENTO</strong>${escapeHtml(isoDate(proforma.validUntil))}</div>
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:28mm">REFERENCIA</th>
          <th>DESCRICAO</th>
          <th class="num" style="width:16mm">QTD.</th>
          <th class="center" style="width:12mm">UNI</th>
          <th class="num" style="width:24mm">P.Unit(S/IMP.)</th>
          <th class="num" style="width:16mm">DESC.%</th>
          <th class="num" style="width:14mm">TAXA%</th>
          <th class="num" style="width:24mm">TOTAL</th>
          <th class="num" style="width:22mm">IVA VALOR</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="spacer"></div>
    <div class="bottom">
      <div class="soft">Processado por programa validado ${escapeHtml(cert)} - NEXOR ERP</div>
      <div class="tax-and-total">
        <div>
          <div class="tax-title">RESUMO DE IMPOSTOS</div>
          <table class="tax">
            <thead>
              <tr><th>DESIGNACAO</th><th>TAXA%</th><th>INCIDENCIA</th><th>IMPOSTO</th></tr>
            </thead>
            <tbody>${taxRows}</tbody>
          </table>
          <div class="note-line">Motivo de Isencao${hasExempt ? `<span class="note-reason">${escapeHtml(IVA_EXEMPTION_REASON)}</span>` : ''}</div>
          <div class="banks">${banksHtml}</div>
        </div>
        <div>
          <table class="totals">
            <tbody>
              <tr><td class="label">VALOR</td><td class="value">${money(proforma.subtotal)}</td></tr>
              <tr><td class="label">DESCONTO</td><td class="value">${money(proforma.discount || 0)}</td></tr>
              <tr><td class="label">SUB TOTAL</td><td class="value">${money(proforma.subtotal)}</td></tr>
              <tr><td class="label">IMPOSTO</td><td class="value">${money(proforma.taxAmount)}</td></tr>
              <tr class="grand"><td class="label">TOTAL</td><td class="value">KZ ${money(proforma.total)}</td></tr>
            </tbody>
          </table>
          <div class="operator">Operador: ${escapeHtml(operator)}</div>
        </div>
      </div>
      <div class="footer-msg">Este documento nao serve Fatura</div>
    </div>
  </div>
</body>
</html>`;
}

export async function printProFormaA4(
  proforma: ProForma,
  branch: Branch,
  language: PrintLanguage = 'pt',
): Promise<void> {
  const html = await generateProFormaA4HTML(proforma, branch, language);
  const { printHtml } = await import('./printHtml');
  await printHtml(html);
}
