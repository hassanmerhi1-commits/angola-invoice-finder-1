// Chart of Accounts types

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountNature = 'debit' | 'credit';

export interface Account {
  id: string;
  code: string;
  name: string;
  description?: string;
  account_type: AccountType;
  account_nature: AccountNature;
  parent_id?: string | null;
  parent_name?: string;
  parent_code?: string;
  level: number;
  is_header: boolean;
  is_active: boolean;
  opening_balance: number;
  current_balance: number;
  branch_id?: string | null;
  children_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_nature: AccountNature;
  opening_balance: number;
  total_debits: number;
  total_credits: number;
  current_balance: number;
}

export interface TrialBalanceRow {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_nature: AccountNature;
  level: number;
  is_header: boolean;
  opening_balance: number;
  total_debits: number;
  total_credits: number;
  closing_balance: number;
}

export interface BalanceSheetAccountRow {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  account_nature: AccountNature;
  level: number;
  is_header: boolean;
  current_balance: number;
  previous_balance: number;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  reference_type?: string;
  reference_id?: string;
  total_debit: number;
  total_credit: number;
  is_posted: boolean;
  posted_at?: string;
  posted_by?: string;
  branch_id?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  lines?: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  account_code?: string;
  account_name?: string;
  description?: string;
  debit_amount: number;
  credit_amount: number;
  created_at: string;
}

export interface AccountFormData {
  code: string;
  name: string;
  description?: string;
  account_type: AccountType;
  account_nature: AccountNature;
  parent_id?: string | null;
  level?: number;
  is_header?: boolean;
  opening_balance?: number;
  branch_id?: string | null;
}

// Helper to get account type label
export const accountTypeLabels: Record<AccountType, { en: string; pt: string }> = {
  asset: { en: 'Asset', pt: 'Activo' },
  liability: { en: 'Liability', pt: 'Passivo' },
  equity: { en: 'Equity', pt: 'Capital Próprio' },
  revenue: { en: 'Revenue', pt: 'Receitas' },
  expense: { en: 'Expense', pt: 'Gastos' }
};

// Helper to get nature based on account type
export function getDefaultNature(type: AccountType): AccountNature {
  switch (type) {
    case 'asset':
    case 'expense':
      return 'debit';
    case 'liability':
    case 'equity':
    case 'revenue':
      return 'credit';
  }
}

// ==================== EXPENSE CATEGORIES ====================

export type ExpenseCategory = 
  | 'transport'      // Taxi, fuel, vehicle
  | 'utilities'      // Water, electricity, internet, rent
  | 'staff'          // Salaries, bonuses
  | 'materials'      // Office supplies, packaging
  | 'maintenance'    // Repairs, cleaning
  | 'other';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'transport', label: 'Transporte', icon: '🚗' },
  { value: 'utilities', label: 'Utilidades / Instalações', icon: '💡' },
  { value: 'staff', label: 'Pessoal / Salários', icon: '👥' },
  { value: 'materials', label: 'Materiais / Outros', icon: '📦' },
  { value: 'maintenance', label: 'Manutenção', icon: '🔧' },
  { value: 'other', label: 'Outros', icon: '📋' },
];

// ==================== CAIXA (CASH BOX) ====================

export interface Caixa {
  id: string;
  branchId: string;
  branchName: string;
  name: string; // e.g., "Caixa Principal", "Caixa 1"
  openingBalance: number;
  currentBalance: number;
  status: 'open' | 'closed';
  // Daily tracking
  openedAt?: string;
  openedBy?: string;
  closedAt?: string;
  closedBy?: string;
  closingBalance?: number;
  closingNotes?: string;
  // Petty cash limits
  pettyLimit?: number; // Max amount for single petty cash expense
  dailyLimit?: number; // Max daily expense without approval
  requiresApproval?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CaixaSession {
  id: string;
  caixaId: string;
  branchId: string;
  date: string; // YYYY-MM-DD
  openingBalance: number;
  closingBalance?: number;
  totalIn: number; // Total money received
  totalOut: number; // Total money paid out
  salesTotal: number;
  expensesTotal: number;
  adjustments: number; // Manual adjustments
  status: 'open' | 'closed' | 'pending_review';
  openedBy: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
  notes?: string;
  createdAt: string;
}

// ==================== BANK ACCOUNTS ====================

export interface BankAccount {
  id: string;
  branchId: string;
  branchName: string;
  bankName: string; // e.g., "BAI", "BFA", "BIC"
  accountName: string;
  accountNumber: string;
  iban?: string;
  swift?: string;
  currency: 'AOA' | 'USD' | 'EUR';
  currentBalance: number;
  isActive: boolean;
  isPrimary?: boolean; // Primary account for this branch
  createdAt: string;
  updatedAt?: string;
}

// ==================== CASH/BANK TRANSACTIONS ====================

export type CashTransactionType = 
  | 'sale'              // Receita de venda
  | 'sale_refund'       // Devolução de venda
  | 'purchase_payment'  // Pagamento a fornecedor
  | 'expense'           // Despesa operacional
  | 'deposit'           // Depósito bancário
  | 'withdrawal'        // Levantamento
  | 'transfer_in'       // Transferência recebida
  | 'transfer_out'      // Transferência enviada
  | 'adjustment'        // Ajuste manual
  | 'opening'           // Saldo de abertura
  | 'closing';          // Saldo de fecho

export interface CashTransaction {
  id: string;
  caixaId: string;
  caixaSessionId?: string;
  branchId: string;
  type: CashTransactionType;
  direction: 'in' | 'out';
  amount: number;
  balanceAfter: number;
  // Reference
  referenceType?: 'sale' | 'purchase_order' | 'expense' | 'transfer' | 'manual';
  referenceId?: string;
  referenceNumber?: string;
  // Details
  description: string;
  category?: ExpenseCategory;
  payee?: string; // Who received/paid the money
  // Approval for large amounts
  requiresApproval?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  // Metadata
  createdBy: string;
  createdAt: string;
  notes?: string;
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  branchId: string;
  type: CashTransactionType;
  direction: 'in' | 'out';
  amount: number;
  balanceAfter: number;
  // Reference
  referenceType?: 'sale' | 'purchase_order' | 'expense' | 'transfer' | 'manual';
  referenceId?: string;
  referenceNumber?: string;
  // Bank details
  transactionDate: string;
  valueDate?: string;
  bankReference?: string;
  // Details
  description: string;
  category?: ExpenseCategory;
  payee?: string;
  // Metadata
  createdBy: string;
  createdAt: string;
  notes?: string;
}

// ==================== EXPENSES ====================

export interface Expense {
  id: string;
  expenseNumber: string; // DESP-BRANCH-YYYYMMDD-SEQ
  branchId: string;
  branchName: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  taxAmount?: number; // IVA if applicable
  totalAmount: number;
  // Payment source
  paymentSource: 'caixa' | 'bank';
  caixaId?: string;
  bankAccountId?: string;
  transactionId?: string; // Reference to CashTransaction or BankTransaction
  // Supplier/Payee
  payeeName?: string;
  payeeNif?: string;
  // Document reference
  invoiceNumber?: string;
  invoiceDate?: string;
  receiptAttached?: boolean;
  // Approval workflow (for petty cash)
  status: 'draft' | 'pending_approval' | 'approved' | 'paid' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  paidBy?: string;
  paidAt?: string;
  rejectionReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

// ==================== TRANSFERS BETWEEN CAIXA/BANKS ====================

export interface MoneyTransfer {
  id: string;
  transferNumber: string;
  branchId: string;
  // Source
  sourceType: 'caixa' | 'bank';
  sourceCaixaId?: string;
  sourceBankAccountId?: string;
  sourceDescription: string;
  // Destination
  destinationType: 'caixa' | 'bank';
  destinationCaixaId?: string;
  destinationBankAccountId?: string;
  destinationDescription: string;
  // Amount
  amount: number;
  // Status
  status: 'pending' | 'completed' | 'cancelled';
  // Metadata
  reason: string;
  createdBy: string;
  createdAt: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

// ==================== SUMMARY / REPORTING ====================

export interface CaixaSummary {
  caixaId: string;
  caixaName: string;
  branchId: string;
  branchName: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  totalSales: number;
  totalExpenses: number;
  totalDeposits: number;
  totalWithdrawals: number;
  netChange: number;
  transactionCount: number;
}

export interface BranchAccountingSummary {
  branchId: string;
  branchName: string;
  period: string; // YYYY-MM or YYYY
  totalCaixaBalance: number;
  totalBankBalance: number;
  totalBalance: number;
  totalRevenue: number;
  totalExpenses: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  netProfit: number;
}
