import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shield, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';
import { api, ensureBackendAuthToken } from '@/lib/api/client';

type SecurityCheck = {
  id: string;
  ok: boolean;
  level: 'ok' | 'warn' | 'critical';
  message: string;
};

type SecurityStatus = {
  ok: boolean;
  attention: boolean;
  appVersion: string;
  schemaVersionExpected: number;
  checks: SecurityCheck[];
  sessions: { activeCount: number; failedLogins24h: number };
  passwords: { legacyHashCount: number; minLength: number };
  backups: {
    count: number;
    latest: { filename: string; createdAt: string } | null;
    ageDays: number | null;
  };
  checkedAt: string;
};

type SessionRow = {
  id: string;
  user_name?: string;
  user_email?: string;
  ip_address?: string;
  workstation_id?: string;
  started_at?: string;
  last_seen_at?: string;
  ended_at?: string | null;
  end_reason?: string | null;
};

function formatWhen(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function SecuritySettingsCard() {
  const { t } = useTranslation();
  const ui = t.securitySettingsUi;
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canView = isAdmin || hasPermission('admin_settings');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const refresh = useCallback(async () => {
    if (!canView) return;
    const isInitial = !status;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      await ensureBackendAuthToken();
      const [statusRes, sessionsRes] = await Promise.all([
        api.security.status(),
        api.security.sessions({ activeOnly: false, limit: 20 }),
      ]);
      const errors: string[] = [];
      if (statusRes.error) errors.push(statusRes.error);
      if (sessionsRes.error) errors.push(sessionsRes.error);
      if (errors.length) {
        setError(ui.refreshFailed.replace('{error}', errors.join('; ')));
      }
      if (statusRes.data) setStatus(statusRes.data as SecurityStatus);
      if (Array.isArray(sessionsRes.data)) setSessions(sessionsRes.data as SessionRow[]);
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

  const levelBadge = (level: SecurityCheck['level'], ok: boolean) => {
    if (ok && level === 'ok') {
      return (
        <Badge variant="outline" className="text-green-700 border-green-300">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          {ui.levelOk}
        </Badge>
      );
    }
    if (level === 'critical') {
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {ui.levelCritical}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-amber-800 bg-amber-100">
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
            <Shield className="h-5 w-5" />
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
        ) : (
          <div className={refreshing ? 'opacity-60 transition-opacity space-y-6' : 'space-y-6 transition-opacity'}>
            {status && (
              <>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant={status.ok ? 'outline' : 'destructive'}>
                    {status.ok ? ui.readinessOk : ui.readinessAttention}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {ui.schemaVersion}: {status.schemaVersionExpected}
                    {' · '}
                    {ui.checkedAt}: {formatWhen(status.checkedAt)}
                    {refreshing ? ` · ${t.common.updating}` : ''}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{ui.activeSessions}</p>
                    <p className="text-2xl font-semibold">{status.sessions.activeCount}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{ui.failedLogins24h}</p>
                    <p className="text-2xl font-semibold">{status.sessions.failedLogins24h}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{ui.backupsCount}</p>
                    <p className="text-2xl font-semibold">{status.backups.count}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{ui.checklistTitle}</h4>
                  <ul className="space-y-2">
                    {status.checks.map((check) => (
                      <li
                        key={check.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        <span>{check.message}</span>
                        {levelBadge(check.level, check.ok)}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                {ui.sessionsTitle}
              </h4>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ui.colUser}</TableHead>
                      <TableHead>{ui.colStarted}</TableHead>
                      <TableHead>{ui.colLastSeen}</TableHead>
                      <TableHead>{ui.colIp}</TableHead>
                      <TableHead>{ui.colStatus}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground text-center">
                          {ui.noSessions}
                        </TableCell>
                      </TableRow>
                    ) : (
                      sessions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.user_name || row.user_email || '—'}</TableCell>
                          <TableCell className="text-xs">{formatWhen(row.started_at)}</TableCell>
                          <TableCell className="text-xs">{formatWhen(row.last_seen_at)}</TableCell>
                          <TableCell className="text-xs font-mono">{row.ip_address || '—'}</TableCell>
                          <TableCell>
                            {row.ended_at ? (
                              <Badge variant="secondary">{row.end_reason || ui.sessionEnded}</Badge>
                            ) : (
                              <Badge variant="outline" className="text-green-700">{ui.sessionActive}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
