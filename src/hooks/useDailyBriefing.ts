import { useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { api } from '@/lib/api/client';
import { isOpenItemDebit } from '@/lib/openItems';
import { resolveOpenItemDueDate } from '@/lib/paymentTerms';

export type LowStockBriefingItem = {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  unit?: string;
};

export type DueBriefingItem = {
  id: string;
  entityId: string;
  entityName: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string | null;
  amount: number;
  daysUntilDue: number | null;
  overdue: boolean;
  isDebit?: boolean;
};

export type UnprintedBriefingItem = {
  id: string;
  documentNumber: string;
  customerName: string;
  total: number;
  createdAt: string;
};

export type PriceChangeBriefingItem = {
  id: string;
  documentNumber: string;
  supplierName: string;
  date: string;
  total: number;
};

function mapOpenItemDueRows(
  rows: any[],
  nameKey: 'client_name' | 'supplier_name',
  options?: { inferDueFromTerms?: boolean },
): DueBriefingItem[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items: DueBriefingItem[] = [];
  const inferDue = options?.inferDueFromTerms ?? false;

  for (const row of rows) {
    const remaining = Number(row.remaining_amount ?? row.remainingAmount ?? 0);
    if (Math.abs(remaining) <= 0.01) continue;

    const isDebit = isOpenItemDebit(row.is_debit ?? row.isDebit);
    const amount = Math.abs(remaining);

    const documentDate = String(row.document_date ?? row.documentDate ?? '').slice(0, 10);
    const paymentTerms = inferDue
      ? String(row.payment_terms ?? row.paymentTerms ?? '').trim() || null
      : null;
    const dueDate = resolveOpenItemDueDate(
      row.due_date ?? row.dueDate,
      documentDate,
      inferDue ? paymentTerms : null,
    );

    let daysUntilDue: number | null = null;
    let overdue = false;

    if (dueDate) {
      try {
        const due = parseISO(dueDate);
        due.setHours(0, 0, 0, 0);
        daysUntilDue = differenceInDays(due, today);
        overdue = daysUntilDue < 0;
      } catch {
        /* keep row */
      }
    }

    items.push({
      id: String(row.id ?? row.document_id ?? ''),
      entityId: String(row.entity_id ?? row.entityId ?? ''),
      entityName: String(row[nameKey] ?? row.entity_name ?? ''),
      documentNumber: String(row.document_number ?? row.documentNumber ?? ''),
      documentDate,
      dueDate,
      amount,
      daysUntilDue,
      overdue,
      isDebit,
    });
  }

  return items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ad = a.daysUntilDue ?? 9999;
    const bd = b.daysUntilDue ?? 9999;
    return ad - bd;
  });
}

export function useDailyBriefing(branchId?: string, enabled = true) {
  const [loading, setLoading] = useState(false);
  const [lowStock, setLowStock] = useState<LowStockBriefingItem[]>([]);
  const [receivables, setReceivables] = useState<DueBriefingItem[]>([]);
  const [payables, setPayables] = useState<DueBriefingItem[]>([]);
  const [unprintedInvoices, setUnprintedInvoices] = useState<UnprintedBriefingItem[]>([]);
  const [priceChanges, setPriceChanges] = useState<PriceChangeBriefingItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    const warnings: string[] = [];

    try {
      let receivableRows: any[] = [];
      let payableRows: any[] = [];

      const duesRes = await api.payments.checklistDues();
      if (duesRes.data) {
        receivableRows = Array.isArray(duesRes.data.receivables) ? duesRes.data.receivables : [];
        payableRows = Array.isArray(duesRes.data.payables) ? duesRes.data.payables : [];
      } else if (duesRes.error) {
        const openRes = await api.transactions.openItems();
        if (openRes.error) {
          throw new Error(duesRes.error);
        }
        const all = Array.isArray(openRes.data) ? openRes.data : [];
        receivableRows = all.filter(
          (r) => String(r.entity_type ?? r.entityType) === 'customer',
        );
        payableRows = all.filter(
          (r) => String(r.entity_type ?? r.entityType) === 'supplier',
        );
        warnings.push(duesRes.error);
      }

      setReceivables(mapOpenItemDueRows(receivableRows, 'client_name'));
      setPayables(
        mapOpenItemDueRows(payableRows, 'supplier_name', { inferDueFromTerms: true }),
      );

      const briefRes = await api.dailyBriefing.get(branchId);
      if (briefRes.error) {
        warnings.push(briefRes.error);
      } else {
        const data = briefRes.data;
        const stockRows = Array.isArray(data?.lowStock) ? data.lowStock : [];
        setLowStock(
          stockRows.map((row: any) => ({
            id: String(row.id),
            sku: String(row.sku ?? ''),
            name: String(row.name ?? ''),
            stock: Number(row.stock ?? 0),
            minStock: Number(row.min_stock ?? row.minStock ?? 0),
            unit: row.unit ? String(row.unit) : undefined,
          })),
        );

        const unprintedRows = Array.isArray(data?.unprintedInvoices) ? data.unprintedInvoices : [];
        setUnprintedInvoices(
          unprintedRows.map((row: any) => ({
            id: String(row.id),
            documentNumber: String(row.invoice_number ?? row.invoiceNumber ?? ''),
            customerName: String(row.customer_name ?? row.customerName ?? ''),
            total: Number(row.total ?? 0),
            createdAt: String(row.created_at ?? row.createdAt ?? ''),
          })),
        );

        const priceRows = Array.isArray(data?.priceChanges) ? data.priceChanges : [];
        setPriceChanges(
          priceRows.map((row: any) => ({
            id: String(row.id),
            documentNumber: String(row.invoice_number ?? row.invoiceNumber ?? ''),
            supplierName: String(row.supplier_name ?? row.supplierName ?? ''),
            date: String(row.date ?? '').slice(0, 10),
            total: Number(row.total ?? 0),
          })),
        );

        const apiWarnings = (data as { warnings?: string[] })?.warnings;
        if (Array.isArray(apiWarnings)) {
          warnings.push(...apiWarnings);
        }
      }

      if (
        receivables.length === 0 &&
        payables.length === 0 &&
        warnings.some((w) => /checklist-dues|404|not found/i.test(w))
      ) {
        throw new Error(
          warnings[0] || 'Checklist dues unavailable — restart the ERP server after update.',
        );
      }

      setError(warnings.length ? warnings.join('; ') : null);
    } catch (e) {
      console.error('[dailyBriefing]', e);
      const msg = e instanceof Error ? e.message : 'Failed to load';
      setError(msg);
      setReceivables([]);
      setPayables([]);
      setLowStock([]);
      setUnprintedInvoices([]);
      setPriceChanges([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, enabled]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const counts = useMemo(
    () => ({
      lowStock: lowStock.length,
      receivables: receivables.length,
      payables: payables.length,
      unprinted: unprintedInvoices.length,
      priceChanges: priceChanges.length,
    }),
    [
      lowStock.length,
      receivables.length,
      payables.length,
      unprintedInvoices.length,
      priceChanges.length,
    ],
  );

  return {
    loading,
    error,
    lowStock,
    receivables,
    payables,
    unprintedInvoices,
    priceChanges,
    counts,
    refresh,
  };
}
