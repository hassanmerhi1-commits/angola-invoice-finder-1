// Core ERP Types - Ready for database integration

export interface Category {
  id: string;
  name: string;
  parentId?: string | null; // null = root/mother category
  description?: string;
  color?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  isMain: boolean;
  priceLevel: number; // 1-4, which price column this branch uses
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  price: number;       // Price 1 (base price)
  price2?: number;     // Price 2
  price3?: number;     // Price 3
  price4?: number;     // Price 4
  cost: number;
  firstCost: number;
  lastCost: number;
  avgCost: number;
  stock: number;
  minStock?: number;    // Minimum stock level (reorder point)
  maxStock?: number;    // Maximum stock level
  unit: string;
  taxRate: number;
  branchId: string;
  supplierId?: string;
  supplierName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  version?: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
  subtotal: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  branchId: string;
  cashierId: string;
  cashierName?: string;
  items: SaleItem[];
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'mixed';
  amountPaid: number;
  change: number;
  customerNif?: string;
  customerName?: string;
  dueDate?: string;
  status: 'completed' | 'voided' | 'pending';
  /** AGT fiscal document type: FT, FR, or FS */
  invoiceType?: 'FT' | 'FR' | 'FS';
  saftHash?: string; // For AGT compliance
  agtStatus?: 'pending' | 'validated' | 'rejected' | 'submitted' | 'approved';
  agtCode?: string;
  agtValidatedAt?: string;
  agtStatus?: 'pending' | 'validated' | 'rejected';
  agtCode?: string;
  agtValidatedAt?: string;
  createdAt: string;
  syncedAt?: string;
  syncedToMain?: boolean;
}

export interface SaleItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  branchId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface DailySummary {
  id: string;
  date: string;
  branchId: string;
  branchName: string;
  totalSales: number;
  totalTransactions: number;
  cashTotal: number;
  cardTotal: number;
  transferTotal: number;
  taxCollected: number;
  openingBalance: number;
  closingBalance: number;
  status: 'open' | 'closed';
  closedBy?: string;
  closedAt?: string;
  notes?: string;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  nif: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  creditLimit: number;
  currentBalance: number;
  /** Which product price level (1-4) to use by default for this client. */
  defaultPriceLevel?: number;
  /** Signed % applied to the selling price: positive = surcharge, negative = discount. */
  priceAdjustmentPct?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  items: StockTransferItem[];
  status: 'pending' | 'in_transit' | 'received' | 'cancelled';
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  notes?: string;
}

export interface StockTransferItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  receivedQuantity?: number;
}

export interface DataExport {
  id: string;
  type: 'sales' | 'daily_report' | 'full_backup';
  branchId: string;
  branchName: string;
  dateFrom: string;
  dateTo: string;
  recordCount: number;
  exportedBy: string;
  exportedAt: string;
  fileName: string;
  status: 'pending' | 'exported' | 'imported';
}

// Stock Movement - Tracks every stock IN/OUT
export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  branchName?: string;
  branchCode?: string;
  createdByName?: string;
  type: 'IN' | 'OUT';
  quantity: number;
  reason: 'purchase' | 'sale' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'damage' | 'return' | 'initial';
  referenceId?: string; // PO ID, Sale ID, Transfer ID
  referenceNumber?: string; // PO number, Invoice number, etc.
  costAtTime?: number; // Cost at the time of movement
  notes?: string;
  createdBy: string;
  createdAt: string;
}

// Complete Sync Package for Filial → Head Office
export interface SyncPackage {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  exportDate: string;
  dateRange: {
    from: string;
    to: string;
  };
  // Core data
  products: Product[];
  suppliers: Supplier[];
  clients: Client[];
  // Transactions
  purchases: PurchaseOrder[];
  sales: Sale[];
  stockMovements: StockMovement[];
  stockTransfers: StockTransfer[];
  // Reports
  dailyReports: DailySummary[];
  // Metadata
  version: string;
  totalRecords: number;
}

export interface Supplier {
  id: string;
  name: string;
  nif: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country: string;
  contactPerson?: string;
  paymentTerms: 'immediate' | '15_days' | '30_days' | '60_days' | '90_days';
  balance: number;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  items: PurchaseOrderItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  // Freight / Frete
  freightCost?: number; // Total freight cost for this order
  freightDistributed?: boolean; // Whether freight has been added to product costs
  // Other costs (despesas)
  otherCosts?: number;
  otherCostsDescription?: string;
  status: 'draft' | 'pending' | 'awaiting_approval' | 'approved' | 'received' | 'partial' | 'cancelled';
  notes?: string;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  receivedBy?: string;
  receivedAt?: string;
  expectedDeliveryDate?: string;
}

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  receivedQuantity?: number;
  unitCost: number;
  // Freight allocation
  freightAllocation?: number; // Portion of freight allocated to this item
  effectiveCost?: number; // unitCost + freightAllocation
  taxRate: number;
  subtotal: number;
}

// ==================== FISCAL DOCUMENTS (AGT Compliance) ====================

// Credit Note - Nota de Crédito
export interface CreditNote {
  id: string;
  documentNumber: string; // NC BRANCH/DATE/SEQUENCE
  branchId: string;
  branchName: string;
  originalInvoiceId: string;
  originalInvoiceNumber: string;
  reason: 'return' | 'discount' | 'error' | 'other';
  reasonDescription: string;
  items: CreditNoteItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  customerNif?: string;
  customerName?: string;
  status: 'draft' | 'issued' | 'cancelled';
  restoreStock?: boolean;
  agtStatus?: string;
  agtCode?: string;
  issuedBy: string;
  issuedAt: string;
  saftHash?: string;
  createdAt: string;
}

export interface CreditNoteItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
}

// Debit Note - Nota de Débito
export interface DebitNote {
  id: string;
  documentNumber: string; // ND BRANCH/DATE/SEQUENCE
  branchId: string;
  branchName: string;
  originalInvoiceId?: string;
  originalInvoiceNumber?: string;
  reason: 'price_adjustment' | 'additional_charge' | 'interest' | 'other';
  reasonDescription: string;
  items: DebitNoteItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  customerNif?: string;
  customerName?: string;
  status: 'draft' | 'issued' | 'cancelled';
  agtStatus?: string;
  agtCode?: string;
  issuedBy: string;
  issuedAt: string;
  saftHash?: string;
  createdAt: string;
}

export interface DebitNoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
}

// Transport Document - Guia de Transporte
export interface TransportDocument {
  id: string;
  documentNumber: string; // GT BRANCH/DATE/SEQUENCE
  branchId: string;
  branchName: string;
  type: 'delivery' | 'transfer' | 'return' | 'consignment';
  // Origin
  originAddress: string;
  originCity: string;
  // Destination
  destinationAddress: string;
  destinationCity: string;
  destinationNif?: string;
  destinationName?: string;
  // Transport
  transporterName?: string;
  transporterNif?: string;
  vehiclePlate?: string;
  loadingDate: string;
  loadingTime: string;
  // Items
  items: TransportDocumentItem[];
  totalWeight?: number;
  totalVolume?: number;
  // Status
  status: 'draft' | 'issued' | 'in_transit' | 'delivered' | 'cancelled';
  relatedInvoiceId?: string;
  relatedInvoiceNumber?: string;
  notes?: string;
  issuedBy: string;
  issuedAt: string;
  deliveredAt?: string;
  saftHash?: string;
  createdAt: string;
}

export interface TransportDocumentItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unit: string;
  weight?: number;
}

// Company/Taxpayer Info for SAF-T
export interface CompanyInfo {
  name: string;
  nif: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  activityCode: string; // CAE code
  fiscalYear: string;
}

// SAF-T Export Package
export interface SAFTExport {
  id: string;
  branchId: string;
  branchName: string;
  periodStart: string;
  periodEnd: string;
  exportType: 'monthly' | 'annual' | 'custom';
  company: CompanyInfo;
  invoices: Sale[];
  creditNotes: CreditNote[];
  debitNotes: DebitNote[];
  transportDocs: TransportDocument[];
  products: Product[];
  clients: Client[];
  exportedBy: string;
  exportedAt: string;
  fileName: string;
  xmlContent?: string;
}

// ==================== OPEN ITEM MANAGEMENT ====================

export interface OpenItem {
  id: string;
  entityType: 'customer' | 'supplier';
  entityId: string;
  /** Resolved from suppliers/clients when listing open items */
  entityName?: string;
  documentType: 'invoice' | 'credit_note' | 'debit_note' | 'payment' | 'advance';
  documentId: string;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  currency: string;
  originalAmount: number;
  remainingAmount: number;
  isDebit: boolean;
  status: 'open' | 'partial' | 'cleared';
  branchId: string;
  createdAt: string;
  clearedAt?: string;
}

// ==================== PAYMENTS ====================

export interface Payment {
  id: string;
  paymentNumber: string;
  paymentType: 'receipt' | 'payment';
  entityType: 'customer' | 'supplier';
  entityId: string;
  entityName: string;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'cheque' | 'mixed';
  amount: number;
  currency: string;
  bankAccount?: string;
  reference?: string;
  notes?: string;
  branchId: string;
  createdBy: string;
  createdAt: string;
  postedAt?: string;
}

// ==================== ACCOUNTING PERIOD ====================

export interface AccountingPeriod {
  id: string;
  year: number;
  month: number;
  name: string;
  status: 'open' | 'closed' | 'locked';
  closedBy?: string;
  closedAt?: string;
}

// ==================== DOCUMENT LINK ====================

export interface DocumentLink {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  targetType: string;
  targetId: string;
  targetNumber: string;
  createdAt: string;
}
