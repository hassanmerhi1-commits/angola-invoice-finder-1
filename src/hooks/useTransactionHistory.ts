// Hook for Transaction History - Easy logging from components

import { useState, useCallback, useMemo } from 'react';
import {
  logTransaction,
  getTransactionHistory,
  filterTransactionHistory,
  getTransactionStats,
  TransactionCategory,
  TransactionAction,
  TransactionRecord,
  TransactionFilter,
} from '@/lib/transactionHistory';

export function useTransactionHistory() {
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Log a transaction and refresh
  const log = useCallback((params: {
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
  }) => {
    const record = logTransaction(params);
    refresh();
    return record;
  }, [refresh]);

  // Get all history
  const history = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = refreshKey; // Trigger re-computation on refresh
    return getTransactionHistory();
  }, [refreshKey]);

  // Get filtered history
  const getFiltered = useCallback((filter: TransactionFilter) => {
    return filterTransactionHistory(filter);
  }, []);

  // Get stats
  const getStats = useCallback((filter?: TransactionFilter) => {
    return getTransactionStats(filter);
  }, []);

  return {
    log,
    history,
    getFiltered,
    getStats,
    refresh,
  };
}

// Convenience hooks for specific transaction types
export function useSaleTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logSaleCreated: (saleId: string, invoiceNumber: string, total: number, customerName?: string) => {
      log({
        category: 'sales',
        action: 'sale_created',
        entityType: 'Venda',
        entityId: saleId,
        entityNumber: invoiceNumber,
        entityName: customerName,
        description: `Venda ${invoiceNumber} realizada${customerName ? ` para ${customerName}` : ''}`,
        amount: total,
      });
    },
    logSaleVoided: (saleId: string, invoiceNumber: string, reason?: string) => {
      log({
        category: 'sales',
        action: 'sale_voided',
        entityType: 'Venda',
        entityId: saleId,
        entityNumber: invoiceNumber,
        description: `Venda ${invoiceNumber} anulada${reason ? `: ${reason}` : ''}`,
      });
    },
    logInvoicePrinted: (invoiceNumber: string) => {
      log({
        category: 'sales',
        action: 'invoice_printed',
        entityType: 'Factura',
        entityNumber: invoiceNumber,
        description: `Factura ${invoiceNumber} impressa`,
      });
    },
  };
}

export function useInventoryTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logProductCreated: (productId: string, sku: string, name: string) => {
      log({
        category: 'inventory',
        action: 'product_created',
        entityType: 'Produto',
        entityId: productId,
        entityNumber: sku,
        entityName: name,
        description: `Produto ${sku} - ${name} criado`,
      });
    },
    logProductUpdated: (productId: string, sku: string, name: string, changes?: Record<string, unknown>) => {
      log({
        category: 'inventory',
        action: 'product_updated',
        entityType: 'Produto',
        entityId: productId,
        entityNumber: sku,
        entityName: name,
        description: `Produto ${sku} - ${name} actualizado`,
        details: changes,
      });
    },
    logProductDeleted: (productId: string, sku: string, name: string) => {
      log({
        category: 'inventory',
        action: 'product_deleted',
        entityType: 'Produto',
        entityId: productId,
        entityNumber: sku,
        entityName: name,
        description: `Produto ${sku} - ${name} eliminado`,
      });
    },
    logStockAdjusted: (productId: string, sku: string, name: string, quantity: number, reason?: string) => {
      log({
        category: 'inventory',
        action: 'stock_adjusted',
        entityType: 'Produto',
        entityId: productId,
        entityNumber: sku,
        entityName: name,
        description: `Stock do produto ${sku} ajustado em ${quantity > 0 ? '+' : ''}${quantity} unidades${reason ? ` - ${reason}` : ''}`,
        details: { quantity, reason },
      });
    },
    logStockImported: (count: number) => {
      log({
        category: 'inventory',
        action: 'stock_imported',
        entityType: 'Produtos',
        description: `${count} produtos importados via Excel`,
        details: { count },
      });
    },
    logPriceChanged: (productId: string, sku: string, name: string, oldPrice: number, newPrice: number) => {
      log({
        category: 'inventory',
        action: 'price_changed',
        entityType: 'Produto',
        entityId: productId,
        entityNumber: sku,
        entityName: name,
        description: `Preço do produto ${sku} alterado de ${oldPrice.toLocaleString()} para ${newPrice.toLocaleString()}`,
        previousValue: oldPrice,
        newValue: newPrice,
      });
    },
  };
}

export function useClientTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logClientCreated: (clientId: string, nif: string, name: string) => {
      log({
        category: 'clients',
        action: 'client_created',
        entityType: 'Cliente',
        entityId: clientId,
        entityNumber: nif,
        entityName: name,
        description: `Cliente ${name} (NIF: ${nif}) criado`,
      });
    },
    logClientUpdated: (clientId: string, nif: string, name: string) => {
      log({
        category: 'clients',
        action: 'client_updated',
        entityType: 'Cliente',
        entityId: clientId,
        entityNumber: nif,
        entityName: name,
        description: `Cliente ${name} (NIF: ${nif}) actualizado`,
      });
    },
    logClientDeleted: (clientId: string, nif: string, name: string) => {
      log({
        category: 'clients',
        action: 'client_deleted',
        entityType: 'Cliente',
        entityId: clientId,
        entityNumber: nif,
        entityName: name,
        description: `Cliente ${name} (NIF: ${nif}) eliminado`,
      });
    },
    logClientsImported: (count: number) => {
      log({
        category: 'clients',
        action: 'client_imported',
        entityType: 'Clientes',
        description: `${count} clientes importados via Excel`,
        details: { count },
      });
    },
  };
}

export function useSupplierTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logSupplierCreated: (supplierId: string, nif: string, name: string) => {
      log({
        category: 'suppliers',
        action: 'supplier_created',
        entityType: 'Fornecedor',
        entityId: supplierId,
        entityNumber: nif,
        entityName: name,
        description: `Fornecedor ${name} (NIF: ${nif}) criado`,
      });
    },
    logSupplierUpdated: (supplierId: string, nif: string, name: string) => {
      log({
        category: 'suppliers',
        action: 'supplier_updated',
        entityType: 'Fornecedor',
        entityId: supplierId,
        entityNumber: nif,
        entityName: name,
        description: `Fornecedor ${name} (NIF: ${nif}) actualizado`,
      });
    },
    logSupplierDeleted: (supplierId: string, nif: string, name: string) => {
      log({
        category: 'suppliers',
        action: 'supplier_deleted',
        entityType: 'Fornecedor',
        entityId: supplierId,
        entityNumber: nif,
        entityName: name,
        description: `Fornecedor ${name} (NIF: ${nif}) eliminado`,
      });
    },
    logSuppliersImported: (count: number) => {
      log({
        category: 'suppliers',
        action: 'supplier_imported',
        entityType: 'Fornecedores',
        description: `${count} fornecedores importados via Excel`,
        details: { count },
      });
    },
  };
}

export function useUserTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logUserLogin: (userId: string, userName: string) => {
      log({
        category: 'user',
        action: 'user_login',
        entityType: 'User',
        entityId: userId,
        entityName: userName,
        description: `${userName} signed in`,
      });
    },
    logUserLogout: (userId: string, userName: string) => {
      log({
        category: 'user',
        action: 'user_logout',
        entityType: 'User',
        entityId: userId,
        entityName: userName,
        description: `${userName} signed out`,
      });
    },
    logUserCreated: (userId: string, userName: string, role: string) => {
      log({
        category: 'user',
        action: 'user_created',
        entityType: 'User',
        entityId: userId,
        entityName: userName,
        description: `User ${userName} created with role ${role}`,
        details: { role },
      });
    },
  };
}

export function useTransferTransactionLog() {
  const { log } = useTransactionHistory();

  return {
    logTransferRequested: (transferId: string, transferNumber: string, fromBranch: string, toBranch: string) => {
      log({
        category: 'stock_transfer',
        action: 'transfer_requested',
        entityType: 'Transfer',
        entityId: transferId,
        entityNumber: transferNumber,
        description: `Transfer ${transferNumber} requested from ${fromBranch} to ${toBranch}`,
      });
    },
    logTransferApproved: (transferId: string, transferNumber: string) => {
      log({
        category: 'stock_transfer',
        action: 'transfer_approved',
        entityType: 'Transfer',
        entityId: transferId,
        entityNumber: transferNumber,
        description: `Transfer ${transferNumber} approved`,
      });
    },
    logTransferReceived: (transferId: string, transferNumber: string) => {
      log({
        category: 'stock_transfer',
        action: 'transfer_received',
        entityType: 'Transfer',
        entityId: transferId,
        entityNumber: transferNumber,
        description: `Transfer ${transferNumber} received`,
      });
    },
    logTransferCancelled: (transferId: string, transferNumber: string, reason?: string) => {
      log({
        category: 'stock_transfer',
        action: 'transfer_cancelled',
        entityType: 'Transfer',
        entityId: transferId,
        entityNumber: transferNumber,
        description: `Transfer ${transferNumber} cancelled${reason ? `: ${reason}` : ''}`,
      });
    },
  };
}
