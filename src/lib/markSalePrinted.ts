import { api } from '@/lib/api/client';
import type { ERPDocument } from '@/types/documents';

/** Record print on backend so the daily checklist "to print" tab stays accurate. */
export async function markSalePrintedAfterPrint(doc: ERPDocument): Promise<void> {
  if (doc.documentType !== 'fatura_venda' || !doc.id) return;
  try {
    await api.sales.markPrinted(doc.id);
  } catch (e) {
    console.warn('[markSalePrinted]', e);
  }
}
