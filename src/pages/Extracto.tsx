import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search, RefreshCw, FileText, Download, Printer, FileDown, Loader2, User, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { toast } from 'sonner';
import { DatePickerButton, localISODate } from '@/components/ui/DatePickerButton';
import { NEXOR_TOOLBAR_BTN_SM } from '@/lib/nexorToolbarStyles';
import {
  buildAccountStatement,
  isGenericPartyName,
  isPlaceholderNif,
  unwrapList,
  type AccountStatementLabels,
  type AccountStatementMovement,
  type AccountStatementParty,
} from '@/lib/accountStatement';
import { buildReportHtml, escapeHtml, exportReportExcel, printReport, saveReportPdf } from '@/lib/reportExport';

function yearStartIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function formatIsoDate(iso: string): string {
  if (!iso || iso.length < 10) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

type PartyRow = { id: string; name: string; nif: string; balance: number };

function mapPartyRow(row: Record<string, unknown>): PartyRow {
  return {
    id: String(row.id || ''),
    name: String(row.name || row.entity_name || ''),
    nif: String(row.nif || ''),
    balance: Number(row.balance ?? row.current_balance ?? row.currentBalance ?? 0),
  };
}

function keepPartyRow(row: PartyRow): boolean {
  if (!row.id) return false;
  if (Math.abs(row.balance) > 0.005) return true;
  return !(isGenericPartyName(row.name) && isPlaceholderNif(row.nif));
}

async function loadPartiesFallback(partyKind: AccountStatementParty): Promise<PartyRow[]> {
  const res = partyKind === 'supplier' ? await api.suppliers.list() : await api.clients.list();
  return unwrapList(res.data).map(mapPartyRow).filter((row) => (
    keepPartyRow(row) && Math.abs(row.balance) > 0.005
  ));
}

function typeBadge(type: AccountStatementMovement['type']): string {
  switch (type) {
    case 'invoice': return 'FT';
    case 'purchase': return 'FC';
    case 'receipt': return 'REC';
    case 'payment': return 'PAG';
    case 'credit_note': return 'NC';
    case 'debit_note': return 'ND';
    case 'advance': return 'AD';
    default: return '';
  }
}

export default function Extracto() {
  const { t, language } = useTranslation();
  const ui = t.extractoUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const dateLocale = language === 'pt' ? 'pt' : 'en';
  const { companyName } = useCompanyLogo();

  const [partyKind, setPartyKind] = useState<AccountStatementParty>('customer');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allParties, setAllParties] = useState<Array<{ id: string; name: string; nif: string; balance: number }>>([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(yearStartIso);
  const [dateTo, setDateTo] = useState(localISODate);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<AccountStatementMovement[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [periodDebit, setPeriodDebit] = useState(0);
  const [periodCredit, setPeriodCredit] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);
  const [rawPayload, setRawPayload] = useState<unknown>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const fetchGen = useRef(0);
  const partyCache = useRef<Partial<Record<AccountStatementParty, PartyRow[]>>>({});
  const statementCache = useRef<Record<string, unknown>>({});

  const labels: AccountStatementLabels = useMemo(() => ({
    invoice: ui.invoice,
    purchase: ui.purchase,
    receipt: ui.receipt,
    payment: ui.payment,
    creditNote: ui.creditNote,
    debitNote: ui.debitNote,
    advance: ui.advance,
    openingBalance: ui.openingBalance,
    paymentWithMethod: ui.paymentWithMethod,
    methodCash: t.chartsUi.methodCash,
    methodCard: t.chartsUi.methodCard,
    methodTransfer: t.chartsUi.methodTransfer,
    methodCheque: ui.methodCheque,
  }), [ui, t.chartsUi.methodCash, t.chartsUi.methodCard, t.chartsUi.methodTransfer]);

  const parties = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? allParties.filter((p) => p.name.toLowerCase().includes(q) || (p.nif || '').toLowerCase().includes(q))
      : allParties;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
  }, [allParties, searchTerm, locale]);

  const selected = useMemo(
    () => allParties.find((row) => row.id === selectedId) ?? parties.find((row) => row.id === selectedId) ?? null,
    [allParties, parties, selectedId],
  );

  useEffect(() => {
    setSelectedId(null);
    setRawPayload(null);
  }, [partyKind]);

  useEffect(() => {
    let cancelled = false;
    const cached = partyCache.current[partyKind];
    if (cached) {
      setAllParties(cached);
      setPartiesLoading(false);
      return undefined;
    }
    setPartiesLoading(true);
    setAllParties([]);
    void (async () => {
      try {
        const res = await api.payments.statementParties(partyKind);
        if (cancelled) return;
        let list = unwrapList(res.data).map(mapPartyRow).filter(keepPartyRow);
        if (res.error || list.length === 0) {
          const fallback = await loadPartiesFallback(partyKind);
          if (fallback.length > 0) list = fallback;
        }
        if (cancelled) return;
        partyCache.current[partyKind] = list;
        setAllParties(list);
      } catch {
        if (!cancelled) {
          try {
            const fallback = await loadPartiesFallback(partyKind);
            partyCache.current[partyKind] = fallback;
            setAllParties(fallback);
          } catch {
            setAllParties([]);
          }
        }
      } finally {
        if (!cancelled) setPartiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyKind, refreshNonce]);

  const money = useCallback((n: number) => (
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 2 }).format(n)
  ), [locale]);

  const applyPayload = useCallback((payload: unknown) => {
    const built = buildAccountStatement({
      party: partyKind,
      dateFrom,
      dateTo,
      payload,
      labels,
    });
    setLines(built.lines);
    setOpeningBalance(built.openingBalance);
    setPeriodDebit(built.periodDebit);
    setPeriodCredit(built.periodCredit);
    setClosingBalance(built.closingBalance);
  }, [partyKind, dateFrom, dateTo, labels]);

  useEffect(() => {
    if (!selectedId) {
      setRawPayload(null);
      setLines([]);
      setOpeningBalance(0);
      setPeriodDebit(0);
      setPeriodCredit(0);
      setClosingBalance(0);
      return;
    }
    const cacheKey = `${partyKind}:${selectedId}`;
    const cached = statementCache.current[cacheKey];
    if (cached) {
      setRawPayload(cached);
      return;
    }
    const generation = ++fetchGen.current;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.payments.statement(partyKind, selectedId);
        if (generation !== fetchGen.current) return;
        if (res.error) throw new Error(res.error);
        statementCache.current[cacheKey] = res.data;
        setRawPayload(res.data);
      } catch (err) {
        console.error('[Extracto] load failed:', err);
        if (generation === fetchGen.current) {
          setRawPayload(null);
          setLines([]);
          toast.error(ui.loadFailed);
        }
      } finally {
        if (generation === fetchGen.current) setLoading(false);
      }
    })();
  }, [selectedId, partyKind, refreshNonce, ui.loadFailed]);

  useEffect(() => {
    if (!selectedId || !rawPayload) return;
    applyPayload(rawPayload);
  }, [selectedId, rawPayload, applyPayload]);

  const movementCount = Math.max(0, lines.length - (lines[0]?.type === 'opening' ? 1 : 0));

  const buildPrintHtml = () => {
    if (!selected) return '';
    const rows = lines.map((entry) => `<tr class="${entry.type === 'opening' ? 'sub' : ''}">
      <td>${escapeHtml(formatIsoDate(entry.date))}</td>
      <td>${escapeHtml(typeBadge(entry.type) || '—')}</td>
      <td>${escapeHtml(entry.reference)}</td>
      <td>${escapeHtml(entry.description)}</td>
      <td class="r">${entry.debit > 0 ? escapeHtml(money(entry.debit)) : ''}</td>
      <td class="r">${entry.credit > 0 ? escapeHtml(money(entry.credit)) : ''}</td>
      <td class="r b">${escapeHtml(money(entry.balance))}</td>
    </tr>`).join('');
    return buildReportHtml({
      title: ui.title,
      companyName,
      subtitle: `${selected.name} · ${t.reportsUi.nif} ${selected.nif || '—'}`,
      periodLabel: t.incomeStatementUi.periodLabel
        .replace('{from}', formatIsoDate(dateFrom))
        .replace('{to}', formatIsoDate(dateTo)),
      bodyHtml: `<table>
        <thead><tr>
          <th>${escapeHtml(t.common.date)}</th>
          <th>${escapeHtml(t.reportsUi.type)}</th>
          <th>${escapeHtml(t.reportsUi.reference)}</th>
          <th>${escapeHtml(t.common.description)}</th>
          <th class="r">${escapeHtml(t.reportsUi.debit)}</th>
          <th class="r">${escapeHtml(t.reportsUi.credit)}</th>
          <th class="r">${escapeHtml(t.reportsUi.balance)}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="tot">
          <td colspan="4">${escapeHtml(t.common.total)}</td>
          <td class="r">${escapeHtml(money(periodDebit))}</td>
          <td class="r">${escapeHtml(money(periodCredit))}</td>
          <td class="r">${escapeHtml(money(closingBalance))}</td>
        </tr></tfoot>
      </table>
      <p class="muted">${escapeHtml(ui.openingBalance)}: ${escapeHtml(money(openingBalance))}
        · ${escapeHtml(ui.closingBalance)}: ${escapeHtml(money(closingBalance))}</p>`,
    });
  };

  const handlePrint = async () => {
    const html = buildPrintHtml();
    if (!html) return;
    try {
      await printReport(html);
    } catch (e) {
      console.error('[Extracto] print failed:', e);
    }
  };

  const handlePdf = async () => {
    const html = buildPrintHtml();
    if (!html || !selected) return;
    try {
      await saveReportPdf(html, `Extracto_${selected.name}_${dateTo}`);
    } catch (e) {
      console.error('[Extracto] pdf failed:', e);
    }
  };

  const handleExcel = async () => {
    if (!selected || lines.length === 0) return;
    try {
      await exportReportExcel(
        lines.map((entry) => ({
          [t.common.date]: formatIsoDate(entry.date),
          [t.reportsUi.type]: typeBadge(entry.type) || entry.description,
          [t.reportsUi.reference]: entry.reference,
          [t.common.description]: entry.description,
          [t.reportsUi.debit]: entry.debit,
          [t.reportsUi.credit]: entry.credit,
          [t.reportsUi.balance]: entry.balance,
        })),
        `Extracto_${selected.name.replace(/\s+/g, '_')}_${dateTo}`,
        { title: ui.title, subtitle: `${selected.name} — ${formatIsoDate(dateFrom)} — ${formatIsoDate(dateTo)}` },
      );
      toast.success(ui.excelExported);
    } catch (e) {
      console.error('[Extracto] excel failed:', e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 px-2 py-1">
        <span className="px-2 text-xs font-semibold">{ui.title}</span>
        <div className="mx-1 h-5 w-px bg-border" />
        <DatePickerButton
          value={dateFrom}
          onChange={setDateFrom}
          locale={dateLocale}
          buttonClassName="h-7 text-xs"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <DatePickerButton
          value={dateTo}
          onChange={setDateTo}
          locale={dateLocale}
          minDate={dateFrom}
          buttonClassName="h-7 text-xs"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          disabled={!selectedId || loading}
          onClick={() => void handlePrint()}
        >
          <Printer className="h-3 w-3" /> {t.reportsUi.print}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          disabled={!selectedId || loading}
          onClick={() => void handlePdf()}
        >
          <FileDown className="h-3 w-3" /> {t.reportsUi.savePdf}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={NEXOR_TOOLBAR_BTN_SM}
          disabled={!selectedId || loading}
          onClick={() => void handleExcel()}
        >
          <Download className="h-3 w-3" /> {t.reportsUi.exportExcel}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            delete partyCache.current[partyKind];
            if (selectedId) delete statementCache.current[`${partyKind}:${selectedId}`];
            setRefreshNonce((n) => n + 1);
          }}
          disabled={loading || partiesLoading}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={ui.searchParty}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-7 w-52 pl-7 text-xs"
          />
        </div>
      </div>

      <Tabs
        value={partyKind}
        onValueChange={(v) => {
          setPartyKind(v as AccountStatementParty);
          setSelectedId(null);
        }}
      >
        <TabsList className="h-auto w-full justify-start rounded-none border-b bg-muted/30 p-0">
          <TabsTrigger
            value="customer"
            className="gap-1 rounded-none border-b-2 border-transparent px-4 py-1.5 text-xs data-[state=active]:border-primary"
          >
            <User className="h-3 w-3" /> {ui.customers}
          </TabsTrigger>
          <TabsTrigger
            value="supplier"
            className="gap-1 rounded-none border-b-2 border-transparent px-4 py-1.5 text-xs data-[state=active]:border-primary"
          >
            <Building2 className="h-3 w-3" /> {ui.suppliers}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-96 overflow-auto border-r">
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b bg-muted/60">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">{partyKind === 'customer' ? t.reportsUi.client : t.reportsUi.supplier}</th>
                <th className="w-24 px-3 py-1.5 text-left font-semibold">{t.reportsUi.nif}</th>
                <th className="w-28 px-3 py-1.5 text-right font-semibold">{t.reportsUi.balance}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {partiesLoading && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />
                    {t.common.loading}
                  </td>
                </tr>
              )}
              {parties.map((party) => (
                <tr
                  key={party.id}
                  className={cn('cursor-pointer hover:bg-accent/50', selectedId === party.id && 'nexor-row-selected')}
                  onClick={() => setSelectedId(party.id)}
                >
                  <td className="px-3 py-1.5 font-medium">{party.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{party.nif || '—'}</td>
                  <td className={cn(
                    'px-3 py-1.5 text-right font-mono font-medium',
                    party.balance > 0.005 ? 'text-destructive' : party.balance < -0.005 ? 'text-green-600' : '',
                  )}>
                    {party.balance.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!partiesLoading && parties.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">
              {searchTerm.trim() ? t.common.noResults : ui.onlyWithMovement}
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-auto">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <div className="text-center">
                <FileText className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>{partyKind === 'customer' ? ui.selectCustomer : ui.selectSupplier}</p>
              </div>
            </div>
          ) : loading && lines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t.common.loading}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              {selected && (
                <div className="flex items-center justify-between gap-4 border-b bg-muted/30 px-4 py-2">
                  <div>
                    <h3 className="text-sm font-bold">{selected.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t.reportsUi.nif}: {selected.nif || '—'}
                      {' · '}
                      {ui.documents.replace('{count}', String(movementCount))}
                    </p>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div className="text-center">
                      <div className="text-muted-foreground">{ui.openingBalance}</div>
                      <div className="font-mono font-bold">{money(openingBalance)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">{t.reportsUi.debit}</div>
                      <div className="font-mono font-bold">{money(periodDebit)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">{t.reportsUi.credit}</div>
                      <div className="font-mono font-bold text-green-600">{money(periodCredit)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">{ui.closingBalance}</div>
                      <div className={cn(
                        'font-mono font-bold',
                        closingBalance > 0.005 ? 'text-destructive' : 'text-green-600',
                      )}>
                        {money(closingBalance)}
                      </div>
                      {closingBalance > 0.005 && (
                        <div className="text-[10px] text-muted-foreground">
                          {partyKind === 'customer' ? ui.theyOwe : ui.weOwe}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="relative min-h-0 flex-1 overflow-auto">
                {loading && (
                  <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 border-b bg-background/80 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t.common.loading}
                  </div>
                )}
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 border-b bg-muted/60">
                    <tr>
                      <th className="w-24 px-3 py-1.5 text-left font-semibold">{t.common.date}</th>
                      <th className="w-14 px-3 py-1.5 text-left font-semibold">{t.reportsUi.type}</th>
                      <th className="w-40 px-3 py-1.5 text-left font-semibold">{t.reportsUi.reference}</th>
                      <th className="px-3 py-1.5 text-left font-semibold">{t.common.description}</th>
                      <th className="w-32 px-3 py-1.5 text-right font-semibold">{t.reportsUi.debit}</th>
                      <th className="w-32 px-3 py-1.5 text-right font-semibold">{t.reportsUi.credit}</th>
                      <th className="w-32 px-3 py-1.5 text-right font-semibold">{t.reportsUi.balance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lines.map((entry) => (
                      <tr
                        key={`${entry.type}-${entry.id}`}
                        className={cn(entry.type === 'opening' && 'bg-muted/40 font-medium')}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">{formatIsoDate(entry.date)}</td>
                        <td className="px-3 py-1.5 font-medium">{typeBadge(entry.type) || '—'}</td>
                        <td className="px-3 py-1.5 font-mono">{entry.reference || '—'}</td>
                        <td className="px-3 py-1.5">{entry.description}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {entry.debit > 0 ? money(entry.debit) : ''}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-green-600">
                          {entry.credit > 0 ? money(entry.credit) : ''}
                        </td>
                        <td className={cn(
                          'px-3 py-1.5 text-right font-mono font-medium',
                          entry.balance > 0.005 ? 'text-destructive' : 'text-green-600',
                        )}>
                          {money(entry.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {movementCount === 0 && !loading && (
                  <div className="py-8 text-center text-sm text-muted-foreground">{ui.noMovements}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
