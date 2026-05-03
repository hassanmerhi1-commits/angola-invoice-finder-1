// Fiscal Documents Storage Layer for AGT Compliance
import { 
  CreditNote, 
  DebitNote, 
  TransportDocument, 
  Sale, 
  Product, 
  Client,
  CompanyInfo,
  SAFTExport,
  Branch
} from '@/types/erp';
import { getAllSales, getProducts, getClients, getBranches } from './storage';

const STORAGE_KEYS = {
  creditNotes: 'kwanzaerp_credit_notes',
  debitNotes: 'kwanzaerp_debit_notes',
  transportDocs: 'kwanzaerp_transport_docs',
  companyInfo: 'kwanzaerp_company_info',
  saftExports: 'kwanzaerp_saft_exports',
};

// Generic storage functions
function getItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setItem<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ==================== HASH GENERATION (SAFT Compliance) ====================

export function generateDocumentHash(
  previousHash: string,
  documentDate: string,
  documentNumber: string,
  total: number
): string {
  const dataToHash = `${previousHash};${documentDate};${documentNumber};${total.toFixed(2)}`;
  let hash = 0;
  for (let i = 0; i < dataToHash.length; i++) {
    const char = dataToHash.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
}

export async function getLastDocumentHash(documentType: 'invoice' | 'credit' | 'debit' | 'transport'): Promise<string> {
  const documentsMap: Record<string, any[]> = {
    credit: getCreditNotes(),
    debit: getDebitNotes(),
    transport: getTransportDocuments(),
  };
  
  let docs: any[];
  if (documentType === 'invoice') {
    docs = await getAllSales();
  } else {
    docs = documentsMap[documentType] || [];
  }
  
  if (docs.length === 0) return '0';
  const lastDoc = docs[docs.length - 1];
  return (lastDoc as any).saftHash || '0';
}

// ==================== CREDIT NOTES ====================

export function getCreditNotes(branchId?: string): CreditNote[] {
  const notes = getItem<CreditNote[]>(STORAGE_KEYS.creditNotes, []);
  return branchId ? notes.filter(n => n.branchId === branchId) : notes;
}

export function saveCreditNote(note: CreditNote): void {
  const notes = getCreditNotes();
  const index = notes.findIndex(n => n.id === note.id);
  if (index >= 0) {
    notes[index] = note;
  } else {
    notes.push(note);
  }
  setItem(STORAGE_KEYS.creditNotes, notes);
}

export function generateCreditNoteNumber(branchCode: string): string {
  const notes = getCreditNotes();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = notes.filter(n => 
    n.documentNumber.startsWith(`NC ${branchCode}/${today}`)
  ).length + 1;
  return `NC ${branchCode}/${today}/${count.toString().padStart(4, '0')}`;
}

// ==================== DEBIT NOTES ====================

export function getDebitNotes(branchId?: string): DebitNote[] {
  const notes = getItem<DebitNote[]>(STORAGE_KEYS.debitNotes, []);
  return branchId ? notes.filter(n => n.branchId === branchId) : notes;
}

export function saveDebitNote(note: DebitNote): void {
  const notes = getDebitNotes();
  const index = notes.findIndex(n => n.id === note.id);
  if (index >= 0) {
    notes[index] = note;
  } else {
    notes.push(note);
  }
  setItem(STORAGE_KEYS.debitNotes, notes);
}

export function generateDebitNoteNumber(branchCode: string): string {
  const notes = getDebitNotes();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = notes.filter(n => 
    n.documentNumber.startsWith(`ND ${branchCode}/${today}`)
  ).length + 1;
  return `ND ${branchCode}/${today}/${count.toString().padStart(4, '0')}`;
}

// ==================== TRANSPORT DOCUMENTS ====================

export function getTransportDocuments(branchId?: string): TransportDocument[] {
  const docs = getItem<TransportDocument[]>(STORAGE_KEYS.transportDocs, []);
  return branchId ? docs.filter(d => d.branchId === branchId) : docs;
}

export function saveTransportDocument(doc: TransportDocument): void {
  const docs = getTransportDocuments();
  const index = docs.findIndex(d => d.id === doc.id);
  if (index >= 0) {
    docs[index] = doc;
  } else {
    docs.push(doc);
  }
  setItem(STORAGE_KEYS.transportDocs, docs);
}

export function generateTransportDocNumber(branchCode: string): string {
  const docs = getTransportDocuments();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = docs.filter(d => 
    d.documentNumber.startsWith(`GT ${branchCode}/${today}`)
  ).length + 1;
  return `GT ${branchCode}/${today}/${count.toString().padStart(4, '0')}`;
}

// ==================== COMPANY INFO ====================

export function getCompanyInfo(): CompanyInfo {
  return getItem<CompanyInfo>(STORAGE_KEYS.companyInfo, {
    name: 'NEXOR ERP',
    nif: '5000000000',
    address: 'Rua Principal, 123',
    city: 'Luanda',
    province: 'Luanda',
    postalCode: '0000',
    country: 'AO',
    phone: '+244 923 456 789',
    email: 'info@nexorerp.co.ao',
    activityCode: '47111',
    fiscalYear: new Date().getFullYear().toString(),
  });
}

export function saveCompanyInfo(info: CompanyInfo): void {
  setItem(STORAGE_KEYS.companyInfo, info);
}

// ==================== SAF-T EXPORT ====================

export function getSAFTExports(): SAFTExport[] {
  return getItem<SAFTExport[]>(STORAGE_KEYS.saftExports, []);
}

export function saveSAFTExport(saftExport: SAFTExport): void {
  const exports = getSAFTExports();
  exports.push(saftExport);
  setItem(STORAGE_KEYS.saftExports, exports);
}

export async function generateSAFTXML(
  periodStart: string,
  periodEnd: string,
  branchId?: string
): Promise<string> {
  const company = getCompanyInfo();
  const allSales = await getAllSales();
  const sales = allSales.filter(s => {
    const date = s.createdAt.split('T')[0];
    return date >= periodStart && date <= periodEnd && 
           (!branchId || s.branchId === branchId) &&
           s.status === 'completed';
  });
  const creditNotes = getCreditNotes(branchId).filter(n => {
    const date = n.createdAt.split('T')[0];
    return date >= periodStart && date <= periodEnd && n.status === 'issued';
  });
  const debitNotes = getDebitNotes(branchId).filter(n => {
    const date = n.createdAt.split('T')[0];
    return date >= periodStart && date <= periodEnd && n.status === 'issued';
  });
  const products = await getProducts(branchId);
  const clients = await getClients();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:AO_1.0">
  <Header>
    <AuditFileVersion>1.0</AuditFileVersion>
    <CompanyID>${company.nif}</CompanyID>
    <TaxRegistrationNumber>${company.nif}</TaxRegistrationNumber>
    <TaxAccountingBasis>F</TaxAccountingBasis>
    <CompanyName>${escapeXml(company.name)}</CompanyName>
    <CompanyAddress>
      <AddressDetail>${escapeXml(company.address)}</AddressDetail>
      <City>${escapeXml(company.city)}</City>
      <PostalCode>${company.postalCode}</PostalCode>
      <Country>${company.country}</Country>
    </CompanyAddress>
    <FiscalYear>${company.fiscalYear}</FiscalYear>
    <StartDate>${periodStart}</StartDate>
    <EndDate>${periodEnd}</EndDate>
    <CurrencyCode>AOA</CurrencyCode>
    <DateCreated>${new Date().toISOString().split('T')[0]}</DateCreated>
    <TaxEntity>Global</TaxEntity>
    <ProductCompanyTaxID>999999999</ProductCompanyTaxID>
    <SoftwareCertificateNumber>0000</SoftwareCertificateNumber>
    <ProductID>NEXOR-ERP/1.0</ProductID>
    <ProductVersion>1.0</ProductVersion>
    <Telephone>${company.phone}</Telephone>
    <Email>${company.email}</Email>
  </Header>
  
  <MasterFiles>
    <Customer>
      <CustomerID>CF</CustomerID>
      <AccountID>Desconhecido</AccountID>
      <CustomerTaxID>999999999</CustomerTaxID>
      <CompanyName>Consumidor Final</CompanyName>
      <BillingAddress>
        <AddressDetail>Desconhecido</AddressDetail>
        <City>Desconhecido</City>
        <PostalCode>0000</PostalCode>
        <Country>AO</Country>
      </BillingAddress>
      <SelfBillingIndicator>0</SelfBillingIndicator>
    </Customer>
${clients.map(c => `    <Customer>
      <CustomerID>${c.id}</CustomerID>
      <AccountID>Desconhecido</AccountID>
      <CustomerTaxID>${c.nif}</CustomerTaxID>
      <CompanyName>${escapeXml(c.name)}</CompanyName>
      <BillingAddress>
        <AddressDetail>${escapeXml(c.address || 'Desconhecido')}</AddressDetail>
        <City>${escapeXml(c.city || 'Desconhecido')}</City>
        <PostalCode>0000</PostalCode>
        <Country>${c.country}</Country>
      </BillingAddress>
      <SelfBillingIndicator>0</SelfBillingIndicator>
    </Customer>`).join('\n')}
    
${products.map(p => `    <Product>
      <ProductType>P</ProductType>
      <ProductCode>${p.sku}</ProductCode>
      <ProductDescription>${escapeXml(p.name)}</ProductDescription>
      <ProductNumberCode>${p.barcode || p.sku}</ProductNumberCode>
    </Product>`).join('\n')}
  </MasterFiles>
  
  <SourceDocuments>
    <SalesInvoices>
      <NumberOfEntries>${sales.length}</NumberOfEntries>
      <TotalDebit>0.00</TotalDebit>
      <TotalCredit>${sales.reduce((sum, s) => sum + s.total, 0).toFixed(2)}</TotalCredit>
${sales.map((s, idx) => `      <Invoice>
        <InvoiceNo>${s.invoiceNumber}</InvoiceNo>
        <ATCUD>0</ATCUD>
        <DocumentStatus>
          <InvoiceStatus>${s.status === 'completed' ? 'N' : 'A'}</InvoiceStatus>
          <InvoiceStatusDate>${s.createdAt}</InvoiceStatusDate>
          <SourceID>NEXOR-ERP</SourceID>
          <SourceBilling>P</SourceBilling>
        </DocumentStatus>
        <Hash>${s.saftHash || generateDocumentHash(idx === 0 ? '0' : (sales[idx-1].saftHash || '0'), s.createdAt.split('T')[0], s.invoiceNumber, s.total)}</Hash>
        <HashControl>1</HashControl>
        <Period>${new Date(s.createdAt).getMonth() + 1}</Period>
        <InvoiceDate>${s.createdAt.split('T')[0]}</InvoiceDate>
        <InvoiceType>FT</InvoiceType>
        <SpecialRegimes>
          <SelfBillingIndicator>0</SelfBillingIndicator>
          <CashVATSchemeIndicator>0</CashVATSchemeIndicator>
          <ThirdPartiesBillingIndicator>0</ThirdPartiesBillingIndicator>
        </SpecialRegimes>
        <SourceID>${s.cashierId}</SourceID>
        <SystemEntryDate>${s.createdAt}</SystemEntryDate>
        <CustomerID>${s.customerNif ? s.customerNif : 'CF'}</CustomerID>
${s.items.map((item, lineIdx) => `        <Line>
          <LineNumber>${lineIdx + 1}</LineNumber>
          <ProductCode>${item.sku}</ProductCode>
          <ProductDescription>${escapeXml(item.productName)}</ProductDescription>
          <Quantity>${item.quantity}</Quantity>
          <UnitOfMeasure>UN</UnitOfMeasure>
          <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
          <TaxPointDate>${s.createdAt.split('T')[0]}</TaxPointDate>
          <Description>${escapeXml(item.productName)}</Description>
          <CreditAmount>${item.subtotal.toFixed(2)}</CreditAmount>
          <Tax>
            <TaxType>IVA</TaxType>
            <TaxCountryRegion>AO</TaxCountryRegion>
            <TaxCode>NOR</TaxCode>
            <TaxPercentage>${item.taxRate}</TaxPercentage>
          </Tax>
        </Line>`).join('\n')}
        <DocumentTotals>
          <TaxPayable>${s.taxAmount.toFixed(2)}</TaxPayable>
          <NetTotal>${s.subtotal.toFixed(2)}</NetTotal>
          <GrossTotal>${s.total.toFixed(2)}</GrossTotal>
          <Payment>
            <PaymentMechanism>${s.paymentMethod === 'cash' ? 'NU' : s.paymentMethod === 'card' ? 'CC' : 'TB'}</PaymentMechanism>
            <PaymentAmount>${s.total.toFixed(2)}</PaymentAmount>
            <PaymentDate>${s.createdAt.split('T')[0]}</PaymentDate>
          </Payment>
        </DocumentTotals>
      </Invoice>`).join('\n')}
    </SalesInvoices>
    
    <MovementOfGoods>
      <NumberOfMovementLines>0</NumberOfMovementLines>
      <TotalQuantityIssued>0</TotalQuantityIssued>
    </MovementOfGoods>
  </SourceDocuments>
</AuditFile>`;

  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function downloadSAFTFile(xml: string, fileName: string): void {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
