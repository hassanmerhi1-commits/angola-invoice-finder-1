import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { api, ensureBackendAuthToken } from '@/lib/api/client';

type PhaseStatus = 'ok' | 'warn' | 'blocker';

type CertificationPhase = {
  id: string;
  phase: number;
  title: string;
  status: PhaseStatus;
  message: string;
};

type CertificationStatus = {
  ok: boolean;
  readyForInternalReview: boolean;
  readyForProductRelease: boolean;
  readyForAgtSubmission: boolean;
  agtDeferred?: boolean;
  appVersion: string;
  schemaVersion: number | null;
  schemaVersionExpected: number;
  blockers: number;
  warnings: number;
  documentationPath: string;
  phases: CertificationPhase[];
  checks: { id: string; ok: boolean; level: string; message: string }[];
  checkedAt: string;
};

function formatWhen(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function CertificationReadinessCard() {
  const { t } = useTranslation();
  const ui = t.certificationSettingsUi;
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canView = isAdmin || hasPermission('admin_settings');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CertificationStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!canView) return;
    const isInitial = !status;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      await ensureBackendAuthToken();
      const res = await api.certification.status();
      if (res.error) {
        setError(ui.refreshFailed.replace('{error}', res.error));
        return;
      }
      if (res.data) setStatus(res.data as CertificationStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(ui.refreshFailed.replace('{error}', message));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canView, status, ui.refreshFailed]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [canView]);

  if (!canView) return null;

  const phaseBadge = (phaseStatus: PhaseStatus) => {
    if (phaseStatus === 'ok') {
      return (
        <Badge variant="outline" className="text-green-700 border-green-300 shrink-0">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {ui.levelOk}
        </Badge>
      );
    }
    if (phaseStatus === 'blocker') {
      return (
        <Badge variant="destructive" className="shrink-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {ui.levelBlocker}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-amber-800 bg-amber-100 shrink-0">
        <AlertTriangle className="h-3 w-3 mr-1" />
        {ui.levelWarn}
      </Badge>
    );
  };

  const busy = loading || refreshing;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            {ui.title}
          </CardTitle>
          <CardDescription>{ui.description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {refreshing ? t.common.updating : ui.refresh}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {loading && !status ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : status ? (
          <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <div className="flex flex-wrap gap-2 items-center">
              {status.readyForProductRelease ? (
                <Badge variant="outline" className="text-green-700 border-green-300">
                  {ui.readyForProduct}
                </Badge>
              ) : status.readyForInternalReview ? (
                <Badge variant="outline" className="text-green-700 border-green-300">
                  {ui.readyForInternal}
                </Badge>
              ) : (
                <Badge variant="destructive">{ui.needsWork}</Badge>
              )}
              {status.agtDeferred && !status.readyForAgtSubmission && (
                <Badge variant="secondary" className="text-muted-foreground">
                  {ui.agtLiveDeferred}
                </Badge>
              )}
              {status.readyForAgtSubmission && (
                <Badge variant="outline" className="text-green-700 border-green-300">
                  {ui.readyForAgt}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {ui.schemaVersion}: {status.schemaVersion ?? '—'} / {status.schemaVersionExpected}
                {' · '}
                {ui.checkedAt}: {formatWhen(status.checkedAt)}
                {refreshing ? ` · ${t.common.updating}` : ''}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mt-6">{ui.docsHint}</p>

            <div className="space-y-2 mt-6">
              <h4 className="text-sm font-medium">{ui.phasesTitle}</h4>
              <ul className="space-y-2">
                {status.phases.map((phase) => (
                  <li
                    key={phase.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{ui.phaseLabel} {phase.phase}:</span>{' '}
                      {phase.title} — {phase.message}
                    </span>
                    {phaseBadge(phase.status)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 mt-6">
              <h4 className="text-sm font-medium">{ui.checksTitle}</h4>
              <ul className="space-y-2">
                {status.checks
                  .filter((c) => c.level !== 'info')
                  .map((check) => (
                    <li
                      key={check.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <span>{check.message}</span>
                      {check.ok ? (
                        <Badge variant="outline" className="text-green-700 border-green-300">
                          {ui.levelOk}
                        </Badge>
                      ) : check.level === 'blocker' ? (
                        <Badge variant="destructive">{ui.levelBlocker}</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-amber-800 bg-amber-100">
                          {ui.levelWarn}
                        </Badge>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{ui.unavailable}</p>
        )}
      </CardContent>
    </Card>
  );
}
