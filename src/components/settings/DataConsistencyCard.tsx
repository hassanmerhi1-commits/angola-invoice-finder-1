import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck,
  Play,
  Wrench,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { isDemoMode } from '@/lib/api/config';
import { BackupApiError, probeBackupApi, type BackupConnectionIssue } from '@/lib/api/backup';
import {
  downloadConsistencyReport,
  formatConsistencyIssue,
  runConsistencyCheck,
  runConsistencyRepair,
  type ConsistencyCheckEntry,
  type ConsistencyReport,
  type ConsistencyRepairResult,
} from '@/lib/api/consistency';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';

function lastErrorFrom(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function statusBadge(
  status: ConsistencyCheckEntry['status'],
  ui: { statusOk: string; statusFail: string; statusWarn: string; statusSkip: string; statusError: string },
) {
  switch (status) {
    case 'ok':
      return (
        <Badge variant="secondary" className="gap-1 shrink-0">
          <CheckCircle2 className="w-3 h-3" />
          {ui.statusOk}
        </Badge>
      );
    case 'warn':
      return (
        <Badge variant="outline" className="gap-1 shrink-0 border-amber-500/50 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-3 h-3" />
          {ui.statusWarn}
        </Badge>
      );
    case 'fail':
      return (
        <Badge variant="destructive" className="gap-1 shrink-0">
          <AlertCircle className="w-3 h-3" />
          {ui.statusFail}
        </Badge>
      );
    case 'skip':
      return <Badge variant="outline" className="shrink-0">{ui.statusSkip}</Badge>;
    default:
      return (
        <Badge variant="destructive" className="shrink-0">
          {ui.statusError}
        </Badge>
      );
  }
}

function CheckRow({
  entry,
  ui,
}: {
  entry: ConsistencyCheckEntry;
  ui: {
    statusOk: string;
    statusFail: string;
    statusWarn: string;
    statusSkip: string;
    statusError: string;
    issuesCount: string;
    andMore: string;
  };
}) {
  const [open, setOpen] = useState(entry.status !== 'ok' && entry.count > 0);
  const hasDetails = entry.count > 0 || !!entry.message;

  return (
    <div className="rounded-md border text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-accent/50 disabled:cursor-default"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
      >
        {hasDetails ? (
          open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />
        ) : (
          <span className="w-4" />
        )}
        <span className="flex-1 min-w-0 font-medium truncate">{entry.label}</span>
        {entry.count > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {ui.issuesCount.replace('{n}', String(entry.count))}
          </span>
        )}
        {statusBadge(entry.status, ui)}
      </button>
      {open && hasDetails && (
        <div className="px-3 pb-2 space-y-1 border-t bg-muted/30">
          {entry.message && <p className="text-xs text-destructive pt-2">{entry.message}</p>}
          {entry.hint && entry.status !== 'ok' && (
            <p className="text-xs text-muted-foreground pt-1">{entry.hint}</p>
          )}
          <ul className="text-xs font-mono text-muted-foreground space-y-0.5 pt-1">
            {entry.samples.map((row, i) => (
              <li key={i} className="break-all">
                {formatConsistencyIssue(row, entry.kind)}
              </li>
            ))}
            {entry.count > entry.samples.length && (
              <li className="italic">{ui.andMore.replace('{n}', String(entry.count - entry.samples.length))}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function RepairSummary({
  repair,
  ui,
}: {
  repair: ConsistencyRepairResult;
  ui: {
    repairApplied: string;
    repairSupplierReturns: string;
    repairSupplierBalances: string;
    repairClientBalances: string;
    repairSkusRenamed: string;
    repairBranchAssigned: string;
    repairOpeningStock: string;
    repairStockReconciled: string;
    repairNoChanges: string;
  };
}) {
  const lines: string[] = [];
  if ((repair.supplierReturns?.repaired ?? 0) > 0) {
    lines.push(ui.repairSupplierReturns.replace('{n}', String(repair.supplierReturns!.repaired)));
  }
  if ((repair.supplierBalances?.updated ?? 0) > 0) {
    lines.push(ui.repairSupplierBalances.replace('{n}', String(repair.supplierBalances!.updated)));
  }
  if ((repair.clientBalances?.updated ?? 0) > 0) {
    lines.push(ui.repairClientBalances.replace('{n}', String(repair.clientBalances!.updated)));
  }
  if ((repair.duplicateSkusRenamed ?? repair.duplicateSkusDeactivated ?? 0) > 0) {
    lines.push(
      ui.repairSkusRenamed.replace(
        '{n}',
        String(repair.duplicateSkusRenamed ?? repair.duplicateSkusDeactivated ?? 0),
      ),
    );
  }
  if ((repair.productsBranchAssigned ?? 0) > 0) {
    lines.push(ui.repairBranchAssigned.replace('{n}', String(repair.productsBranchAssigned)));
  }
  if ((repair.openingMovementsSeeded ?? 0) > 0) {
    lines.push(ui.repairOpeningStock.replace('{n}', String(repair.openingMovementsSeeded)));
  }
  if ((repair.productStockReconciled ?? 0) > 0) {
    lines.push(ui.repairStockReconciled.replace('{n}', String(repair.productStockReconciled)));
  }
  if (lines.length === 0) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        {ui.repairNoChanges}
      </div>
    );
  }
  return (
    <div className="p-3 rounded-lg bg-accent/50 text-sm space-y-1">
      <p className="font-medium">{ui.repairApplied}</p>
      <ul className="list-disc list-inside text-xs text-muted-foreground">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function DataConsistencyCard() {
  const { t } = useTranslation();
  const ui = t.dataConsistencyUi;
  const demo = isDemoMode();
  const { user } = useAuth();
  const { isAdmin, hasPermission } = usePermissions(user?.id);
  const canManageConsistency = isAdmin || hasPermission('admin_consistency');

  const [checking, setChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [lastRepair, setLastRepair] = useState<ConsistencyRepairResult | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState<BackupConnectionIssue | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const issueMessage = (issue: BackupConnectionIssue | null): string => {
    switch (issue) {
      case 'offline':
        return ui.errorOffline;
      case 'timeout':
        return ui.errorTimeout;
      case 'not_found':
        return ui.errorNotFound;
      case 'server_error':
        return ui.errorServer;
      case 'demo':
        return ui.demoUnavailable;
      case 'unauthorized':
        return ui.errorUnauthorized;
      case 'forbidden':
        return ui.errorForbidden;
      default:
        return ui.backendUnavailable;
    }
  };

  const handleApiError = (e: unknown) => {
    if (e instanceof BackupApiError) {
      setConnectionIssue(e.issue);
      setLastError(e.message);
      const authIssue = e.issue === 'forbidden' || e.issue === 'unauthorized';
      setBackendUnavailable(!authIssue);
    } else {
      setBackendUnavailable(true);
      setConnectionIssue('unknown');
      setLastError(lastErrorFrom(e));
    }
  };

  const rowUi = {
    statusOk: ui.statusOk,
    statusFail: ui.statusFail,
    statusWarn: ui.statusWarn,
    statusSkip: ui.statusSkip,
    statusError: ui.statusError,
    issuesCount: ui.issuesCount,
    andMore: ui.andMore,
  };

  const repairUi = {
    repairApplied: ui.repairApplied,
    repairSupplierReturns: ui.repairSupplierReturns,
    repairSupplierBalances: ui.repairSupplierBalances,
    repairClientBalances: ui.repairClientBalances,
    repairSkusRenamed: ui.repairSkusRenamed,
    repairBranchAssigned: ui.repairBranchAssigned,
    repairStockReconciled: ui.repairStockReconciled,
  };

  const handleCheck = useCallback(async () => {
    if (demo) {
      toast.error(ui.demoUnavailable);
      return;
    }
    if (!canManageConsistency) {
      toast.error(ui.adminRequired);
      return;
    }
    setChecking(true);
    setBackendUnavailable(false);
    setLastError(null);
    try {
      await probeBackupApi();
      const result = await runConsistencyCheck();
      setReport(result);
      setLastRepair(null);
      if (result.status === 'ok') {
        toast.success(ui.checkOk);
      } else if (result.status === 'warnings') {
        toast.warning(ui.checkWarnings, {
          description: ui.summaryWarnings.replace('{n}', String(result.summary.warnings)),
        });
      } else {
        toast.error(ui.checkErrors, {
          description: ui.summaryErrors.replace('{n}', String(result.summary.errors)),
        });
      }
    } catch (e: unknown) {
      setReport(null);
      handleApiError(e);
      toast.error(ui.checkFailed, { description: lastErrorFrom(e) });
    } finally {
      setChecking(false);
    }
  }, [demo, ui, canManageConsistency]);

  const handleExport = () => {
    if (!report) return;
    downloadConsistencyReport(report, lastRepair);
    toast.success(ui.exportDone);
  };

  const handleRepair = async () => {
    if (demo) {
      toast.error(ui.demoUnavailable);
      return;
    }
    if (!canManageConsistency) {
      toast.error(ui.adminRequired);
      return;
    }
    if (!window.confirm(ui.confirmRepair)) return;
    setRepairing(true);
    setBackendUnavailable(false);
    setLastError(null);
    try {
      await probeBackupApi();
      const { repair, check } = await runConsistencyRepair();
      setLastRepair(repair);
      setReport(check);
      if (check.status === 'ok') {
        toast.success(ui.repairOk);
      } else if (check.status === 'warnings') {
        toast.warning(ui.repairPartial, {
          description: ui.summaryWarnings.replace('{n}', String(check.summary.warnings)),
        });
      } else {
        toast.error(ui.repairStillErrors, {
          description: ui.summaryErrors.replace('{n}', String(check.summary.errors)),
        });
      }
    } catch (e: unknown) {
      handleApiError(e);
      toast.error(ui.repairFailed, { description: lastErrorFrom(e) });
    } finally {
      setRepairing(false);
    }
  };

  const actionsDisabled = checking || repairing || demo || backendUnavailable || !canManageConsistency;

  const overallBadge = () => {
    if (!report) return null;
    if (report.status === 'ok') {
      return (
        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
          <CheckCircle2 className="w-3 h-3" />
          {ui.overallOk}
        </Badge>
      );
    }
    if (report.status === 'warnings') {
      return (
        <Badge variant="outline" className="gap-1 border-amber-500/50">
          <AlertTriangle className="w-3 h-3" />
          {ui.overallWarnings}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="w-3 h-3" />
        {ui.overallErrors}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <ShieldCheck className="w-5 h-5" />
          {ui.title}
          {overallBadge()}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {demo && (
          <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {ui.demoUnavailable}
          </div>
        )}

        {!demo && !canManageConsistency && (
          <div className="flex gap-2 p-3 rounded-lg bg-muted text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {ui.adminRequired}
          </div>
        )}

        {!demo &&
          !backendUnavailable &&
          (connectionIssue === 'forbidden' || connectionIssue === 'unauthorized') && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-900 dark:text-amber-100 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p>{issueMessage(connectionIssue)}</p>
                {lastError && <p className="text-xs font-mono break-all opacity-90 mt-1">{lastError}</p>}
              </div>
            </div>
          )}

        {backendUnavailable && !demo && (
          <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p>{issueMessage(connectionIssue)}</p>
              {lastError && <p className="text-xs font-mono break-all opacity-90">{lastError}</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            onClick={handleCheck}
            variant="default"
            className="gap-2 h-11"
            disabled={actionsDisabled}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {ui.runCheck}
          </Button>
          <Button
            onClick={handleRepair}
            variant="outline"
            className="gap-2 h-11"
            disabled={actionsDisabled}
          >
            {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            {ui.runRepair}
          </Button>
        </div>

        {report && canManageConsistency && (
          <Button type="button" variant="secondary" className="gap-2 w-full sm:w-auto" onClick={handleExport}>
            <FileDown className="w-4 h-4" />
            {ui.exportReport}
          </Button>
        )}

        <p className="text-[10px] text-muted-foreground">{ui.hint}</p>

        {lastRepair && <RepairSummary repair={lastRepair} ui={repairUi} />}

        {report && (
          <div className="space-y-4">
            {report.databasePath && (
              <p className="text-xs text-muted-foreground font-mono break-all">{report.databasePath}</p>
            )}

            <section className="space-y-2">
              <h4 className="text-sm font-medium">{ui.sectionUniqueness}</h4>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {report.uniqueness.map((entry) => (
                  <CheckRow key={entry.label} entry={entry} ui={rowUi} />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">{ui.sectionReconciliation}</h4>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {report.reconciliation.map((entry) => (
                  <CheckRow key={entry.label} entry={entry} ui={rowUi} />
                ))}
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
