// Pro Forma (Orçamento) Types for NEXOR ERP

export interface ProFormaItem {
  id?: string;
  productId: string;
  productName: string;
  sku: string;
  unit?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total?: number;
}

export interface ProForma {
  id: string;
  documentNumber: string; // OR BRANCH/DATE/SEQUENCE
  branchId: string;
  branchName: string;
  
  // Customer
  customerName: string;
  customerNif?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;

  // Legacy aliases used by DB mappers
  clientId?: string;
  clientName?: string;
  clientNif?: string;
  
  // Items and totals
  items: ProFormaItem[];
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  currency?: string;
  
  // Validity
  validUntil: string;
  
  // Status
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'expired';
  
  // Conversion tracking
  convertedToInvoiceId?: string;
  convertedToInvoiceNumber?: string;
  convertedAt?: string;
  
  // Notes
  notes?: string;
  termsAndConditions?: string;
  
  // Audit
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}
