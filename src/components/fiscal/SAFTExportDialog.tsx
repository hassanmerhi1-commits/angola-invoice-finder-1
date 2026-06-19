import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileJson,
  FileCode,
  Download,
  FileText,
  Building2,
  Calendar,
  Users,
  Package,
  Receipt,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useBranches } from '@/hooks/useERP';
import {
  downloadSAFTFile,
  getSAFTSummary,
  SAFTExportOptions,
  SAFTAO,
  SAFTSummary,
} from '@/lib/saftAO';
import { getCompanySettings } from '@/lib/companySettings';
import { api } from '@/lib/api/client';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { usePermissions } from '@/hooks/usePermissions';

interface SAFTExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SAFTExportDialog({
  open,
  onOpenChange,
}: SAFTExportDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions(user?.id);
  const canExportSaft = hasPermission('saft_export');
  const { branches } = useBranches();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [generatedSAFT, setGeneratedSAFT] = useState<SAFTAO | null>(null);
  const [summary, setSummary] = useState<SAFTSummary | null>(null);
  const [validation, setValidation] = useState<{
    ok: boolean;
    issues: Array<{ level: string; code: string; message: string; xpath?: string }>;
    errorCount: number;
    warningCount: number;
    engine: string;
  } | null>(null);

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [options, setOptions] = useState<SAFTExportOptions>({
    startDate: firstOfMonth.toISOString().split('T')[0],
    endDate: lastOfMonth.toISOString().split('T')[0],
    branchId: undefined,
    includeVoided: false,
    format: 'json',
  });

  const company = getCompanySettings();

  const handleGenerate = async () => {
    if (!canExportSaft) {
      toast.error('You do not have permission to export SAF-T');
      return;
    }
    setIsGenerating(true);

    try {
      if (!company.nif || company.nif === '5000000000') {
        toast.error(t.saftUi.companyNifRequired);
        return;
      }

      await api.companySettings.save(company).catch(() => {});

      const response = await api.saft.generate({
        startDate: options.startDate,
        endDate: options.endDate,
        branchId: options.branchId,
        includeVoided: options.includeVoided,
        company,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const saft = response.data as SAFTAO;
      if (!saft?.AuditFile) {
        throw new Error('Invalid SAF-T response from server');
      }

      const saftSummary = getSAFTSummary(saft);
      setGeneratedSAFT(saft);
      setSummary(saftSummary);
      setValidation(null);

      setIsValidating(true);
      try {
        const valRes = await api.saft.validate({
          startDate: options.startDate,
          endDate: options.endDate,
          branchId: options.branchId,
          includeVoided: options.includeVoided,
          company,
        });
        if (valRes.data) {
          setValidation(valRes.data);
          if (!valRes.data.ok) {
            toast.error(t.saftUi.validationFailed);
          }
        }
      } catch (valErr) {
        console.warn('[SAFT] XSD validation skipped:', valErr);
      } finally {
        setIsValidating(false);
      }

      toast.success(t.saftUi.generated);
    } catch (error) {
      console.error('Error generating SAF-T:', error);
      toast.error(
        t.saftUi.generateErrorPrefix.replace('{message}', (error as Error).message),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedSAFT) return;

    try {
      downloadSAFTFile(generatedSAFT, options.format);
      toast.success(t.saftUi.downloaded.replace('{format}', options.format.toUpperCase()));
    } catch {
      toast.error(t.saftUi.downloadError);
    }
  };

  const handleDownloadXmlFromServer = async () => {
    try {
      setIsGenerating(true);
      await api.companySettings.save(company).catch(() => {});

      const url = api.saft.exportUrl({
        startDate: options.startDate,
        endDate: options.endDate,
        branchId: options.branchId,
        includeVoided: options.includeVoided,
        format: 'xml',
      });

      const a = document.createElement('a');
      a.href = url;
      a.download = `SAFT-AO_${company.nif}_${options.startDate}_${options.endDate}.xml`;
      a.click();

      toast.success(t.saftUi.xmlDownloadedServer);
    } catch {
      toast.error(t.saftUi.serverUnavailableUseLocal);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setGeneratedSAFT(null);
    setSummary(null);
    setValidation(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t.saftUi.title}
          </DialogTitle>
          <DialogDescription>
            {t.saftUi.description}
          </DialogDescription>
        </DialogHeader>

        {!generatedSAFT ? (
          <div className="space-y-6">
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <Building2 className="w-8 h-8 text-primary" />
                  <div>
                    <p className="font-medium">{company.name}</p>
                    <p className="text-sm text-muted-foreground">NIF: {company.nif}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {t.saftUi.exportPeriod}
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate" className="text-sm text-muted-foreground">
                    {t.saftUi.startDate}
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={options.startDate}
                    onChange={(e) => setOptions({ ...options, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate" className="text-sm text-muted-foreground">
                    {t.saftUi.endDate}
                  </Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={options.endDate}
                    onChange={(e) => setOptions({ ...options, endDate: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Label>{t.saftUi.branch}</Label>
              <Select
                value={options.branchId || 'all'}
                onValueChange={(value) =>
                  setOptions({ ...options, branchId: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.saftUi.selectBranch} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.saftUi.allBranches}</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeVoided"
                checked={options.includeVoided}
                onCheckedChange={(checked) =>
                  setOptions({ ...options, includeVoided: checked as boolean })
                }
              />
              <Label htmlFor="includeVoided" className="text-sm">
                {t.saftUi.includeVoided}
              </Label>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>{t.saftUi.fileFormat}</Label>
              <RadioGroup
                value={options.format}
                onValueChange={(value) =>
                  setOptions({ ...options, format: value as 'json' | 'xml' })
                }
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="json" id="json" />
                  <Label htmlFor="json" className="flex items-center gap-2 cursor-pointer">
                    <FileJson className="w-4 h-4" />
                    {t.saftUi.jsonRecommended}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="xml" id="xml" />
                  <Label htmlFor="xml" className="flex items-center gap-2 cursor-pointer">
                    <FileCode className="w-4 h-4" />
                    XML (Compatibilidade)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium mb-1">Requisitos AGT</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>SAF-T Facturação: envio mensal</li>
                      <li>SAF-T Contabilidade Anual: até 10 de Abril</li>
                      <li>Ficheiro de Inventário: até 15 de Fevereiro</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  A gerar SAF-T...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Gerar SAF-T AO
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <Card className={validation?.ok === false ? 'border-destructive bg-destructive/5' : validation?.ok ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  {isValidating ? (
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  ) : validation?.ok === false ? (
                    <AlertCircle className="w-8 h-8 text-destructive" />
                  ) : (
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  )}
                  <div>
                    <p className="font-medium">
                      {isValidating
                        ? t.saftUi.validating
                        : validation?.ok === false
                          ? t.saftUi.validationFailed
                          : validation?.ok
                            ? t.saftUi.validationOk
                            : 'SAF-T AO Gerado com Sucesso'}
                    </p>
                    {validation && !isValidating && (
                      <p className="text-sm text-muted-foreground">
                        {t.saftUi.validationEngine.replace('{engine}', validation.engine)}
                        {validation.warningCount > 0
                          ? ` · ${t.saftUi.validationWarnings.replace('{count}', String(validation.warningCount))}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {validation && validation.issues.length > 0 && (
              <Card className="border-destructive/50">
                <CardContent className="pt-4 space-y-2 max-h-48 overflow-y-auto">
                  {validation.issues.map((issue, idx) => (
                    <div key={`${issue.code}-${idx}`} className="text-sm flex gap-2">
                      <Badge variant={issue.level === 'error' ? 'destructive' : 'secondary'} className="shrink-0">
                        {issue.level}
                      </Badge>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Calendar className="w-4 h-4" />
                      <span className="text-xs">Período</span>
                    </div>
                    <p className="font-medium text-sm">{summary.period}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Receipt className="w-4 h-4" />
                      <span className="text-xs">Documentos</span>
                    </div>
                    <p className="font-bold text-xl">{summary.totalInvoices}</p>
                    <p className="text-xs text-muted-foreground">
                      FT {summary.totalSalesInvoices} · NC {summary.totalCreditNotes} · ND {summary.totalDebitNotes}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Package className="w-4 h-4" />
                      <span className="text-xs">Produtos</span>
                    </div>
                    <p className="font-bold text-xl">{summary.totalProducts}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Users className="w-4 h-4" />
                      <span className="text-xs">Clientes</span>
                    </div>
                    <p className="font-bold text-xl">{summary.totalCustomers}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <span className="text-xs">Total Vendas</span>
                    </div>
                    <p className="font-bold text-lg">
                      {summary.totalCredit.toLocaleString('pt-AO')} Kz
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <span className="text-xs">Total IVA</span>
                    </div>
                    <p className="font-bold text-lg">
                      {summary.totalTax.toLocaleString('pt-AO')} Kz
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {options.format === 'json' ? (
                      <FileJson className="w-10 h-10 text-yellow-600" />
                    ) : (
                      <FileCode className="w-10 h-10 text-orange-600" />
                    )}
                    <div>
                      <p className="font-medium">
                        SAFT-AO_{company.nif}_{options.startDate}_{options.endDate}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Formato: {options.format.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <Badge>{options.format.toUpperCase()}</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset} className="flex-1">
                Voltar
              </Button>
              <Button onClick={handleDownload} className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                Descarregar
              </Button>
              <Button
                variant="secondary"
                onClick={handleDownloadXmlFromServer}
                disabled={isGenerating}
                className="flex-1"
              >
                <FileCode className="w-4 h-4 mr-2" />
                XML Servidor
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
