import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { toast } from 'sonner';

type ServerUpdateStatus = Awaited<ReturnType<typeof api.deployment.updateStatus>>['data'];

const BUSY_PHASES = new Set(['checking', 'downloading', 'verifying', 'applying', 'restarting']);

function fallbackPercent(phase?: string | null) {
  switch (phase) {
    case 'checking': return 5;
    case 'downloading': return 20;
    case 'verifying': return 45;
    case 'applying': return 62;
    case 'restarting': return 88;
    case 'success':
    case 'upToDate': return 100;
    default: return 0;
  }
}

function formatElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

function formatWhen(value?: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function ServerUpdateCard() {
  const { t } = useTranslation();
  const ui = t.settingsPage.serverUpdate;
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canManage = isAdmin || hasPermission('admin_settings');

  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [offlineDuringApply, setOfflineDuringApply] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (refreshLatest = true) => {
    if (isDemoMode()) {
      setLoading(false);
      setError(ui.demoUnavailable);
      return null;
    }
    if (!canManage) {
      setLoading(false);
      return null;
    }
    const res = await api.deployment.updateStatus(refreshLatest);
    if (res.error) {
      if (restarting || applying) {
        setOfflineDuringApply(true);
        setRestarting(true);
        return null;
      }
      setError(res.error);
      setStatus(null);
      setLoading(false);
      return null;
    }
    setError(null);
    setOfflineDuringApply(false);
    setStatus(res.data ?? null);
    setLoading(false);
    const phase = res.data?.job?.phase;
    if (phase === 'success' || phase === 'failed' || phase === 'upToDate') {
      setApplying(false);
      setRestarting(false);
      setOfflineDuringApply(false);
    } else if (phase && BUSY_PHASES.has(phase)) {
      setApplying(true);
      setRestarting(phase === 'restarting');
    }
    return res.data ?? null;
  }, [canManage, applying, restarting, ui.demoUnavailable]);

  useEffect(() => {
    void load(true);
  }, [canManage]); // eslint-disable-line react-hooks/exhaustive-deps -- first load only

  useEffect(() => {
    if (!applying && !restarting) return undefined;
    const id = window.setInterval(() => {
      void load(false);
    }, 1500);
    return () => window.clearInterval(id);
  }, [applying, restarting, load]);

  useEffect(() => {
    if (!applying && !restarting) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [applying, restarting]);

  const onApply = async () => {
    setConfirmOpen(false);
    setApplying(true);
    setRestarting(false);
    setOfflineDuringApply(false);
    setError(null);
    const res = await api.deployment.applyUpdate();
    if (res.error) {
      setApplying(false);
      setRestarting(false);
      setError(res.error);
      toast.error(res.error);
      return;
    }
    toast.message(ui.startedToast);
    void load(false);
  };

  const jobPhase = status?.job?.phase;
  const jobUpdatedRaw = status?.job?.updatedAt || status?.job?.finishedAt;
  const jobAgeMs = (() => {
    if (!jobUpdatedRaw) return Number.POSITIVE_INFINITY;
    const ms = Date.now() - new Date(jobUpdatedRaw).getTime();
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  })();
  const jobLooksStuck = !!(jobPhase && BUSY_PHASES.has(jobPhase) && jobAgeMs > 20 * 60 * 1000);

  useEffect(() => {
    if (jobLooksStuck && (applying || restarting)) {
      setApplying(false);
      setRestarting(false);
      setOfflineDuringApply(false);
    }
  }, [jobLooksStuck, applying, restarting]);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            {ui.title}
          </CardTitle>
          <CardDescription>{ui.needAdmin}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const job = status?.job;
  const phaseBusy = !!(job?.phase && BUSY_PHASES.has(job.phase));
  const busy = !jobLooksStuck && (applying || restarting || phaseBusy) && job?.phase !== 'failed' && job?.phase !== 'success';
  const rawPercent = Number(job?.percent);
  const displayPercent = Number.isFinite(rawPercent) && rawPercent > 0
    ? Math.max(0, Math.min(100, Math.round(rawPercent)))
    : fallbackPercent(job?.phase);
  const startedMs = job?.startedAt ? new Date(job.startedAt).getTime() : NaN;
  const elapsedLabel = Number.isFinite(startedMs) ? formatElapsed(nowMs - startedMs) : '';
  const progressMessage = offlineDuringApply
    ? (job?.message ? `${job.message} — ${ui.waitingReconnect}` : ui.waitingReconnect)
    : (job?.message || (restarting ? ui.restarting : ui.applying));
  const latestLabel = status?.latest?.buildIdShort || status?.latest?.buildId?.slice(0, 7);
  const currentLabel = status?.current?.buildIdShort || '—';
  const latestWhen = formatWhen(status?.latest?.builtAt || null);
  const currentWhen = formatWhen(status?.current?.builtAt || null);
  const canPress = !!status?.canApply && !!status?.updateAvailable && !busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{ui.thisServer}</span>
          <Badge variant="outline">{ui.versionLocked}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <div className="text-muted-foreground">{ui.currentBuild}</div>
            <div className="font-mono font-medium">{currentLabel}</div>
            {currentWhen ? <div className="text-xs text-muted-foreground">{currentWhen}</div> : null}
          </div>
          <div>
            <div className="text-muted-foreground">{ui.latestBuild}</div>
            <div className="font-mono font-medium">{latestLabel || '—'}</div>
            {latestWhen ? <div className="text-xs text-muted-foreground">{latestWhen}</div> : null}
          </div>
        </div>

        {status && !status.updateAvailable && status.canApply && !busy && job?.phase !== 'failed' ? (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            {ui.upToDate}
          </div>
        ) : null}

        {status && !status.canApply && status.reason ? (
          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{status.reason}</div>
        ) : null}

        {status?.latestError && !status.latest ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{status.latestError}</div>
        ) : null}

        {(error || job?.phase === 'failed') && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div>{error || job?.error || job?.message || ui.failed}</div>
              {job?.rollback ? <div className="mt-1 text-xs">{ui.rolledBack}</div> : null}
            </div>
          </div>
        )}

        {job?.phase === 'success' ? (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            {job.message || ui.success}
          </div>
        ) : null}

        {busy ? (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span className="min-w-0">{progressMessage}</span>
              </div>
              <span className="shrink-0 font-mono text-base font-semibold tabular-nums">
                {displayPercent}%
              </span>
            </div>
            <Progress value={displayPercent} className="h-2.5" />
            {elapsedLabel ? (
              <div className="text-xs text-muted-foreground">
                {ui.elapsed.replace('{time}', elapsedLabel)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{ui.safetyHint}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="gap-2"
            disabled={loading || busy}
            onClick={() => void load(true)}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {ui.check}
          </Button>
          <Button className="gap-2" disabled={!canPress} onClick={() => setConfirmOpen(true)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {ui.apply}
          </Button>
          {job?.phase === 'success' ? (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {ui.reload}
            </Button>
          ) : null}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ui.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onApply()}>{ui.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
