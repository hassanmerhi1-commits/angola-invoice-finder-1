import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';
import { pt, enUS } from 'date-fns/locale';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  Users,
  Truck,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type PartyBalanceMode = 'receivables' | 'payables';

type DocLine = {
  id: string;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  amount: number;
  daysUntilDue: number;
};

type PartyRow = {
  entityId: string;
  name: string;
  nif: string;
  total: number;
  overdue: number;
  current: number;
  documentCount: number;
  oldestDue: string | null;
  lines: DocLine[];
};

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  try {
    const d = parseISO(String(raw).slice(0, 10));
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function groupPartyRows(
  rows: any[],
  mode: PartyBalanceMode,
): PartyRow[] {
  const today = new Date();
  const byId = new Map<string, PartyRow>();

  for (const row of rows) {
    const entityId = String(row.entity_id || row.entityId || '').trim();
    if (!entityId) continue;
    const amount = Number(row.remaining_amount ?? row.remainingAmount ?? 0);
    if (!(amount > 0.001)) continue;

    const name = String(
      mode === 'receivables'
        ? (row.client_name || row.clientName || row.entity_name || row.entityName || '')
        : (row.supplier_name || row.supplierName || row.entity_name || row.entityName || ''),
    );
    const nif = String(
      mode === 'receivables'
        ? (row.client_nif || row.clientNif || '')
        : (row.supplier_nif || row.supplierNif || ''),
    );
    const dueRaw = String(row.due_date || row.dueDate || row.document_date || row.documentDate || '');
    const due = parseDate(dueRaw);
    const daysUntilDue = due ? differenceInDays(due, today) : 0;
    const isOverdue = daysUntilDue < 0;

    let party = byId.get(entityId);
    if (!party) {
      party = {
        entityId,
        name: name || entityId,
        nif,
        total: 0,
        overdue: 0,
        current: 0,
        documentCount: 0,
        oldestDue: null,
        lines: [],
      };
      byId.set(entityId, party);
    }

    party.total += amount;
    if (isOverdue) party.overdue += amount;
    else party.current += amount;
    party.documentCount += 1;
    if (dueRaw) {
      if (!party.oldestDue || dueRaw < party.oldestDue) party.oldestDue = dueRaw.slice(0, 10);
    }
    party.lines.push({
      id: String(row.id || row.document_id || `${entityId}-${party.documentCount}`),
      documentNumber: String(row.document_number || row.documentNumber || '—'),
      documentDate: String(row.document_date || row.documentDate || '').slice(0, 10),
      dueDate: dueRaw.slice(0, 10),
      amount,
      daysUntilDue,
    });
  }

  return Array.from(byId.values())
    .map((p) => ({
      ...p,
      lines: p.lines.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function PartyBalancesView({ mode }: { mode: PartyBalanceMode }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { apiBranchId } = useBranchScope();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dfLocale = language === 'pt' ? pt : enUS;
  const ui = t.partyBalancesUi;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = mode === 'receivables'
        ? await api.payments.receivablesAging(apiBranchId || undefined)
        : await api.payments.payablesAging(apiBranchId || undefined);
      if (res.error) throw new Error(res.error);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, apiBranchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parties = useMemo(() => groupPartyRows(rows, mode), [rows, mode]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return parties;
    return parties.filter(
      (p) =>
        p.name.toLowerCase().includes(term)
        || p.nif.toLowerCase().includes(term)
        || p.lines.some((l) => l.documentNumber.toLowerCase().includes(term)),
    );
  }, [parties, search]);

  const totals = useMemo(() => {
    const total = filtered.reduce((s, p) => s + p.total, 0);
    const overdue = filtered.reduce((s, p) => s + p.overdue, 0);
    return { total, overdue, parties: filtered.length, documents: filtered.reduce((s, p) => s + p.documentCount, 0) };
  }, [filtered]);

  const formatMoney = (n: number) =>
    `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

  const formatDate = (raw: string | null) => {
    if (!raw) return '—';
    const d = parseDate(raw);
    if (!d) return raw;
    return format(d, 'dd/MM/yyyy', { locale: dfLocale });
  };

  const openCollectOrPay = (party: PartyRow) => {
    if (mode === 'receivables') {
      navigate('/payments', {
        state: {
          openReceipt: true,
          entityId: party.entityId,
          entityName: party.name,
          returnTo: '/receivables',
        },
      });
    } else {
      navigate('/payments', {
        state: {
          openPayment: true,
          entityId: party.entityId,
          entityName: party.name,
          returnTo: '/payables',
        },
      });
    }
  };

  const TitleIcon = mode === 'receivables' ? Users : Truck;
  const MoneyIcon = mode === 'receivables' ? ArrowDownCircle : ArrowUpCircle;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 rounded-md p-2',
            mode === 'receivables' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-orange-500/10 text-orange-600',
          )}>
            <TitleIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {mode === 'receivables' ? ui.receivablesTitle : ui.payablesTitle}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'receivables' ? ui.receivablesSubtitle : ui.payablesSubtitle}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {ui.refresh}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 pb-2 md:grid-cols-4">
        <Card>
          <CardContent className="px-4 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <MoneyIcon className={cn('h-5 w-5', mode === 'receivables' ? 'text-emerald-500' : 'text-orange-500')} />
              <div>
                <p className="text-xs text-muted-foreground">{ui.totalOpen}</p>
                <p className="text-lg font-bold">{formatMoney(totals.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 pb-3 pt-4">
            <p className="text-xs text-muted-foreground">{ui.overdue}</p>
            <p className={cn('text-lg font-bold', totals.overdue > 0.01 ? 'text-destructive' : '')}>
              {formatMoney(totals.overdue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 pb-3 pt-4">
            <p className="text-xs text-muted-foreground">{ui.parties}</p>
            <p className="text-lg font-bold">{totals.parties}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-4 pb-3 pt-4">
            <p className="text-xs text-muted-foreground">{ui.documents}</p>
            <p className="text-lg font-bold">{totals.documents}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ui.searchPlaceholder}
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {ui.loading}
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-destructive">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>{ui.refresh}</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
            <TitleIcon className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm">{ui.empty}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">{ui.colParty}</th>
                  <th className="px-3 py-2 font-medium">{ui.colNif}</th>
                  <th className="px-3 py-2 text-right font-medium">{ui.colDocs}</th>
                  <th className="px-3 py-2 text-right font-medium">{ui.colCurrent}</th>
                  <th className="px-3 py-2 text-right font-medium">{ui.colOverdue}</th>
                  <th className="px-3 py-2 text-right font-medium">{ui.colTotal}</th>
                  <th className="px-3 py-2 font-medium">{ui.colOldestDue}</th>
                  <th className="px-3 py-2 text-right font-medium">{ui.colAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((party) => {
                  const open = expandedId === party.entityId;
                  return (
                    <PartyTableRows
                      key={party.entityId}
                      party={party}
                      open={open}
                      mode={mode}
                      ui={ui}
                      formatMoney={formatMoney}
                      formatDate={formatDate}
                      onToggle={() => setExpandedId(open ? null : party.entityId)}
                      onAction={() => openCollectOrPay(party)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PartyTableRows({
  party,
  open,
  mode,
  ui,
  formatMoney,
  formatDate,
  onToggle,
  onAction,
}: {
  party: PartyRow;
  open: boolean;
  mode: PartyBalanceMode;
  ui: any;
  formatMoney: (n: number) => string;
  formatDate: (raw: string | null) => string;
  onToggle: () => void;
  onAction: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-accent/40">
        <td className="px-2 py-2">
          <button type="button" className="rounded p-1 hover:bg-accent" onClick={onToggle} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-2 font-medium">{party.name}</td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{party.nif || '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{party.documentCount}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(party.current)}</td>
        <td className={cn('px-3 py-2 text-right font-mono tabular-nums', party.overdue > 0.01 && 'text-destructive')}>
          {formatMoney(party.overdue)}
        </td>
        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{formatMoney(party.total)}</td>
        <td className="px-3 py-2">{formatDate(party.oldestDue)}</td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="outline" onClick={onAction}>
            {mode === 'receivables' ? ui.collect : ui.pay}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={9} className="px-6 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{ui.colDocument}</th>
                  <th className="py-1 pr-3 font-medium">{ui.colDocDate}</th>
                  <th className="py-1 pr-3 font-medium">{ui.colDueDate}</th>
                  <th className="py-1 pr-3 text-right font-medium">{ui.colAmount}</th>
                  <th className="py-1 font-medium">{ui.colStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {party.lines.map((line) => {
                  const overdue = line.daysUntilDue < 0;
                  return (
                    <tr key={line.id}>
                      <td className="py-1.5 pr-3 font-mono">{line.documentNumber}</td>
                      <td className="py-1.5 pr-3">{formatDate(line.documentDate)}</td>
                      <td className="py-1.5 pr-3">{formatDate(line.dueDate)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatMoney(line.amount)}</td>
                      <td className="py-1.5">
                        {overdue ? (
                          <Badge variant="destructive" className="text-[10px]">{ui.statusOverdue}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">{ui.statusOpen}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
