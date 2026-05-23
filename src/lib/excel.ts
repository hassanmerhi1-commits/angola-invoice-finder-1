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
    } else if (client.nif.length < 9) {
      rowErrors.push('NIF deve ter pelo menos 9 caracteres');
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
