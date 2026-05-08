import { generateId } from '@/lib/utils';
// Pro Forma hook for NEXOR ERP — API-First
import { useState, useCallback, useEffect } from 'react';
import { ProForma, ProFormaItem } from '@/types/proforma';
import { Product, Sale, SaleItem } from '@/types/erp';
import {
  getProFormas,
  getProFormaById,
  saveProForma,
  deleteProForma as removeProForma,
  generateProFormaNumber,
  calculateProFormaTotals,
  updateExpiredProFormas,
  getProFormaStats,
} from '@/lib/proforma';
import { api } from '@/lib/api/client';
import { useTransactionHistory } from './useTransactionHistory';

export function useProForma(branchId?: string) {
  const [proformas, setProformas] = useState<ProForma[]>([]);
  const { log: logTransaction } = useTransactionHistory();

  const refresh = useCallback(async () => {
    await updateExpiredProFormas();
    const data = await getProFormas(branchId);
    setProformas(data);
  }, [branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProForma = useCallback(async (
    branchId: string,
    branchCode: string,
    branchName: string,
    items: ProFormaItem[],
    customer: {
      name: string;
      nif?: string;
      email?: string;
      phone?: string;
      address?: string;
    },
    validDays: number,
    createdBy: string,
    notes?: string,
    termsAndConditions?: string
  ): Promise<ProForma> => {
    const totals = calculateProFormaTotals(items);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);

    const proforma: ProForma = {
      id: generateId(),
      documentNumber: generateProFormaNumber(branchCode),
      branchId,
      branchName,
      customerName: customer.name,
      customerNif: customer.nif,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerAddress: customer.address,
      items,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discount: 0,
      total: totals.total,
      validUntil: validUntil.toISOString(),
      status: 'draft',
      notes,
      termsAndConditions,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveProForma(proforma);
    await refresh();

    logTransaction({
      category: 'fiscal',
      action: 'proforma_created',
      entityId: proforma.id,
      entityType: 'proforma',
      description: `Pro Forma ${proforma.documentNumber} criada para ${customer.name}`,
      details: { total: proforma.total, items: items.length },
    });

    return proforma;
  }, [refresh, logTransaction]);

  const updateProFormaStatus = useCallback(async (
    proformaId: string,
    status: ProForma['status']
  ): Promise<void> => {
    const proforma = await getProFormaById(proformaId);
    if (!proforma) return;

    proforma.status = status;
    proforma.updatedAt = new Date().toISOString();
    await saveProForma(proforma);
    await refresh();

    logTransaction({
      category: 'fiscal',
      action: 'proforma_status_changed',
      entityId: proforma.id,
      entityType: 'proforma',
      description: `Pro Forma ${proforma.documentNumber} alterada para ${status}`,
      details: { status },
    });
  }, [refresh, logTransaction]);

  const convertToInvoice = useCallback(async (
    proformaId: string,
    branchCode: string,
    cashierId: string,
    cashierName: string,
    paymentMethod: Sale['paymentMethod'],
    amountPaid: number
  ): Promise<Sale | null> => {
    const proforma = await getProFormaById(proformaId);
    if (!proforma || proforma.status === 'converted') return null;

    const saleItems: SaleItem[] = proforma.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      subtotal: item.subtotal,
    }));

    // Generate invoice number via API
    let invoiceNumber = '';
    try {
      const response = await api.sales.generateInvoiceNumber(branchCode);
      invoiceNumber = response.data?.invoiceNumber || `FT-${branchCode}-${Date.now()}`;
    } catch {
      invoiceNumber = `FT-${branchCode}-${Date.now()}`;
    }
    
    const sale: Sale = {
      id: generateId(),
      invoiceNumber,
      branchId: proforma.branchId,
      cashierId,
      cashierName,
      items: saleItems,
      subtotal: proforma.subtotal,
      taxAmount: proforma.taxAmount,
      discount: proforma.discount,
      total: proforma.total,
      paymentMethod,
      amountPaid,
      change: Math.max(0, amountPaid - proforma.total),
      customerNif: proforma.customerNif,
      customerName: proforma.customerName,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };

    const saleResult = await api.sales.create(sale);
    if (!saleResult.data) {
      throw new Error(saleResult.error || 'Failed to save sale on the server');
    }

    proforma.status = 'converted';
    proforma.convertedToInvoiceId = sale.id;
    proforma.convertedToInvoiceNumber = invoiceNumber;
    proforma.convertedAt = new Date().toISOString();
    proforma.updatedAt = new Date().toISOString();
    await saveProForma(proforma);
    
    await refresh();

    logTransaction({
      category: 'sales',
      action: 'proforma_converted',
      entityId: sale.id,
      entityType: 'sale',
      description: `Pro Forma ${proforma.documentNumber} converted to Invoice ${invoiceNumber}`,
      details: { proformaId, invoiceId: sale.id, invoiceNumber, total: sale.total },
    });

    return sale;
  }, [refresh, logTransaction]);

  const duplicateProForma = useCallback(async (
    proformaId: string,
    branchCode: string,
    createdBy: string
  ): Promise<ProForma | null> => {
    const original = await getProFormaById(proformaId);
    if (!original) return null;

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const newProforma: ProForma = {
      ...original,
      id: generateId(),
      documentNumber: generateProFormaNumber(branchCode),
      status: 'draft',
      validUntil: validUntil.toISOString(),
      convertedToInvoiceId: undefined,
      convertedToInvoiceNumber: undefined,
      convertedAt: undefined,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveProForma(newProforma);
    await refresh();

    return newProforma;
  }, [refresh]);

  const deleteProForma = useCallback(async (proformaId: string): Promise<void> => {
    const proforma = await getProFormaById(proformaId);
    if (proforma && proforma.status !== 'converted') {
      await removeProForma(proformaId);
      await refresh();

      logTransaction({
        category: 'fiscal',
        action: 'proforma_deleted',
        entityId: proformaId,
        entityType: 'proforma',
        description: `Pro Forma ${proforma.documentNumber} eliminada`,
        details: {},
      });
    }
  }, [refresh, logTransaction]);

  const getStats = useCallback(() => {
    return getProFormaStats(branchId);
  }, [branchId]);

  return {
    proformas,
    refresh,
    createProForma,
    updateProFormaStatus,
    convertToInvoice,
    duplicateProForma,
    deleteProForma,
    getStats,
    getProFormaById,
  };
}

export function productToProFormaItem(product: Product, quantity: number = 1): ProFormaItem {
  const subtotal = product.price * quantity;
  const taxAmount = subtotal * (product.taxRate / 100);
  
  return {
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    quantity,
    unitPrice: product.price,
    discount: 0,
    taxRate: product.taxRate,
    taxAmount,
    subtotal: subtotal + taxAmount,
  };
}
