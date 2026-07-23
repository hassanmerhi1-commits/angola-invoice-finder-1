import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';

type SearchResult = {
  clients: { id: string; name: string; nif?: string; href: string }[];
  products: { id: string; name: string; sku?: string; href: string }[];
  sales: { id: string; invoiceNumber?: string; customerName?: string; href: string }[];
  purchaseInvoices: { id: string; invoiceNumber?: string; supplierName?: string; href: string }[];
};

const EMPTY: SearchResult = { clients: [], products: [], sales: [], purchaseInvoices: [] };

export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult>(EMPTY);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runSearch = useCallback(async (value: string) => {
    setQ(value);
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

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    setResults(EMPTY);
    navigate(href);
  };

  const sections: { title: string; rows: { key: string; label: string; href: string }[] }[] = [
    {
      title: 'Clients',
      rows: results.clients.map((r) => ({
        key: `c-${r.id}`,
        label: `${r.name}${r.nif ? ` · ${r.nif}` : ''}`,
        href: r.href,
      })),
    },
    {
      title: 'Products',
      rows: results.products.map((r) => ({
        key: `p-${r.id}`,
        label: `${r.name}${r.sku ? ` · ${r.sku}` : ''}`,
        href: r.href,
      })),
    },
    {
      title: 'Sales',
      rows: results.sales.map((r) => ({
        key: `s-${r.id}`,
        label: `${r.invoiceNumber || r.id}${r.customerName ? ` · ${r.customerName}` : ''}`,
        href: r.href,
      })),
    },
    {
      title: 'Purchases',
      rows: results.purchaseInvoices.map((r) => ({
        key: `pi-${r.id}`,
        label: `${r.invoiceNumber || r.id}${r.supplierName ? ` · ${r.supplierName}` : ''}`,
        href: r.href,
      })),
    },
  ].filter((s) => s.rows.length > 0);

  return (
    <>
      <button
        type="button"
        className="hidden md:inline-flex items-center gap-2 h-7 px-2 rounded-md border border-sidebar-border bg-sidebar-accent text-xs text-sidebar-foreground/80 hover:text-sidebar-foreground"
        onClick={() => setOpen(true)}
        title="Search (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="text-[10px] opacity-70">Ctrl+K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base">Global search</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-3">
            <Input
              autoFocus
              placeholder="Client, SKU, invoice…"
              value={q}
              onChange={(e) => void runSearch(e.target.value)}
            />
          </div>
          <div className="max-h-80 overflow-y-auto border-t px-2 py-2">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {!loading && q.trim().length >= 2 && sections.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p>
            )}
            {sections.map((section) => (
              <div key={section.title} className="mb-2">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  {section.title}
                </div>
                {section.rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => go(row.href)}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
