import type { NavigateFunction } from 'react-router-dom';
import type { DailyTodoItem } from '@/lib/dailyTodos';

/**
 * Stable checklist destinations (SAP / Odoo / NetSuite style):
 * checkbox = complete; row click = open the workspace for that task.
 */
export type DailyTodoAction =
  | 'review_invoices'
  | 'low_stock'
  | 'reconcile_caixa'
  | 'overdue_ar'
  | 'overdue_ap'
  | 'payments'
  | 'purchase_invoices'
  | 'pos';

export const DEFAULT_TODO_ACTIONS: DailyTodoAction[] = [
  'review_invoices',
  'low_stock',
  'reconcile_caixa',
  'overdue_ar',
];

/** Legacy English default lines → action (users who never edited Settings). */
const LEGACY_TEXT_TO_ACTION: Record<string, DailyTodoAction> = {
  'review pending sales invoices and receipts': 'review_invoices',
  'check inventory / low-stock items': 'low_stock',
  'reconcile cash register (caixa)': 'reconcile_caixa',
  'follow up on overdue customer balances': 'overdue_ar',
};

export interface DailyTodoActionTarget {
  path: string;
  state?: Record<string, unknown>;
  /** Optional briefing tab inside the checklist dialog (before navigate). */
  briefingTab?:
    | 'tasks'
    | 'lowStock'
    | 'receivables'
    | 'payables'
    | 'toPrint'
    | 'priceChanges';
}

export function resolveDailyTodoAction(item: Pick<DailyTodoItem, 'text' | 'action'>): DailyTodoAction | null {
  if (item.action) return item.action;
  const key = String(item.text || '').trim().toLowerCase();
  if (LEGACY_TEXT_TO_ACTION[key]) return LEGACY_TEXT_TO_ACTION[key];
  return inferActionFromText(key);
}

/** Best-effort match for free-text / custom tasks. */
export function inferActionFromText(text: string): DailyTodoAction | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/(caixa|cash register|gaveta|fecho|reconcile|reconcil)/.test(t)) return 'reconcile_caixa';
  if (/(low.?stock|inventory|stock|inventário|inventario|stock baixo)/.test(t)) return 'low_stock';
  if (/(receivable|customer balance|overdue customer|cobran|cliente|a receber)/.test(t)) {
    return 'overdue_ar';
  }
  if (/(payable|supplier.*pay|a pagar|fornecedor)/.test(t)) return 'overdue_ap';
  if (/(purchase|compra|preço|preco|price change)/.test(t)) return 'purchase_invoices';
  if (/(receipt|payment|pagamento|recibo)/.test(t) && !/invoice|factura|fatura/.test(t)) {
    return 'payments';
  }
  if (/(invoice|factura|fatura|print|imprim|receipt)/.test(t)) return 'review_invoices';
  if (/\bpos\b|checkout|venda/.test(t)) return 'pos';
  return null;
}

export function getDailyTodoActionTarget(action: DailyTodoAction): DailyTodoActionTarget {
  switch (action) {
    case 'review_invoices':
      return { path: '/invoices', briefingTab: 'toPrint' };
    case 'low_stock':
      return { path: '/inventory', briefingTab: 'lowStock' };
    case 'reconcile_caixa':
      return { path: '/caixa' };
    case 'overdue_ar':
      return { path: '/receivables', briefingTab: 'receivables' };
    case 'overdue_ap':
      return { path: '/payables', briefingTab: 'payables' };
    case 'payments':
      return { path: '/payments', state: { openReceipt: true } };
    case 'purchase_invoices':
      return { path: '/purchase-invoices', briefingTab: 'priceChanges' };
    case 'pos':
      return { path: '/pos' };
    default:
      return { path: '/' };
  }
}

export function navigateDailyTodoAction(
  navigate: NavigateFunction,
  action: DailyTodoAction,
): void {
  const target = getDailyTodoActionTarget(action);
  if (target.state) {
    navigate(target.path, { state: target.state });
  } else {
    navigate(target.path);
  }
}
