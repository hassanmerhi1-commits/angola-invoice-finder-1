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
  tipoDocumento: 'FT' | 'FR' | 'FS' | 'NC' | 'ND'; // FT, FR, FS, NC, ND
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

/**
 * Build the QR code data string according to AGT specifications
 * Format follows the AGT standard for document verification
 */
export function buildAGTQRCodeString(data: AGTQRCodeData): string {
  // AGT QR Code format (pipe-separated values)
  const fields = [
    `A:${data.nifEmissor}`,                    // A - NIF Emissor
    `B:${data.nomeEmissor}`,                   // B - Nome Emissor
    `C:${data.nifCliente || '999999990'}`,     // C - NIF Cliente (999999990 = Consumidor Final)
    `D:${data.tipoDocumento}`,                 // D - Tipo Documento
    `E:${data.atcud || '0'}`,                   // E - ATCUD
    `F:${data.dataEmissao}`,                   // F - Data Emissão
    `G:${data.numeroDocumento}`,               // G - Número Documento
    `H:${data.totalSemIVA.toFixed(2)}`,        // H - Total sem IVA
    `I:${data.totalIVA.toFixed(2)}`,           // I - Total IVA
    `J:${data.totalComIVA.toFixed(2)}`,        // J - Total com IVA
    `K:${data.hash}`,                          // K - Hash (4 chars)
    `L:${data.certificadoSoftware || '0'}`,    // L - Certificado Software
  ];
  
  // Add CUCE if available (from AGT validation)
  if (data.cuce) {
    fields.push(`M:${data.cuce}`);
  }
  
  return fields.join('*');
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
  const { size = 150, margin = 1 } = options;
  
  const qrData = saleToAGTQRData(sale, branch);
  const qrString = buildAGTQRCodeString(qrData);
  
  try {
    const dataURL = await QRCode.toDataURL(qrString, {
      width: size,
      margin: margin,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
    
    return dataURL;
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
    
    return svg;
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
    await QRCode.toCanvas(canvas, qrString, {
      width: size,
      margin: margin,
      errorCorrectionLevel: 'M',
    });
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
    `Doc: ${qrData.tipoDocumento} ${qrData.numeroDocumento}`,
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
