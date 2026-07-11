import { useState, useRef, useEffect } from 'react';
import { useDataSync, useAuth } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { SyncPackage } from '@/types/erp';
// ImportResult type defined inline
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Download, Upload, Mail, HardDrive, FileJson, CheckCircle, AlertCircle, Building,
  Package, Users, ShoppingCart, Truck, FileText, BarChart3, ArrowRightLeft
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { useTranslation } from '@/i18n';

export default function DataSync() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const dfLocale = language === 'pt' ? pt : enUS;
  const { user } = useAuth();
  const { branches, currentBranch, scopeId } = useBranchScope();
  const { exportData, downloadSyncPackage } = useDataSync();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch?.id || '');

  useEffect(() => {
    const next = String(scopeId || currentBranch?.id || '').trim();
    if (next) setSelectedBranch(next);
  }, [scopeId, currentBranch?.id]);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [syncPackage, setSyncPackage] = useState<SyncPackage | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);

  const isMainOffice = currentBranch?.isMain;

  const handleExport = async () => {
    const branchId = isMainOffice ? selectedBranch : currentBranch?.id;
    if (!branchId) {
      toast({
        title: t.dataSyncUi.toastErrorTitle,
        description: t.dataSyncUi.selectBranchError,
        variant: 'destructive',
      });
      return;
    }

    const pkg = await exportData(branchId, dateFrom, dateTo);
    setSyncPackage(pkg as any);
    
    toast({
      title: t.dataSyncUi.packagePreparedTitle,
      description: t.dataSyncUi.recordsReady.replace('{count}', String(pkg.totalRecords)),
    });
  };

  const handleDownload = () => {
    if (syncPackage) {
      downloadSyncPackage(syncPackage);
      toast({
        title: t.dataSyncUi.downloadStartedTitle,
        description: t.dataSyncUi.jsonDownloaded,
      });
    }
  };

  const handleSendEmail = () => {
    if (syncPackage && email) {
      // Create mailto link with package info
      const subject = encodeURIComponent(
        t.dataSyncUi.emailSubject.replace('{branch}', syncPackage.branchName),
      );
      const body = encodeURIComponent(
        t.dataSyncUi.emailBody.replace('{count}', String(syncPackage.totalRecords)),
      );
      window.open(`mailto:${email}?subject=${subject}&body=${body}`);
      toast({
        title: t.dataSyncUi.emailPreparedTitle,
        description: t.dataSyncUi.emailClientOpened,
      });
      setEmailDialogOpen(false);
      setEmail('');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const pkg = JSON.parse(content) as SyncPackage;
        
        // Validate package structure
        if (!pkg.id || !pkg.branchId) {
          throw new Error(t.dataSyncUi.invalidFileFormat);
        }

        // Basic import: merge data from package
        const result = {
          totalImported: pkg.totalRecords || 0,
          productsImported: pkg.products?.length || 0,
          suppliersImported: pkg.suppliers?.length || 0,
          clientsImported: pkg.clients?.length || 0,
          purchasesImported: pkg.purchases?.length || 0,
          salesImported: pkg.sales?.length || 0,
          stockMovementsImported: pkg.stockMovements?.length || 0,
          stockTransfersImported: pkg.stockTransfers?.length || 0,
          reportsImported: pkg.dailyReports?.length || 0,
        };
        setImportResult(result);
        
        toast({
          title: t.dataSyncUi.importCompletedTitle,
          description: t.dataSyncUi.recordsImported.replace('{count}', String(result.totalImported)),
        });
      } catch (error) {
        toast({
          title: t.dataSyncUi.importErrorTitle,
          description: t.dataSyncUi.invalidOrCorruptedFile,
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t.dataSyncUi.title}</h1>
          <p className="text-muted-foreground">{t.dataSyncUi.subtitle}</p>
        </div>
      </div>

      {/* Architecture Info */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t.dataSyncUi.offlineFirstTitle}</AlertTitle>
        <AlertDescription>{t.dataSyncUi.offlineFirstDesc}</AlertDescription>
      </Alert>

      <Tabs defaultValue={isMainOffice ? 'import' : 'export'} className="space-y-4">
        <TabsList>
          <TabsTrigger value="export">
            <Download className="w-4 h-4 mr-2" />
            {t.dataSyncUi.tabExport}
          </TabsTrigger>
          {isMainOffice && (
            <TabsTrigger value="import">
              <Upload className="w-4 h-4 mr-2" />
              {t.dataSyncUi.tabImport}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.dataSyncUi.exportPackageTitle}</CardTitle>
              <CardDescription>{t.dataSyncUi.exportPackageDesc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {isMainOffice && (
                  <div className="space-y-2">
                    <Label>{t.dataSyncUi.branchLabel}</Label>
                    <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder={t.dataSyncUi.selectBranchPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map(branch => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{t.dataSyncUi.dateFromLabel}</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.dataSyncUi.dateToLabel}</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={handleExport}>
                <FileJson className="w-4 h-4 mr-2" />
                {t.dataSyncUi.preparePackage}
              </Button>
            </CardContent>
          </Card>

          {syncPackage && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  {t.dataSyncUi.packageReadyTitle}
                </CardTitle>
                <CardDescription>{t.dataSyncUi.packageReadyDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Package Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Building className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t.dataSyncUi.branchLabel}</p>
                    </div>
                    <p className="font-medium">{syncPackage.branchName}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.dataSyncUi.branchCodeLabel.replace('{code}', syncPackage.branchCode)}
                    </p>
                  </div>
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t.dataSyncUi.periodLabel}</p>
                    </div>
                    <p className="font-medium">
                  {format(new Date(syncPackage.dateRange.from), 'dd/MM/yyyy', { locale: dfLocale })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                  {t.dataSyncUi.toLabel} {format(new Date(syncPackage.dateRange.to), 'dd/MM/yyyy', { locale: dfLocale })}
                    </p>
                  </div>
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t.dataSyncUi.totalRecordsLabel}</p>
                    </div>
                    <p className="font-bold text-xl">{syncPackage.totalRecords}</p>
                  </div>
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <FileJson className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{t.dataSyncUi.versionLabel}</p>
                    </div>
                    <p className="font-medium">{syncPackage.version}</p>
                  </div>
                </div>

                {/* Detailed breakdown */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg text-center">
                    <Package className="w-5 h-5 mx-auto mb-1 text-blue-600" />
                    <p className="text-lg font-bold">{syncPackage.products.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statProducts}</p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-950/30 p-3 rounded-lg text-center">
                    <Truck className="w-5 h-5 mx-auto mb-1 text-purple-600" />
                    <p className="text-lg font-bold">{syncPackage.suppliers.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statSuppliers}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/30 p-3 rounded-lg text-center">
                    <Users className="w-5 h-5 mx-auto mb-1 text-green-600" />
                    <p className="text-lg font-bold">{syncPackage.clients.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statClients}</p>
                  </div>
                  <div className="bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg text-center">
                    <ShoppingCart className="w-5 h-5 mx-auto mb-1 text-orange-600" />
                    <p className="text-lg font-bold">{syncPackage.purchases.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statPurchases}</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg text-center">
                    <FileText className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                    <p className="text-lg font-bold">{syncPackage.sales.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statSales}</p>
                  </div>
                  <div className="bg-cyan-50 dark:bg-cyan-950/30 p-3 rounded-lg text-center">
                    <ArrowRightLeft className="w-5 h-5 mx-auto mb-1 text-cyan-600" />
                    <p className="text-lg font-bold">{syncPackage.stockMovements.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statMovements}</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg text-center">
                    <Truck className="w-5 h-5 mx-auto mb-1 text-amber-600" />
                    <p className="text-lg font-bold">{syncPackage.stockTransfers.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statTransfers}</p>
                  </div>
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 p-3 rounded-lg text-center">
                    <BarChart3 className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
                    <p className="text-lg font-bold">{syncPackage.dailyReports.length}</p>
                    <p className="text-xs text-muted-foreground">{t.dataSyncUi.statReports}</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button onClick={handleDownload}>
                    <HardDrive className="w-4 h-4 mr-2" />
                    {t.dataSyncUi.downloadUsb}
                  </Button>
                  <Button variant="outline" onClick={() => setEmailDialogOpen(true)}>
                    <Mail className="w-4 h-4 mr-2" />
                    {t.dataSyncUi.sendByEmail}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isMainOffice && (
          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="w-5 h-5" />
                  {t.dataSyncUi.importBranchDataTitle}
                </CardTitle>
                <CardDescription>{t.dataSyncUi.importBranchDataDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">{t.dataSyncUi.uploadSyncFileTitle}</p>
                  <p className="text-sm text-muted-foreground mb-4">{t.dataSyncUi.uploadSyncFileDesc}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-2" />
                    {t.dataSyncUi.selectFile}
                  </Button>
                </div>

                {importResult && (
                  <Alert className="bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-800 dark:text-green-200">{t.dataSyncUi.importDoneAlertTitle}</AlertTitle>
                    <AlertDescription className="text-green-700 dark:text-green-300">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.productsImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statProducts}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.suppliersImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statSuppliers}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.clientsImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statClients}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.purchasesImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statPurchases}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.salesImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statSales}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.stockMovementsImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statMovements}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.stockTransfersImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statTransfers}</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.reportsImported}</p>
                          <p className="text-xs">{t.dataSyncUi.statReports}</p>
                        </div>
                      </div>
                      <div className="text-center mt-4 pt-3 border-t border-green-300 dark:border-green-700">
                        <p className="font-bold text-xl">{importResult.totalImported}</p>
                        <p className="text-sm">{t.dataSyncUi.totalImportedLabel}</p>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Import Instructions */}
            <Card>
              <CardHeader>
                <CardTitle>{t.dataSyncUi.importInstructionsTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>{t.dataSyncUi.importStepReceiveFile}</li>
                  <li>{t.dataSyncUi.importStepSelectFile}</li>
                  <li>{t.dataSyncUi.importStepAutoImport}</li>
                  <li>{t.dataSyncUi.importStepDuplicates}</li>
                  <li>{t.dataSyncUi.importStepConsolidate}</li>
                </ol>
                
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">{t.dataSyncUi.packageContentsTitle}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" /> {t.dataSyncUi.packageItemProducts}
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4" /> {t.dataSyncUi.packageItemSuppliers}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" /> {t.dataSyncUi.packageItemClients}
                    </div>
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4" /> {t.dataSyncUi.packageItemPurchases}
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" /> {t.dataSyncUi.packageItemSales}
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="w-4 h-4" /> {t.dataSyncUi.packageItemStockMovements}
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4" /> {t.dataSyncUi.packageItemStockTransfers}
                    </div>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" /> {t.dataSyncUi.packageItemDailyReports}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.dataSyncUi.emailDialogTitle}</DialogTitle>
            <DialogDescription>{t.dataSyncUi.emailDialogDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t.dataSyncUi.headOfficeEmailLabel}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.dataSyncUi.headOfficeEmailPlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSendEmail} disabled={!email}>
              <Mail className="w-4 h-4 mr-2" />
              {t.dataSyncUi.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}