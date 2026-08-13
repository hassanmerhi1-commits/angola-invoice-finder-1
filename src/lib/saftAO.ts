/**
 * SAF-T AO (Standard Audit File for Tax - Angola)
 * Generator for AGT (Administração Geral Tributária) compliance
 * 
 * Based on Executive Decree 683/25 requirements
 * Format: JSON (as per AGT specification)
 */

import { Sale, Product, Client, Branch, Supplier, Category } from '@/types/erp';
import { getCompanySettings, CompanySettings } from './companySettings';

// SAF-T AO Structure Types
export interface SAFTHeader {
  AuditFileVersion: string;
  CompanyID: string;
  TaxRegistrationNumber: string;
  TaxAccountingBasis: 'F' | 'C' | 'I' | 'P'; // F=Facturação, C=Contabilidade, I=Integrado, P=Parcial
  CompanyName: string;
  BusinessName?: string;
  CompanyAddress: SAFTAddress;
  FiscalYear: string;
  StartDate: string;
  EndDate: string;
  CurrencyCode: string;
  DateCreated: string;
  TaxEntity: string;
  ProductCompanyTaxID: string;
  SoftwareCertificateNumber: string;
  ProductID: string;
  ProductVersion: string;
  HeaderComment?: string;
  Telephone?: string;
  Email?: string;
  Website?: string;
}

export interface SAFTAddress {
  AddressDetail: string;
  City: string;
  PostalCode?: string;
  Region?: string;
  Country: string;
}

export interface SAFTCustomer {
  CustomerID: string;
  AccountID: string;
  CustomerTaxID: string;
  CompanyName: string;
  Contact?: string;
  BillingAddress: SAFTAddress;
  Telephone?: string;
  Email?: string;
  SelfBillingIndicator: '0' | '1';
}

export interface SAFTProduct {
  ProductType: 'P' | 'S' | 'O' | 'I'; // P=Produto, S=Serviço, O=Outro, I=Imposto
  ProductCode: string;
  ProductGroup?: string;
  ProductDescription: string;
  ProductNumberCode: string;
}

export interface SAFTTaxTableEntry {
  TaxType: 'IVA' | 'IS' | 'NS'; // IVA, Imposto Selo, Não Sujeito
  TaxCountryRegion: string;
  TaxCode: string;
  Description: string;
  TaxPercentage: number;
}

export interface SAFTInvoiceLine {
  LineNumber: string;
  ProductCode: string;
  ProductDescription: string;
  Quantity: number;
  UnitOfMeasure: string;
  UnitPrice: number;
  TaxPointDate: string;
  Description: string;
  CreditAmount?: number;
  DebitAmount?: number;
  Tax: {
    TaxType: string;
    TaxCountryRegion: string;
    TaxCode: string;
    TaxPercentage: number;
  };
  SettlementAmount?: number;
}

export interface SAFTDocumentTotals {
  TaxPayable: number;
  NetTotal: number;
  GrossTotal: number;
}

export interface SAFTPayment {
  PaymentMechanism: 'NU' | 'CC' | 'TB' | 'MB' | 'CH' | 'CD' | 'LC' | 'OU';
  PaymentAmount: number;
  PaymentDate: string;
}

export interface SAFTInvoice {
  InvoiceNo: string;
  ATCUD: string;
  DocumentStatus: {
    InvoiceStatus: 'N' | 'A' | 'F'; // N=Normal, A=Anulado, F=Facturado
    InvoiceStatusDate: string;
    SourceID: string;
    SourceBilling: 'P' | 'I' | 'M'; // P=Programa, I=Integrado, M=Manual
  };
  Hash: string;
  HashControl: string;
  Period: string;
  InvoiceDate: string;
  InvoiceType: 'FT' | 'FR' | 'FS' | 'NC' | 'ND' | 'VD' | 'TV' | 'TD' | 'AA' | 'DA';
  SpecialRegimes: {
    SelfBillingIndicator: '0' | '1';
    CashVATSchemeIndicator: '0' | '1';
    ThirdPartiesBillingIndicator: '0' | '1';
  };
  SourceID: string;
  SystemEntryDate: string;
  CustomerID: string;
  ShipTo?: SAFTAddress;
  ShipFrom?: SAFTAddress;
  Line: SAFTInvoiceLine[];
  DocumentTotals: SAFTDocumentTotals;
  Payment?: SAFTPayment[];
}

export interface SAFTMasterFiles {
  Customer: SAFTCustomer[];
  Product: SAFTProduct[];
  TaxTable: {
    TaxTableEntry: SAFTTaxTableEntry[];
  };
}

export interface SAFTSourceDocuments {
  SalesInvoices?: {
    NumberOfEntries: number;
    TotalDebit: number;
    TotalCredit: number;
    Invoice: SAFTInvoice[];
  };
}

export interface SAFTAO {
  AuditFile: {
    Header: SAFTHeader;
    MasterFiles: SAFTMasterFiles;
    SourceDocuments: SAFTSourceDocuments;
  };
}

// Export Options
export interface SAFTExportOptions {
  startDate: string;
  endDate: string;
  branchId?: string;
  includeVoided?: boolean;
  format: 'json' | 'xml';
}

// Generate Hash for SAF-T (simplified)
function generateSAFTHash(invoice: Sale, previousHash?: string): string {
  const dataString = `${invoice.invoiceNumber}|${invoice.createdAt}|${invoice.total}|${previousHash || ''}`;
  let hash = 0;
  for (let i = 0; i < dataString.length; i++) {
    const char = dataString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
}

// Format date for SAF-T (YYYY-MM-DD)
function formatSAFTDate(date: string | Date): string {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

// Format datetime for SAF-T (YYYY-MM-DDTHH:MM:SS)
function formatSAFTDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toISOString().slice(0, 19);
}

// Get period (month) from date
function getPeriod(date: string | Date): string {
  const d = new Date(date);
  return (d.getMonth() + 1).toString().padStart(2, '0');
}

// Build SAF-T Header
function buildHeader(
  company: CompanySettings,
  options: SAFTExportOptions
): SAFTHeader {
  const fiscalYear = new Date(options.startDate).getFullYear().toString();
  
  return {
    AuditFileVersion: '1.0_01',
    CompanyID: company.nif,
    TaxRegistrationNumber: company.nif,
    TaxAccountingBasis: 'F',
    CompanyName: company.name,
    BusinessName: company.tradeName,
    CompanyAddress: {
      AddressDetail: company.address,
      City: company.city,
      PostalCode: company.postalCode,
      Region: company.province,
      Country: 'AO',
    },
    FiscalYear: fiscalYear,
    StartDate: formatSAFTDate(options.startDate),
    EndDate: formatSAFTDate(options.endDate),
    CurrencyCode: 'AOA',
    DateCreated: formatSAFTDate(new Date()),
    TaxEntity: 'Global',
    ProductCompanyTaxID: company.nif,
    SoftwareCertificateNumber: company.agtCertificateNumber || 'SW/AGT/0000/0000',
    ProductID: 'NEXOR ERP',
    ProductVersion: company.softwareVersion || '1.0.0',
    HeaderComment: `SAF-T AO Export - ${company.name}`,
    Telephone: company.phone,
    Email: company.email,
    Website: company.website,
  };
}

// Build Customer entries
function buildCustomers(
  clients: Client[],
  sales: Sale[]
): SAFTCustomer[] {
  const customers: SAFTCustomer[] = [];
  const addedIds = new Set<string>();
  
  // Add known clients
  for (const client of clients) {
    if (!addedIds.has(client.id)) {
      customers.push({
        CustomerID: client.id,
        AccountID: 'Desconhecido',
        CustomerTaxID: client.nif || '999999990',
        CompanyName: client.name,
        BillingAddress: {
          AddressDetail: client.address || 'Desconhecido',
          City: client.city || 'Desconhecido',
          Country: client.country || 'AO',
        },
        Telephone: client.phone,
        Email: client.email,
        SelfBillingIndicator: '0',
      });
      addedIds.add(client.id);
    }
  }
  
  // Add "Consumidor Final" for sales without client
  const hasAnonymousSales = sales.some(s => !s.customerNif);
  if (hasAnonymousSales) {
    customers.push({
      CustomerID: 'CF',
      AccountID: 'Desconhecido',
      CustomerTaxID: '999999990',
      CompanyName: 'Consumidor Final',
      BillingAddress: {
        AddressDetail: 'Desconhecido',
        City: 'Desconhecido',
        Country: 'AO',
      },
      SelfBillingIndicator: '0',
    });
  }
  
  return customers;
}

// Build Product entries
function buildProducts(products: Product[]): SAFTProduct[] {
  return products.map(product => ({
    ProductType: 'P',
    ProductCode: product.sku || product.id,
    ProductGroup: product.category,
    ProductDescription: product.name,
    ProductNumberCode: product.barcode || product.sku || product.id,
  }));
}

// Build Tax Table
function buildTaxTable(): SAFTTaxTableEntry[] {
  return [
    {
      TaxType: 'IVA',
      TaxCountryRegion: 'AO',
      TaxCode: 'NOR',
      Description: 'IVA Taxa Normal',
      TaxPercentage: 14,
    },
    {
      TaxType: 'IVA',
      TaxCountryRegion: 'AO',
      TaxCode: 'RED',
      Description: 'IVA Taxa Reduzida',
      TaxPercentage: 5,
    },
    {
      TaxType: 'IVA',
      TaxCountryRegion: 'AO',
      TaxCode: 'ISE',
      Description: 'IVA Isento',
      TaxPercentage: 0,
    },
  ];
}

// Build Invoice entries
function buildInvoices(
  sales: Sale[],
  options: SAFTExportOptions
): { invoices: SAFTInvoice[]; totalDebit: number; totalCredit: number } {
  const invoices: SAFTInvoice[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let previousHash = '';
  
  const filteredSales = sales.filter(sale => {
    const saleDate = new Date(sale.createdAt);
    const start = new Date(options.startDate);
    const end = new Date(options.endDate);
    end.setHours(23, 59, 59, 999);
    
    const inRange = saleDate >= start && saleDate <= end;
    const matchesBranch = !options.branchId || sale.branchId === options.branchId;
    const includeStatus = options.includeVoided || sale.status === 'completed';
    
    return inRange && matchesBranch && includeStatus;
  });
  
  for (const sale of filteredSales) {
    const hash = sale.saftHash || generateSAFTHash(sale, previousHash);
    
    const paymentMechanism: SAFTPayment['PaymentMechanism'] = 
      sale.paymentMethod === 'cash' ? 'NU' :
      sale.paymentMethod === 'card' ? 'CC' :
      sale.paymentMethod === 'transfer' ? 'TB' : 'OU';
    
    const lines: SAFTInvoiceLine[] = sale.items.map((item, index) => {
      const taxAmount = item.subtotal * 0.14 / 1.14;
      const netAmount = item.subtotal - taxAmount;
      
      return {
        LineNumber: (index + 1).toString(),
        ProductCode: item.productId,
        ProductDescription: item.productName,
        Quantity: item.quantity,
        UnitOfMeasure: 'UN',
        UnitPrice: item.unitPrice,
        TaxPointDate: formatSAFTDate(sale.createdAt),
        Description: item.productName,
        CreditAmount: netAmount,
        Tax: {
          TaxType: 'IVA',
          TaxCountryRegion: 'AO',
          TaxCode: 'NOR',
          TaxPercentage: 14,
        },
      };
    });
    
    invoices.push({
      InvoiceNo: sale.invoiceNumber,
      ATCUD: sale.atcud || '0',
      DocumentStatus: {
        InvoiceStatus: sale.status === 'voided' ? 'A' : 'N',
        InvoiceStatusDate: formatSAFTDateTime(sale.createdAt),
        SourceID: sale.cashierId || 'SYSTEM',
        SourceBilling: 'P',
      },
      Hash: hash,
      HashControl: '1',
      Period: getPeriod(sale.createdAt),
      InvoiceDate: formatSAFTDate(sale.createdAt),
      InvoiceType: 'FR',
      SpecialRegimes: {
        SelfBillingIndicator: '0',
        CashVATSchemeIndicator: '0',
        ThirdPartiesBillingIndicator: '0',
      },
      SourceID: sale.cashierId || 'SYSTEM',
      SystemEntryDate: formatSAFTDateTime(sale.createdAt),
      CustomerID: sale.customerNif ? sale.customerNif : 'CF',
      Line: lines,
      DocumentTotals: {
        TaxPayable: sale.taxAmount,
        NetTotal: sale.subtotal,
        GrossTotal: sale.total,
      },
      Payment: [{
        PaymentMechanism: paymentMechanism,
        PaymentAmount: sale.amountPaid,
        PaymentDate: formatSAFTDate(sale.createdAt),
      }],
    });
    
    if (sale.status === 'completed') {
      totalCredit += sale.total;
    }
    
    previousHash = hash;
  }
  
  return { invoices, totalDebit, totalCredit };
}

// Main SAF-T AO Generator
export function generateSAFTAO(
  sales: Sale[],
  products: Product[],
  clients: Client[],
  options: SAFTExportOptions
): SAFTAO {
  const company = getCompanySettings();
  const { invoices, totalDebit, totalCredit } = buildInvoices(sales, options);
  
  return {
    AuditFile: {
      Header: buildHeader(company, options),
      MasterFiles: {
        Customer: buildCustomers(clients, sales),
        Product: buildProducts(products),
        TaxTable: {
          TaxTableEntry: buildTaxTable(),
        },
      },
      SourceDocuments: {
        SalesInvoices: {
          NumberOfEntries: invoices.length,
          TotalDebit: totalDebit,
          TotalCredit: totalCredit,
          Invoice: invoices,
        },
      },
    },
  };
}

// Export to JSON
export function exportSAFTToJSON(saft: SAFTAO): string {
  return JSON.stringify(saft, null, 2);
}

// Export to XML (for compatibility)
export function exportSAFTToXML(saft: SAFTAO): string {
  if (!saft?.AuditFile) {
    throw new Error('Invalid SAF-T response from server');
  }

  const escapeXML = (str: string | undefined | null): string => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  const formatValue = (value: any): string => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return value.toFixed(2);
    return escapeXML(String(value));
  };
  
  const objectToXML = (obj: any, indent: number = 0): string => {
    const spaces = '  '.repeat(indent);
    let xml = '';
    
    for (const key in obj) {
      const value = obj[key];
      
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object') {
            xml += `${spaces}<${key}>\n${objectToXML(item, indent + 1)}${spaces}</${key}>\n`;
          } else {
            xml += `${spaces}<${key}>${formatValue(item)}</${key}>\n`;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        xml += `${spaces}<${key}>\n${objectToXML(value, indent + 1)}${spaces}</${key}>\n`;
      } else {
        xml += `${spaces}<${key}>${formatValue(value)}</${key}>\n`;
      }
    }
    
    return xml;
  };
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:AO_1.0_01" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
${objectToXML(saft.AuditFile, 1)}</AuditFile>`;
}

// Download SAF-T file
export function downloadSAFTFile(
  saft: SAFTAO,
  format: 'json' | 'xml' = 'json'
): void {
  const company = getCompanySettings();
  const header = saft.AuditFile.Header;
  const fileName = `SAFT-AO_${company.nif}_${header.FiscalYear}_${header.StartDate}_${header.EndDate}`;
  
  let content: string;
  let mimeType: string;
  let extension: string;
  
  if (format === 'xml') {
    content = exportSAFTToXML(saft);
    mimeType = 'application/xml';
    extension = 'xml';
  } else {
    content = exportSAFTToJSON(saft);
    mimeType = 'application/json';
    extension = 'json';
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.${extension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

// Get SAF-T summary for preview
export interface SAFTSummary {
  period: string;
  totalInvoices: number;
  totalSalesInvoices: number;
  totalCreditNotes: number;
  totalDebitNotes: number;
  totalProducts: number;
  totalCustomers: number;
  totalCredit: number;
  totalDebit: number;
  totalTax: number;
}

export function getSAFTSummary(saft: SAFTAO): SAFTSummary {
  if (!saft?.AuditFile) {
    throw new Error('Invalid SAF-T response from server');
  }
  const header = saft.AuditFile.Header;
  const salesInvoices = saft.AuditFile.SourceDocuments?.SalesInvoices;
  const rawInvoice = salesInvoices?.Invoice;
  const invoices = Array.isArray(rawInvoice) ? rawInvoice : rawInvoice ? [rawInvoice] : [];

  const totalTax = invoices.reduce(
    (sum, inv) => sum + inv.DocumentTotals.TaxPayable,
    0,
  ) || 0;

  const totalSalesInvoices = invoices.filter((inv) => inv.InvoiceType === 'FT' || !inv.InvoiceType).length;
  const totalCreditNotes = invoices.filter((inv) => inv.InvoiceType === 'NC').length;
  const totalDebitNotes = invoices.filter((inv) => inv.InvoiceType === 'ND').length;

  return {
    period: `${header.StartDate} a ${header.EndDate}`,
    totalInvoices: salesInvoices?.NumberOfEntries || invoices.length,
    totalSalesInvoices,
    totalCreditNotes,
    totalDebitNotes,
    totalProducts: Array.isArray(saft.AuditFile.MasterFiles?.Product)
      ? saft.AuditFile.MasterFiles.Product.length
      : 0,
    totalCustomers: Array.isArray(saft.AuditFile.MasterFiles?.Customer)
      ? saft.AuditFile.MasterFiles.Customer.length
      : 0,
    totalCredit: typeof salesInvoices?.TotalCredit === 'number'
      ? salesInvoices.TotalCredit
      : parseFloat(String(salesInvoices?.TotalCredit || 0)),
    totalDebit: typeof salesInvoices?.TotalDebit === 'number'
      ? salesInvoices.TotalDebit
      : parseFloat(String(salesInvoices?.TotalDebit || 0)),
    totalTax,
  };
}
