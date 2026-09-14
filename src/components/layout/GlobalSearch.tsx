import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { useTranslation } from '@/i18n';
import {
  clientSearchHref,
  productSearchHref,
  purchaseSearchHref,
  saleSearchHref,
  splitAppHref,
  type NexorSearchFocus,
} from '@/lib/searchFocus';

type SearchResult = {
  clients: { id: string; name: string; nif?: string; href: string }[];
  products: { id: string; name: string; sku?: string; href: string }[];
  sales: { id: string; invoiceNumber?: string; customerName?: string; href: string }[];
  purchaseInvoices: { id: string; invoiceNumber?: string; supplierName?: string; href: string }[];
};

const EMPTY: SearchResult = { clients: [], products: [], sales: [], purchaseInvoices: [] };

export function GlobalSearch() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const gs = t.globalSearchUi;
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const runSearch = useCallback(async (value: string) => {
    setQ(value);
    setOpen(true);
    if (isDemoMode() || value.trim().length < 2) {
      setResults(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const res = await api.search.query(value.trim());
      if (res.data) setResults(res.data as SearchResult);
      else setResults(EMPTY);
    } catch {
      setResults(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  const go = (href: string, focus: NexorSearchFocus) => {
    setOpen(false);
    setQ('');
    setResults(EMPTY);
    const { pathname, search } = splitAppHref(href);
    navigate({ pathname, search }, { state: { nexorSearchFocus: focus } });
  };

  const sections: {
    title: string;
    rows: { key: string; label: string; href: string; focus: NexorSearchFocus }[];
  }[] = [
    {
      title: gs.clients,
      rows: results.clients.map((r) => ({
        key: `c-${r.id}`,
        label: `${r.name}${r.nif ? ` · ${r.nif}` : ''}`,
        href: clientSearchHref(r.id),
        focus: { kind: 'client', clientId: r.id },
      })),
    },
    {
      title: gs.products,
      rows: results.products.map((r) => ({
        key: `p-${r.id}`,
        label: `${r.name}${r.sku ? ` · ${r.sku}` : ''}`,
        href: productSearchHref(r.id, r.sku, r.name),
        focus: { kind: 'product', productId: r.id, sku: r.sku, name: r.name },
      })),
    },
    {
      title: gs.sales,
      rows: results.sales.map((r) => ({
        key: `s-${r.id}`,
        label: `${r.invoiceNumber || r.id}${r.customerName ? ` · ${r.customerName}` : ''}`,
        href: saleSearchHref(r.id, r.invoiceNumber),
        focus: { kind: 'sale', invoiceId: r.id, q: r.invoiceNumber },
      })),
    },
    {
      title: gs.purchases,
      rows: results.purchaseInvoices.map((r) => ({
        key: `pi-${r.id}`,
        label: `${r.invoiceNumber || r.id}${r.supplierName ? ` · ${r.supplierName}` : ''}`,
        href: purchaseSearchHref(r.id, r.invoiceNumber),
        focus: { kind: 'purchase', invoiceId: r.id, q: r.invoiceNumber },
      })),
    },
  ].filter((s) => s.rows.length > 0);

  const firstRow = sections[0]?.rows[0];

  const showPanel = open && (loading || q.trim().length >= 2);

  return (
    <div ref={boxRef} className="relative hidden md:block w-72 xl:w-80">
      <Search className="pointer-events-none absolute left-2 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/60" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => void runSearch(e.target.value)}
        onFocus={() => {
          if (q.trim().length >= 2) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !firstRow) return;
          e.preventDefault();
          go(firstRow.href, firstRow.focus);
        }}
        placeholder={gs.placeholder}
        title={gs.buttonTitle}
        className="h-7 border-sidebar-border bg-sidebar-accent pl-7 pr-10 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/55"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-sidebar-foreground/50">
        Ctrl+K
      </kbd>

      {showPanel && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[22rem] max-h-80 overflow-y-auto rounded-md border bg-popover p-2 shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {gs.searching}
            </div>
          )}
          {!loading && q.trim().length >= 2 && sections.length === 0 && (
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
                  onClick={() => go(row.href, row.focus)}
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
