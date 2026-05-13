/**
 * Central Transaction Engine — API-First
 * 
 * All business operations go through the backend API which atomically updates:
 *   1. Stock movements (branch-scoped)
 *   2. Journal entries (double-entry accounting)
 *   3. Open items (receivables/payables)
 *   4. Document links (traceability chain)
 *   5. Entity balances (client/supplier)
 * 
 * Uses the backend API as the single execution layer for transactional writes.
 */

import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { OpenItem, DocumentLink } from '@/types/erp';
import { updateCoABalancesFromJournal } from '@/lib/chartOfAccountsEngine';
import { logTransaction, TransactionCategory, TransactionAction } from '@/lib/transactionHistory';

// ==================== TYPES ====================

export interface StockEntry {
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitCost: number;
  direction: 'IN' | 'OUT';
  warehouseId: string;
}

export interface JournalLine {
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
  note?: string;
}

export interface TaxLineEntry {
  lineNumber: number;
  taxCode: string;
  taxRate: number;
  baseAmount: number;
  taxAmount: number;
  isInclusive?: boolean;
}

export interface OpenItemEntry {
  entityType: 'customer' | 'supplier';
  entityId: string;
  entityName: string;
  documentType: 'invoice' | 'credit_note' | 'debit_note' | 'payment' | 'advance';
  originalAmount: number;
  isDebit: boolean;
  dueDate?: string;
  currency?: string;
}

export interface DocumentLinkEntry {
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  targetType: string;
  targetId: string;
  targetNumber: string;
}

export interface TransactionRequest {
  transactionType: 'purchase_invoice' | 'sale' | 'payment_receipt' | 'payment_out' | 'stock_transfer' | 'adjustment' | 'expense' | 'credit_note';
  documentId: string;
  documentNumber: string;
  branchId: string;
  branchName: string;
  userId: string;
  userName: string;
  date: string;
  currency?: string;
  stockEntries?: StockEntry[];
  journalLines?: JournalLine[];
  taxLines?: TaxLineEntry[];
  openItem?: OpenItemEntry;
  documentLinks?: DocumentLinkEntry[];
  priceUpdates?: {
    productId: string;
    newUnitCost: number;
    quantityReceived: number;
    updateAvgCost: boolean;
  }[];
  entityBalanceUpdate?: {
    entityType: 'customer' | 'supplier';
    entityId: string;
    entityName: string;
    entityNif?: string;
    amount: number;
  };
  description: string;
  amount?: number;
}

export interface TransactionResult {
  success: boolean;
  errors: string[];
  stockMovementIds: string[];
  journalEntryId?: string;
  openItemId?: string;
  documentLinkIds: string[];
}

// ==================== MAIN ENGINE (API-First) ====================

export async function processTransaction(request: TransactionRequest): Promise<TransactionResult> {
  const result: TransactionResult = {
    success: false,
    errors: [],
    stockMovementIds: [],
    documentLinkIds: [],
  };

  if (!request.branchId) {
    result.errors.push('branchId é obrigatório — todas as transações devem ser associadas a uma filial');
    return result;
  }

  if (isDemoMode()) {
    return processTransactionLocal(request);
  }

  try {
    const apiResult = await api.transactions.process(request);

    if (apiResult.data && apiResult.data.success) {
      result.success = true;
      result.stockMovementIds = apiResult.data.stockMovementIds || [];
      result.journalEntryId = apiResult.data.journalEntryId;
      result.openItemId = apiResult.data.openItemId;
      result.documentLinkIds = apiResult.data.documentLinkIds || [];

      console.log(`[TransactionEngine] ✅ ${request.transactionType} ${request.documentNumber} processed via API`);
    } else if (apiResult.error) {
      console.error(`[TransactionEngine] ❌ API error for ${request.transactionType} ${request.documentNumber}:`, apiResult.error);
      result.errors.push(apiResult.error);
      return result;
    }
  } catch (error) {
    console.error('[TransactionEngine] ❌ API transaction failed:', error);
    result.errors.push(error instanceof Error ? error.message : 'Transaction failed');
    return result;
  }

  // Audit trail (always local for real-time feedback)
  logTransactionAudit(request);

  return result;
}

// ==================== LOCAL FALLBACK (Demo/Offline) ====================

async function processTransactionLocal(request: TransactionRequest): Promise<TransactionResult> {
  const result: TransactionResult = {
    success: false,
    errors: [],
    stockMovementIds: [],
    documentLinkIds: [],
  };

  try {
    // Phase 1: Stock Movements (localStorage)
    if (request.stockEntries && request.stockEntries.length > 0) {
      const MOVEMENTS_KEY = 'kwanzaerp_stock_movements';
      const movements = JSON.parse(localStorage.getItem(MOVEMENTS_KEY) || '[]');

      for (const entry of request.stockEntries) {
        const movementId = `sm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        movements.push({
          id: movementId,
          productId: entry.productId,
          productName: entry.productName,
          sku: entry.productSku,
          branchId: entry.warehouseId,
          type: entry.direction,
          quantity: entry.quantity,
          reason: mapTransactionTypeToReason(request.transactionType),
          referenceId: request.documentId,
          referenceNumber: request.documentNumber,
          costAtTime: entry.unitCost,
          createdBy: request.userId,
          createdAt: new Date().toISOString(),
        });
        result.stockMovementIds.push(movementId);

        // Update product stock in localStorage
        const PRODUCTS_KEY = 'kwanzaerp_products';
        const products = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || '[]');
        const qtyChange = entry.direction === 'IN' ? entry.quantity : -entry.quantity;
        const pIdx = products.findIndex((p: any) => p.id === entry.productId);
        if (pIdx >= 0) {
          products[pIdx].stock = (products[pIdx].stock || 0) + qtyChange;
          products[pIdx].updatedAt = new Date().toISOString();
          localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
        }
      }
      localStorage.setItem(MOVEMENTS_KEY, JSON.stringify(movements));
    }

    // Phase 2: Journal Entry (localStorage)
    if (request.journalLines && request.journalLines.length > 0) {
      const JE_KEY = 'kwanzaerp_journal_entries';
      const entries = JSON.parse(localStorage.getItem(JE_KEY) || '[]');
      const entryId = `je_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const totalDebit = request.journalLines.reduce((s, l) => s + (l.debit || 0), 0);
      const totalCredit = request.journalLines.reduce((s, l) => s + (l.credit || 0), 0);

      entries.push({
        id: entryId,
        entryNumber: `JE-${Date.now()}`,
        entryDate: request.date.split('T')[0],
        description: request.description,
        referenceType: request.transactionType,
        referenceId: request.documentId,
        branchId: request.branchId,
        totalDebit,
        totalCredit,
        lines: request.journalLines,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(JE_KEY, JSON.stringify(entries));
      result.journalEntryId = entryId;

      // Phase 2b: Update Chart of Accounts balances from journal lines
      try {
        await updateCoABalancesFromJournal(request.journalLines);
        console.log(`[TransactionEngine] ✅ CoA balances updated for ${request.journalLines.length} lines`);
      } catch (coaErr) {
        console.error('[TransactionEngine] ⚠️ CoA balance update failed:', coaErr);
      }
    }

    // Phase 3: Open Item (localStorage)
    if (request.openItem) {
      const OI_KEY = 'kwanzaerp_open_items';
      const items = JSON.parse(localStorage.getItem(OI_KEY) || '[]');
      const oiId = `oi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      items.push({
        id: oiId,
        entityType: request.openItem.entityType,
        entityId: request.openItem.entityId,
        documentType: request.openItem.documentType,
        documentId: request.documentId,
        documentNumber: request.documentNumber,
        documentDate: request.date,
        dueDate: request.openItem.dueDate,
        currency: request.openItem.currency || request.currency || 'AOA',
        originalAmount: request.openItem.originalAmount,
        remainingAmount: request.openItem.originalAmount,
        isDebit: request.openItem.isDebit,
        status: 'open',
        branchId: request.branchId,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(OI_KEY, JSON.stringify(items));
      result.openItemId = oiId;
    }

    // Phase 4: Document Links (localStorage)
    if (request.documentLinks && request.documentLinks.length > 0) {
      const DL_KEY = 'kwanzaerp_document_links';
      const links = JSON.parse(localStorage.getItem(DL_KEY) || '[]');
      for (const dl of request.documentLinks) {
        const dlId = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        links.push({
          id: dlId,
          sourceType: dl.sourceType,
          sourceId: dl.sourceId,
          sourceNumber: dl.sourceNumber,
          targetType: dl.targetType,
          targetId: dl.targetId,
          targetNumber: dl.targetNumber,
          createdAt: new Date().toISOString(),
        });
        result.documentLinkIds.push(dlId);
      }
      localStorage.setItem(DL_KEY, JSON.stringify(links));
    }

    // Phase 5: Entity Balance (localStorage)
    if (request.entityBalanceUpdate) {
      const ebu = request.entityBalanceUpdate;
      if (ebu.entityType === 'supplier') {
        const SUPPLIERS_KEY = 'kwanzaerp_suppliers';
        const suppliers = JSON.parse(localStorage.getItem(SUPPLIERS_KEY) || '[]');
        const sIdx = suppliers.findIndex((s: any) => s.id === ebu.entityId || s.name === ebu.entityName);
        if (sIdx >= 0) {
          suppliers[sIdx].balance = (suppliers[sIdx].balance || 0) + ebu.amount;
          localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(suppliers));
        }
      } else if (ebu.entityType === 'customer') {
        const CLIENTS_KEY = 'kwanzaerp_clients';
        const clients = JSON.parse(localStorage.getItem(CLIENTS_KEY) || '[]');
        const cIdx = clients.findIndex((c: any) => c.id === ebu.entityId || c.name === ebu.entityName);
        if (cIdx >= 0) {
          clients[cIdx].currentBalance = (clients[cIdx].currentBalance || 0) + ebu.amount;
          localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
        }
      }
    }

    result.success = true;
    console.log(`[TransactionEngine] ✅ ${request.transactionType} ${request.documentNumber} processed locally (demo mode)`);
  } catch (error) {
    console.error('[TransactionEngine] ❌ Local transaction failed:', error);
    result.errors.push(String(error));
  }

  logTransactionAudit(request);
  return result;
}

// ==================== QUERY FUNCTIONS (API-First) ====================

export async function getOpenItemsByEntity(entityType: 'customer' | 'supplier', entityId: string): Promise<OpenItem[]> {
  const result = await api.transactions.openItems({ entityType, entityId });
  if (result.data) {
    return result.data.map(mapOpenItemFromApi);
  }
  // Fallback to localStorage
  const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]');
  return items.filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId && oi.status !== 'cleared');
}

export async function getOpenItemsByBranch(branchId: string): Promise<OpenItem[]> {
  const result = await api.transactions.openItems({ branchId });
  if (result.data) {
    return result.data.map(mapOpenItemFromApi);
  }
  const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]');
  return items.filter((oi: any) => oi.branchId === branchId);
}

export async function getDocumentLinksBySource(sourceType: string, sourceId: string): Promise<DocumentLink[]> {
  const result = await api.transactions.documentLinks({ sourceType, sourceId });
  if (result.data) {
    return result.data.map(mapDocLinkFromApi);
  }
  const links = JSON.parse(localStorage.getItem('kwanzaerp_document_links') || '[]');
  return links.filter((dl: any) => dl.sourceType === sourceType && dl.sourceId === sourceId);
}

export async function getDocumentLinksByTarget(targetType: string, targetId: string): Promise<DocumentLink[]> {
  const result = await api.transactions.documentLinks({ targetType: targetType, targetId });
  if (result.data) {
    return result.data.map(mapDocLinkFromApi);
  }
  const links = JSON.parse(localStorage.getItem('kwanzaerp_document_links') || '[]');
  return links.filter((dl: any) => dl.targetType === targetType && dl.targetId === targetId);
}

export async function getDocumentChain(documentType: string, documentId: string): Promise<DocumentLink[]> {
  const result = await api.transactions.documentLinks({ sourceType: documentType, sourceId: documentId });
  if (result.data) {
    return result.data.map(mapDocLinkFromApi);
  }
  const links = JSON.parse(localStorage.getItem('kwanzaerp_document_links') || '[]');
  const chain: DocumentLink[] = [];
  chain.push(...links.filter((dl: any) => dl.sourceType === documentType && dl.sourceId === documentId));
  chain.push(...links.filter((dl: any) => dl.targetType === documentType && dl.targetId === documentId));
  return chain;
}

// ==================== HELPERS ====================

function mapTransactionTypeToReason(type: string): string {
  const map: Record<string, string> = {
    purchase_invoice: 'purchase',
    sale: 'sale',
    stock_transfer: 'transfer_in',
    adjustment: 'adjustment',
    credit_note: 'return',
  };
  return map[type] || 'adjustment';
}

function mapOpenItemFromApi(row: any): OpenItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    documentType: row.document_type,
    documentId: row.document_id,
    documentNumber: row.document_number,
    documentDate: row.document_date,
    dueDate: row.due_date,
    currency: row.currency || 'AOA',
    originalAmount: Number(row.original_amount || 0),
    remainingAmount: Number(row.remaining_amount || 0),
    isDebit: !!row.is_debit,
    status: row.status || 'open',
    branchId: row.branch_id,
    createdAt: row.created_at,
  };
}

function mapDocLinkFromApi(row: any): DocumentLink {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceNumber: row.source_number,
    targetType: row.target_type,
    targetId: row.target_id,
    targetNumber: row.target_number,
    createdAt: row.created_at,
  };
}

function logTransactionAudit(request: TransactionRequest): void {
  const categoryMap: Record<string, TransactionCategory> = {
    purchase_invoice: 'purchase',
    sale: 'sales',
    payment_receipt: 'sales',
    payment_out: 'purchase',
    stock_transfer: 'stock_transfer',
    adjustment: 'inventory',
    expense: 'purchase',
    credit_note: request.openItem?.entityType === 'supplier' ? 'purchase' : 'sales',
  };

  const actionMap: Record<string, TransactionAction> = {
    purchase_invoice: 'purchase_created',
    sale: 'sale_created',
    payment_receipt: 'purchase_received',
    payment_out: 'purchase_created',
    stock_transfer: 'transfer_requested',
    adjustment: 'stock_adjusted',
    expense: 'purchase_created',
    credit_note: request.openItem?.entityType === 'supplier' ? 'supplier_return' : 'sale_refunded',
  };

  logTransaction({
    category: categoryMap[request.transactionType] || 'purchase',
    action: actionMap[request.transactionType] || 'purchase_created',
    entityType: request.transactionType,
    entityId: request.documentId,
    entityNumber: request.documentNumber,
    description: request.description,
    amount: request.amount,
    branchId: request.branchId,
    branchName: request.branchName,
  });
}
