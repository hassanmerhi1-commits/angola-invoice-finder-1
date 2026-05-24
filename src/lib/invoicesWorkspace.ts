import type { DocumentType } from '@/types/documents';
import { DOCUMENT_TYPE_CONFIG } from '@/types/documents';

/** Active tab on /invoices — shared with TopNav toolbar (survives event timing). */
export type InvoicesWorkspaceTab = DocumentType | 'all';

const VALID_TABS = new Set<InvoicesWorkspaceTab>([
  'all',
  ...Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[],
]);

const STORAGE_KEY = 'nexor_invoices_active_tab';

let memoryTab: InvoicesWorkspaceTab = 'all';

export const NEXOR_INVOICES_NEW = 'nexor:invoices-new';
export const NEXOR_INVOICES_NEW_RECEIPT = 'nexor:invoices-new-receipt';

export function setInvoicesWorkspaceTab(tab: InvoicesWorkspaceTab): void {
  const safe = sanitizeTab(tab);
  memoryTab = safe;
  try {
    sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* ignore */
  }
}

function sanitizeTab(tab: string | null | undefined): InvoicesWorkspaceTab {
  if (tab && VALID_TABS.has(tab as InvoicesWorkspaceTab)) {
    return tab as InvoicesWorkspaceTab;
  }
  return 'all';
}

export function getInvoicesWorkspaceTab(): InvoicesWorkspaceTab {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) return sanitizeTab(stored);
  } catch {
    /* ignore */
  }
  return sanitizeTab(memoryTab);
}

export function documentTypeForNewFromTab(tab?: InvoicesWorkspaceTab): DocumentType {
  const resolved = tab ?? getInvoicesWorkspaceTab();
  if (resolved === 'all') return 'fatura_venda';
  return resolved;
}
