// NEXOR ERP Document Types for the linked document flow
// Proforma → Fatura De Venda → Recibo → Pagamento → Extracto

export type DocumentType = 
  | 'proforma'        // Orçamento / Proforma
  | 'fatura_venda'    // Fatura De Venda (Sales Invoice)
  | 'fatura_compra'   // Fatura De Compra (Purchase Invoice)
  | 'recibo'          // Recibo (Receipt)
  | 'pagamento'       // Pagamento (Payment)
  | 'nota_credito'    // Nota De Crédito (Credit Note)
  | 'nota_debito'     // Nota De Débito (Debit Note)
  | 'guia_remessa';   // Guia De Remessa (Delivery Note)

export type DocumentStatus = 
  | 'draft'           // Rascunho
  | 'pending'         // Pendente
  | 'confirmed'       // Confirmado
  | 'paid'            // Pago
  | 'partial'         // Parcialmente pago
  | 'cancelled'       // Anulado
  | 'converted';      // Convertido

export interface DocumentLine {
  id: string;
  productId?: string;
  productSku?: string;
  description: string;
  quantity: number;
  unit?: string;           // UN, SC, CX, KG, LT, etc.
  unitPrice: number;
  discount: number;        // percentage
  discountAmount: number;  // calculated
  taxRate: number;         // IVA %
  taxAmount: number;       // calculated
  lineTotal: number;       // calculated
  accountCode?: string;    // linked account
}

export interface ERPDocument {
  id: string;
  documentType: DocumentType;
  documentNumber: string;   // e.g. FV-SEDE-20260328-0001
  branchId: string;
  branchName: string;
  
  // Customer/Supplier
  entityType: 'customer' | 'supplier';
  entityId?: string;
  entityName: string;
  entityNif?: string;
  entityAddress?: string;
  entityPhone?: string;
  entityEmail?: string;
  entityCode?: string;        // entity reference code (e.g. 0000201)
  
  // Payment terms
  paymentCondition?: string;  // e.g. "Factura 15 Dias", "Pronto Pagamento"
  requisition?: string;       // requisition reference
  
  // Shipping / Transport
  loadAddress?: string;       // Carga address
  loadDate?: string;          // Carga date
  unloadAddress?: string;     // Descarga address
  transportRef?: string;      // e.g. LOAD VM2, GUIA-272
  
  // Bank details for payment
  bankDetails?: Array<{
    bank: string;
    account: string;
    iban: string;
  }>;
  
  // Copy label
  copyLabel?: string;         // "Original", "Duplicado", "Triplicado"
  
  // Lines
  lines: DocumentLine[];
  
  // Totals
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  total: number;
  
  // Payment
  currency: string;
  paymentMethod?: 'cash' | 'card' | 'transfer' | 'cheque' | 'mixed';
  amountPaid: number;
  amountDue: number;
  
  // Linked documents (the chain)
  parentDocumentId?: string;      // e.g. proforma that generated this invoice
  parentDocumentNumber?: string;
  parentDocumentType?: DocumentType;
  childDocuments?: { id: string; number: string; type: DocumentType }[];
  
  // Accounting
  journalEntryId?: string;
  accountCode?: string;    // main account affected
  
  // Status & validity
  status: DocumentStatus;
  issueDate: string;
  issueTime: string;        // HH:MM:SS — AGT mandatory
  dueDate?: string;
  validUntil?: string;     // for proformas
  
  // Issued fiscal documents cannot be edited (corrections via NC/ND only)
  fiscalLocked?: boolean;

  // AGT compliance
  saftHash?: string;
  agtStatus?: 'pending' | 'validated' | 'rejected';
  agtCode?: string;
  
  // Notes
  notes?: string;
  internalNotes?: string;
  termsAndConditions?: string;
  
  // Audit
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

const LEGACY_DOCUMENT_TYPE_MAP: Record<string, DocumentType> = {
  FT: 'fatura_venda',
  FV: 'fatura_venda',
  invoice: 'fatura_venda',
  sales_invoice: 'fatura_venda',
  FC: 'fatura_compra',
  purchase_invoice: 'fatura_compra',
  RC: 'recibo',
  receipt: 'recibo',
  PG: 'pagamento',
  payment: 'pagamento',
  OR: 'proforma',
  NC: 'nota_credito',
  credit_note: 'nota_credito',
  ND: 'nota_debito',
  debit_note: 'nota_debito',
  GR: 'guia_remessa',
  delivery: 'guia_remessa',
};

/** Map DB / legacy codes to a valid DocumentType (avoids render crashes on /invoices). */
export function normalizeErpDocumentType(
  raw: unknown,
  fallback: DocumentType = 'fatura_venda',
): DocumentType {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return fallback;
  if (trimmed in DOCUMENT_TYPE_CONFIG) return trimmed as DocumentType;
  const lower = trimmed.toLowerCase();
  if (lower in DOCUMENT_TYPE_CONFIG) return lower as DocumentType;
  const upper = trimmed.toUpperCase();
  if (LEGACY_DOCUMENT_TYPE_MAP[upper]) return LEGACY_DOCUMENT_TYPE_MAP[upper];
  if (LEGACY_DOCUMENT_TYPE_MAP[lower]) return LEGACY_DOCUMENT_TYPE_MAP[lower];
  return fallback;
}

// Document type configuration
export const DOCUMENT_TYPE_CONFIG: Record<DocumentType, {
  label: string;
  shortLabel: string;
  prefix: string;
  color: string;
  entityType: 'customer' | 'supplier';
  canConvertTo: DocumentType[];
  requiresPayment: boolean;
  affectsStock: boolean;
}> = {
  proforma: {
    label: 'Proforma / Orçamento',
    shortLabel: 'Proforma',
    prefix: 'OR',
    color: 'text-blue-600',
    entityType: 'customer',
    canConvertTo: ['fatura_venda'],
    requiresPayment: false,
    affectsStock: false,
  },
  fatura_venda: {
    label: 'Fatura De Venda',
    shortLabel: 'Fat. Venda',
    prefix: 'FV',
    color: 'text-green-600',
    entityType: 'customer',
    canConvertTo: ['recibo', 'nota_credito', 'guia_remessa'],
    requiresPayment: false,
    affectsStock: true,
  },
  fatura_compra: {
    label: 'Fatura De Compra',
    shortLabel: 'Fat. Compra',
    prefix: 'FC',
    color: 'text-orange-600',
    entityType: 'supplier',
    canConvertTo: ['pagamento', 'nota_debito'],
    requiresPayment: false,
    affectsStock: true,
  },
  recibo: {
    label: 'Recibo',
    shortLabel: 'Recibo',
    prefix: 'RC',
    color: 'text-emerald-600',
    entityType: 'customer',
    canConvertTo: [],
    requiresPayment: true,
    affectsStock: false,
  },
  pagamento: {
    label: 'Pagamento',
    shortLabel: 'Pagamento',
    prefix: 'PG',
    color: 'text-red-600',
    entityType: 'supplier',
    canConvertTo: [],
    requiresPayment: true,
    affectsStock: false,
  },
  nota_credito: {
    label: 'Nota De Crédito',
    shortLabel: 'N. Crédito',
    prefix: 'NC',
    color: 'text-purple-600',
    entityType: 'customer',
    canConvertTo: [],
    requiresPayment: false,
    affectsStock: true,
  },
  nota_debito: {
    label: 'Nota De Débito',
    shortLabel: 'N. Débito',
    prefix: 'ND',
    color: 'text-amber-600',
    entityType: 'supplier',
    canConvertTo: [],
    requiresPayment: false,
    affectsStock: false,
  },
  guia_remessa: {
    label: 'Guia De Remessa',
    shortLabel: 'G. Remessa',
    prefix: 'GR',
    color: 'text-cyan-600',
    entityType: 'customer',
    canConvertTo: [],
    requiresPayment: false,
    affectsStock: true,
  },
};

// Generate document number
export function generateDocumentNumber(type: DocumentType, branchCode: string, sequence: number): string {
  const config = DOCUMENT_TYPE_CONFIG[type];
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${config.prefix}-${branchCode}-${date}-${String(sequence).padStart(4, '0')}`;
}
