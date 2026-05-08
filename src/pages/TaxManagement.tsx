import { useState, useMemo } from 'react';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Receipt, Calculator, FileText, Edit, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';

function titleCase(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Demo IVA report data
const DEMO_IVA_REPORT = {
  lines: [
    { direction: 'output', tax_code: 'IVA14', tax_rate: 14, total_base: '2450000', total_tax: '343000', document_count: '87' },
    { direction: 'output', tax_code: 'IVA5', tax_rate: 5, total_base: '180000', total_tax: '9000', document_count: '12' },
    { direction: 'input', tax_code: 'IVA14', tax_rate: 14, total_base: '1200000', total_tax: '168000', document_count: '34' },
  ],
  outputTax: 352000,
  inputTax: 168000,
  ivaPayable: 184000,
};

export default function TaxManagement() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const [activeTab, setActiveTab] = useState('codes');
  const defaultTaxCodes = useMemo(() => ([
    { id: '1', code: 'IVA14', name: t.taxManagementUi.defaults.ivaNormal, rate: 14, tax_type: 'IVA', is_active: true, description: t.taxManagementUi.defaults.ivaNormalDesc },
    { id: '2', code: 'IVA0', name: t.taxManagementUi.defaults.ivaZero, rate: 0, tax_type: 'IVA', is_active: true, description: t.taxManagementUi.defaults.ivaZeroDesc },
    { id: '3', code: 'ISENTO', name: t.taxManagementUi.defaults.exemptIva, rate: 0, tax_type: 'IVA', is_active: true, description: t.taxManagementUi.defaults.exemptIvaDesc },
    { id: '4', code: 'IVA5', name: t.taxManagementUi.defaults.ivaReduced, rate: 5, tax_type: 'IVA', is_active: true, description: t.taxManagementUi.defaults.ivaReducedDesc },
    { id: '5', code: 'IVA7', name: t.taxManagementUi.defaults.ivaIntermediate, rate: 7, tax_type: 'IVA', is_active: true, description: t.taxManagementUi.defaults.ivaIntermediateDesc },
    { id: '6', code: 'RET3.5', name: t.taxManagementUi.defaults.withholding35, rate: 3.5, tax_type: 'RETENCAO', is_active: true, description: t.taxManagementUi.defaults.withholdingIncomeDesc },
    { id: '7', code: 'RET6.5', name: t.taxManagementUi.defaults.withholding65, rate: 6.5, tax_type: 'RETENCAO', is_active: true, description: t.taxManagementUi.defaults.withholdingServicesDesc },
    { id: '8', code: 'IS', name: t.taxManagementUi.defaults.stampTax, rate: 0.1, tax_type: 'IS', is_active: true, description: t.taxManagementUi.defaults.stampTaxDesc },
  ]), [t]);
  const taxCodes = defaultTaxCodes;
  const [ivaReport] = useState(DEMO_IVA_REPORT);
  const [selectedYear] = useState(new Date().getFullYear());
  const [selectedMonth] = useState(new Date().getMonth() + 1);

  const taxTypeLabels: Record<string, string> = {
    IVA: t.taxManagementUi.taxTypes.iva,
    RETENCAO: t.taxManagementUi.taxTypes.withholding,
    IS: t.taxManagementUi.taxTypes.stampTax,
    OUTRO: t.taxManagementUi.taxTypes.other,
  };

  const taxTypeColors: Record<string, string> = {
    IVA: 'default',
    RETENCAO: 'secondary',
    IS: 'outline',
    OUTRO: 'outline',
  };

  const monthNames = useMemo(() => (
    Array.from({ length: 12 }, (_, i) => titleCase(new Date(2024, i, 1).toLocaleString(uiLocale, { month: 'long' })))
  ), [uiLocale]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              {t.taxManagementUi.title}
            </h1>
            <p className="text-sm text-muted-foreground">{t.taxManagementUi.subtitle}</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="codes" className="gap-1.5">
            <FileText className="w-4 h-4" /> {t.taxManagementUi.tabTaxCodes}
          </TabsTrigger>
          <TabsTrigger value="iva" className="gap-1.5">
            <Receipt className="w-4 h-4" /> {t.taxManagementUi.tabIvaReturn}
          </TabsTrigger>
        </TabsList>

        {/* Tax Codes Tab */}
        <TabsContent value="codes" className="flex-1 p-4 overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Códigos de Imposto</CardTitle>
                <Button size="sm" className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> {t.taxManagementUi.newCode}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">{t.taxManagementUi.colCode}</TableHead>
                    <TableHead>{t.common.name}</TableHead>
                    <TableHead className="w-20 text-right">{t.taxManagementUi.colRate}</TableHead>
                    <TableHead className="w-24">{t.common.type}</TableHead>
                    <TableHead>{t.common.description}</TableHead>
                    <TableHead className="w-20 text-center">{t.common.status}</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxCodes.map(code => (
                    <TableRow key={code.id}>
                      <TableCell className="font-mono font-medium">{code.code}</TableCell>
                      <TableCell className="font-medium">{code.name}</TableCell>
                      <TableCell className="text-right font-mono">{code.rate}%</TableCell>
                      <TableCell>
                        <Badge variant={taxTypeColors[code.tax_type] as any}>
                          {taxTypeLabels[code.tax_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{code.description}</TableCell>
                      <TableCell className="text-center">
                        {code.is_active ? (
                          <Check className="w-4 h-4 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-destructive mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* IVA Declaration Tab */}
        <TabsContent value="iva" className="flex-1 p-4 overflow-auto space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{t.taxManagementUi.ivaReturnTitle}</h2>
            <Badge variant="outline">{monthNames[selectedMonth - 1]} {selectedYear}</Badge>
          </div>

          {/* Output Tax */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{t.taxManagementUi.outputVatTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.taxManagementUi.colCode}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colRateShort}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colTaxBase}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colVat}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colDocs}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ivaReport.lines.filter(l => l.direction === 'output').map((line, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{line.tax_code}</TableCell>
                      <TableCell className="text-right">{line.tax_rate}%</TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(line.total_base).toLocaleString(uiLocale)} Kz
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {parseFloat(line.total_tax).toLocaleString(uiLocale)} Kz
                      </TableCell>
                      <TableCell className="text-right">{line.document_count}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={3}>{t.taxManagementUi.totalOutputVat}</TableCell>
                    <TableCell className="text-right font-mono text-primary">
                      {ivaReport.outputTax.toLocaleString(uiLocale)} Kz
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Input Tax */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{t.taxManagementUi.inputVatTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.taxManagementUi.colCode}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colRateShort}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colTaxBase}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colVat}</TableHead>
                    <TableHead className="text-right">{t.taxManagementUi.colDocs}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ivaReport.lines.filter(l => l.direction === 'input').map((line, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{line.tax_code}</TableCell>
                      <TableCell className="text-right">{line.tax_rate}%</TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(line.total_base).toLocaleString(uiLocale)} Kz
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {parseFloat(line.total_tax).toLocaleString(uiLocale)} Kz
                      </TableCell>
                      <TableCell className="text-right">{line.document_count}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={3}>{t.taxManagementUi.totalInputVat}</TableCell>
                    <TableCell className="text-right font-mono text-green-600">
                      {ivaReport.inputTax.toLocaleString(uiLocale)} Kz
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Net IVA */}
          <Card className="border-primary/30">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{t.taxManagementUi.netVatPayableTitle}</p>
                  <p className="text-xs text-muted-foreground">{t.taxManagementUi.netVatPayableHint}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    {ivaReport.ivaPayable.toLocaleString(uiLocale)} Kz
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ivaReport.outputTax.toLocaleString(uiLocale)} - {ivaReport.inputTax.toLocaleString(uiLocale)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
