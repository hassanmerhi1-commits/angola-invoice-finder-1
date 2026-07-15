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
    userName: currentUser?.name || 'Sistema',
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

// Action display names (Portuguese)
export const ACTION_LABELS: Record<TransactionAction, string> = {
  // Sales
  sale_created: 'Venda Realizada',
  sale_voided: 'Venda Anulada',
  sale_refunded: 'Venda Reembolsada',
  invoice_printed: 'Factura Impressa',
  invoice_reprinted: 'Factura Reimpressa',
  // Inventory
  product_created: 'Produto Criado',
  product_updated: 'Produto Actualizado',
  product_deleted: 'Produto Eliminado',
  stock_adjusted: 'Stock Ajustado',
  stock_imported: 'Stock Importado',
  price_changed: 'Preço Alterado',
  // Clients
  client_created: 'Cliente Criado',
  client_updated: 'Cliente Actualizado',
  client_deleted: 'Cliente Eliminado',
  client_imported: 'Clientes Importados',
  // Suppliers
  supplier_created: 'Fornecedor Criado',
  supplier_updated: 'Fornecedor Actualizado',
  supplier_deleted: 'Fornecedor Eliminado',
  supplier_imported: 'Fornecedores Importados',
  // Stock Transfer
  transfer_requested: 'Transferência Solicitada',
  transfer_approved: 'Transferência Aprovada',
  transfer_received: 'Transferência Recebida',
  transfer_cancelled: 'Transferência Cancelada',
  // Purchases
  purchase_created: 'Compra Registada',
  purchase_received: 'Compra Recebida',
  purchase_cancelled: 'Compra Cancelada',
  supplier_return: 'Devolução ao Fornecedor',
  // User
  user_login: 'Início de Sessão',
  user_logout: 'Fim de Sessão',
  user_created: 'Utilizador Criado',
  user_updated: 'Utilizador Actualizado',
  user_deleted: 'Utilizador Eliminado',
  password_changed: 'Palavra-passe Alterada',
  // Settings
  settings_updated: 'Configurações Actualizadas',
  branch_created: 'Filial Criada',
  branch_updated: 'Filial Actualizada',
  branch_deleted: 'Filial Eliminada',
  category_created: 'Categoria Criada',
  category_updated: 'Categoria Actualizada',
  category_deleted: 'Categoria Eliminada',
  // Fiscal
  saft_exported: 'SAF-T Exportado',
  day_closed: 'Dia Fechado',
  day_opened: 'Dia Aberto',
  proforma_created: 'Pro Forma Criada',
  proforma_status_changed: 'Pro Forma Actualizada',
  proforma_converted: 'Pro Forma Convertida',
  proforma_deleted: 'Pro Forma Eliminada',
  // Reports
  report_generated: 'Relatório Gerado',
  report_exported: 'Relatório Exportado',
  data_exported: 'Dados Exportados',
  data_imported: 'Dados Importados',
};

// Category display names (Portuguese)
export const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  sales: 'Vendas',
  inventory: 'Inventário',
  clients: 'Clientes',
  suppliers: 'Fornecedores',
  stock_transfer: 'Transferências',
  purchase: 'Compras',
  user: 'Utilizadores',
  settings: 'Configurações',
  fiscal: 'Fiscal',
  reports: 'Relatórios',
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
export async function exportTransactionHistoryToExcel(records: TransactionRecord[], filename = 'historico_transacoes') {
  const data = records.map(r => ({
    'Data/Hora': new Date(r.timestamp).toLocaleString('pt-AO'),
    'Utilizador': r.userName,
    'Função': r.userRole,
    'Filial': r.branchName,
    'Categoria': CATEGORY_LABELS[r.category] || r.category,
    'Acção': ACTION_LABELS[r.action] || r.action,
    'Tipo Entidade': r.entityType,
    'Número': r.entityNumber || '',
    'Nome': r.entityName || '',
    'Descrição': r.description,
    'Valor': r.amount ? r.amount.toLocaleString('pt-AO') : '',
  }));

  await exportReportExcel(data, filename, { title: 'Histórico de Transacções' });
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
