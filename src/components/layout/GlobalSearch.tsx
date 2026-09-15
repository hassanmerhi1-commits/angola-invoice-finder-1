import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { useTranslation } from '@/i18n';
import {
  accountSearchHref,
  bankAccountSearchHref,
  branchSearchHref,
  caixaSearchHref,
  categorySearchHref,
  clientSearchHref,
  creditNoteSearchHref,
  debitNoteSearchHref,
  expenseSearchHref,
  importOrderSearchHref,
  journalSearchHref,
  openItemSearchHref,
  paymentSearchHref,
  productSearchHref,
  proformaSearchHref,
  purchaseOrderSearchHref,
  purchaseSearchHref,
  saleSearchHref,
  salesOrderSearchHref,
  splitAppHref,
  stockTransferSearchHref,
  supplierSearchHref,
  transportSearchHref,
  userSearchHref,
  type NexorSearchFocus,
} from '@/lib/searchFocus';

type SearchHit = { id: string; [key: string]: unknown };

type SearchResult = {
  clients: SearchHit[];
  products: SearchHit[];
  suppliers: SearchHit[];
  sales: SearchHit[];
  purchaseInvoices: SearchHit[];
  purchaseOrders: SearchHit[];
  salesOrders: SearchHit[];
  proformas: SearchHit[];
  creditNotes: SearchHit[];
  debitNotes: SearchHit[];
  transportDocuments: SearchHit[];
  expenses: SearchHit[];
  payments: SearchHit[];
  journals: SearchHit[];
  accounts: SearchHit[];
  bankAccounts: SearchHit[];
  stockTransfers: SearchHit[];
  importOrders: SearchHit[];
  users: SearchHit[];
  branches: SearchHit[];
  categories: SearchHit[];
  caixas: SearchHit[];
  openItems: SearchHit[];
};

const EMPTY: SearchResult = {
  clients: [],
  products: [],
  suppliers: [],
  sales: [],
  purchaseInvoices: [],
  purchaseOrders: [],
  salesOrders: [],
  proformas: [],
  creditNotes: [],
  debitNotes: [],
  transportDocuments: [],
  expenses: [],
  payments: [],
  journals: [],
  accounts: [],
  bankAccounts: [],
  stockTransfers: [],
  importOrders: [],
  users: [],
  branches: [],
  categories: [],
  caixas: [],
  openItems: [],
};

const MORE_KEYS: (keyof SearchResult)[] = [
  'purchaseOrders',
  'salesOrders',
  'proformas',
  'creditNotes',
  'debitNotes',
  'transportDocuments',
  'expenses',
  'payments',
  'journals',
  'accounts',
  'bankAccounts',
  'stockTransfers',
  'importOrders',
  'users',
  'branches',
  'categories',
  'caixas',
  'openItems',
];

function mergeMore(prev: SearchResult, extra: Partial<SearchResult>): SearchResult {
  const next = { ...prev };
  for (const key of MORE_KEYS) {
    if (Array.isArray(extra[key])) next[key] = extra[key] as SearchHit[];
  }
  return next;
}

function str(v: unknown) {
  return v == null ? '' : String(v);
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const gs = t.globalSearchUi;
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchSearch = useCallback(async (term: string) => {
    const seq = ++seqRef.current;
    try {
      const quick = await api.search.query(term, 6, 'quick');
      if (seq !== seqRef.current) return;
      setResults(quick.data ? { ...EMPTY, ...(quick.data as Partial<SearchResult>) } : EMPTY);
      setLoading(false);
      // New backend returns scope:"quick". Older servers ignore scope and already
      // searched every table — skip the second round-trip in that case.
      if ((quick.data as { scope?: string } | undefined)?.scope !== 'quick') {
        return;
      }
      setLoadingMore(true);
      const more = await api.search.query(term, 6, 'more');
      if (seq !== seqRef.current) return;
      if (more.data) setResults((prev) => mergeMore(prev, more.data as Partial<SearchResult>));
    } catch {
      if (seq !== seqRef.current) return;
      setResults(EMPTY);
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const onQueryChange = useCallback((value: string) => {
    setQ(value);
    setOpen(true);
    const trimmed = value.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (isDemoMode() || trimmed.length < 2) {
      seqRef.current += 1;
      setResults(EMPTY);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void fetchSearch(trimmed);
    }, 100);
  }, [fetchSearch]);

  const go = (href: string, focus: NexorSearchFocus) => {
    setOpen(false);
    setQ('');
    setResults(EMPTY);
    const { pathname, search } = splitAppHref(href);
    navigate({ pathname, search }, { state: { nexorSearchFocus: focus } });
  };

  const sections = [
    {
      title: gs.products,
      rows: (results.products || []).map((r) => ({
        key: `p-${r.id}`,
        label: `${str(r.name)}${r.sku ? ` · ${str(r.sku)}` : ''}`,
        href: productSearchHref(r.id, str(r.sku) || undefined, str(r.name) || undefined),
        focus: { kind: 'product', productId: r.id, sku: str(r.sku) || undefined, name: str(r.name) || undefined },
      })),
    },
    {
      title: gs.clients,
      rows: (results.clients || []).map((r) => ({
        key: `c-${r.id}`,
        label: `${str(r.name)}${r.nif ? ` · ${str(r.nif)}` : ''}`,
        href: clientSearchHref(r.id),
        focus: { kind: 'client', clientId: r.id },
      })),
    },
    {
      title: gs.suppliers,
      rows: (results.suppliers || []).map((r) => ({
        key: `sup-${r.id}`,
        label: `${str(r.name)}${r.nif ? ` · ${str(r.nif)}` : ''}`,
        href: supplierSearchHref(r.id),
        focus: { kind: 'supplier', supplierId: r.id },
      })),
    },
    {
      title: gs.sales,
      rows: (results.sales || []).map((r) => ({
        key: `s-${r.id}`,
        label: `${str(r.invoiceNumber || r.id)}${r.customerName ? ` · ${str(r.customerName)}` : ''}`,
        href: saleSearchHref(r.id, str(r.invoiceNumber) || undefined),
        focus: { kind: 'sale', invoiceId: r.id, q: str(r.invoiceNumber) || undefined },
      })),
    },
    {
      title: gs.purchases,
      rows: (results.purchaseInvoices || []).map((r) => ({
        key: `pi-${r.id}`,
        label: `${str(r.invoiceNumber || r.id)}${r.supplierName ? ` · ${str(r.supplierName)}` : ''}`,
        href: purchaseSearchHref(r.id, str(r.invoiceNumber) || undefined),
        focus: { kind: 'purchase', invoiceId: r.id, q: str(r.invoiceNumber) || undefined },
      })),
    },
    {
      title: gs.purchaseOrders,
      rows: (results.purchaseOrders || []).map((r) => ({
        key: `po-${r.id}`,
        label: `${str(r.orderNumber || r.id)}${r.supplierName ? ` · ${str(r.supplierName)}` : ''}`,
        href: purchaseOrderSearchHref(r.id, str(r.orderNumber) || undefined),
        focus: { kind: 'purchaseOrder', orderId: r.id, q: str(r.orderNumber) || undefined },
      })),
    },
    {
      title: gs.salesOrders,
      rows: (results.salesOrders || []).map((r) => ({
        key: `so-${r.id}`,
        label: `${str(r.orderNumber || r.id)}${r.clientName ? ` · ${str(r.clientName)}` : ''}`,
        href: salesOrderSearchHref(r.id),
        focus: { kind: 'salesOrder', orderId: r.id },
      })),
    },
    {
      title: gs.proformas,
      rows: (results.proformas || []).map((r) => ({
        key: `pf-${r.id}`,
        label: `${str(r.proformaNumber || r.id)}${r.clientName ? ` · ${str(r.clientName)}` : ''}`,
        href: proformaSearchHref(r.id),
        focus: { kind: 'proforma', proformaId: r.id },
      })),
    },
    {
      title: gs.creditNotes,
      rows: (results.creditNotes || []).map((r) => ({
        key: `cn-${r.id}`,
        label: `${str(r.documentNumber || r.id)}${r.customerName ? ` · ${str(r.customerName)}` : ''}`,
        href: creditNoteSearchHref(r.id),
        focus: { kind: 'creditNote', creditNoteId: r.id },
      })),
    },
    {
      title: gs.debitNotes,
      rows: (results.debitNotes || []).map((r) => ({
        key: `dn-${r.id}`,
        label: `${str(r.documentNumber || r.id)}${r.customerName ? ` · ${str(r.customerName)}` : ''}`,
        href: debitNoteSearchHref(r.id),
        focus: { kind: 'debitNote', debitNoteId: r.id },
      })),
    },
    {
      title: gs.transport,
      rows: (results.transportDocuments || []).map((r) => ({
        key: `gt-${r.id}`,
        label: `${str(r.documentNumber || r.id)}${r.destinationName ? ` · ${str(r.destinationName)}` : ''}`,
        href: transportSearchHref(r.id),
        focus: { kind: 'transport', transportId: r.id },
      })),
    },
    {
      title: gs.expenses,
      rows: (results.expenses || []).map((r) => ({
        key: `ex-${r.id}`,
        label: `${str(r.expenseNumber || r.description || r.id)}${r.payeeName ? ` · ${str(r.payeeName)}` : ''}`,
        href: expenseSearchHref(r.id),
        focus: { kind: 'expense', expenseId: r.id },
      })),
    },
    {
      title: gs.payments,
      rows: (results.payments || []).map((r) => ({
        key: `pay-${r.id}`,
        label: `${str(r.paymentNumber || r.id)}${r.entityName ? ` · ${str(r.entityName)}` : ''}`,
        href: paymentSearchHref(r.id, str(r.paymentNumber) || undefined, str(r.paymentType) || undefined),
        focus: {
          kind: 'payment',
          paymentId: r.id,
          q: str(r.paymentNumber) || undefined,
          type: str(r.paymentType) || undefined,
        },
      })),
    },
    {
      title: gs.journals,
      rows: (results.journals || []).map((r) => ({
        key: `j-${r.id}`,
        label: `${str(r.entryNumber || r.id)}${r.description ? ` · ${str(r.description)}` : ''}`,
        href: journalSearchHref(r.id, str(r.entryNumber) || undefined),
        focus: { kind: 'journal', journalId: r.id, q: str(r.entryNumber) || undefined },
      })),
    },
    {
      title: gs.accounts,
      rows: (results.accounts || []).map((r) => ({
        key: `a-${r.id}`,
        label: `${str(r.code)} · ${str(r.name)}`,
        href: accountSearchHref(r.id, str(r.code) || undefined),
        focus: { kind: 'account', accountId: r.id, code: str(r.code) || undefined },
      })),
    },
    {
      title: gs.bankAccounts,
      rows: (results.bankAccounts || []).map((r) => ({
        key: `ba-${r.id}`,
        label: `${str(r.bankName || r.name)}${r.accountNumber ? ` · ${str(r.accountNumber)}` : ''}`,
        href: bankAccountSearchHref(r.id),
        focus: { kind: 'bankAccount', bankAccountId: r.id },
      })),
    },
    {
      title: gs.stockTransfers,
      rows: (results.stockTransfers || []).map((r) => ({
        key: `st-${r.id}`,
        label: `${str(r.transferNumber || r.id)}${r.fromBranchName ? ` · ${str(r.fromBranchName)} → ${str(r.toBranchName)}` : ''}`,
        href: stockTransferSearchHref(r.id),
        focus: { kind: 'stockTransfer', transferId: r.id },
      })),
    },
    {
      title: gs.importOrders,
      rows: (results.importOrders || []).map((r) => ({
        key: `io-${r.id}`,
        label: `${str(r.orderNumber || r.id)}${r.supplierName ? ` · ${str(r.supplierName)}` : ''}`,
        href: importOrderSearchHref(r.id),
        focus: { kind: 'importOrder', importOrderId: r.id },
      })),
    },
    {
      title: gs.users,
      rows: (results.users || []).map((r) => ({
        key: `u-${r.id}`,
        label: `${str(r.name)}${r.email ? ` · ${str(r.email)}` : ''}`,
        href: userSearchHref(r.id),
        focus: { kind: 'user', userId: r.id },
      })),
    },
    {
      title: gs.branches,
      rows: (results.branches || []).map((r) => ({
        key: `b-${r.id}`,
        label: `${str(r.name)}${r.code ? ` · ${str(r.code)}` : ''}`,
        href: branchSearchHref(r.id),
        focus: { kind: 'branch', branchId: r.id },
      })),
    },
    {
      title: gs.categories,
      rows: (results.categories || []).map((r) => ({
        key: `cat-${r.id}`,
        label: str(r.name),
        href: categorySearchHref(r.id),
        focus: { kind: 'category', categoryId: r.id },
      })),
    },
    {
      title: gs.caixas,
      rows: (results.caixas || []).map((r) => ({
        key: `cx-${r.id}`,
        label: `${str(r.name)}${r.branchName ? ` · ${str(r.branchName)}` : ''}`,
        href: caixaSearchHref(r.id),
        focus: { kind: 'caixa', caixaId: r.id },
      })),
    },
    {
      title: gs.openItems,
      rows: (results.openItems || []).map((r) => ({
        key: `oi-${r.id}`,
        label: `${str(r.documentNumber || r.id)}${r.entityName ? ` · ${str(r.entityName)}` : ''}`,
        href: openItemSearchHref(r.id, str(r.entityType) || undefined, str(r.documentNumber || r.entityName) || undefined),
        focus: {
          kind: 'openItem',
          openItemId: r.id,
          q: str(r.documentNumber || r.entityName) || undefined,
          entityType: str(r.entityType) || undefined,
        },
      })),
    },
  ].filter((s) => s.rows.length > 0);

  const firstRow = sections[0]?.rows[0];
  const waiting = (loading || loadingMore) && sections.length === 0;
  const showPanel = open && (loading || loadingMore || q.trim().length >= 2);

  return (
    <div ref={boxRef} className="relative hidden md:block w-72 xl:w-80">
      <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/60" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => {
          if (q.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !firstRow) return;
          e.preventDefault();
          go(firstRow.href, firstRow.focus as NexorSearchFocus);
        }}
        placeholder={gs.placeholder}
        title={gs.buttonTitle}
        className="h-7 border-sidebar-border bg-sidebar-accent pl-7 pr-10 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/55"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-sidebar-foreground/50">
        Ctrl+K
      </kbd>

      {showPanel && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[24rem] max-h-[28rem] overflow-y-auto rounded-md border bg-popover p-2 shadow-lg">
          {waiting && (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {gs.searching}
            </div>
          )}
          {loadingMore && sections.length > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {gs.searching}
            </div>
          )}
          {!loading && !loadingMore && q.trim().length >= 2 && sections.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{gs.noMatches}</p>
          )}
          {sections.map((section) => (
            <div key={section.title} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                {section.title}
              </div>
              {section.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => go(row.href, row.focus as NexorSearchFocus)}
                >
                  {row.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
