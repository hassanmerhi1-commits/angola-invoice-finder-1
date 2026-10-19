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
        setRestarting(true);
        return null;
      }
      setError(res.error);
      setStatus(null);
      setLoading(false);
      return null;
    }
    setError(null);
    setStatus(res.data ?? null);
    setLoading(false);
    const phase = res.data?.job?.phase;
    if (phase === 'success') {
      setApplying(false);
      setRestarting(false);
    } else if (phase === 'failed') {
      setApplying(false);
      setRestarting(false);
    } else if (phase && BUSY_PHASES.has(phase)) {
      setApplying(true);
      if (phase === 'restarting') setRestarting(true);
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
    }, 2500);
    return () => window.clearInterval(id);
  }, [applying, restarting, load]);

  const onApply = async () => {
    setConfirmOpen(false);
    setApplying(true);
    setError(null);
    const res = await api.deployment.applyUpdate();
    if (res.error) {
      setApplying(false);
      setRestarting(false);
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setRestarting(true);
    toast.message(ui.restartingToast);
    void load(false);
  };

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
  const jobAgeMs = (() => {
    const raw = job?.updatedAt || job?.finishedAt;
    if (!raw) return Number.POSITIVE_INFINITY;
    const ms = Date.now() - new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
  })();
  const jobLooksStuck = !!(job?.phase && BUSY_PHASES.has(job.phase) && jobAgeMs > 20 * 60 * 1000);
  const busy = !jobLooksStuck && (applying || restarting || (job?.phase ? BUSY_PHASES.has(job.phase) : false));

  useEffect(() => {
    if (jobLooksStuck && (applying || restarting)) {
      setApplying(false);
      setRestarting(false);
    }
  }, [jobLooksStuck, applying, restarting]);
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {restarting ? ui.restarting : job?.message || ui.applying}
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
