import { useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import { api } from '@/lib/api/client';

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

const DUE_WITHIN_DAYS = 30;

function parseDueDate(raw: unknown, documentDate: string): string | null {
  if (raw) return String(raw).slice(0, 10);
  if (!documentDate) return null;
  return String(documentDate).slice(0, 10);
}

function mapDueRows(
  rows: any[],
  nameKey: 'client_name' | 'supplier_name',
): DueBriefingItem[] {
  const today = new Date();
  const items: DueBriefingItem[] = [];

  for (const row of rows) {
    const amount = Number(row.remaining_amount ?? row.remainingAmount ?? 0);
    if (amount <= 0.01) continue;

    const documentDate = String(row.document_date ?? row.documentDate ?? '').slice(0, 10);
    const dueDate = parseDueDate(row.due_date ?? row.dueDate, documentDate);
    let daysUntilDue: number | null = null;
    let overdue = false;

    if (dueDate) {
      daysUntilDue = differenceInDays(parseISO(dueDate), today);
      overdue = daysUntilDue < 0;
      if (daysUntilDue > DUE_WITHIN_DAYS) continue;
    }

    items.push({
      id: String(row.id ?? row.document_id ?? ''),
      entityId: String(row.entity_id ?? ''),
      entityName: String(row[nameKey] ?? ''),
      documentNumber: String(row.document_number ?? row.documentNumber ?? ''),
      documentDate,
      dueDate,
      amount,
      daysUntilDue,
      overdue,
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
    try {
      const res = await api.dailyBriefing.get(branchId);
      if (res.error) throw new Error(res.error);

      const data = res.data;
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

      setReceivables(
        mapDueRows(Array.isArray(data?.receivables) ? data.receivables : [], 'client_name'),
      );
      setPayables(
        mapDueRows(Array.isArray(data?.payables) ? data.payables : [], 'supplier_name'),
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
    } catch (e) {
      console.error('[dailyBriefing]', e);
      setError(e instanceof Error ? e.message : 'Failed to load');
      setLowStock([]);
      setReceivables([]);
      setPayables([]);
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
