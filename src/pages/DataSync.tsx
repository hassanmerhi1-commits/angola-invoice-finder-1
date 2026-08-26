import { useEffect, useRef, useState } from 'react';
import { useBranchScope } from '@/hooks/useBranchScope';
import { api } from '@/lib/api/client';
import { applyUsbDownCatalog } from '@/lib/sync/applyUsbDown';
import {
  buildUpPackage,
  countUpEvents,
  downloadJsonFile,
  parseUsbPackage,
  type NexorDownPackage,
  type NexorUpEvent,
  type NexorUsbPackage,
} from '@/lib/sync/usbPackage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Download, Upload, HardDrive, CheckCircle, AlertCircle, Package, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function exportPendingFromElectron(dateFrom: string, dateTo: string): Promise<NexorUpEvent[]> {
  const apiEl = (window as unknown as {
    electronAPI?: {
      syncOutbox?: {
        exportPending?: (from: string, to: string) => Promise<{
          success?: boolean;
          error?: string;
          events?: NexorUpEvent[];
        }>;
      };
    };
  }).electronAPI;
  const fn = apiEl?.syncOutbox?.exportPending;
  if (!fn) return [];
  const r = await fn(dateFrom, dateTo);
  if (!r?.success && r?.error) throw new Error(String(r.error));
  return Array.isArray(r?.events) ? r.events : [];
}

export default function DataSync() {
  const { t } = useTranslation();
  const { branches, currentBranch, scopeId } = useBranchScope();
  const { toast } = useToast();
  const upFileRef = useRef<HTMLInputElement>(null);
  const downFileRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState(todayIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch?.id || '');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<NexorUsbPackage | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  useEffect(() => {
    const next = String(scopeId || currentBranch?.id || '').trim();
    if (next) setSelectedBranch(next);
  }, [scopeId, currentBranch?.id]);

  const branchId = selectedBranch || currentBranch?.id || '';
  const branchName = branches.find((b) => b.id === branchId)?.name || currentBranch?.name || '';

  const handleExportUp = async () => {
    setBusy(true);
    setApplyResult(null);
    try {
      const events = await exportPendingFromElectron(dateFrom, dateTo);
      const pkg = buildUpPackage({
        events,
        fromBranchId: currentBranch?.id || branchId,
        branchName: currentBranch?.name || branchName,
        dateRange: { from: dateFrom, to: dateTo },
      });
      const stamp = `${dateFrom}_${dateTo}`;
      const code = (currentBranch as { code?: string } | undefined)?.code || 'shop';
      downloadJsonFile(`nexor-up_${code}_${stamp}.json`, pkg);
      toast({
        title: t.dataSyncUi.packagePreparedTitle,
        description: t.dataSyncUi.recordsReady.replace('{count}', String(pkg.events.length)),
      });
    } catch (e) {
      toast({
        title: t.dataSyncUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.dataSyncUi.exportFailed,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExportDown = async () => {
    if (!branchId) {
      toast({
        title: t.dataSyncUi.toastErrorTitle,
        description: t.dataSyncUi.selectBranchError,
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    setApplyResult(null);
    try {
      const res = await api.sync.usbCatalog(branchId);
      if (res.error || !res.data?.package) {
        throw new Error(res.error || t.dataSyncUi.exportFailed);
      }
      const pkg = res.data.package as NexorDownPackage;
      const stamp = todayIso();
      downloadJsonFile(`nexor-down_${pkg.toBranchId || branchId}_${stamp}.json`, pkg);
      toast({
        title: t.dataSyncUi.packagePreparedTitle,
        description: t.dataSyncUi.catalogReady
          .replace('{products}', String(pkg.products?.length || 0))
          .replace('{clients}', String(pkg.clients?.length || 0)),
      });
    } catch (e) {
      toast({
        title: t.dataSyncUi.toastErrorTitle,
        description: e instanceof Error ? e.message : t.dataSyncUi.exportFailed,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const readPackageFile = (file: File) => {
    setApplyResult(null);
    setPreviewError(null);
    setPreview(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const pkg = parseUsbPackage(String(reader.result || ''));
        setPreview(pkg);
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : t.dataSyncUi.invalidOrCorruptedFile);
      }
    };
    reader.readAsText(file);
  };

  const handleApplyPreview = async () => {
    if (!preview) return;
    setBusy(true);
    setApplyResult(null);
    try {
      if (preview.kind === 'nexor-up') {
        const res = await api.sync.usbIngest(preview);
        if (res.error) throw new Error(res.error);
        const applied = Number(res.data?.applied || 0);
        const dup = Number(res.data?.duplicates || 0);
        const failed = Number(res.data?.failed || 0);
        if (failed > 0 && applied === 0) {
          throw new Error(t.dataSyncUi.applyFailed);
        }
        setApplyResult(
          t.dataSyncUi.upApplied
            .replace('{applied}', String(applied))
            .replace('{duplicates}', String(dup))
            .replace('{failed}', String(failed)),
        );
        toast({
          title: t.dataSyncUi.importCompletedTitle,
          description: t.dataSyncUi.recordsImported.replace('{count}', String(applied)),
        });
      } else {
        const r = await applyUsbDownCatalog(preview, currentBranch?.id || branchId);
        setApplyResult(
          t.dataSyncUi.downApplied
            .replace('{products}', String(r.products))
            .replace('{clients}', String(r.clients)),
        );
        toast({
          title: t.dataSyncUi.importCompletedTitle,
          description: t.dataSyncUi.catalogLoaded,
        });
      }
    } catch (e) {
      toast({
        title: t.dataSyncUi.importErrorTitle,
        description: e instanceof Error ? e.message : t.dataSyncUi.invalidOrCorruptedFile,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const upCounts = preview?.kind === 'nexor-up' ? countUpEvents(preview) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.dataSyncUi.title}</h1>
        <p className="text-muted-foreground">{t.dataSyncUi.subtitle}</p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t.dataSyncUi.howItWorksTitle}</AlertTitle>
        <AlertDescription>{t.dataSyncUi.howItWorksDesc}</AlertDescription>
      </Alert>

      <Tabs defaultValue="to-city" className="space-y-4">
        <TabsList>
          <TabsTrigger value="to-city">
            <Upload className="w-4 h-4 mr-2" />
            {t.dataSyncUi.tabToCity}
          </TabsTrigger>
          <TabsTrigger value="to-shop">
            <Download className="w-4 h-4 mr-2" />
            {t.dataSyncUi.tabToShop}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="to-city" className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t.dataSyncUi.sendWorkTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.dataSyncUi.sendWorkDesc}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-lg">
              <div className="space-y-1.5">
                <Label>{t.dataSyncUi.dateFromLabel}</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t.dataSyncUi.dateToLabel}</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => void handleExportUp()} disabled={busy} className="gap-2">
              <HardDrive className="h-4 w-4" />
              {t.dataSyncUi.exportPending}
            </Button>
          </section>

          <section className="space-y-3 border-t pt-5">
            <h2 className="text-sm font-semibold">{t.dataSyncUi.applyWorkTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.dataSyncUi.applyWorkDesc}</p>
            <input
              ref={upFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readPackageFile(file);
                e.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => upFileRef.current?.click()} disabled={busy} className="gap-2">
              <Upload className="h-4 w-4" />
              {t.dataSyncUi.selectFile}
            </Button>
          </section>
        </TabsContent>

        <TabsContent value="to-shop" className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t.dataSyncUi.exportCatalogTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.dataSyncUi.exportCatalogDesc}</p>
            <Alert>
              <Package className="h-4 w-4" />
              <AlertTitle>{t.dataSyncUi.stockSnapshotTitle}</AlertTitle>
              <AlertDescription>{t.dataSyncUi.stockSnapshotDesc}</AlertDescription>
            </Alert>
            <div className="max-w-sm space-y-1.5">
              <Label>{t.dataSyncUi.branchLabel}</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder={t.dataSyncUi.selectBranchPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void handleExportDown()} disabled={busy || !branchId} className="gap-2">
              <HardDrive className="h-4 w-4" />
              {t.dataSyncUi.exportCatalog}
            </Button>
          </section>

          <section className="space-y-3 border-t pt-5">
            <h2 className="text-sm font-semibold">{t.dataSyncUi.loadCatalogTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.dataSyncUi.loadCatalogDesc}</p>
            <input
              ref={downFileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readPackageFile(file);
                e.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => downFileRef.current?.click()} disabled={busy} className="gap-2">
              <Upload className="h-4 w-4" />
              {t.dataSyncUi.selectFile}
            </Button>
          </section>
        </TabsContent>
      </Tabs>

      {(preview || previewError) && (
        <div className="rounded-lg border p-4 space-y-3">
          {previewError && (
            <p className="text-sm text-destructive">{previewError}</p>
          )}
          {preview && (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-medium">
                  {preview.kind === 'nexor-up' ? t.dataSyncUi.previewUp : t.dataSyncUi.previewDown}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {preview.branchName || preview.fromBranchId || '—'}
                {preview.kind === 'nexor-up' && preview.dateRange
                  ? ` · ${preview.dateRange.from} → ${preview.dateRange.to}`
                  : ''}
              </p>
              {upCounts && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
                  <div><p className="font-semibold">{upCounts.sales}</p><p className="text-xs text-muted-foreground">{t.dataSyncUi.statSales}</p></div>
                  <div><p className="font-semibold">{upCounts.payments}</p><p className="text-xs text-muted-foreground">{t.dataSyncUi.statPayments}</p></div>
                  <div><p className="font-semibold">{upCounts.purchases}</p><p className="text-xs text-muted-foreground">{t.dataSyncUi.statPurchases}</p></div>
                  <div><p className="font-semibold">{upCounts.movements}</p><p className="text-xs text-muted-foreground">{t.dataSyncUi.statMovements}</p></div>
                  <div><p className="font-semibold">{upCounts.caixa}</p><p className="text-xs text-muted-foreground">{t.dataSyncUi.statCaixa}</p></div>
                </div>
              )}
              {preview.kind === 'nexor-down' && (
                <div className="grid grid-cols-2 gap-2 text-center text-sm max-w-xs">
                  <div>
                    <Package className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <p className="font-semibold">{preview.products?.length || 0}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statProducts}</p>
                  </div>
                  <div>
                    <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                    <p className="font-semibold">{preview.clients?.length || 0}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statClients}</p>
                  </div>
                </div>
              )}
              <Button onClick={() => void handleApplyPreview()} disabled={busy}>
                {t.dataSyncUi.applyPackage}
              </Button>
            </>
          )}
          {applyResult && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{applyResult}</p>
          )}
        </div>
      )}
    </div>
  );
}
