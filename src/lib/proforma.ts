// Pro Forma storage and management for NEXOR ERP
// DUAL-MODE: Electron → DB + localStorage mirror | Web → localStorage
import { ProForma, ProFormaItem } from '@/types/proforma';
import { isElectronMode, dbGetAll, dbInsert, dbDelete as dbDeleteRow, lsGet, lsSet } from '@/lib/dbHelper';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';

const STORAGE_KEY = 'kwanzaerp_proformas';

function readLocalProformas(): ProForma[] {
  return lsGet<ProForma[]>(STORAGE_KEY, []);
}

function writeLocalProforma(proforma: ProForma): void {
  const proformas = readLocalProformas();
  const index = proformas.findIndex((p) => p.id === proforma.id);
  const next = { ...proforma, updatedAt: new Date().toISOString() };
  if (index >= 0) {
    proformas[index] = next;
  } else {
    proformas.push(next);
  }
  lsSet(STORAGE_KEY, proformas);
}

function removeLocalProforma(id: string): void {
  lsSet(STORAGE_KEY, readLocalProformas().filter((p) => p.id !== id));
}

function attachItemsToProforma(row: any, allItems: any[]): ProForma {
  const base = mapProformaFromDb(row);
  if (Array.isArray(row.items) && row.items.length > 0) {
    return { ...base, items: row.items };
  }
  return {
    ...base,
    items: allItems
      .filter((i: any) => i.proforma_id === row.id)
      .map(mapProformaItemFromDb),
  };
}

// Pro Forma CRUD
export async function getProFormas(branchId?: string): Promise<ProForma[]> {
  const localProformas = readLocalProformas();

  if (isElectronMode()) {
    const rows = await dbGetAll<any>('proformas');
    const items = await dbGetAll<any>('proforma_items');
    const dbProformas = rows.map((r) => attachItemsToProforma(r, items));
    const byId = new Map<string, ProForma>();
    for (const pf of [...dbProformas, ...localProformas]) {
      byId.set(pf.id, pf);
    }
    let proformas = Array.from(byId.values());
    if (branchId) {
      proformas = proformas.filter((p) => p.branchId === branchId);
    }
    return proformas.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  const proformas = localProformas;
  return branchId ? proformas.filter((p) => p.branchId === branchId) : proformas;
}

export async function getProFormaById(id: string): Promise<ProForma | undefined> {
  const proformas = await getProFormas();
  return proformas.find((p) => p.id === id);
}

export async function saveProForma(proforma: ProForma): Promise<void> {
  const now = new Date().toISOString();
  const normalized: ProForma = {
    ...proforma,
    createdAt: proforma.createdAt || now,
    updatedAt: now,
  };

  if (isElectronMode()) {
    const dbPayload = {
      ...mapProformaToDb(normalized),
      ...normalized,
      branch_id: normalized.branchId,
      proforma_number: normalized.documentNumber,
      client_name: normalized.customerName,
      client_nif: normalized.customerNif || '',
    };
    const saved = await dbInsert('proformas', dbPayload);
    if (saved) {
      for (const item of normalized.items || []) {
        await dbInsert('proforma_items', {
          id: item.id || `pi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          proforma_id: normalized.id,
          product_id: item.productId || '',
          product_name: item.productName || item.description || '',
          sku: item.sku || '',
          description: item.description || '',
          quantity: item.quantity,
          unit_price: item.unitPrice,
          discount: item.discount || 0,
          tax_rate: item.taxRate,
          tax_amount: item.taxAmount || 0,
          subtotal: item.subtotal || 0,
          total: item.total || item.subtotal || 0,
          branch_id: normalized.branchId || '',
        });
      }
    }
    writeLocalProforma(normalized);
    return;
  }

  writeLocalProforma(normalized);
}

export async function deleteProForma(id: string): Promise<void> {
  if (isElectronMode()) {
    await dbDeleteRow('proformas', id);
  }
  removeLocalProforma(id);
}

export function generateProFormaNumber(branchCode: string): string {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Date.now().toString().slice(-4);
  return `OR ${branchCode}/${dateStr}/${seq}`;
}

// Calculate totals for items
export function calculateProFormaTotals(items: ProFormaItem[]): {
  subtotal: number;
  taxAmount: number;
  total: number;
} {
  let subtotal = 0;
  let taxAmount = 0;

  items.forEach((item) => {
    const itemSubtotal = item.quantity * item.unitPrice * (1 - item.discount / 100);
    const itemTax = itemSubtotal * (item.taxRate / 100);
    subtotal += itemSubtotal;
    taxAmount += itemTax;
  });

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round((subtotal + taxAmount) * 100) / 100,
  };
}

export async function updateExpiredProFormas(): Promise<void> {
  const proformas = await getProFormas();
  const now = new Date();

  for (const p of proformas) {
    if (!p.validUntil) continue;
    if (['draft', 'sent'].includes(p.status) && new Date(p.validUntil) < now) {
      p.status = 'expired';
      p.updatedAt = now.toISOString();
      await saveProForma(p);
    }
  }
}

export async function getProFormaStats(branchId?: string): Promise<{
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  converted: number;
  expired: number;
  totalValue: number;
  pendingValue: number;
}> {
  const proformas = await getProFormas(branchId);

  return {
    total: proformas.length,
    draft: proformas.filter((p) => p.status === 'draft').length,
    sent: proformas.filter((p) => p.status === 'sent').length,
    accepted: proformas.filter((p) => p.status === 'accepted').length,
    converted: proformas.filter((p) => p.status === 'converted').length,
    expired: proformas.filter((p) => p.status === 'expired').length,
    totalValue: proformas.reduce((sum, p) => sum + p.total, 0),
    pendingValue: proformas
      .filter((p) => ['draft', 'sent', 'accepted'].includes(p.status))
      .reduce((sum, p) => sum + p.total, 0),
  };
}

// DB mappers
function mapProformaFromDb(row: any): ProForma {
  if (row.documentNumber) {
    return {
      id: row.id,
      documentNumber: row.documentNumber,
      branchId: row.branchId || row.branch_id || '',
      branchName: row.branchName || row.branch_name || '',
      customerName: row.customerName || row.client_name || '',
      customerNif: row.customerNif || row.client_nif || '',
      customerEmail: row.customerEmail || row.customer_email || '',
      customerPhone: row.customerPhone || row.customer_phone || '',
      customerAddress: row.customerAddress || row.customer_address || '',
      clientId: row.clientId || row.client_id || '',
      clientName: row.clientName || row.client_name || '',
      clientNif: row.clientNif || row.client_nif || '',
      items: Array.isArray(row.items) ? row.items : [],
      subtotal: Number(row.subtotal ?? 0),
      taxAmount: Number(row.taxAmount ?? row.tax_amount ?? 0),
      discount: Number(row.discount ?? 0),
      total: Number(row.total ?? 0),
      currency: row.currency || 'AOA',
      status: row.status || 'draft',
      validUntil: row.validUntil || row.valid_until || '',
      notes: row.notes || '',
      termsAndConditions: row.termsAndConditions || row.terms_and_conditions || '',
      convertedToInvoiceId: row.convertedToInvoiceId || row.converted_to_invoice_id,
      convertedToInvoiceNumber: row.convertedToInvoiceNumber || row.converted_to_invoice_number,
      convertedAt: row.convertedAt || row.converted_at,
      createdBy: row.createdBy || row.created_by || '',
      createdByName: row.createdByName || row.created_by_name || '',
      createdAt: row.createdAt || row.created_at || '',
      updatedAt: row.updatedAt || row.updated_at || '',
    };
  }

  return {
    id: row.id,
    documentNumber: row.proforma_number || row.documentNumber || '',
    branchId: row.branch_id || row.branchId || '',
    branchName: row.branch_name || row.branchName || '',
    customerName: row.client_name || row.customerName || '',
    customerNif: row.client_nif || row.customerNif || '',
    customerEmail: row.customer_email || row.customerEmail || '',
    customerPhone: row.customer_phone || row.customerPhone || '',
    customerAddress: row.customer_address || row.customerAddress || '',
    clientId: row.client_id || row.clientId || '',
    clientName: row.client_name || row.clientName || '',
    clientNif: row.client_nif || row.clientNif || '',
    items: [],
    subtotal: Number(row.subtotal || 0),
    taxAmount: Number(row.tax_amount ?? row.taxAmount ?? 0),
    discount: Number(row.discount || 0),
    total: Number(row.total || 0),
    currency: row.currency || 'AOA',
    status: row.status || 'draft',
    validUntil: row.valid_until || row.validUntil || '',
    notes: row.notes || '',
    termsAndConditions: row.terms_and_conditions || row.termsAndConditions || '',
    convertedToInvoiceId: row.converted_to_invoice_id || row.convertedToInvoiceId,
    convertedToInvoiceNumber: row.converted_to_invoice_number || row.convertedToInvoiceNumber,
    convertedAt: row.converted_at || row.convertedAt,
    createdBy: row.created_by || row.createdBy || '',
    createdByName: row.created_by_name || row.createdByName || '',
    createdAt: row.created_at || row.createdAt || '',
    updatedAt: row.updated_at || row.updatedAt || '',
  };
}

function mapProformaToDb(proforma: ProForma): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: proforma.id,
    proforma_number: proforma.documentNumber,
    client_id: proforma.clientId || '',
    client_name: proforma.customerName || proforma.clientName || '',
    client_nif: proforma.customerNif || proforma.clientNif || '',
    branch_id: proforma.branchId || '',
    branch_name: proforma.branchName || '',
    subtotal: proforma.subtotal,
    tax_amount: proforma.taxAmount,
    discount: proforma.discount || 0,
    total: proforma.total,
    currency: proforma.currency || 'AOA',
    status: proforma.status,
    valid_until: proforma.validUntil || '',
    notes: proforma.notes || '',
    terms_and_conditions: proforma.termsAndConditions || '',
    created_by: proforma.createdBy || '',
    created_at: proforma.createdAt || now,
    updated_at: proforma.updatedAt || now,
  };
}

function mapProformaItemFromDb(row: any): ProFormaItem {
  return {
    id: row.id,
    productId: row.product_id || row.productId || '',
    productName: row.product_name || row.productName || '',
    sku: row.sku || '',
    description: row.description || row.product_name || row.productName || '',
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price ?? row.unitPrice ?? 0),
    discount: Number(row.discount || 0),
    taxRate: Number(row.tax_rate ?? row.taxRate ?? DEFAULT_VAT_RATE),
    taxAmount: Number(row.tax_amount ?? row.taxAmount ?? 0),
    subtotal: Number(row.subtotal || 0),
    total: Number(row.total || 0),
  };
}
