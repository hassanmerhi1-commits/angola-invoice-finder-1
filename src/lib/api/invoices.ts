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

/** AGT status from server only — never invent fiscal state from localStorage. */
export async function getAGTStatus(invoiceId: string): Promise<{
  status: 'pending' | 'validated' | 'rejected' | 'not_found' | 'error';
  agtCode?: string;
  validatedAt?: string;
  error?: string;
}> {
  try {
    const res = await api.agt.getSaleStatus(invoiceId);
    if (res.error) {
      return { status: 'error', error: res.error };
    }
    const data = res.data || {};
    const raw = String(data.agtStatus || data.status || '').toLowerCase();
    if (raw === 'validated' || raw === 'accepted') {
      return {
        status: 'validated',
        agtCode: data.agtCode || undefined,
        validatedAt: data.agtValidatedAt || data.validatedAt || undefined,
      };
    }
    if (raw === 'rejected' || raw === 'failed') {
      return { status: 'rejected', agtCode: data.agtCode || undefined };
    }
    if (raw === 'not_found' || (!raw && !data.agtCode)) {
      return { status: 'not_found' };
    }
    return { status: 'pending', agtCode: data.agtCode || undefined };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'AGT status lookup failed',
    };
  }
}
