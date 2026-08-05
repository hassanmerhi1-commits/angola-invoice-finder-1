/**
 * When POS auto-prints before the sale exists on the city API (offline / outbox),
 * mark-printed 404s and the checklist keeps showing the invoice. Queue those marks
 * and retry once the sale is on the server.
 */

import { api } from '@/lib/api/client';

const STORAGE_KEY = 'nexor:pending-print-marks:v1';
const MAX_ENTRIES = 200;

export type PendingPrintMark = {
  id: string;
  documentNumber?: string;
  clientRequestId?: string;
  format?: string;
  source?: string;
  at: string;
};

function readQueue(): PendingPrintMark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list: PendingPrintMark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* ignore */
  }
}

function sameMark(a: PendingPrintMark, b: PendingPrintMark): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (a.clientRequestId && b.clientRequestId && a.clientRequestId === b.clientRequestId) return true;
  if (
    a.documentNumber
    && b.documentNumber
    && a.documentNumber.trim().toUpperCase() === b.documentNumber.trim().toUpperCase()
  ) {
    return true;
  }
  return false;
}

export function enqueuePendingPrintMark(
  mark: Omit<PendingPrintMark, 'at'> & { at?: string },
): void {
  if (!mark.id && !mark.documentNumber && !mark.clientRequestId) return;
  const next: PendingPrintMark = {
    id: String(mark.id || mark.clientRequestId || mark.documentNumber || ''),
    documentNumber: mark.documentNumber || undefined,
    clientRequestId: mark.clientRequestId || undefined,
    format: mark.format,
    source: mark.source,
    at: mark.at || new Date().toISOString(),
  };
  const list = readQueue().filter((row) => !sameMark(row, next));
  list.push(next);
  writeQueue(list);
}

export function removePendingPrintMark(match: Partial<PendingPrintMark>): void {
  const probe: PendingPrintMark = {
    id: String(match.id || ''),
    documentNumber: match.documentNumber,
    clientRequestId: match.clientRequestId,
    at: '',
  };
  writeQueue(readQueue().filter((row) => !sameMark(row, probe)));
}

/** Best-effort flush — safe to call from checklist refresh / after sync. */
export async function flushPendingPrintMarks(): Promise<{ flushed: number; left: number }> {
  const list = readQueue();
  if (list.length === 0) return { flushed: 0, left: 0 };

  const remaining: PendingPrintMark[] = [];
  let flushed = 0;

  for (const mark of list) {
    const id = mark.id || mark.clientRequestId || mark.documentNumber;
    if (!id) continue;
    try {
      const res = await api.sales.markPrinted(id, {
        format: mark.format,
        reprint: false,
        source: mark.source || 'pos',
        documentNumber: mark.documentNumber,
        clientRequestId: mark.clientRequestId || (mark.id !== mark.documentNumber ? mark.id : undefined),
      });
      if (res.error) {
        remaining.push(mark);
      } else {
        flushed += 1;
      }
    } catch {
      remaining.push(mark);
    }
  }

  writeQueue(remaining);
  return { flushed, left: remaining.length };
}
