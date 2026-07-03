import * as XLSX from 'xlsx';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
import { Product, Client, Supplier } from '@/types/erp';
import { ColumnMapping } from '@/components/import/ColumnMappingDialog';

// Generic export to Excel for any data
export function exportToExcel(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return;
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  
  // Auto-size columns
  const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Export clients to Excel
export function exportClientsToExcel(clients: Client[], filename: string = 'clientes.xlsx') {
  const data = clients.map(c => ({
    'Código': c.id.slice(0, 8).toUpperCase(),
    'Nome': c.name,
    'NIF': c.nif,
    'Telefone': c.phone || '',
    'Email': c.email || '',
    'Morada': c.address || '',
    'Cidade': c.city || '',
    'País': c.country,
    'Limite Crédito': c.creditLimit,
    'Saldo Actual': c.currentBalance,
    'Estado': c.isActive ? 'Activo' : 'Inactivo',
    'Data Criação': c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-AO') : '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  
  const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, filename);
}

// Export suppliers to Excel
export function exportSuppliersToExcel(suppliers: Supplier[], filename: string = 'fornecedores.xlsx') {
  const data = suppliers.map(s => ({
    'Código': s.id.slice(0, 8).toUpperCase(),
    'Nome': s.name,
    'NIF': s.nif,
    'Pessoa Contacto': s.contactPerson || '',
    'Telefone': s.phone || '',
    'Email': s.email || '',
    'Morada': s.address || '',
    'Cidade': s.city || '',
    'País': s.country,
    'Prazo Pagamento': s.paymentTerms,
    'Estado': s.isActive ? 'Activo' : 'Inactivo',
    'Notas': s.notes || '',
    'Data Criação': s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-AO') : '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fornecedores');
  
  const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, filename);
}

export interface ExcelProduct {
  codigo: string;
  descricao: string;
  preco: number;
  custo: number;
  quantidade: number;
  unidade: string;
  categoria: string;
  iva: number;
  codigoBarras?: string;
  fornecedor?: string;
  qtdMinima?: number;
  localizacao?: string;
}

// Export products to Excel
export function exportProductsToExcel(products: Product[], filename: string = 'produtos.xlsx') {
  const data = products.map(p => ({
    'Código': p.sku,
    'Descrição': p.name,
    'Código de Barras': p.barcode || '',
    'Categoria': p.category,
    'Preço Venda': p.price,
    'Preço Custo': p.cost,
    'Quantidade': p.stock,
    'Unidade': p.unit,
    'IVA %': p.taxRate,
    'Activo': p.isActive ? 'Sim' : 'Não',
    'Filial': p.branchId,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  
  // Auto-size columns
  const colWidths = Object.keys(data[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, filename);
}

// Export to CSV
export function exportProductsToCSV(products: Product[], filename: string = 'produtos.csv') {
  const data = products.map(p => ({
    codigo: p.sku,
    descricao: p.name,
    codigo_barras: p.barcode || '',
    categoria: p.category,
    preco_venda: p.price,
    preco_custo: p.cost,
    quantidade: p.stock,
    unidade: p.unit,
    iva: p.taxRate,
    activo: p.isActive ? '1' : '0',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Detect if the first row looks like data (no real headers)
function detectHeaderless(sheet: XLSX.WorkSheet): boolean {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  if (rawRows.length === 0) return false;
  const firstRow = rawRows[0];
  // If first cell is purely numeric, it's likely a code (data), not a header
  if (firstRow.length > 0 && !isNaN(Number(firstRow[0]))) return true;
  return false;
}

// Parse Excel file with optional custom column mapping
export async function parseExcelFile(file: File, columnMappings?: ColumnMapping[]): Promise<ExcelProduct[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const isHeaderless = detectHeaderless(firstSheet);
        
        let rows: any[];
        
        if (isHeaderless) {
          // No header row — read all rows as arrays, then map by column position
          const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
          const colCount = rawRows[0]?.length || 0;
          
          // Auto-assign headers based on column count
          rows = rawRows.filter(r => r.some(cell => cell !== null && cell !== undefined && cell !== '')).map(r => {
            if (colCount >= 3) {
              // 3+ columns: code, description, price (or more)
              return {
                'Código': r[0],
                'Descrição': r[1],
                'Preço Venda': r[2] || 0,
                'Preço Custo': r[3] || 0,
                'Quantidade': r[4] || 0,
                'Unidade': r[5] || 'UN',
                'Categoria': r[6] || '',
                'IVA %': r[7] || DEFAULT_VAT_RATE,
              };
            } else {
              // 2 columns: code + description only
              return {
                'Código': r[0],
                'Descrição': r[1] || '',
              };
            }
          });
        } else {
          rows = XLSX.utils.sheet_to_json(firstSheet);
        }
        
        const products: ExcelProduct[] = rows.map((row: any) => {
          // If custom mappings provided, use them
          if (columnMappings && columnMappings.length > 0) {
            const getMappedValue = (field: string) => {
              const mapping = columnMappings.find(m => m.systemField === field);
              return mapping?.excelColumn ? row[mapping.excelColumn] : undefined;
            };
            
            return {
              codigo: String(getMappedValue('codigo') || ''),
              descricao: String(getMappedValue('descricao') || ''),
              preco: parseFloat(getMappedValue('preco') || 0),
              custo: parseFloat(getMappedValue('custo') || 0),
              quantidade: parseInt(getMappedValue('quantidade') || 0),
              unidade: String(getMappedValue('unidade') || 'UN'),
              categoria: String(getMappedValue('categoria') || ''),
              iva: parseFloat(getMappedValue('iva') || String(DEFAULT_VAT_RATE)),
              codigoBarras: getMappedValue('codigoBarras') || '',
              fornecedor: getMappedValue('fornecedor') || '',
              qtdMinima: parseInt(getMappedValue('qtdMinima') || 0),
              localizacao: getMappedValue('localizacao') || '',
            };
          }
          
          // Default mapping with common column name patterns
          return {
            codigo: String(row['Código'] || row['codigo'] || row['SKU'] || row['sku'] || row['Cod'] || row['COD'] || row['Code'] || ''),
            descricao: String(row['Descrição'] || row['descricao'] || row['Nome'] || row['nome'] || row['Produto'] || row['DESCRICAO'] || row['Description'] || ''),
            preco: parseFloat(row['Preço Venda'] || row['preco'] || row['Preço'] || row['Price'] || row['PVP'] || 0),
            custo: parseFloat(row['Preço Custo'] || row['custo'] || row['Cost'] || row['Custo'] || 0),
            quantidade: parseInt(row['Quantidade'] || row['quantidade'] || row['Stock'] || row['Qty'] || row['QTD'] || 0),
            unidade: String(row['Unidade'] || row['unidade'] || row['Unit'] || row['UN'] || 'UN'),
            categoria: String(row['Categoria'] || row['categoria'] || row['Category'] || ''),
            iva: parseFloat(row['IVA %'] || row['iva'] || row['IVA'] || row['Tax'] || String(DEFAULT_VAT_RATE)),
            codigoBarras: row['Código de Barras'] || row['codigo_barras'] || row['Barcode'] || row['EAN'] || '',
            fornecedor: row['Fornecedor'] || row['fornecedor'] || row['Supplier'] || '',
            qtdMinima: parseInt(row['Qtd Mínima'] || row['qtd_minima'] || row['Min Qty'] || 0),
            localizacao: row['Localização'] || row['localizacao'] || row['Location'] || '',
          };
        });
        
        resolve(products);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Get Excel file headers for column mapping
export async function getExcelHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];
        
        if (jsonData.length > 0) {
          const headers = jsonData[0].map(h => String(h || '').trim()).filter(Boolean);
          resolve(headers);
        } else {
          resolve([]);
        }
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Generate Excel template for import
export function downloadImportTemplate() {
  const templateData = [
    {
      'Código': 'PROD001',
      'Descrição': 'Exemplo de Produto',
      'Código de Barras': '1234567890123',
      'Categoria': 'GERAL',
      'Preço Venda': 1000,
      'Preço Custo': 700,
      'Quantidade': 100,
      'Unidade': 'UN',
      'IVA %': DEFAULT_VAT_RATE,
      'Fornecedor': 'Fornecedor Exemplo',
      'Qtd Mínima': 10,
      'Localização': 'A1',
    }
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  
  XLSX.writeFile(wb, 'template_importacao_produtos.xlsx');
}

// Validate imported products
export function validateImportedProducts(products: ExcelProduct[]): {
  valid: ExcelProduct[];
  errors: { row: number; errors: string[] }[];
} {
  const valid: ExcelProduct[] = [];
  const errors: { row: number; errors: string[] }[] = [];

  products.forEach((product, index) => {
    const rowErrors: string[] = [];
    
    if (!product.codigo) {
      rowErrors.push('Código é obrigatório');
    }
    if (!product.descricao) {
      rowErrors.push('Descrição é obrigatória');
    }
    if (product.preco < 0) {
      rowErrors.push('Preço não pode ser negativo');
    }
    if (product.quantidade < 0) {
      rowErrors.push('Quantidade não pode ser negativa');
    }
    if (product.iva < 0 || product.iva > 100) {
      rowErrors.push('IVA deve estar entre 0 e 100');
    }

    if (rowErrors.length > 0) {
      errors.push({ row: index + 2, errors: rowErrors });
    } else {
      valid.push(product);
    }
  });

  return { valid, errors };
}

// ============ STOCK ENTRY (ADJUST IN) IMPORT ============

export interface ExcelStockEntryLine {
  codigo: string;
  descricao?: string;
  quantidade: number;
  custo: number;
}

function normalizeSpreadsheetHeader(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

/** Format product codes from Excel cells (numbers must not use scientific notation). */
export function formatSpreadsheetCode(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Number.isInteger(value)) return String(value);
    const asText = String(value);
    return asText.includes('e') || asText.includes('E')
      ? String(Math.trunc(value))
      : asText.replace(/\.0+$/, '');
  }
  let text = String(value).trim();
  if (!text) return '';
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return String(Math.trunc(n));
  }
  return text;
}

function parseSpreadsheetNumber(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim().replace(/\s/g, '');
  if (!raw) return 0;
  // 1.234,56 (pt) vs 1,234.56 (en)
  const ptStyle = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(raw);
  const normalized = ptStyle ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Pick first non-empty cell matching any header alias (exact or normalized). */
function pickSpreadsheetField(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedAliases = aliases.map(normalizeSpreadsheetHeader);

  for (const alias of aliases) {
    const val = row[alias];
    if (val !== undefined && val !== null && String(val).trim() !== '') return val;
  }

  for (const [key, val] of Object.entries(row)) {
    if (val === undefined || val === null || String(val).trim() === '') continue;
    const nk = normalizeSpreadsheetHeader(key);
    if (normalizedAliases.includes(nk)) return val;
  }

  return undefined;
}

/** Quantity column priority: explicit qty → count sheet count/diff → system stock. */
function pickSpreadsheetQuantity(row: Record<string, unknown>): number {
  const priorityGroups = [
    ['quantidade', 'quantity', 'qty', 'qtd a entrar', 'entrada', 'qtde'],
    ['contagem', 'count', 'contado', 'contagem fisica', 'contagem física'],
    ['diff', 'dif', 'diferenca', 'diferença', 'delta'],
    ['qtd', 'stock', 'existencias', 'existências', 'exist', 'saldo'],
  ];

  for (const group of priorityGroups) {
    for (const [key, val] of Object.entries(row)) {
      if (val === undefined || val === null || String(val).trim() === '') continue;
      const nk = normalizeSpreadsheetHeader(key);
      if (group.some((g) => nk === g || nk.startsWith(`${g} `) || nk.endsWith(` ${g}`))) {
        const n = parseSpreadsheetNumber(val);
        if (n !== 0) return Math.abs(n);
      }
    }
  }

  const fallback = pickSpreadsheetField(row, [
    'Quantidade', 'quantidade', 'Quantity', 'quantity',
    'Contagem', 'contagem', 'Count', 'count',
    'Diff', 'diff', 'Dif', 'Diferença', 'Diferenca',
    'Qty', 'qty', 'QTD', 'qtd', 'Qtd', 'Qtd.',
    'Stock', 'stock', 'Exist.', 'Existências',
  ]);
  return Math.abs(parseSpreadsheetNumber(fallback));
}

function parseStockEntryRow(row: Record<string, unknown>): ExcelStockEntryLine {
  const codigoRaw = pickSpreadsheetField(row, [
    'Código', 'Codigo', 'codigo', 'SKU', 'sku', 'Cod', 'COD', 'Code', 'code',
    'Código Produto', 'codigo_produto', 'Ref', 'Referência', 'Referencia',
  ]);
  const costRaw = pickSpreadsheetField(row, [
    'Preço Custo', 'Preco Custo', 'custo', 'Custo', 'Cost', 'cost',
    'Preço de Custo', 'preco_custo', 'Valor Custo',
  ]);
  const descRaw = pickSpreadsheetField(row, [
    'Descrição', 'Descricao', 'descricao', 'Nome', 'nome', 'Produto', 'Description',
  ]);

  return {
    codigo: formatSpreadsheetCode(codigoRaw),
    descricao: descRaw != null ? String(descRaw).trim() : undefined,
    quantidade: pickSpreadsheetQuantity(row),
    custo: parseSpreadsheetNumber(costRaw),
  };
}

function parseHeaderlessStockEntryRow(cells: unknown[]): ExcelStockEntryLine {
  const colCount = cells.length;
  // Count sheet layout: code | description | [barcode] | system qty | count | diff
  let qtyCell: unknown;
  if (colCount >= 6) {
    qtyCell = cells[5] ?? cells[4] ?? cells[3];
  } else if (colCount >= 5) {
    qtyCell = cells[4] ?? cells[3] ?? cells[2];
  } else if (colCount >= 4) {
    qtyCell = cells[3] ?? cells[2];
  } else if (colCount >= 3) {
    qtyCell = cells[2];
  }
  // 2 columns = code + description only (quantity entered manually after import)

  return parseStockEntryRow({
    Código: formatSpreadsheetCode(cells[0]),
    Descrição: colCount >= 2 ? cells[1] : undefined,
    Quantidade: qtyCell,
    'Preço Custo': colCount >= 5 ? cells[colCount - 1] : undefined,
  });
}

/** Parse Excel/CSV rows for stock entry (code + quantity + optional cost). */
export async function parseStockEntryExcelFile(
  file: File,
  columnMappings?: ColumnMapping[],
): Promise<ExcelStockEntryLine[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const isHeaderless = detectHeaderless(firstSheet);

        let rows: ExcelStockEntryLine[] = [];

        if (isHeaderless) {
          const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
          rows = rawRows
            .filter((r) => r.some((cell) => cell !== null && cell !== undefined && cell !== ''))
            .map((r) => parseHeaderlessStockEntryRow(r));
        } else if (columnMappings && columnMappings.length > 0) {
          const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
          rows = jsonRows.map((row) => {
            const getMappedValue = (field: string) => {
              const mapping = columnMappings.find((m) => m.systemField === field);
              return mapping?.excelColumn ? row[mapping.excelColumn] : undefined;
            };
            return parseStockEntryRow({
              Código: getMappedValue('codigo'),
              Descrição: getMappedValue('descricao'),
              Quantidade: getMappedValue('quantidade'),
              'Preço Custo': getMappedValue('custo'),
            });
          });
        } else {
          const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);
          rows = jsonRows.map((row) => parseStockEntryRow(row));
        }

        resolve(rows.filter((r) => String(r.codigo || '').trim()));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function validateImportedStockEntryLines(products: ExcelStockEntryLine[]): {
  valid: ExcelStockEntryLine[];
  errors: { row: number; errors: string[] }[];
} {
  const valid: ExcelStockEntryLine[] = [];
  const errors: { row: number; errors: string[] }[] = [];

  products.forEach((row, index) => {
    const rowErrors: string[] = [];

    if (!row.codigo.trim()) {
      rowErrors.push('Código é obrigatório');
    }
    if (row.custo < 0) {
      rowErrors.push('Custo não pode ser negativo');
    }

    if (rowErrors.length > 0) {
      errors.push({ row: index + 2, errors: rowErrors });
    } else {
      valid.push({
        codigo: row.codigo.trim(),
        descricao: row.descricao,
        quantidade: row.quantidade > 0 ? Math.round(row.quantidade) : 0,
        custo: Math.max(0, row.custo),
      });
    }
  });

  return { valid, errors };
}

export function downloadStockEntryImportTemplate() {
  const templateData = [
    {
      'Código': 'PROD001',
      'Descrição': 'Exemplo de produto',
    },
    {
      'Código': 'PROD002',
      'Descrição': 'Outro produto',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Entrada');

  ws['!cols'] = [{ wch: 14 }, { wch: 40 }];

  XLSX.writeFile(wb, 'template_entrada_stock.xlsx');
}

// ============ CLIENT IMPORT ============

export interface ExcelClient {
  nome: string;
  nif: string;
  telefone?: string;
  email?: string;
  morada?: string;
  cidade?: string;
  pais?: string;
  limiteCredito?: number;
}

export async function parseClientsFromExcel(file: File, columnMappings?: ColumnMapping[]): Promise<ExcelClient[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        const clients: ExcelClient[] = jsonData.map((row: any) => {
          // If custom mappings provided, use them
          if (columnMappings && columnMappings.length > 0) {
            const getMappedValue = (field: string) => {
              const mapping = columnMappings.find(m => m.systemField === field);
              return mapping?.excelColumn ? row[mapping.excelColumn] : undefined;
            };
            
            return {
              nome: String(getMappedValue('nome') || ''),
              nif: String(getMappedValue('nif') || ''),
              telefone: getMappedValue('telefone') || '',
              email: getMappedValue('email') || '',
              morada: getMappedValue('morada') || '',
              cidade: getMappedValue('cidade') || '',
              pais: getMappedValue('pais') || 'Angola',
              limiteCredito: parseFloat(getMappedValue('limiteCredito') || 0),
            };
          }
          
          // Default mapping
          return {
            nome: String(row['Nome'] || row['nome'] || row['Name'] || ''),
            nif: String(row['NIF'] || row['nif'] || row['Nif'] || ''),
            telefone: row['Telefone'] || row['telefone'] || row['Phone'] || '',
            email: row['Email'] || row['email'] || '',
            morada: row['Morada'] || row['morada'] || row['Endereço'] || row['Address'] || '',
            cidade: row['Cidade'] || row['cidade'] || row['City'] || '',
            pais: row['País'] || row['pais'] || row['Country'] || 'Angola',
            limiteCredito: parseFloat(row['Limite Crédito'] || row['limite_credito'] || row['Credit Limit'] || 0),
          };
        });
        
        resolve(clients);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Falha ao ler ficheiro'));
    reader.readAsArrayBuffer(file);
  });
}

export function validateImportedClients(clients: ExcelClient[]): {
  valid: ExcelClient[];
  errors: { row: number; errors: string[] }[];
} {
  const valid: ExcelClient[] = [];
  const errors: { row: number; errors: string[] }[] = [];

  clients.forEach((client, index) => {
    const rowErrors: string[] = [];
    
    if (!client.nome) {
      rowErrors.push('Nome é obrigatório');
    }
    if (!client.nif) {
      rowErrors.push('NIF é obrigatório');
    } else {
      const cleaned = client.nif.replace(/\D/g, '');
      if (cleaned.length !== 10) {
        rowErrors.push('NIF deve ter 10 dígitos');
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ row: index + 2, errors: rowErrors });
    } else {
      valid.push(client);
    }
  });

  return { valid, errors };
}

export function downloadClientImportTemplate() {
  const templateData = [
    {
      'Nome': 'Cliente Exemplo Lda',
      'NIF': '5000123456',
      'Telefone': '+244 923 456 789',
      'Email': 'cliente@exemplo.ao',
      'Morada': 'Rua Principal, 123',
      'Cidade': 'Luanda',
      'País': 'Angola',
      'Limite Crédito': 500000,
    }
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  
  XLSX.writeFile(wb, 'template_importacao_clientes.xlsx');
}

// ============ SUPPLIER IMPORT ============

export interface ExcelSupplier {
  nome: string;
  nif: string;
  pessoaContacto?: string;
  telefone?: string;
  email?: string;
  morada?: string;
  cidade?: string;
  pais?: string;
  prazoPagamento?: string;
  notas?: string;
}

export async function parseSuppliersFromExcel(file: File, columnMappings?: ColumnMapping[]): Promise<ExcelSupplier[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const isHeaderless = detectHeaderless(firstSheet);
        
        let jsonData: any[];
        
        if (isHeaderless) {
          const rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
          jsonData = rawRows
            .filter(r => r.some(cell => cell !== null && cell !== undefined && cell !== ''))
            .map(r => ({
              'NIF': String(r[0] || ''),
              'Nome': String(r[1] || ''),
              'Telefone': r[2] || '',
              'Email': r[3] || '',
              'Morada': r[4] || '',
              'Cidade': r[5] || '',
            }));
        } else {
          jsonData = XLSX.utils.sheet_to_json(firstSheet);
        }
        
        const suppliers: ExcelSupplier[] = jsonData.map((row: any) => {
          // If custom mappings provided, use them
          if (columnMappings && columnMappings.length > 0) {
            const getMappedValue = (field: string) => {
              const mapping = columnMappings.find(m => m.systemField === field);
              return mapping?.excelColumn ? row[mapping.excelColumn] : undefined;
            };
            
            return {
              nome: String(getMappedValue('nome') || ''),
              nif: String(getMappedValue('nif') || ''),
              pessoaContacto: getMappedValue('pessoaContacto') || '',
              telefone: getMappedValue('telefone') || '',
              email: getMappedValue('email') || '',
              morada: getMappedValue('morada') || '',
              cidade: getMappedValue('cidade') || '',
              pais: getMappedValue('pais') || 'Angola',
              prazoPagamento: getMappedValue('prazoPagamento') || 'immediate',
              notas: getMappedValue('notas') || '',
            };
          }
          
          // Default mapping
          return {
            nome: String(row['Nome'] || row['nome'] || row['Name'] || ''),
            nif: String(row['NIF'] || row['nif'] || row['Nif'] || ''),
            pessoaContacto: row['Pessoa Contacto'] || row['pessoa_contacto'] || row['Contact Person'] || '',
            telefone: row['Telefone'] || row['telefone'] || row['Phone'] || '',
            email: row['Email'] || row['email'] || '',
            morada: row['Morada'] || row['morada'] || row['Endereço'] || row['Address'] || '',
            cidade: row['Cidade'] || row['cidade'] || row['City'] || '',
            pais: row['País'] || row['pais'] || row['Country'] || 'Angola',
            prazoPagamento: row['Prazo Pagamento'] || row['prazo_pagamento'] || row['Payment Terms'] || 'immediate',
            notas: row['Notas'] || row['notas'] || row['Notes'] || '',
          };
        });
        
        resolve(suppliers);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Falha ao ler ficheiro'));
    reader.readAsArrayBuffer(file);
  });
}

export type SupplierImportValidationMessages = {
  nameRequired: string;
  nifRequired: string;
};

export function validateImportedSuppliers(
  suppliers: ExcelSupplier[],
  messages?: SupplierImportValidationMessages,
): {
  valid: ExcelSupplier[];
  errors: { row: number; errors: string[] }[];
} {
  const valid: ExcelSupplier[] = [];
  const errors: { row: number; errors: string[] }[] = [];
  const nameRequired = messages?.nameRequired ?? 'Nome é obrigatório';
  const nifRequired = messages?.nifRequired ?? 'NIF/Código é obrigatório';

  suppliers.forEach((supplier, index) => {
    const rowErrors: string[] = [];
    
    if (!supplier.nome) {
      rowErrors.push(nameRequired);
    }
    if (!supplier.nif) {
      rowErrors.push(nifRequired);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: index + 2, errors: rowErrors });
    } else {
      valid.push(supplier);
    }
  });

  return { valid, errors };
}

export type SupplierImportTemplateConfig = {
  columns: {
    name: string;
    nif: string;
    contactPerson: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    country: string;
    paymentTerms: string;
    notes: string;
  };
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  notes: string;
  sheetName: string;
  filename: string;
};

export function downloadSupplierImportTemplate(config?: SupplierImportTemplateConfig) {
  const cols = config?.columns ?? {
    name: 'Nome',
    nif: 'NIF',
    contactPerson: 'Pessoa Contacto',
    phone: 'Telefone',
    email: 'Email',
    address: 'Morada',
    city: 'Cidade',
    country: 'País',
    paymentTerms: 'Prazo Pagamento',
    notes: 'Notas',
  };

  const templateData = [
    {
      [cols.name]: config?.name ?? 'Fornecedor Exemplo Lda',
      [cols.nif]: '5000123456',
      [cols.contactPerson]: config?.contact ?? 'João Silva',
      [cols.phone]: config?.phone ?? '+244 923 456 789',
      [cols.email]: config?.email ?? 'fornecedor@exemplo.ao',
      [cols.address]: config?.address ?? 'Rua Principal, 123',
      [cols.city]: config?.city ?? 'Luanda',
      [cols.country]: config?.country ?? 'Angola',
      [cols.paymentTerms]: '30_days',
      [cols.notes]: config?.notes ?? 'Observações adicionais',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, config?.sheetName ?? 'Template');
  
  XLSX.writeFile(wb, config?.filename ?? 'template_importacao_fornecedores.xlsx');
}
