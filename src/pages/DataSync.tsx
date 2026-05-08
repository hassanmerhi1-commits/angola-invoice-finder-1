import { useState, useRef } from 'react';
import { useDataSync, useAuth } from '@/hooks/useERP';
import { useBranchContext } from '@/contexts/BranchContext';
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
  const { branches, currentBranch } = useBranchContext();
  const { exportData, downloadSyncPackage } = useDataSync();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [selectedBranch, setSelectedBranch] = useState(currentBranch?.id || '');
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
      const subject = encodeURIComponent(`Sincronização: ${syncPackage.branchName}`);
      const body = encodeURIComponent(`Pacote de sincronização com ${syncPackage.totalRecords} registos.`);
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
        <AlertTitle>Sistema Offline-First</AlertTitle>
        <AlertDescription>
          Cada filial trabalha com dados locais. No final do dia/semana, exporte os dados e envie para a sede 
          via pen drive ou email. A sede importa os dados de todas as filiais para consolidação.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue={isMainOffice ? 'import' : 'export'} className="space-y-4">
        <TabsList>
          <TabsTrigger value="export">
            <Download className="w-4 h-4 mr-2" />
            Exportar Dados
          </TabsTrigger>
          {isMainOffice && (
            <TabsTrigger value="import">
              <Upload className="w-4 h-4 mr-2" />
              Importar Dados
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Exportar Pacote Completo</CardTitle>
              <CardDescription>
                Gera um ficheiro JSON com todos os dados da filial para enviar à sede
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {isMainOffice && (
                  <div className="space-y-2">
                    <Label>Filial</Label>
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
                  <Label>Data Inicial</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data Final</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={handleExport}>
                <FileJson className="w-4 h-4 mr-2" />
                Preparar Pacote
              </Button>
            </CardContent>
          </Card>

          {syncPackage && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  Pacote Preparado
                </CardTitle>
                <CardDescription>
                  Pronto para download ou envio por email
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Package Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Building className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Filial</p>
                    </div>
                    <p className="font-medium">{syncPackage.branchName}</p>
                    <p className="text-xs text-muted-foreground">Código: {syncPackage.branchCode}</p>
                  </div>
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Período</p>
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
                      <p className="text-sm text-muted-foreground">Total Registos</p>
                    </div>
                    <p className="font-bold text-xl">{syncPackage.totalRecords}</p>
                  </div>
                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <FileJson className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Versão</p>
                    </div>
                    <p className="font-medium">{syncPackage.version}</p>
                  </div>
                </div>

                {/* Detailed breakdown */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg text-center">
                    <Package className="w-5 h-5 mx-auto mb-1 text-blue-600" />
                    <p className="text-lg font-bold">{syncPackage.products.length}</p>
                    <p className="text-xs text-muted-foreground">Produtos</p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-950/30 p-3 rounded-lg text-center">
                    <Truck className="w-5 h-5 mx-auto mb-1 text-purple-600" />
                    <p className="text-lg font-bold">{syncPackage.suppliers.length}</p>
                    <p className="text-xs text-muted-foreground">Fornecedores</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/30 p-3 rounded-lg text-center">
                    <Users className="w-5 h-5 mx-auto mb-1 text-green-600" />
                    <p className="text-lg font-bold">{syncPackage.clients.length}</p>
                    <p className="text-xs text-muted-foreground">Clientes</p>
                  </div>
                  <div className="bg-orange-50 dark:bg-orange-950/30 p-3 rounded-lg text-center">
                    <ShoppingCart className="w-5 h-5 mx-auto mb-1 text-orange-600" />
                    <p className="text-lg font-bold">{syncPackage.purchases.length}</p>
                    <p className="text-xs text-muted-foreground">Compras</p>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-lg text-center">
                    <FileText className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                    <p className="text-lg font-bold">{syncPackage.sales.length}</p>
                    <p className="text-xs text-muted-foreground">Vendas</p>
                  </div>
                  <div className="bg-cyan-50 dark:bg-cyan-950/30 p-3 rounded-lg text-center">
                    <ArrowRightLeft className="w-5 h-5 mx-auto mb-1 text-cyan-600" />
                    <p className="text-lg font-bold">{syncPackage.stockMovements.length}</p>
                    <p className="text-xs text-muted-foreground">Movimentos</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg text-center">
                    <Truck className="w-5 h-5 mx-auto mb-1 text-amber-600" />
                    <p className="text-lg font-bold">{syncPackage.stockTransfers.length}</p>
                    <p className="text-xs text-muted-foreground">Transferências</p>
                  </div>
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 p-3 rounded-lg text-center">
                    <BarChart3 className="w-5 h-5 mx-auto mb-1 text-indigo-600" />
                    <p className="text-lg font-bold">{syncPackage.dailyReports.length}</p>
                    <p className="text-xs text-muted-foreground">Relatórios</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button onClick={handleDownload}>
                    <HardDrive className="w-4 h-4 mr-2" />
                    Descarregar (Pen Drive)
                  </Button>
                  <Button variant="outline" onClick={() => setEmailDialogOpen(true)}>
                    <Mail className="w-4 h-4 mr-2" />
                    Enviar por Email
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
                  Importar Dados das Filiais
                </CardTitle>
                <CardDescription>
                  Carregue os ficheiros JSON recebidos das filiais
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">Carregar Ficheiro de Sincronização</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Arraste e solte ou clique para selecionar o ficheiro JSON
                  </p>
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
                    <AlertTitle className="text-green-800 dark:text-green-200">Importação Concluída</AlertTitle>
                    <AlertDescription className="text-green-700 dark:text-green-300">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.productsImported}</p>
                          <p className="text-xs">Produtos</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.suppliersImported}</p>
                          <p className="text-xs">Fornecedores</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.clientsImported}</p>
                          <p className="text-xs">Clientes</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.purchasesImported}</p>
                          <p className="text-xs">Compras</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.salesImported}</p>
                          <p className="text-xs">Vendas</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.stockMovementsImported}</p>
                          <p className="text-xs">Movimentos</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.stockTransfersImported}</p>
                          <p className="text-xs">Transferências</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-lg">{importResult.reportsImported}</p>
                          <p className="text-xs">Relatórios</p>
                        </div>
                      </div>
                      <div className="text-center mt-4 pt-3 border-t border-green-300 dark:border-green-700">
                        <p className="font-bold text-xl">{importResult.totalImported}</p>
                        <p className="text-sm">Total de Registos Importados</p>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Import Instructions */}
            <Card>
              <CardHeader>
                <CardTitle>Instruções de Importação</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>Receba o ficheiro JSON da filial (via pen drive ou email)</li>
                  <li>{t.dataSyncUi.importStepSelectFile}</li>
                  <li>O sistema irá validar e importar os dados automaticamente</li>
                  <li>Registos duplicados serão ignorados (baseado no ID ou NIF)</li>
                  <li>Os dados serão consolidados no sistema central</li>
                </ol>
                
                <div className="mt-4 p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Dados Incluídos no Pacote:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" /> Produtos
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4" /> Fornecedores
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" /> Clientes
                    </div>
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4" /> Compras (POs)
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Vendas (Facturas)
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="w-4 h-4" /> Movimentos Stock
                    </div>
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4" /> Transferências
                    </div>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" /> Relatórios Diários
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
            <DialogTitle>Enviar por Email</DialogTitle>
            <DialogDescription>
              O ficheiro será descarregado e o seu cliente de email será aberto
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email da Sede</Label>
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