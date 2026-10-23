/**
 * Label/Barcode Printer Service for NEXOR ERP
 * Supports printing product labels with barcodes on thermal label printers
 */

import { Product } from '@/types/erp';

export interface LabelConfig {
  width: number; // mm
  height: number; // mm
  showPrice: boolean;
  showBarcode: boolean;
  showSKU: boolean;
  copies: number;
}

export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  width: 50,
  height: 25,
  showPrice: true,
  showBarcode: true,
  showSKU: true,
  copies: 1,
};

// Generate EAN-13 check digit
function generateEAN13CheckDigit(code: string): string {
  if (code.length !== 12) return code;
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return code + checkDigit;
}

/** Real Code 128B SVG a gun can read. Not decorative bars. */
export function generateBarcodeSVG(code: string): string {
  // Simple Code 128B encoding
  const CODE128_START_B = 104;
  const CODE128_STOP = 106;
  
  const CODE128_PATTERNS: Record<number, string> = {
    0: '11011001100', 1: '11001101100', 2: '11001100110', 3: '10010011000',
    4: '10010001100', 5: '10001001100', 6: '10011001000', 7: '10011000100',
    8: '10001100100', 9: '11001001000', 10: '11001000100', 11: '11000100100',
    12: '10110011100', 13: '10011011100', 14: '10011001110', 15: '10111001100',
    16: '10011101100', 17: '10011100110', 18: '11001110010', 19: '11001011100',
    20: '11001001110', 21: '11011100100', 22: '11001110100', 23: '11101101110',
    24: '11101001100', 25: '11100101100', 26: '11100100110', 27: '11101100100',
    28: '11100110100', 29: '11100110010', 30: '11011011000', 31: '11011000110',
    32: '11000110110', 33: '10100011000', 34: '10001011000', 35: '10001000110',
    36: '10110001000', 37: '10001101000', 38: '10001100010', 39: '11010001000',
    40: '11000101000', 41: '11000100010', 42: '10110111000', 43: '10110001110',
    44: '10001101110', 45: '10111011000', 46: '10111000110', 47: '10001110110',
    48: '11101110110', 49: '11010001110', 50: '11000101110', 51: '11011101000',
    52: '11011100010', 53: '11011101110', 54: '11101011000', 55: '11101000110',
    56: '11100010110', 57: '11101101000', 58: '11101100010', 59: '11100011010',
    60: '11101111010', 61: '11001000010', 62: '11110001010', 63: '10100110000',
    64: '10100001100', 65: '10010110000', 66: '10010000110', 67: '10000101100',
    68: '10000100110', 69: '10110010000', 70: '10110000100', 71: '10011010000',
    72: '10011000010', 73: '10000110100', 74: '10000110010', 75: '11000010010',
    76: '11001010000', 77: '11110111010', 78: '11000010100', 79: '10001111010',
    80: '10100111100', 81: '10010111100', 82: '10010011110', 83: '10111100100',
    84: '10011110100', 85: '10011110010', 86: '11110100100', 87: '11110010100',
    88: '11110010010', 89: '11011011110', 90: '11011110110', 91: '11110110110',
    92: '10101111000', 93: '10100011110', 94: '10001011110', 95: '10111101000',
    96: '10111100010', 97: '11110101000', 98: '11110100010', 99: '10111011110',
    100: '10111101110', 101: '11101011110', 102: '11110101110', 103: '11010000100',
    104: '11010010000', 105: '11010011100', 106: '1100011101011',
  };
  
  // Encode the string
  const values: number[] = [CODE128_START_B];
  let checksum = CODE128_START_B;
  
  for (let i = 0; i < code.length; i++) {
    const charCode = code.charCodeAt(i) - 32;
    if (charCode >= 0 && charCode < 95) {
      values.push(charCode);
      checksum += charCode * (i + 1);
    }
  }
  
  values.push(checksum % 103);
  values.push(CODE128_STOP);
  
  // Generate pattern
  let pattern = '';
  for (const value of values) {
    pattern += CODE128_PATTERNS[value] || '';
  }
  
  // Integer modules + viewBox so print/CSS cannot smear the bars.
  const module = 1;
  const quiet = 10;
  const barH = 48;
  const padY = 4;
  const width = quiet * 2 + pattern.length * module;
  const height = barH + padY * 2;
  let x = quiet;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">`;
  svg += `<rect width="${width}" height="${height}" fill="white"/>`;

  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      svg += `<rect x="${x}" y="${padY}" width="${module}" height="${barH}" fill="black"/>`;
    }
    x += module;
  }

  svg += `</svg>`;
  return svg;
}

// Print product label
export function printProductLabel(
  product: Product,
  config: LabelConfig = DEFAULT_LABEL_CONFIG
): void {
  const printWindow = window.open('', '_blank', 'width=400,height=300');
  
  if (!printWindow) {
    console.error('Could not open print window');
    return;
  }
  
  const barcodeCode = product.barcode || product.sku || product.id.slice(0, 12);
  const barcodeSVG = generateBarcodeSVG(barcodeCode);
  
  const labelHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiqueta - ${product.name}</title>
  <style>
    @page {
      size: ${config.width}mm ${config.height}mm;
      margin: 0;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
      width: ${config.width}mm;
      height: ${config.height}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2mm;
      background: white;
    }
    .product-name {
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 2px;
    }
    .barcode {
      max-width: 100%;
      height: auto;
    }
    .barcode-text {
      font-size: 8px;
      font-family: monospace;
      margin-top: 2px;
    }
    .price {
      font-size: 14px;
      font-weight: bold;
      margin-top: 2px;
    }
    .sku {
      font-size: 7px;
      color: #666;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="product-name">${product.name}</div>
  ${config.showBarcode ? `
    <div class="barcode">${barcodeSVG}</div>
    <div class="barcode-text">${barcodeCode}</div>
  ` : ''}
  ${config.showPrice ? `
    <div class="price">${product.price.toLocaleString('pt-AO')} Kz</div>
  ` : ''}
  ${config.showSKU ? `
    <div class="sku">SKU: ${product.sku}</div>
  ` : ''}
</body>
</html>
  `;
  
  // Generate multiple labels if copies > 1
  const fullHTML = Array(config.copies).fill(labelHTML).join('<div style="page-break-after: always;"></div>');
  
  printWindow.document.write(fullHTML);
  printWindow.document.close();
  
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

// Print multiple product labels
export function printProductLabels(
  products: { product: Product; copies: number }[],
  config: Omit<LabelConfig, 'copies'> = DEFAULT_LABEL_CONFIG
): void {
  const printWindow = window.open('', '_blank', 'width=600,height=800');
  
  if (!printWindow) {
    console.error('Could not open print window');
    return;
  }
  
  let labelsHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Etiquetas de Produtos</title>
  <style>
    @page {
      size: ${config.width}mm ${config.height}mm;
      margin: 0;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    .label {
      font-family: Arial, sans-serif;
      width: ${config.width}mm;
      height: ${config.height}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2mm;
      background: white;
      page-break-after: always;
    }
    .product-name {
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 2px;
    }
    .barcode {
      max-width: 100%;
      height: auto;
    }
    .barcode-text {
      font-size: 8px;
      font-family: monospace;
      margin-top: 2px;
    }
    .price {
      font-size: 14px;
      font-weight: bold;
      margin-top: 2px;
    }
    .sku {
      font-size: 7px;
      color: #666;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  `;
  
  for (const { product, copies } of products) {
    const barcodeCode = product.barcode || product.sku || product.id.slice(0, 12);
    const barcodeSVG = generateBarcodeSVG(barcodeCode);
    
    for (let i = 0; i < copies; i++) {
      labelsHTML += `
  <div class="label">
    <div class="product-name">${product.name}</div>
    ${config.showBarcode ? `
      <div class="barcode">${barcodeSVG}</div>
      <div class="barcode-text">${barcodeCode}</div>
    ` : ''}
    ${config.showPrice ? `
      <div class="price">${product.price.toLocaleString('pt-AO')} Kz</div>
    ` : ''}
    ${config.showSKU ? `
      <div class="sku">SKU: ${product.sku}</div>
    ` : ''}
  </div>
      `;
    }
  }
  
  labelsHTML += `
</body>
</html>
  `;
  
  printWindow.document.write(labelsHTML);
  printWindow.document.close();
  
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

// Get saved label configuration
export function getLabelConfig(): LabelConfig {
  try {
    const saved = localStorage.getItem('kwanza_label_config');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading label config:', error);
  }
  return DEFAULT_LABEL_CONFIG;
}

// Save label configuration
export function saveLabelConfig(config: LabelConfig): void {
  localStorage.setItem('kwanza_label_config', JSON.stringify(config));
}
