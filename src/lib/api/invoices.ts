// Invoice API — API-First
import { Sale } from '@/types/erp';
import { api } from '@/lib/api/client';

export interface CreateInvoiceRequest {
  company: {
    name: string;
    nif: string;
    address: string;
  };
  customer: {
    name: string;
    nif: string;
  };
  invoice: {
    date: string;
    items: {
      description: string;
      quantity: number;
      unit_price: number;
      vat_rate: number;
    }[];
  };
}

export interface CreateInvoiceResponse {
  status: 'pending_agt' | 'error';
  invoice_id: string;
  invoice_number: string;
  subtotal: number;
  vat: number;
  total: number;
  error?: string;
}

export interface AGTValidationResponse {
  status: 'validated' | 'rejected' | 'error';
  agt_code: string;
  timestamp: string;
  error?: string;
}

export function validateNIF(nif: string): { valid: boolean; error?: string } {
  if (!nif || nif.trim() === '') {
    return { valid: false, error: 'NIF é obrigatório' };
  }
  const cleanNif = nif.replace(/\s/g, '');
  if (!/^\d{10}$/.test(cleanNif)) {
    return { valid: false, error: 'NIF deve ter 10 dígitos' };
  }
  if (!cleanNif.startsWith('5')) {
    return { valid: false, error: 'NIF de empresa deve começar com 5' };
  }
  return { valid: true };
}

export function calculateInvoiceTotals(items: CreateInvoiceRequest['invoice']['items']) {
  let subtotal = 0;
  let totalVat = 0;
  for (const item of items) {
    const lineTotal = item.quantity * item.unit_price;
    const lineVat = lineTotal * (item.vat_rate / 100);
    subtotal += lineTotal;
    totalVat += lineVat;
  }
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat: Math.round(totalVat * 100) / 100,
    total: Math.round((subtotal + totalVat) * 100) / 100
  };
}

// POST /api/invoices - Create Invoice via API
export async function createInvoice(
  request: CreateInvoiceRequest,
  branchId: string,
  branchCode: string,
  userId: string
): Promise<CreateInvoiceResponse> {
  const companyNifValidation = validateNIF(request.company.nif);
  if (!companyNifValidation.valid) {
    return {
      status: 'error', invoice_id: '', invoice_number: '', subtotal: 0, vat: 0, total: 0,
      error: `NIF da empresa inválido: ${companyNifValidation.error}`
    };
  }
  
  if (request.customer.nif) {
    const customerNifValidation = validateNIF(request.customer.nif);
    if (!customerNifValidation.valid) {
      return {
        status: 'error', invoice_id: '', invoice_number: '', subtotal: 0, vat: 0, total: 0,
        error: `NIF do cliente inválido: ${customerNifValidation.error}`
      };
    }
  }
  
  if (!request.invoice.items || request.invoice.items.length === 0) {
    return {
      status: 'error', invoice_id: '', invoice_number: '', subtotal: 0, vat: 0, total: 0,
      error: 'A factura deve ter pelo menos um item'
    };
  }
  
  const totals = calculateInvoiceTotals(request.invoice.items);
  
  // Generate invoice number via API
  let invoiceNumber = '';
  try {
    const response = await api.sales.generateInvoiceNumber(branchCode);
    invoiceNumber = response.data?.invoiceNumber || `FT-${branchCode}-${Date.now()}`;
  } catch {
    invoiceNumber = `FT-${branchCode}-${Date.now()}`;
  }
  const invoiceId = `INV-${Date.now()}`;
  
  const sale: Sale = {
    id: invoiceId,
    branchId,
    invoiceNumber,
    items: request.invoice.items.map((item, index) => ({
      productId: `manual-${index}`,
      productName: item.description,
      sku: `MAN-${index}`,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      discount: 0,
      taxRate: item.vat_rate,
      subtotal: item.quantity * item.unit_price,
      taxAmount: (item.quantity * item.unit_price) * (item.vat_rate / 100)
    })),
    subtotal: totals.subtotal,
    taxAmount: totals.vat,
    discount: 0,
    total: totals.total,
    paymentMethod: 'cash',
    amountPaid: totals.total,
    change: 0,
    status: 'pending',
    cashierId: userId,
    cashierName: 'Sistema',
    customerName: request.customer.name || undefined,
    customerNif: request.customer.nif || undefined,
    createdAt: request.invoice.date || new Date().toISOString(),
    agtStatus: 'pending'
  };
  
  const saleResult = await api.sales.create(sale);
  if (!saleResult.data) {
    return {
      status: 'error', invoice_id: '', invoice_number: '', subtotal: 0, vat: 0, total: 0,
      error: saleResult.error || 'Falha ao guardar venda no servidor'
    };
  }
  
  return {
    status: 'pending_agt',
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    subtotal: totals.subtotal,
    vat: totals.vat,
    total: totals.total
  };
}

// POST /api/agt/transmit
export async function sendToAGT(invoiceId: string): Promise<AGTValidationResponse> {
  try {
    const res = await api.agt.transmit({ entityType: 'sale', entityId: invoiceId });
    if (res.error) {
      return { status: 'error', agt_code: '', timestamp: new Date().toISOString(), error: res.error };
    }
    const data = res.data;
    return {
      status: data?.agtStatus === 'validated' ? 'validated' : 'pending',
      agt_code: data?.agtCode || '',
      timestamp: data?.validatedAt || new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: 'error',
      agt_code: '',
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'AGT transmit failed',
    };
  }
}

async function sendToAGTSimulated(invoiceId: string): Promise<AGTValidationResponse> {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Try to get sale from API first
  let sales: Sale[] = [];
  try {
    const response = await api.sales.list();
    sales = response.data || [];
  } catch {
    sales = JSON.parse(localStorage.getItem('kwanzaerp_sales') || '[]');
  }
  
  const sale = sales.find(s => s.id === invoiceId);
  if (!sale) {
    return { status: 'error', agt_code: '', timestamp: new Date().toISOString(), error: 'Factura não encontrada' };
  }
  
  const agtCode = `AGT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  
  // Update in localStorage for now (AGT status is compliance metadata)
  const lsSales = JSON.parse(localStorage.getItem('kwanzaerp_sales') || '[]') as Sale[];
  const idx = lsSales.findIndex(s => s.id === invoiceId);
  if (idx >= 0) {
    lsSales[idx] = { ...lsSales[idx], status: 'completed', agtStatus: 'validated', agtCode, agtValidatedAt: timestamp };
    localStorage.setItem('kwanzaerp_sales', JSON.stringify(lsSales));
  }
  
  return { status: 'validated', agt_code: agtCode, timestamp };
}

export function getAGTStatus(invoiceId: string): { 
  status: 'pending' | 'validated' | 'rejected' | 'not_found';
  agtCode?: string;
  validatedAt?: string;
} {
  const sales = JSON.parse(localStorage.getItem('kwanzaerp_sales') || '[]') as Sale[];
  const sale = sales.find(s => s.id === invoiceId);
  
  if (!sale) return { status: 'not_found' };
  
  if (sale.agtStatus === 'validated' && sale.agtCode) {
    return { status: 'validated', agtCode: sale.agtCode, validatedAt: sale.agtValidatedAt };
  }
  
  return { status: sale.agtStatus || 'pending' };
}
