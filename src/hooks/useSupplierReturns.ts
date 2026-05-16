// Supplier Returns Hook — API-First
import { useState, useEffect, useCallback } from 'react';
import { PurchaseOrder } from '@/types/erp';
import { 
  SupplierReturn, 
  SupplierReturnItem,
  getSupplierReturns, 
  saveSupplierReturn, 
  generateSupplierReturnNumber 
} from '@/lib/supplierReturns';
import { api } from '@/lib/api/client';
import {
  afterSupplierReturnMutation,
  subscribeSupplierReturnsChanged,
} from '@/lib/supplierReturnSync';

export function useSupplierReturns(branchId?: string) {
  const [supplierReturns, setSupplierReturns] = useState<SupplierReturn[]>([]);

  const refreshReturns = useCallback(async () => {
    const data = await getSupplierReturns(branchId);
    setSupplierReturns(data);
  }, [branchId]);

  useEffect(() => {
    refreshReturns();
  }, [refreshReturns]);

  useEffect(() => subscribeSupplierReturnsChanged(refreshReturns), [refreshReturns]);

  const createSupplierReturn = useCallback(async (
    branchId: string,
    branchCode: string,
    purchaseOrder: PurchaseOrder,
    reason: SupplierReturn['reason'],
    reasonDescription: string,
    items: SupplierReturnItem[],
    createdBy: string,
    notes?: string,
    deductStock: boolean = true
  ): Promise<SupplierReturn> => {
    let branches: any[] = [];
    try {
      const response = await api.branches.list();
      branches = response.data || [];
    } catch {
      const raw = localStorage.getItem('kwanzaerp_branches');
      branches = raw ? JSON.parse(raw) : [];
    }
    const branch = branches.find((b: any) => b.id === branchId);
    const returnNumber = generateSupplierReturnNumber(branchCode);
    
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = items.reduce((sum, item) => sum + item.taxAmount, 0);
    const total = subtotal + taxAmount;

    const supplierReturn: SupplierReturn = {
      id: `sr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      returnNumber,
      branchId,
      branchName: branch?.name || '',
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderNumber: purchaseOrder.orderNumber,
      supplierId: purchaseOrder.supplierId,
      supplierName: purchaseOrder.supplierName,
      reason,
      reasonDescription,
      items,
      subtotal,
      taxAmount,
      total,
      status: 'pending',
      createdBy,
      createdAt: new Date().toISOString(),
      notes,
    };

    await saveSupplierReturn(supplierReturn);

    if (deductStock) {
      for (const item of items) {
        // Use transaction engine API for stock movements
        try {
          await api.transactions.createStockMovement({
            productId: item.productId,
            warehouseId: branchId,
            movementType: 'OUT',
            quantity: item.quantity,
            referenceType: 'supplier_return',
            referenceId: supplierReturn.id,
            referenceNumber: returnNumber,
            notes: `Devolução a fornecedor: ${reasonDescription}`,
            createdBy,
          });
        } catch {
          // Fallback: direct product stock update
          await api.products.updateStock(item.productId, -item.quantity);
        }
      }
    }

    await afterSupplierReturnMutation({
      invoiceId: purchaseOrder.id,
      branchId,
    });
    await refreshReturns();
    return supplierReturn;
  }, [refreshReturns]);

  const approveReturn = useCallback(async (returnId: string, approvedBy: string) => {
    const returns = await getSupplierReturns();
    const returnDoc = returns.find(r => r.id === returnId);
    if (returnDoc && returnDoc.status === 'pending') {
      returnDoc.status = 'approved';
      returnDoc.approvedBy = approvedBy;
      returnDoc.approvedAt = new Date().toISOString();
      await saveSupplierReturn(returnDoc);
      await afterSupplierReturnMutation({
        invoiceId: returnDoc.purchaseOrderId,
        branchId: returnDoc.branchId,
      });
      await refreshReturns();
    }
  }, [refreshReturns]);

  const markAsShipped = useCallback(async (returnId: string) => {
    const returns = await getSupplierReturns();
    const returnDoc = returns.find(r => r.id === returnId);
    if (returnDoc && returnDoc.status === 'approved') {
      returnDoc.status = 'shipped';
      returnDoc.shippedAt = new Date().toISOString();
      await saveSupplierReturn(returnDoc);
      await afterSupplierReturnMutation({
        invoiceId: returnDoc.purchaseOrderId,
        branchId: returnDoc.branchId,
      });
      await refreshReturns();
    }
  }, [refreshReturns]);

  const completeReturn = useCallback(async (returnId: string) => {
    const returns = await getSupplierReturns();
    const returnDoc = returns.find(r => r.id === returnId);
    if (returnDoc && (returnDoc.status === 'shipped' || returnDoc.status === 'approved')) {
      returnDoc.status = 'completed';
      returnDoc.completedAt = new Date().toISOString();
      await saveSupplierReturn(returnDoc);
      await afterSupplierReturnMutation({
        invoiceId: returnDoc.purchaseOrderId,
        branchId: returnDoc.branchId,
      });
      await refreshReturns();
    }
  }, [refreshReturns]);

  const cancelReturn = useCallback(async (returnId: string, userId: string) => {
    const returns = await getSupplierReturns();
    const returnDoc = returns.find(r => r.id === returnId);
    if (returnDoc && returnDoc.status === 'pending') {
      for (const item of returnDoc.items) {
        try {
          await api.transactions.createStockMovement({
            productId: item.productId,
            warehouseId: returnDoc.branchId,
            movementType: 'IN',
            quantity: item.quantity,
            referenceType: 'adjustment',
            referenceId: returnDoc.id,
            referenceNumber: returnDoc.returnNumber,
            notes: 'Supplier return cancellation',
            createdBy: userId,
          });
        } catch {
          await api.products.updateStock(item.productId, item.quantity);
        }
      }
      
      returnDoc.status = 'cancelled';
      await saveSupplierReturn(returnDoc);
      await afterSupplierReturnMutation({
        invoiceId: returnDoc.purchaseOrderId,
        branchId: returnDoc.branchId,
      });
      await refreshReturns();
    }
  }, [refreshReturns]);

  return { 
    supplierReturns, 
    createSupplierReturn, 
    approveReturn, 
    markAsShipped, 
    completeReturn, 
    cancelReturn,
    refreshReturns 
  };
}
