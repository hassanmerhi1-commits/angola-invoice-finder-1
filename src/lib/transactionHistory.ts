// Transaction History - Comprehensive Audit Trail System
// Tracks all user actions across the ERP for full accountability

import { getCurrentUser } from './storage';
import { exportReportExcel } from '@/lib/reportExport';

// Storage key for transaction history
const STORAGE_KEY = 'kwanzaerp_transaction_history';

// Action categories
export type TransactionCategory = 
  | 'sales'
  | 'inventory'
  | 'clients'
  | 'suppliers'
  | 'stock_transfer'
  | 'purchase'
  | 'user'
  | 'settings'
  | 'fiscal'
  | 'reports';

// Action types
export type TransactionAction =
  // Sales
  | 'sale_created'
  | 'sale_voided'
  | 'sale_refunded'
  | 'invoice_printed'
  | 'invoice_reprinted'
  // Inventory
  | 'product_created'
  | 'product_updated'
  | 'product_deleted'
  | 'stock_adjusted'
  | 'stock_imported'
  | 'price_changed'
  // Clients
  | 'client_created'
  | 'client_updated'
  | 'client_deleted'
  | 'client_imported'
  // Suppliers
  | 'supplier_created'
  | 'supplier_updated'
  | 'supplier_deleted'
  | 'supplier_imported'
  // Stock Transfer
  | 'transfer_requested'
  | 'transfer_approved'
  | 'transfer_received'
  | 'transfer_cancelled'
  // Purchases
  | 'purchase_created'
  | 'purchase_received'
  | 'purchase_cancelled'
  | 'supplier_return'
  // User
  | 'user_login'
  | 'user_logout'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'password_changed'
  // Settings
  | 'settings_updated'
  | 'branch_created'
  | 'branch_updated'
  | 'branch_deleted'
  | 'category_created'
  | 'category_updated'
  | 'category_deleted'
  // Fiscal
  | 'saft_exported'
  | 'day_closed'
  | 'day_opened'
  | 'proforma_created'
  | 'proforma_status_changed'
  | 'proforma_converted'
  | 'proforma_deleted'
  // Reports
  | 'report_generated'
  | 'report_exported'
  | 'data_exported'
  | 'data_imported';

// Transaction record interface
export interface TransactionRecord {
  id: string;
  timestamp: string;
  // User info
  userId: string;
  userName: string;
  userRole: string;
  // Branch info
  branchId: string;
  branchName: string;
  // Action details
  category: TransactionCategory;
  action: TransactionAction;
  // Entity info
  entityType: string;
  entityId?: string;
  entityName?: string;
  entityNumber?: string;
  // Change details
  description: string;
  details?: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
  // Financial impact
  amount?: number;
  // Metadata
  ipAddress?: string;
  deviceInfo?: string;
}

// Get all transaction history
export function getTransactionHistory(): TransactionRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save transaction history
function saveTransactionHistory(records: TransactionRecord[]): void {
  // Keep only last 50,000 records to prevent localStorage overflow
  const trimmed = records.slice(-50000);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

// Generate unique ID
function generateId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Log a transaction
export function logTransaction(params: {
  category: TransactionCategory;
  action: TransactionAction;
  entityType: string;
  entityId?: string;
  entityName?: string;
  entityNumber?: string;
  description: string;
  details?: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
  amount?: number;
  branchId?: string;
  branchName?: string;
}): TransactionRecord {
  const currentUser = getCurrentUser();
  const currentBranch = JSON.parse(localStorage.getItem('kwanzaerp_current_branch') || '{}');

  const record: TransactionRecord = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    userId: currentUser?.id || 'system',
    userName: currentUser?.name || 'System',
    userRole: currentUser?.role || 'system',
    branchId: params.branchId || currentBranch?.id || '',
    branchName: params.branchName || currentBranch?.name || '',
    category: params.category,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    entityName: params.entityName,
    entityNumber: params.entityNumber,
    description: params.description,
    details: params.details,
    previousValue: params.previousValue,
    newValue: params.newValue,
    amount: params.amount,
    deviceInfo: navigator.userAgent,
  };

  const history = getTransactionHistory();
  history.push(record);
  saveTransactionHistory(history);

  // Also log to console for debugging
  console.log(`[TRANSACTION] ${params.action}: ${params.description}`);

  return record;
}

// Filter transaction history
export interface TransactionFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  branchId?: string;
  category?: TransactionCategory;
  action?: TransactionAction;
  entityType?: string;
  searchTerm?: string;
}

export function filterTransactionHistory(filter: TransactionFilter): TransactionRecord[] {
  let records = getTransactionHistory();

  if (filter.dateFrom) {
    records = records.filter(r => r.timestamp >= filter.dateFrom!);
  }
  if (filter.dateTo) {
    const endDate = new Date(filter.dateTo);
    endDate.setDate(endDate.getDate() + 1);
    records = records.filter(r => r.timestamp < endDate.toISOString());
  }
  if (filter.userId) {
    records = records.filter(r => r.userId === filter.userId);
  }
  if (filter.branchId) {
    records = records.filter(r => r.branchId === filter.branchId);
  }
  if (filter.category) {
    records = records.filter(r => r.category === filter.category);
  }
  if (filter.action) {
    records = records.filter(r => r.action === filter.action);
  }
  if (filter.entityType) {
    records = records.filter(r => r.entityType === filter.entityType);
  }
  if (filter.searchTerm) {
    const term = filter.searchTerm.toLowerCase();
    records = records.filter(r =>
      r.description.toLowerCase().includes(term) ||
      r.userName.toLowerCase().includes(term) ||
      r.entityName?.toLowerCase().includes(term) ||
      r.entityNumber?.toLowerCase().includes(term)
    );
  }

  return records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// Get transaction statistics
export function getTransactionStats(filter?: TransactionFilter) {
  const records = filter ? filterTransactionHistory(filter) : getTransactionHistory();

  const byCategory = records.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byUser = records.reduce((acc, r) => {
    acc[r.userName] = (acc[r.userName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byAction = records.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalAmount = records.reduce((sum, r) => sum + (r.amount || 0), 0);

  return {
    totalTransactions: records.length,
    byCategory,
    byUser,
    byAction,
    totalAmount,
  };
}

// Action display names (English)
export const ACTION_LABELS: Record<TransactionAction, string> = {
  // Sales
  sale_created: 'Sale Created',
  sale_voided: 'Sale Voided',
  sale_refunded: 'Sale Refunded',
  invoice_printed: 'Invoice Printed',
  invoice_reprinted: 'Invoice Reprinted',
  // Inventory
  product_created: 'Product Created',
  product_updated: 'Product Updated',
  product_deleted: 'Product Deleted',
  stock_adjusted: 'Stock Adjusted',
  stock_imported: 'Stock Imported',
  price_changed: 'Price Changed',
  // Clients
  client_created: 'Client Created',
  client_updated: 'Client Updated',
  client_deleted: 'Client Deleted',
  client_imported: 'Clients Imported',
  // Suppliers
  supplier_created: 'Supplier Created',
  supplier_updated: 'Supplier Updated',
  supplier_deleted: 'Supplier Deleted',
  supplier_imported: 'Suppliers Imported',
  // Stock Transfer
  transfer_requested: 'Transfer Requested',
  transfer_approved: 'Transfer Approved',
  transfer_received: 'Transfer Received',
  transfer_cancelled: 'Transfer Cancelled',
  // Purchases
  purchase_created: 'Purchase Recorded',
  purchase_received: 'Purchase Received',
  purchase_cancelled: 'Purchase Cancelled',
  supplier_return: 'Supplier Return',
  // User
  user_login: 'Login',
  user_logout: 'Logout',
  user_created: 'User Created',
  user_updated: 'User Updated',
  user_deleted: 'User Deleted',
  password_changed: 'Password Changed',
  // Settings
  settings_updated: 'Settings Updated',
  branch_created: 'Branch Created',
  branch_updated: 'Branch Updated',
  branch_deleted: 'Branch Deleted',
  category_created: 'Category Created',
  category_updated: 'Category Updated',
  category_deleted: 'Category Deleted',
  // Fiscal
  saft_exported: 'SAF-T Exported',
  day_closed: 'Day Closed',
  day_opened: 'Day Opened',
  proforma_created: 'Proforma Created',
  proforma_status_changed: 'Proforma Updated',
  proforma_converted: 'Proforma Converted',
  proforma_deleted: 'Proforma Deleted',
  // Reports
  report_generated: 'Report Generated',
  report_exported: 'Report Exported',
  data_exported: 'Data Exported',
  data_imported: 'Data Imported',
};

// Category display names (English)
export const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  sales: 'Sales',
  inventory: 'Inventory',
  clients: 'Clients',
  suppliers: 'Suppliers',
  stock_transfer: 'Transfers',
  purchase: 'Purchases',
  user: 'Users',
  settings: 'Settings',
  fiscal: 'Fiscal',
  reports: 'Reports',
};

// Category colors
export const CATEGORY_COLORS: Record<TransactionCategory, string> = {
  sales: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  inventory: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  clients: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  suppliers: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  stock_transfer: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  purchase: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  user: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  settings: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  fiscal: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  reports: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
};

// Export transaction history to Excel
export async function exportTransactionHistoryToExcel(records: TransactionRecord[], filename = 'transaction_history') {
  const data = records.map(r => ({
    'Date/Time': new Date(r.timestamp).toLocaleString('en-GB'),
    'User': r.userName,
    'Role': r.userRole,
    'Branch': r.branchName,
    'Category': CATEGORY_LABELS[r.category] || r.category,
    'Action': ACTION_LABELS[r.action] || r.action,
    'Entity Type': r.entityType,
    'Number': r.entityNumber || '',
    'Name': r.entityName || '',
    'Description': r.description,
    'Amount': r.amount ? r.amount.toLocaleString('en-GB') : '',
  }));

  await exportReportExcel(data, filename, { title: 'Transaction History' });
}

// Clear old transactions (keep last N days)
export function clearOldTransactions(daysToKeep = 365): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffStr = cutoffDate.toISOString();

  const history = getTransactionHistory();
  const filtered = history.filter(r => r.timestamp >= cutoffStr);
  const removed = history.length - filtered.length;
  
  saveTransactionHistory(filtered);
  return removed;
}
