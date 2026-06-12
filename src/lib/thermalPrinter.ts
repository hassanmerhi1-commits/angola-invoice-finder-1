/**
 * Thermal Printer Service for NEXOR ERP
 * Supports 58mm and 80mm thermal printers (ESC/POS compatible)
 * Works with USB, Serial, and Network printers
 */

import { Sale, Branch } from '@/types/erp';
import { buildAGTQRCodeString, saleToAGTQRData, getInvoiceHash } from './agtQRCode';
import { getCompanySettings } from './companySettings';
import { formatTaxLabel, taxRatesFromSaleItems } from './taxUtils';
import { receiptDocTypeLabel } from './fiscalInvoiceType';

// Printer configuration
export interface PrinterConfig {
  type: 'usb' | 'serial' | 'network' | 'browser';
  paperWidth: 58 | 80; // mm
  characterWidth: number; // characters per line
  ip?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  type: 'browser',
  paperWidth: 80,
  characterWidth: 48, // 80mm = 48 chars, 58mm = 32 chars
};

// ESC/POS Commands
const ESC = '\x1B';
const GS = '\x1D';

export const ESC_POS = {
  // Initialize printer
  INIT: ESC + '@',
  
  // Text formatting
  ALIGN_LEFT: ESC + 'a' + '\x00',
  ALIGN_CENTER: ESC + 'a' + '\x01',
  ALIGN_RIGHT: ESC + 'a' + '\x02',
  
  // Font styles
  BOLD_ON: ESC + 'E' + '\x01',
  BOLD_OFF: ESC + 'E' + '\x00',
  DOUBLE_HEIGHT_ON: GS + '!' + '\x01',
  DOUBLE_WIDTH_ON: GS + '!' + '\x10',
  DOUBLE_SIZE_ON: GS + '!' + '\x11',
  NORMAL_SIZE: GS + '!' + '\x00',
  UNDERLINE_ON: ESC + '-' + '\x01',
  UNDERLINE_OFF: ESC + '-' + '\x00',
  
  // Paper handling
  CUT_PAPER: GS + 'V' + '\x00',
  PARTIAL_CUT: GS + 'V' + '\x01',
  FEED_LINES: (n: number) => ESC + 'd' + String.fromCharCode(n),
  
  // Cash drawer
  OPEN_DRAWER: ESC + 'p' + '\x00' + '\x19' + '\xFA',
  
  // Line spacing
  LINE_SPACING_DEFAULT: ESC + '2',
  LINE_SPACING: (n: number) => ESC + '3' + String.fromCharCode(n),
};

// Generate receipt text for thermal printer
export function generateReceiptText(
  sale: Sale,
  branch: Branch,
  config: PrinterConfig = DEFAULT_PRINTER_CONFIG
): string {
  const company = getCompanySettings();
  const width = config.paperWidth === 80 ? 48 : 32;
  const divider = '-'.repeat(width);
  const doubleDivider = '='.repeat(width);
  
  const center = (text: string) => {
    const pad = Math.floor((width - text.length) / 2);
    return ' '.repeat(Math.max(0, pad)) + text;
  };
  
  const leftRight = (left: string, right: string) => {
    const spaces = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, spaces)) + right;
  };
  
  const formatMoney = (value: number) => {
    return value.toLocaleString('pt-AO') + ' Kz';
  };
  
  const lines: string[] = [];
  
  // Header - Use branch info for multi-branch display
  lines.push(center(branch.name.toUpperCase()));
  lines.push(center(branch.address || ''));
  lines.push(center('Tel: ' + (branch.phone || '')));
  lines.push(center('NIF: ' + company.nif));
  lines.push('');
  lines.push(divider);
  
  // Invoice info
  lines.push(center(receiptDocTypeLabel(sale.invoiceType)));
  lines.push(center(sale.invoiceNumber));
  lines.push(center(new Date(sale.createdAt).toLocaleString('pt-AO')));
  lines.push(center('Caixa: ' + (sale.cashierName || sale.cashierId || 'N/A')));
  lines.push(divider);
  
  // Items header
  lines.push(leftRight('ITEM', 'VALOR'));
  lines.push(divider);
  
  // Items
  for (const item of sale.items) {
    const name = item.productName.substring(0, width - 15);
    lines.push(name);
    const qtyPrice = `  ${item.quantity} x ${item.unitPrice.toLocaleString('pt-AO')}`;
    const subtotal = formatMoney(item.subtotal);
    lines.push(leftRight(qtyPrice, subtotal));
  }
  
  lines.push(divider);
  
  // Totals
  lines.push(leftRight('Subtotal:', formatMoney(sale.subtotal)));
  lines.push(leftRight(`${formatTaxLabel(taxRatesFromSaleItems(sale.items))}:`, formatMoney(sale.taxAmount)));
  lines.push(doubleDivider);
  lines.push(leftRight('TOTAL:', formatMoney(sale.total)));
  lines.push(doubleDivider);
  
  // Multi-currency equivalents
  if (company.exchangeRateUSD && company.exchangeRateUSD > 0) {
    const usdVal = (sale.total / company.exchangeRateUSD).toFixed(2);
    lines.push(leftRight('Equiv. USD:', '$ ' + usdVal));
  }
  if (company.exchangeRateEUR && company.exchangeRateEUR > 0) {
    const eurVal = (sale.total / company.exchangeRateEUR).toFixed(2);
    lines.push(leftRight('Equiv. EUR:', 'E ' + eurVal));
  }
  
  // Payment info
  lines.push('');
  const paymentMethodNames: Record<string, string> = {
    cash: 'DINHEIRO',
    card: 'CARTAO',
    transfer: 'TRANSFERENCIA',
  };
  lines.push(leftRight('Pagamento:', paymentMethodNames[sale.paymentMethod] || sale.paymentMethod.toUpperCase()));
  lines.push(leftRight('Recebido:', formatMoney(sale.amountPaid)));
  
  if (sale.change > 0) {
    lines.push(leftRight('Troco:', formatMoney(sale.change)));
  }
  
  // Customer info
  if (sale.customerNif || sale.customerName) {
    lines.push('');
    lines.push(divider);
    if (sale.customerNif) {
      lines.push(leftRight('NIF Cliente:', sale.customerNif));
    }
    if (sale.customerName) {
      lines.push(leftRight('Cliente:', sale.customerName));
    }
  }
  
  // Footer
  lines.push('');
  lines.push(divider);
  lines.push(center('Documento processado por'));
  lines.push(center(company.tradeName || company.name || 'NEXOR ERP'));
  lines.push('');
  lines.push(center('Obrigado pela preferencia!'));
  lines.push('');
  lines.push('');
  lines.push('');
  
  return lines.join('\n');
}

// Generate ESC/POS commands for thermal printer
export const POS_RECEIPT_COPY_LABELS = ['ORIGINAL', 'CLIENTE'] as const;

export type PrintReceiptOptions = {
  openDrawer?: boolean;
  copies?: number;
  copyLabels?: string[];
  /** Skip preview and print immediately (POS auto-print). */
  direct?: boolean;
};

export function generateESCPOSReceipt(
  sale: Sale,
  branch: Branch,
  config: PrinterConfig = DEFAULT_PRINTER_CONFIG,
  copyLabel?: string,
): Uint8Array {
  const company = getCompanySettings();
  const encoder = new TextEncoder();
  const commands: number[] = [];
  
  const addText = (text: string) => {
    const bytes = encoder.encode(text);
    commands.push(...bytes);
  };
  
  const addCommand = (cmd: string) => {
    for (let i = 0; i < cmd.length; i++) {
      commands.push(cmd.charCodeAt(i));
    }
  };
  
  // Initialize
  addCommand(ESC_POS.INIT);
  addCommand(ESC_POS.ALIGN_CENTER);

  if (copyLabel) {
    addCommand(ESC_POS.BOLD_ON);
    addCommand(ESC_POS.DOUBLE_WIDTH_ON);
    addText(`*** ${copyLabel.toUpperCase()} ***\n`);
    addCommand(ESC_POS.NORMAL_SIZE);
    addCommand(ESC_POS.BOLD_OFF);
    addText('\n');
  }
  
  // Header - Bold and larger with branch info
  addCommand(ESC_POS.BOLD_ON);
  addCommand(ESC_POS.DOUBLE_SIZE_ON);
  addText(branch.name.toUpperCase() + '\n');
  addCommand(ESC_POS.NORMAL_SIZE);
  addCommand(ESC_POS.BOLD_OFF);
  
  addText((branch.address || '') + '\n');
  addText('Tel: ' + (branch.phone || '') + '\n');
  addText('NIF: ' + company.nif + '\n\n');
  
  // Invoice number
  addCommand(ESC_POS.BOLD_ON);
  addText(receiptDocTypeLabel(sale.invoiceType) + '\n');
  addText(sale.invoiceNumber + '\n');
  addCommand(ESC_POS.BOLD_OFF);
  addText(new Date(sale.createdAt).toLocaleString('pt-AO') + '\n\n');
  
  addCommand(ESC_POS.ALIGN_LEFT);
  addText('-'.repeat(config.characterWidth) + '\n');
  
  // Items
  for (const item of sale.items) {
    addText(item.productName + '\n');
    const qtyLine = `  ${item.quantity} x ${item.unitPrice.toLocaleString('pt-AO')}`;
    const subtotal = item.subtotal.toLocaleString('pt-AO') + ' Kz';
    const spaces = config.characterWidth - qtyLine.length - subtotal.length;
    addText(qtyLine + ' '.repeat(Math.max(1, spaces)) + subtotal + '\n');
  }
  
  addText('-'.repeat(config.characterWidth) + '\n');
  
  // Totals
  const formatLine = (label: string, value: string) => {
    const spaces = config.characterWidth - label.length - value.length;
    return label + ' '.repeat(Math.max(1, spaces)) + value + '\n';
  };
  
  addText(formatLine('Subtotal:', sale.subtotal.toLocaleString('pt-AO') + ' Kz'));
  addText(formatLine(`${formatTaxLabel(taxRatesFromSaleItems(sale.items))}:`, sale.taxAmount.toLocaleString('pt-AO') + ' Kz'));
  
  addCommand(ESC_POS.BOLD_ON);
  addCommand(ESC_POS.DOUBLE_HEIGHT_ON);
  addText(formatLine('TOTAL:', sale.total.toLocaleString('pt-AO') + ' Kz'));
  addCommand(ESC_POS.NORMAL_SIZE);
  addCommand(ESC_POS.BOLD_OFF);
  
  // Payment
  addText('\n');
  const paymentNames: Record<string, string> = {
    cash: 'DINHEIRO',
    card: 'CARTAO',
    transfer: 'TRANSFERENCIA',
  };
  addText(formatLine('Pagamento:', paymentNames[sale.paymentMethod] || sale.paymentMethod));
  addText(formatLine('Recebido:', sale.amountPaid.toLocaleString('pt-AO') + ' Kz'));
  
  if (sale.change > 0) {
    addCommand(ESC_POS.BOLD_ON);
    addText(formatLine('Troco:', sale.change.toLocaleString('pt-AO') + ' Kz'));
    addCommand(ESC_POS.BOLD_OFF);
  }
  
  // Customer
  if (sale.customerNif || sale.customerName) {
    addText('\n');
    if (sale.customerNif) {
      addText(formatLine('NIF Cliente:', sale.customerNif));
    }
    if (sale.customerName) {
      addText(formatLine('Cliente:', sale.customerName));
    }
  }
  
  // Footer
  addText('\n');
  addCommand(ESC_POS.ALIGN_CENTER);
  addText('Documento processado por\n');
  addText((company.tradeName || company.name || 'NEXOR ERP') + '\n\n');
  addText('Obrigado pela preferencia!\n');
  
  // Feed and cut
  addCommand(ESC_POS.FEED_LINES(4));
  addCommand(ESC_POS.PARTIAL_CUT);
  
  return new Uint8Array(commands);
}

// Print using Web Serial API (for USB thermal printers)
export async function printViaSerial(data: Uint8Array): Promise<boolean> {
  try {
    if (!('serial' in navigator)) {
      console.warn('Web Serial API not supported');
      return false;
    }
    
    // Request port access
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 });
    
    const writer = port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
    
    await port.close();
    return true;
  } catch (error) {
    console.error('Serial print error:', error);
    return false;
  }
}

// Print using browser's print dialog (fallback)
function buildReceiptCopyBody(
  sale: Sale,
  branch: Branch,
  paperWidth: 58 | 80,
  company: ReturnType<typeof getCompanySettings>,
  qrCodeDataURL: string,
  copyLabel?: string,
): string {
  return `
  <div class="receipt-copy">
  ${copyLabel ? `<div class="center bold large" style="margin-bottom:6px;">*** ${copyLabel.toUpperCase()} ***</div>` : ''}
  ${company.logo ? `<div class="center" style="margin-bottom: 5px;"><img src="${company.logo}" alt="Logo" style="max-height: 40px; max-width: ${paperWidth === 80 ? '60' : '40'}mm; object-fit: contain;"></div>` : ''}
  <div class="center bold large">${company.tradeName || company.name || branch.name.toUpperCase()}</div>
  <div class="center small">${branch.address || ''}</div>
  <div class="center small">Tel: ${branch.phone || ''}</div>
  <div class="center small">NIF: ${company.nif}</div>
  
  <div class="divider"></div>
  
  <div class="center bold">${sale.invoiceNumber}</div>
  <div class="center small">${new Date(sale.createdAt).toLocaleString('pt-AO')}</div>
  
  <div class="divider"></div>
  
  ${sale.items.map(item => `
    <div class="item-name">${item.productName}</div>
    <div class="item-details">
      <span>${item.quantity} x ${item.unitPrice.toLocaleString('pt-AO')}</span>
      <span>${item.subtotal.toLocaleString('pt-AO')} Kz</span>
    </div>
  `).join('')}
  
  <div class="divider"></div>
  
  <div class="row">
    <span>Subtotal:</span>
    <span>${sale.subtotal.toLocaleString('pt-AO')} Kz</span>
  </div>
  <div class="row">
    <span>${formatTaxLabel(taxRatesFromSaleItems(sale.items))}:</span>
    <span>${sale.taxAmount.toLocaleString('pt-AO')} Kz</span>
  </div>
  
  <div class="double-divider"></div>
  
  <div class="row total-row">
    <span>TOTAL:</span>
    <span>${sale.total.toLocaleString('pt-AO')} Kz</span>
  </div>
  
  <div class="double-divider"></div>
  
  <div class="row">
    <span>Pagamento:</span>
    <span>${sale.paymentMethod === 'cash' ? 'DINHEIRO' : sale.paymentMethod === 'card' ? 'CARTÃO' : 'TRANSF.'}</span>
  </div>
  <div class="row">
    <span>Recebido:</span>
    <span>${sale.amountPaid.toLocaleString('pt-AO')} Kz</span>
  </div>
  ${sale.change > 0 ? `
  <div class="row bold">
    <span>Troco:</span>
    <span>${sale.change.toLocaleString('pt-AO')} Kz</span>
  </div>
  ` : ''}
  
  ${(sale.customerNif || sale.customerName) ? `
  <div class="divider"></div>
  ${sale.customerNif ? `<div class="row small"><span>NIF Cliente:</span><span>${sale.customerNif}</span></div>` : ''}
  ${sale.customerName ? `<div class="row small"><span>Cliente:</span><span>${sale.customerName}</span></div>` : ''}
  ` : ''}
  
  <div class="divider"></div>
  
  <div class="center" style="padding: 10px 0;">
    ${qrCodeDataURL ? `<img src="${qrCodeDataURL}" alt="QR Code AGT" style="width: 100px; height: 100px;">` : ''}
    <div style="font-size: 8px; margin-top: 5px; font-family: monospace;">
      Hash: ${getInvoiceHash(sale)}
    </div>
    <div style="font-size: 7px; color: #666; margin-top: 3px;">
      Documento processado por programa certificado AGT
    </div>
  </div>
  
  <div class="divider"></div>
  
  <div class="footer center">
    <div>Software: ${company.tradeName || company.name || 'NEXOR ERP'}</div>
    <div style="font-size: 9px;">Certificado AGT</div>
    <br>
    <div>Obrigado pela preferência!</div>
  </div>
  </div>`;
}

async function buildReceiptBrowserHtml(
  sale: Sale,
  branch: Branch,
  paperWidth: 58 | 80 = 80,
  copyLabels: (string | undefined)[] = [undefined],
): Promise<string> {
  const { generateAGTQRCodeDataURL } = await import('./agtQRCode');
  const qrCodeDataURL = await generateAGTQRCodeDataURL(sale, branch, { size: 100, margin: 1 });
  const company = getCompanySettings();
  const width = paperWidth === 80 ? '80mm' : '58mm';
  const bodies = copyLabels.map((label) =>
    buildReceiptCopyBody(sale, branch, paperWidth, company, qrCodeDataURL, label),
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Recibo - ${sale.invoiceNumber}</title>
  <style>
    @page {
      size: ${width} auto;
      margin: 0;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      width: ${width};
      padding: 5mm;
      background: white;
      color: black;
    }
    .receipt-copy + .receipt-copy {
      page-break-before: always;
      break-before: page;
    }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .large { font-size: 14px; }
    .small { font-size: 10px; }
    .divider {
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .double-divider {
      border-top: 2px solid #000;
      margin: 5px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .item-name {
      margin-top: 4px;
    }
    .item-details {
      display: flex;
      justify-content: space-between;
      padding-left: 10px;
      font-size: 11px;
    }
    .total-row {
      font-size: 16px;
      font-weight: bold;
      margin: 5px 0;
    }
    .footer {
      margin-top: 15px;
      font-size: 10px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${bodies.join('\n')}
</body>
</html>`;
}

export async function printViaBrowser(
  sale: Sale,
  branch: Branch,
  paperWidth: 58 | 80 = 80,
  copyLabelOrLabels?: string | (string | undefined)[],
  options: { direct?: boolean } = {},
): Promise<void> {
  const labels = Array.isArray(copyLabelOrLabels)
    ? copyLabelOrLabels
    : [copyLabelOrLabels];
  const html = await buildReceiptBrowserHtml(sale, branch, paperWidth, labels);
  const { printHtml } = await import('./printHtml');
  await printHtml(html, { direct: options.direct, silent: options.direct });
}

function normalizePrintReceiptOptions(
  openDrawerOrOptions: boolean | PrintReceiptOptions = false,
): PrintReceiptOptions {
  if (typeof openDrawerOrOptions === 'boolean') {
    return { openDrawer: openDrawerOrOptions };
  }
  return openDrawerOrOptions;
}

/** POS auto-print: always thermal, 2 copies (original + customer). */
export async function printPosThermalReceipts(
  sale: Sale,
  branch: Branch,
  options: { openDrawer?: boolean } = {},
): Promise<{ success: boolean; method: string }> {
  const config = getPrinterConfig();
  return printReceipt(sale, branch, config, {
    openDrawer: options.openDrawer ?? false,
    copies: POS_RECEIPT_COPY_LABELS.length,
    copyLabels: [...POS_RECEIPT_COPY_LABELS],
    direct: true,
  });
}

// Main print function - tries thermal first, falls back to browser
export async function printReceipt(
  sale: Sale,
  branch: Branch,
  config: PrinterConfig = DEFAULT_PRINTER_CONFIG,
  openDrawerOrOptions: boolean | PrintReceiptOptions = false,
): Promise<{ success: boolean; method: string }> {
  const options = normalizePrintReceiptOptions(openDrawerOrOptions);
  const copies = Math.max(1, options.copies ?? 1);
  const copyLabels = options.copyLabels ?? [];
  const labels = Array.from({ length: copies }, (_, i) => copyLabels[i]);

  if (config.type === 'usb' && 'serial' in navigator) {
    try {
      let serialOk = true;
      for (let copyIndex = 0; copyIndex < copies; copyIndex++) {
        const copyLabel = copyLabels[copyIndex];
        const openDrawer = options.openDrawer === true && copyIndex === 0;
        let data = generateESCPOSReceipt(sale, branch, config, copyLabel);

        if (openDrawer) {
          const encoder = new TextEncoder();
          const drawerCmd = encoder.encode(ESC_POS.OPEN_DRAWER);
          const combined = new Uint8Array(data.length + drawerCmd.length);
          combined.set(drawerCmd);
          combined.set(data, drawerCmd.length);
          data = combined;
        }

        const success = await printViaSerial(data);
        if (!success) {
          serialOk = false;
          break;
        }
      }
      if (serialOk) {
        return { success: true, method: 'serial' };
      }
    } catch (error) {
      console.warn('Serial printing failed, falling back to browser:', error);
    }
  }

  await printViaBrowser(sale, branch, config.paperWidth, labels, {
    direct: options.direct ?? false,
  });
  return { success: true, method: 'browser' };
}

// Open cash drawer only
export async function openCashDrawer(): Promise<boolean> {
  try {
    if (!('serial' in navigator)) {
      console.warn('Web Serial API not supported for cash drawer');
      return false;
    }
    
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 });
    
    const encoder = new TextEncoder();
    const data = encoder.encode(ESC_POS.OPEN_DRAWER);
    
    const writer = port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
    
    await port.close();
    return true;
  } catch (error) {
    console.error('Failed to open cash drawer:', error);
    return false;
  }
}

// Get saved printer configuration
export function getPrinterConfig(): PrinterConfig {
  try {
    const saved = localStorage.getItem('kwanza_printer_config');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading printer config:', error);
  }
  return DEFAULT_PRINTER_CONFIG;
}

// Save printer configuration
export function savePrinterConfig(config: PrinterConfig): void {
  localStorage.setItem('kwanza_printer_config', JSON.stringify(config));
}
