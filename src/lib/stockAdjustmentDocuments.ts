import type { StockMovement } from '@/types/erp';

const NON_ADJUSTMENT_REASONS = new Set([
  'purchase',
  'sale',
  'transfer',
  'transfer_in',
  'transfer_out',
  'purchase_invoice',
  'credit_note',
  'return',
]);

export interface StockAdjustmentLine {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  lineValue: number;
}

export interface StockAdjustmentDocument {
  id: string;
  referenceNumber: string;
  direction: 'IN' | 'OUT';
  branchId: string;
  branchName: string;
  reason: string;
  notes: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  lineCount: number;
  totalQuantity: number;
  totalValue: number;
  lines: StockAdjustmentLine[];
}

export function isStockAdjustmentMovement(
  movement: Pick<StockMovement, 'reason' | 'referenceNumber' | 'notes'>,
): boolean {
  const reason = String(movement.reason || '').toLowerCase().trim();
  const refNo = String(movement.referenceNumber || '').trim();
  if (reason === 'adjustment_void') return false;
  if (String(movement.notes || '').includes('[ANULADO]')) return false;

  // Stock Entry / Exit docs (AJ-*) always belong in adjustment history, even when the
  // operator picked reason "purchase" or "transfer_in" (those are NOT purchase invoices).
  if (/^AJ-/i.test(refNo)) return true;

  if (NON_ADJUSTMENT_REASONS.has(reason)) return false;
  if (
    reason === 'adjustment'
    || reason === 'correction'
    || reason === 'damage'
    || reason === 'initial'
    || reason === 'loss'
    || reason === 'expired'
    || reason === 'internal_use'
    || reason === 'sample'
    || reason === 'donation'
  ) {
    return true;
  }
  return false;
}

function documentGroupKey(movement: StockMovement): string {
  const refId = String(movement.referenceId || '').trim();
  if (refId) return refId;
  const refNo = String(movement.referenceNumber || '').trim();
  const branchId = String(movement.branchId || '').trim();
  const day = String(movement.createdAt || '').slice(0, 16);
  return `${refNo}|${branchId}|${movement.type}|${day}`;
}

export function groupStockAdjustmentDocuments(movements: StockMovement[]): StockAdjustmentDocument[] {
  const adjustmentMovements = movements.filter(isStockAdjustmentMovement);
  const groups = new Map<string, StockMovement[]>();

  for (const movement of adjustmentMovements) {
    const key = documentGroupKey(movement);
    const bucket = groups.get(key);
    if (bucket) bucket.push(movement);
    else groups.set(key, [movement]);
  }

  const documents: StockAdjustmentDocument[] = [];

  for (const [key, lines] of groups) {
    const sorted = [...lines].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const first = sorted[0];
    const direction = (first.type === 'OUT' ? 'OUT' : 'IN') as 'IN' | 'OUT';
    const mappedLines: StockAdjustmentLine[] = sorted.map((m) => {
      const unitCost = Number(m.costAtTime) || 0;
      const quantity = Number(m.quantity) || 0;
      return {
        id: m.id,
        productId: m.productId,
        sku: m.sku,
        productName: m.productName,
        quantity,
        unitCost,
        lineValue: Math.round(unitCost * quantity * 100) / 100,
      };
    });
    const totalQuantity = mappedLines.reduce((sum, line) => sum + line.quantity, 0);
    const totalValue = Math.round(
      mappedLines.reduce((sum, line) => sum + line.lineValue, 0) * 100,
    ) / 100;

    documents.push({
      id: String(first.referenceId || key),
      referenceNumber: first.referenceNumber || first.referenceId || key,
      direction,
      branchId: first.branchId,
      branchName: first.branchName || first.branchId,
      reason: first.reason,
      notes: first.notes || '',
      createdAt: first.createdAt,
      createdBy: first.createdBy || '',
      createdByName: first.createdByName || first.createdBy || '',
      lineCount: mappedLines.length,
      totalQuantity,
      totalValue,
      lines: mappedLines,
    });
  }

  return documents.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function filterStockAdjustmentDocuments(
  documents: StockAdjustmentDocument[],
  opts: {
    dateFrom?: string;
    dateTo?: string;
    direction?: 'all' | 'IN' | 'OUT';
    branchId?: string;
    searchTerm?: string;
  },
): StockAdjustmentDocument[] {
  let result = [...documents];

  if (opts.dateFrom) {
    const from = new Date(opts.dateFrom);
    result = result.filter((doc) => new Date(doc.createdAt) >= from);
  }
  if (opts.dateTo) {
    const to = new Date(`${opts.dateTo}T23:59:59`);
    result = result.filter((doc) => new Date(doc.createdAt) <= to);
  }
  if (opts.direction && opts.direction !== 'all') {
    result = result.filter((doc) => doc.direction === opts.direction);
  }
  if (opts.branchId) {
    result = result.filter((doc) => String(doc.branchId) === String(opts.branchId));
  }
  if (opts.searchTerm?.trim()) {
    const q = opts.searchTerm.trim().toLowerCase();
    result = result.filter((doc) =>
      doc.referenceNumber.toLowerCase().includes(q)
      || doc.notes.toLowerCase().includes(q)
      || doc.createdByName.toLowerCase().includes(q)
      || doc.lines.some(
        (line) =>
          line.sku.toLowerCase().includes(q)
          || line.productName.toLowerCase().includes(q),
      ),
    );
  }

  return result;
}

export async function printStockAdjustmentDocument(
  doc: StockAdjustmentDocument,
  labels: {
    title: string;
    reference: string;
    date: string;
    branch: string;
    direction: string;
    directionIn: string;
    directionOut: string;
    reason: string;
    user: string;
    notes: string;
    sku: string;
    product: string;
    quantity: string;
    unitCost: string;
    lineTotal: string;
    documentTotal: string;
    printedAt: string;
  },
  formatMoney: (value: number) => string,
  formatDate: (iso: string) => string,
  getReasonLabel: (reason: string) => string,
): Promise<void> {
  const escape = (value: string) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const rows = doc.lines
    .map(
      (line) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-family:monospace;">${escape(line.sku)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${escape(line.productName)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">${line.quantity}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">${escape(formatMoney(line.unitCost))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;">${escape(formatMoney(line.lineValue))}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escape(labels.title)} — ${escape(doc.referenceNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .meta { margin: 12px 0 20px; font-size: 13px; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #999; background: #f5f5f5; }
    th.right, td.right { text-align: right; }
    .total { margin-top: 12px; font-size: 14px; font-weight: bold; text-align: right; }
    .footer { margin-top: 24px; font-size: 11px; color: #666; }
  </style>
</head>
<body>
  <h1>${escape(labels.title)}</h1>
  <div class="meta">
    <div><strong>${escape(labels.reference)}:</strong> ${escape(doc.referenceNumber)}</div>
    <div><strong>${escape(labels.date)}:</strong> ${escape(formatDate(doc.createdAt))}</div>
    <div><strong>${escape(labels.branch)}:</strong> ${escape(doc.branchName)}</div>
    <div><strong>${escape(labels.direction)}:</strong> ${escape(doc.direction === 'IN' ? labels.directionIn : labels.directionOut)}</div>
    <div><strong>${escape(labels.reason)}:</strong> ${escape(getReasonLabel(doc.reason))}</div>
    <div><strong>${escape(labels.user)}:</strong> ${escape(doc.createdByName || '—')}</div>
    ${doc.notes ? `<div><strong>${escape(labels.notes)}:</strong> ${escape(doc.notes)}</div>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th>${escape(labels.sku)}</th>
        <th>${escape(labels.product)}</th>
        <th class="right">${escape(labels.quantity)}</th>
        <th class="right">${escape(labels.unitCost)}</th>
        <th class="right">${escape(labels.lineTotal)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">${escape(labels.documentTotal)}: ${escape(formatMoney(doc.totalValue))} (${doc.lineCount} ${escape(labels.product.toLowerCase())})</div>
  <div class="footer">${escape(labels.printedAt)}</div>
</body>
</html>`;

  const { printHtml } = await import('@/lib/printHtml');
  await printHtml(html);
}
