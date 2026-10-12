/**
 * AGT (Administração Geral Tributária) QR Code Generator
 * Compliant with Executive Decree 683/25 for Angola e-invoicing
 * 
 * The QR code contains invoice verification data as required by AGT
 */

import QRCode from 'qrcode';
import { Sale, Branch } from '@/types/erp';
import { getCompanySettings } from './companySettings';
import { resolveSaleDocumentType } from './fiscalInvoiceType';

// AGT QR Code Data Structure
export interface AGTQRCodeData {
  // Emitter (Seller) Information
  nifEmissor: string;        // Seller's NIF (Número de Identificação Fiscal)
  nomeEmissor: string;       // Seller's name
  
  // Customer Information
  nifCliente?: string;       // Customer's NIF (optional for final consumers)
  nomeCliente?: string;      // Customer's name
  
  // Invoice Information
  tipoDocumento: 'FT' | 'FR' | 'FS' | 'TV' | 'NC' | 'ND';
  numeroDocumento: string;   // Invoice number
  dataEmissao: string;       // Issue date (YYYYMMDD)
  horaEmissao: string;       // Issue time (HHMMSS)
  
  // Financial Values
  totalSemIVA: number;       // Subtotal without VAT
  totalIVA: number;          // Total VAT amount
  totalComIVA: number;       // Total with VAT
  
  // Security & Validation
  hash: string;              // First 4 characters of the document's digital signature
  atcud?: string;            // ATCUD (Código Único de Documento) - unique document code
  cuce?: string;             // CUCE (Código Único de Controlo e Validação) - from AGT validation
  
  // Software Information
  certificadoSoftware?: string; // Certified software number
}

// Get company info from settings
function getCompanyInfo() {
  const settings = getCompanySettings();
  return {
    nif: settings.nif,
    nome: settings.name,
    softwareCertificado: settings.agtCertificateNumber || 'SW001',
  };
}

/**
 * First 4 characters of the document's digital signature (SAF-T / AGT QR field K).
 * Never invent a hash — missing signature prints as "----".
 */
export function getInvoiceHash(sale: Sale): string {
  const stored = String(sale.saftHash || '').trim();
  if (stored && stored !== '0') {
    return stored.slice(0, 4).toUpperCase();
  }
  return '----';
}

/**
 * ATCUD for print/QR. Real codes come from AGT; until then SAF-T uses "0".
 * Do not synthesize KWERP-... placeholders that look like live validation.
 */
export function getSaleAtcud(sale: Sale): string {
  const stored = String(sale.atcud || '').trim();
  return stored || '0';
}

export const AGT_QR_VERIFY_BASE = 'https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consultar-fe';
/** AGT: PNG 350x350 px, error correction M, AGT logo under 20% of the image. */
export const AGT_QR_PIXELS = 350;
/** Logo side as a fraction of the QR side (~6% of the area) — level M only recovers ~15%. */
const AGT_QR_LOGO_SIDE = 0.24;

/**
 * documentNo exactly as transmitted to AGT (backend `formatDocumentNo`): "<type> <number>",
 * with FS travelling as FR because AGT has no FS type.
 */
export function agtDocumentNo(type: string | undefined, number: string | undefined): string {
  const raw = String(number || '').trim();
  const upper = String(type || 'FT').toUpperCase();
  const agtType = upper === 'FS' ? 'FR' : upper;
  if (!raw) return agtType;
  if (raw.toUpperCase().startsWith(`${agtType} `)) return raw;
  if (/^(FT|FR|FS|TV|NC|ND)\s+/i.test(raw)) return raw.replace(/^FS\s+/i, 'FR ');
  return `${agtType} ${raw}`;
}

/** Kiosk URL; spaces in documentNo become %20 (AGT rule), "/" stays readable. */
export function buildAGTVerificationUrl(nifEmissor: string, documentNo: string): string {
  const emissor = encodeURIComponent(String(nifEmissor || '').trim());
  const document = encodeURIComponent(String(documentNo || '').trim()).replace(/%2F/gi, '/');
  return `${AGT_QR_VERIFY_BASE}?emissor=${emissor}&document=${document}`;
}

/** QR content per the AGT e-invoicing spec: the AGT kiosk verification URL. */
export function buildAGTQRCodeString(data: AGTQRCodeData): string {
  return buildAGTVerificationUrl(data.nifEmissor, agtDocumentNo(data.tipoDocumento, data.numeroDocumento));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('AGT logo failed to load'));
    img.src = src;
  });
}

/** White pad + AGT logo in the centre of an already drawn QR canvas. */
async function drawAgtLogo(canvas: HTMLCanvasElement): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { AGT_LOGO_DATA_URL } = await import('./agtLogo');
  const logo = await loadImage(AGT_LOGO_DATA_URL);
  const side = Math.round(canvas.width * AGT_QR_LOGO_SIDE);
  const x = Math.round((canvas.width - side) / 2);
  const y = Math.round((canvas.height - side) / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, side, side);
  ctx.drawImage(logo, x, y, side, side);
}

async function renderAgtQrCanvas(canvas: HTMLCanvasElement, qrString: string, margin: number): Promise<void> {
  await QRCode.toCanvas(canvas, qrString, {
    width: AGT_QR_PIXELS,
    margin,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  try {
    await drawAgtLogo(canvas);
  } catch (e) {
    console.warn('[AGT QR] logo skipped:', e);
  }
}

/**
 * Convert sale to AGT QR Code data format
 */
export function saleToAGTQRData(sale: Sale, branch?: Branch): AGTQRCodeData {
  const issueDate = new Date(sale.createdAt);
  const companyInfo = getCompanyInfo();
  
  return {
    nifEmissor: companyInfo.nif,
    nomeEmissor: branch?.name || companyInfo.nome,
    nifCliente: sale.customerNif,
    nomeCliente: sale.customerName,
    tipoDocumento: resolveSaleDocumentType({
      invoiceType: sale.invoiceType,
      invoiceNumber: sale.invoiceNumber,
    }),
    numeroDocumento: sale.invoiceNumber,
    dataEmissao: issueDate.toISOString().slice(0, 10).replace(/-/g, ''),
    horaEmissao: issueDate.toTimeString().slice(0, 8).replace(/:/g, ''),
    totalSemIVA: sale.subtotal,
    totalIVA: sale.taxAmount,
    totalComIVA: sale.total,
    hash: getInvoiceHash(sale),
    atcud: getSaleAtcud(sale),
    cuce: sale.agtCode,
    certificadoSoftware: companyInfo.softwareCertificado,
  };
}

/**
 * Generate QR code as Data URL for display in documents
 */
export async function generateAGTQRCodeDataURL(
  sale: Sale,
  branch?: Branch,
  options: { size?: number; margin?: number } = {}
): Promise<string> {
  // `size` is the display size; the PNG itself is always AGT's 350x350.
  const { margin = 1 } = options;

  const qrData = saleToAGTQRData(sale, branch);
  const qrString = buildAGTQRCodeString(qrData);

  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      await renderAgtQrCanvas(canvas, qrString, margin);
      return canvas.toDataURL('image/png');
    }
    return await QRCode.toDataURL(qrString, {
      width: AGT_QR_PIXELS,
      margin,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

/**
 * Generate QR code as SVG string for printing
 */
export async function generateAGTQRCodeSVG(
  sale: Sale,
  branch?: Branch,
  options: { size?: number; margin?: number } = {}
): Promise<string> {
  const { size = 150, margin = 1 } = options;
  
  const qrData = saleToAGTQRData(sale, branch);
  const qrString = buildAGTQRCodeString(qrData);
  
  try {
    const svg = await QRCode.toString(qrString, {
      type: 'svg',
      width: size,
      margin: margin,
      errorCorrectionLevel: 'M',
    });
    const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
    if (!viewBox) return svg;
    const { AGT_LOGO_DATA_URL } = await import('./agtLogo');
    const w = Number(viewBox[1]);
    const side = w * AGT_QR_LOGO_SIDE;
    const pos = (w - side) / 2;
    const logo =
      `<rect x="${pos}" y="${pos}" width="${side}" height="${side}" fill="#FFFFFF"/>` +
      `<image x="${pos}" y="${pos}" width="${side}" height="${side}" href="${AGT_LOGO_DATA_URL}"/>`;
    return svg.replace(/<\/svg>\s*$/, `${logo}</svg>`);
  } catch (error) {
    console.error('Error generating QR code SVG:', error);
    throw error;
  }
}

/**
 * Generate QR code as Canvas for thermal printing
 */
export async function generateAGTQRCodeCanvas(
  sale: Sale,
  canvas: HTMLCanvasElement,
  branch?: Branch,
  options: { size?: number; margin?: number } = {}
): Promise<void> {
  const { size = 150, margin = 1 } = options;
  
  const qrData = saleToAGTQRData(sale, branch);
  const qrString = buildAGTQRCodeString(qrData);
  
  try {
    await renderAgtQrCanvas(canvas, qrString, margin);
    if (size && size !== AGT_QR_PIXELS) {
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    }
  } catch (error) {
    console.error('Error generating QR code to canvas:', error);
    throw error;
  }
}

/**
 * Validate AGT QR code data
 */
export function validateAGTQRData(data: AGTQRCodeData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data.nifEmissor || data.nifEmissor.length !== 10) {
    errors.push('NIF do emissor inválido');
  }
  
  if (!data.numeroDocumento) {
    errors.push('Número do documento é obrigatório');
  }
  
  if (!data.dataEmissao || data.dataEmissao.length !== 8) {
    errors.push('Data de emissão inválida');
  }
  
  if (data.totalComIVA <= 0) {
    errors.push('Total deve ser maior que zero');
  }
  
  if (!data.hash || data.hash.length !== 4) {
    errors.push('Hash deve ter 4 caracteres');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format the verification text that appears below the QR code
 */
export function formatVerificationText(sale: Sale, branch?: Branch): string {
  const qrData = saleToAGTQRData(sale, branch);
  const lines = [
    `NIF: ${qrData.nifEmissor}`,
    `Doc: ${agtDocumentNo(qrData.tipoDocumento, qrData.numeroDocumento)}`,
    `ATCUD: ${qrData.atcud}`,
    `Hash: ${qrData.hash}`,
  ];
  
  if (qrData.cuce) {
    lines.push(`CUCE: ${qrData.cuce}`);
  }
  
  return lines.join(' | ');
}

// Note: Company info is now managed via companySettings.ts
// These exports are kept for backwards compatibility but use the new system
