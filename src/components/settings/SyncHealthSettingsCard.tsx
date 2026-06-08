import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Loader2, RefreshCw, RotateCcw, CheckCircle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { toast } from 'sonner';

type SyncOverview = {
  pending?: number;
  failed?: number;
  dead?: number;
  sent?: number;
  byBranch?: Array<{ branchId: string; pending: number; failed: number; dead: number }>;
  byDestination?: { main: number; agt: number; other: number };
  clientIngestSecured?: boolean;
  supportedClientTypes?: string[];
  recentClientIngest?: Array<{
    idempotency_key: string;
    event_type: string;
    branch_id?: string;
    created_at: string;
  }>;
};

type DeadLetterEvent = {
  id: string;
  event_type: string;
  branch_id?: string;
  destination?: string;
  attempts?: number;
  last_error?: string;
  created_at: string;
};

type ConsolidationReport = {
  period?: { startDate: string; endDate: string };
  totals?: { sales: number; payments: number; purchases: number; journals?: number; journalDebit?: number };
  salesByBranch?: Array<{ branch_id: string; sale_count: number; sales_total: number }>;
  purchasesByBranch?: Array<{ branch_id: string; purchase_count: number; purchases_total: number }>;
  recentHqIngest?: Array<{ event_type: string; created_at: string }>;
};

type InstallationConfig = {
  role?: string;
  isMainServer?: boolean;
  mainApiUrl?: string;
  hasApiKey?: boolean;
};

export function SyncHealthSettingsCard() {
  const { t } = useTranslation();
  const ui = t.syncHealthUi;
  const [data, setData] = useState<SyncOverview | null>(null);
  const [consolidation, setConsolidation] = useState<ConsolidationReport | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEvent[]>([]);
  const [installation, setInstallation] = useState<InstallationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isDemoMode()) {
      setLoading(false);
      setError(ui.demoUnavailable);
      return;
    }
    setLoading(true);
    setError(null);
    const [overviewRes, consolidationRes, deadRes, instRes] = await Promise.all([
      api.sync.overview(),
      api.sync.consolidation(),
      api.sync.deadLetter(30),
      api.installations.config(),
    ]);
    if (overviewRes.error) {
      setError(overviewRes.error);
      setData(null);
    } else {
      setData(overviewRes.data ?? null);
    }
    setConsolidation(consolidationRes.error ? null : consolidationRes.data ?? null);
    setDeadLetters(deadRes.error ? [] : deadRes.data?.events ?? []);
    setInstallation(instRes.error ? null : instRes.data ?? null);
    setLoading(false);
  }, [ui.demoUnavailable]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReplay = async (id: string) => {
    setActionId(id);
    const res = await api.sync.replayDeadLetter(id);
    setActionId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(ui.replayOk);
    void load();
  };

  const handleResolve = async (id: string) => {
    setActionId(id);
    const res = await api.sync.resolveDeadLetter(id);
    setActionId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(ui.resolveOk);
    void load();
  };

  const hasIssues = (data?.pending ?? 0) + (data?.failed ?? 0) + (data?.dead ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {ui.refresh}
          </Button>
          {installation?.role && (
            <Badge variant="outline">
              {installation.isMainServer ? ui.roleHq : ui.roleCity}: {installation.role}
            </Badge>
          )}
          {data && (
            <Badge variant={hasIssues ? 'destructive' : 'secondary'}>
              {hasIssues ? ui.statusAttention : ui.statusOk}
            </Badge>
          )}
          {data?.clientIngestSecured === false && (
            <Badge variant="outline">{ui.ingestOpen}</Badge>
          )}
        </div>

        {installation?.mainApiUrl && (
          <p className="text-xs text-muted-foreground">
            {ui.mainApiUrl}: <span className="font-mono">{installation.mainApiUrl}</span>
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">{ui.pending}</p>
                <p className="font-semibold">{data.pending ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ui.failed}</p>
                <p className="font-semibold">{data.failed ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ui.dead}</p>
                <p className="font-semibold">{data.dead ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ui.sent}</p>
                <p className="font-semibold">{data.sent ?? 0}</p>
              </div>
            </div>

            {data.supportedClientTypes && data.supportedClientTypes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {ui.clientTypes}: {data.supportedClientTypes.join(', ')}
              </p>
            )}

            {(data.recentClientIngest?.length ?? 0) > 0 && (
              <ul className="text-xs space-y-1 text-muted-foreground max-h-28 overflow-y-auto">
                {data.recentClientIngest!.map((row) => (
                  <li key={row.idempotency_key} className="flex justify-between gap-2">
                    <span>{row.event_type}</span>
                    <span>{new Date(row.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {consolidation?.totals && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">{ui.consolidationTitle}</p>
            {consolidation.period && (
              <p className="text-xs text-muted-foreground">
                {consolidation.period.startDate} — {consolidation.period.endDate}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">{ui.consolidationSales}</p>
                <p className="font-semibold">{Number(consolidation.totals.sales).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ui.consolidationPayments}</p>
                <p className="font-semibold">{Number(consolidation.totals.payments).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{ui.consolidationPurchases}</p>
                <p className="font-semibold">{Number(consolidation.totals.purchases).toLocaleString()}</p>
              </div>
            </div>
            {(consolidation.totals.journals ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {ui.consolidationJournals}: {consolidation.totals.journals} ({Number(consolidation.totals.journalDebit || 0).toLocaleString()} {ui.consolidationDebitLabel})
              </p>
            )}
            {(consolidation.salesByBranch?.length ?? 0) > 0 && (
              <ul className="text-xs text-muted-foreground max-h-24 overflow-y-auto space-y-1">
                {consolidation.salesByBranch!.map((row) => (
                  <li key={row.branch_id} className="flex justify-between gap-2">
                    <span>{ui.branchLabel} {row.branch_id}</span>
                    <span>{Number(row.sales_total).toLocaleString()} ({row.sale_count})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {deadLetters.length > 0 && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">{ui.deadLetterTitle}</p>
            <ul className="text-xs space-y-2 max-h-40 overflow-y-auto">
              {deadLetters.map((ev) => (
                <li key={ev.id} className="border-b border-border/50 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{ev.event_type}</span>
                    <span className="text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>
                  </div>
                  {ev.last_error && (
                    <p className="text-muted-foreground truncate" title={ev.last_error}>{ev.last_error}</p>
                  )}
                  <div className="flex gap-1 mt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={actionId === ev.id}
                      onClick={() => void handleReplay(ev.id)}
                    >
                      {actionId === ev.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      {ui.replay}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={actionId === ev.id}
                      onClick={() => void handleResolve(ev.id)}
                    >
                      <CheckCircle className="h-3 w-3" />
                      {ui.resolve}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
