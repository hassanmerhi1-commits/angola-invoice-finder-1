import type { Sale, Branch, User } from '@/types/erp';
import type { CaixaSession } from '@/types/accounting';
import { getCompanySettings } from '@/lib/companySettings';
import { printHtml } from '@/lib/printHtml';

export type ShiftInvoiceListLabels = {
  title: string;
  cashier: string;
  date: string;
  time: string;
  invoice: string;
  customer: string;
  payment: string;
  total: string;
  walkIn: string;
  shiftSince?: string | null;
  paymentLabel: (method: string) => string;
};

/**
 * A4-style list of shift invoices (one row per sale) — not full thermal receipts.
 * Columns: time, invoice, customer, total, payment method.
 */
export async function printShiftInvoiceList(opts: {
  sales: Sale[];
  branch: Branch | null;
  cashier: User | null;
  session?: CaixaSession | null;
  locale: string;
  labels: ShiftInvoiceListLabels;
}): Promise<{ success: boolean; count: number }> {
  const sales = opts.sales || [];
  if (sales.length === 0) return { success: false, count: 0 };

  const company = getCompanySettings();
  const L = opts.labels;
  const locale = opts.locale;
  const grand = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

  const rows = sales
    .map((sale) => {
      const time = new Date(sale.createdAt).toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const customer = (sale.customerName || '').trim() || L.walkIn;
      const total = `${(Number(sale.total) || 0).toLocaleString(locale)} Kz`;
      return `<tr>
        <td>${escapeHtml(time)}</td>
        <td class="mono">${escapeHtml(sale.invoiceNumber || '')}</td>
        <td>${escapeHtml(customer)}</td>
        <td class="num">${escapeHtml(total)}</td>
        <td>${escapeHtml(L.paymentLabel(sale.paymentMethod || ''))}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(L.title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 12px; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.02em; color: #333; border-bottom: 2px solid #222; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { border-top: 2px solid #222; border-bottom: none; font-weight: bold; padding-top: 8px; }
  @media print {
    body { padding: 0; }
    @page { margin: 12mm; }
  }
</style></head><body>
  <h1>${escapeHtml(L.title)}</h1>
  <div class="meta">
    <div>${escapeHtml(company.tradeName || company.name || '')}</div>
    <div>${escapeHtml(opts.branch?.name || '')}</div>
    <div>${escapeHtml(L.cashier)}: <strong>${escapeHtml(opts.cashier?.name || opts.cashier?.username || '—')}</strong></div>
    <div>${escapeHtml(L.date)}: <strong>${escapeHtml(new Date().toLocaleDateString(locale))}</strong></div>
    ${L.shiftSince ? `<div>${escapeHtml(L.shiftSince)}</div>` : ''}
    <div>${sales.length} · ${escapeHtml(grand.toLocaleString(locale))} Kz</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(L.time)}</th>
        <th>${escapeHtml(L.invoice)}</th>
        <th>${escapeHtml(L.customer)}</th>
        <th class="num">${escapeHtml(L.total)}</th>
        <th>${escapeHtml(L.payment)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">${escapeHtml(L.total)}</td>
        <td class="num">${escapeHtml(grand.toLocaleString(locale))} Kz</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body></html>`;

  await printHtml(html);
  return { success: true, count: sales.length };
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
