import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type DeploymentStatus = Awaited<ReturnType<typeof api.deployment.status>>['data'];

export function DeploymentHealthCard() {
  const { t, language } = useTranslation();
  const d = t.deploymentUi;
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isDemoMode()) {
      setLoading(false);
      setError(d.demoUnavailable);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await api.deployment.status();
    if (res.error) {
      setError(res.error);
      setStatus(null);
    } else {
      setStatus(res.data ?? null);
    }
    setLoading(false);
  }, [d.demoUnavailable]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasWarnings = (status?.warnings?.length ?? 0) > 0;
  const allClear = status?.ok && !hasWarnings;

  return (
    <Card className={hasWarnings ? 'border-amber-500/50' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          {d.title}
        </CardTitle>
        <CardDescription>{d.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {d.refresh}
          </Button>
          {status && (
            <Badge variant={allClear ? 'default' : 'destructive'} className="gap-1">
              {allClear ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {allClear ? d.statusOk : d.statusAttention}
            </Badge>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {status && !error && (
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{d.appVersion}</p>
                <p className="font-medium">{status.appVersion}</p>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{d.schemaVersion}</p>
                <p className="font-medium">
                  {status.schemaVersion ?? '—'} / {status.schemaVersionExpected}
                  {!status.schemaUpToDate && (
                    <span className="text-destructive text-xs ml-1">({d.outdated})</span>
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Database className="h-3.5 w-3.5" />
                {d.activeDatabase}
              </p>
              <p className="font-mono text-xs break-all">{status.database?.path || '—'}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(status.database?.sizeBytes ?? 0)}
                {status.database?.modifiedAt
                  ? ` · ${new Date(status.database.modifiedAt).toLocaleString(locale)}`
                  : ''}
              </p>
              {status.database?.counts && (
                <p className="text-xs">
                  {d.counts
                    .replace('{products}', String(status.database.counts.products ?? 0))
                    .replace('{sales}', String(status.database.counts.sales ?? 0))}
                </p>
              )}
            </div>

            {status.ipFile?.configuredPath && (
              <div className="text-xs text-muted-foreground">
                {d.ipFile}: <span className="font-mono">{status.ipFile.configuredPath}</span>
              </div>
            )}

            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <HardDrive className="h-3.5 w-3.5" />
                {d.backups}
              </p>
              {status.backups?.latest ? (
                <p className="text-xs">
                  {d.latestBackup
                    .replace('{name}', status.backups.latest.filename)
                    .replace('{date}', new Date(status.backups.latest.createdAt).toLocaleString(locale))}
                </p>
              ) : (
                <p className="text-xs text-amber-700">{d.noBackup}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {d.backupCount.replace('{count}', String(status.backups?.count ?? 0))}
              </p>
            </div>

            {status.duplicateDatabases?.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 space-y-1">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{d.otherDbFiles}</p>
                <ul className="text-xs font-mono space-y-0.5 text-muted-foreground">
                  {status.duplicateDatabases.slice(0, 5).map((dup) => (
                    <li key={dup.path}>
                      {dup.path} ({dup.sizeMb ?? formatBytes(dup.sizeBytes)})
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">{d.otherDbHint}</p>
              </div>
            )}

            {hasWarnings && (
              <ul className="space-y-1.5">
                {status.warnings.map((w) => (
                  <li
                    key={w.code}
                    className="flex gap-2 text-xs text-amber-800 dark:text-amber-200 rounded-md border border-amber-500/30 px-2 py-1.5"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-muted-foreground">
              {d.checkedAt.replace('{time}', new Date(status.checkedAt).toLocaleString(locale))}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
