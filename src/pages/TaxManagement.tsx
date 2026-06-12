import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Calculator, FileText, Edit, Plus, Check, X, RefreshCw, Radio, FileBarChart, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import {
  buildAgtReportHtml,
  buildFiscalDocsReportHtml,
  buildIvaReportHtml,
  fiscalReportFilename,
  printFiscalReportPdf,
  saveFiscalReportPdf,
  type FiscalReportKind,
  type FiscalReportPdfLabels,
} from '@/lib/fiscalReportPdf';

function titleCase(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

type IvaLine = {
  direction: string;
  tax_code: string;
  tax_rate: number;
  total_base: string | number;
  total_tax: string | number;
  document_count: string | number;
};

type IvaReport = {
  lines: IvaLine[];
  outputTax: number;
  inputTax: number;
  ivaPayable: number;
};

type FiscalDocLine = {
  docType: string;
  documentCount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  agtValidatedCount: number;
};

type AgtReport = {
  summary: { total: number; validated: number; failed: number; pending: number };
  byTypeStatus: Array<{ transmission_type: string; agt_status: string; count: number }>;
};

const EMPTY_IVA: IvaReport = { lines: [], outputTax: 0, inputTax: 0, ivaPayable: 0 };

export default function TaxManagement() {
  const { t, language } = useTranslation();
  const ui = t.taxManagementUi;
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const now = new Date();

  const defaultTaxCodes = useMemo(() => ([
    { id: '1', code: 'IVA14', name: ui.defaults.ivaNormal, rate: 14, tax_type: 'IVA', is_active: true, description: ui.defaults.ivaNormalDesc },
    { id: '2', code: 'IVA0', name: ui.defaults.ivaZero, rate: 0, tax_type: 'IVA', is_active: true, description: ui.defaults.ivaZeroDesc },
    { id: '3', code: 'ISENTO', name: ui.defaults.exemptIva, rate: 0, tax_type: 'IVA', is_active: true, description: ui.defaults.exemptIvaDesc },
    { id: '4', code: 'IVA5', name: ui.defaults.ivaReduced, rate: 5, tax_type: 'IVA', is_active: true, description: ui.defaults.ivaReducedDesc },
    { id: '5', code: 'IVA7', name: ui.defaults.ivaIntermediate, rate: 7, tax_type: 'IVA', is_active: true, description: ui.defaults.ivaIntermediateDesc },
    { id: '6', code: 'RET3.5', name: ui.defaults.withholding35, rate: 3.5, tax_type: 'RETENCAO', is_active: true, description: ui.defaults.withholdingIncomeDesc },
    { id: '7', code: 'RET6.5', name: ui.defaults.withholding65, rate: 6.5, tax_type: 'RETENCAO', is_active: true, description: ui.defaults.withholdingServicesDesc },
    { id: '8', code: 'IS', name: ui.defaults.stampTax, rate: 0.1, tax_type: 'IS', is_active: true, description: ui.defaults.stampTaxDesc },
  ]), [ui]);

  const [activeTab, setActiveTab] = useState('codes');
  const [taxCodes, setTaxCodes] = useState(defaultTaxCodes);
  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<(typeof defaultTaxCodes)[0] | null>(null);
  const [codeForm, setCodeForm] = useState({ code: '', name: '', rate: 14, tax_type: 'IVA', description: '' });

  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [ivaReport, setIvaReport] = useState<IvaReport>(EMPTY_IVA);
  const [fiscalReport, setFiscalReport] = useState<{ lines: FiscalDocLine[]; totals: FiscalDocLine | null }>({ lines: [], totals: null });
  const [agtReport, setAgtReport] = useState<AgtReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.tax.codes().then((res) => {
      if (res.data?.length) {
        setTaxCodes(res.data.map((row: any) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          rate: Number(row.rate || 0),
          tax_type: row.tax_type || 'IVA',
          is_active: row.is_active !== false,
          description: row.description || '',
        })));
      }
    }).catch(() => { /* keep defaults */ });
  }, []);

  const yearOptions = useMemo(() => {
    const current = now.getFullYear();
    return Array.from({ length: 6 }, (_, i) => current - i);
  }, [now]);

  const monthNames = useMemo(() => (
    Array.from({ length: 12 }, (_, i) => titleCase(new Date(2024, i, 1).toLocaleString(uiLocale, { month: 'long' })))
  ), [uiLocale]);

  const formatMoney = (value: number) => `${value.toLocaleString(uiLocale)} Kz`;

  const loadReports = useCallback(async () => {
    setReportLoading(true);
    try {
      if (activeTab === 'iva') {
        const res = await api.tax.ivaReport(selectedYear, selectedMonth);
        if (res.error) throw new Error(res.error);
        const data = res.data || EMPTY_IVA;
        setIvaReport({
          lines: data.lines || [],
          outputTax: Number(data.outputTax || 0),
          inputTax: Number(data.inputTax || 0),
          ivaPayable: Number(data.ivaPayable || 0),
        });
      } else if (activeTab === 'fiscal') {
        const res = await api.tax.fiscalDocumentsReport(selectedYear, selectedMonth);
        if (res.error) throw new Error(res.error);
        setFiscalReport({
          lines: res.data?.lines || [],
          totals: res.data?.totals ? {
            docType: 'TOTAL',
            documentCount: res.data.totals.documentCount,
            subtotal: res.data.totals.subtotal,
            taxAmount: res.data.totals.taxAmount,
            total: res.data.totals.total,
            agtValidatedCount: res.data.totals.agtValidatedCount,
          } : null,
        });
      } else if (activeTab === 'agt') {
        const res = await api.agt.transmissionsReport(selectedYear, selectedMonth);
        if (res.error) throw new Error(res.error);
        setAgtReport(res.data || null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ui.reportError);
      if (activeTab === 'iva') setIvaReport(EMPTY_IVA);
      if (activeTab === 'fiscal') setFiscalReport({ lines: [], totals: null });
      if (activeTab === 'agt') setAgtReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [activeTab, selectedYear, selectedMonth, ui.reportError]);

  useEffect(() => {
    if (activeTab === 'codes') return;
    void loadReports();
  }, [activeTab, selectedYear, selectedMonth, loadReports]);

  const taxTypeLabels: Record<string, string> = {
    IVA: ui.taxTypes.iva,
    RETENCAO: ui.taxTypes.withholding,
    IS: ui.taxTypes.stampTax,
    OUTRO: ui.taxTypes.other,
  };

  const taxTypeColors: Record<string, string> = {
    IVA: 'default',
    RETENCAO: 'secondary',
    IS: 'outline',
    OUTRO: 'outline',
  };

  const docTypeLabel = (docType: string) => {
    const map: Record<string, string> = {
      FT: ui.docTypeFt,
      FR: ui.docTypeFr,
      FS: ui.docTypeFs,
      NC: ui.docTypeNc,
      ND: ui.docTypeNd,
      GT: ui.docTypeGt,
    };
    return map[docType] || docType;
  };

  const agtTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      invoice: ui.agtTypeInvoice,
      credit_note: ui.agtTypeCreditNote,
      debit_note: ui.agtTypeDebitNote,
      void: ui.agtTypeVoid,
    };
    return map[type] || type;
  };

  const pdfLabels = useMemo((): FiscalReportPdfLabels => ({
    generatedAt: t.reportsUi.generatedAt.replace(
      '{date}',
      new Date().toLocaleString(uiLocale, { dateStyle: 'short', timeStyle: 'short' }),
    ),
    systemName: t.reportsUi.systemName,
    periodLabel: `${monthNames[selectedMonth - 1]} ${selectedYear}`,
    nif: t.reportsUi.nif,
    company: ui.title,
    ivaReturnTitle: ui.ivaReturnTitle,
    outputVatTitle: ui.outputVatTitle,
    inputVatTitle: ui.inputVatTitle,
    colCode: ui.colCode,
    colRateShort: ui.colRateShort,
    colTaxBase: ui.colTaxBase,
    colVat: ui.colVat,
    colDocs: ui.colDocs,
    totalOutputVat: ui.totalOutputVat,
    totalInputVat: ui.totalInputVat,
    netVatPayableTitle: ui.netVatPayableTitle,
    netVatPayableHint: ui.netVatPayableHint,
    fiscalDocsTitle: ui.fiscalDocsTitle,
    colDocType: ui.colDocType,
    colSubtotal: ui.colSubtotal,
    colTax: ui.colTax,
    colTotal: ui.colTotal,
    colAgtValidated: ui.colAgtValidated,
    fiscalDocsTotal: ui.fiscalDocsTotal,
    docTypeFt: ui.docTypeFt,
    docTypeFr: ui.docTypeFr,
    docTypeFs: ui.docTypeFs,
    docTypeNc: ui.docTypeNc,
    docTypeNd: ui.docTypeNd,
    docTypeGt: ui.docTypeGt,
    agtReportTitle: ui.agtReportTitle,
    agtTotalSent: ui.agtTotalSent,
    agtValidated: ui.agtValidated,
    agtFailed: ui.agtFailed,
    agtPending: ui.agtPending,
    agtColTransmissionType: ui.agtColTransmissionType,
    agtColStatus: ui.agtColStatus,
    agtColCount: ui.agtColCount,
    agtTypeInvoice: ui.agtTypeInvoice,
    agtTypeCreditNote: ui.agtTypeCreditNote,
    agtTypeDebitNote: ui.agtTypeDebitNote,
    agtTypeVoid: ui.agtTypeVoid,
    noReportData: ui.noReportData,
  }), [ui, t.reportsUi, monthNames, selectedMonth, selectedYear, uiLocale]);

  const buildCurrentReportHtml = useCallback((): { html: string; kind: FiscalReportKind } | null => {
    if (activeTab === 'iva') {
      const html = buildIvaReportHtml(ivaReport, pdfLabels, uiLocale);
      return html ? { html, kind: 'iva' } : null;
    }
    if (activeTab === 'fiscal') {
      const html = buildFiscalDocsReportHtml(
        { lines: fiscalReport.lines, totals: fiscalReport.totals },
        pdfLabels,
        uiLocale,
      );
      return html ? { html, kind: 'fiscal' } : null;
    }
    if (activeTab === 'agt' && agtReport) {
      const html = buildAgtReportHtml(agtReport, pdfLabels);
      return html ? { html, kind: 'agt' } : null;
    }
    return null;
  }, [activeTab, ivaReport, fiscalReport, agtReport, pdfLabels, uiLocale]);

  const handleSavePdf = async () => {
    const built = buildCurrentReportHtml();
    if (!built) {
      toast.error(ui.noReportData);
      return;
    }
    setExporting(true);
    try {
      const saved = await saveFiscalReportPdf(
        built.html,
        fiscalReportFilename(built.kind, selectedYear, selectedMonth),
      );
      toast.success(saved ? ui.pdfSaved : ui.pdfPrintHint);
    } catch {
      toast.error(ui.pdfFailed);
    } finally {
      setExporting(false);
    }
  };

  const handlePrintReport = async () => {
    const built = buildCurrentReportHtml();
    if (!built) {
      toast.error(ui.noReportData);
      return;
    }
    setExporting(true);
    try {
      await printFiscalReportPdf(built.html);
    } catch {
      toast.error(ui.pdfFailed);
    } finally {
      setExporting(false);
    }
  };

  const periodPicker = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label>{ui.periodYear}</Label>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>{ui.periodMonth}</Label>
        <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {monthNames.map((name, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadReports()} disabled={reportLoading}>
        <RefreshCw className={`w-3.5 h-3.5 ${reportLoading ? 'animate-spin' : ''}`} />
        {ui.refreshReport}
      </Button>
      {activeTab !== 'codes' && (
        <>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handlePrintReport()} disabled={exporting || reportLoading}>
            <Printer className="w-3.5 h-3.5" />
            {ui.printReport}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleSavePdf()} disabled={exporting || reportLoading}>
            <Download className="w-3.5 h-3.5" />
            {ui.savePdf}
          </Button>
        </>
      )}
      <Badge variant="outline">{monthNames[selectedMonth - 1]} {selectedYear}</Badge>
    </div>
  );

  const outputLines = ivaReport.lines.filter((l) => l.direction === 'output');
  const inputLines = ivaReport.lines.filter((l) => l.direction === 'input');

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              {ui.title}
            </h1>
            <p className="text-sm text-muted-foreground">{ui.subtitle}</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2 flex-wrap h-auto">
          <TabsTrigger value="codes" className="gap-1.5">
            <FileText className="w-4 h-4" /> {ui.tabTaxCodes}
          </TabsTrigger>
          <TabsTrigger value="iva" className="gap-1.5">
            <Receipt className="w-4 h-4" /> {ui.tabIvaReturn}
          </TabsTrigger>
          <TabsTrigger value="fiscal" className="gap-1.5">
            <FileBarChart className="w-4 h-4" /> {ui.tabFiscalDocs}
          </TabsTrigger>
          <TabsTrigger value="agt" className="gap-1.5">
            <Radio className="w-4 h-4" /> {ui.tabAgtReport}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="codes" className="flex-1 p-4 overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{ui.tabTaxCodes}</CardTitle>
                <Button size="sm" className="gap-1.5" onClick={() => {
                  setEditingCode(null);
                  setCodeForm({ code: '', name: '', rate: 14, tax_type: 'IVA', description: '' });
                  setCodeDialogOpen(true);
                }}>
                  <Plus className="w-3.5 h-3.5" /> {ui.newCode}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">{ui.colCode}</TableHead>
                    <TableHead>{t.common.name}</TableHead>
                    <TableHead className="w-20 text-right">{ui.colRate}</TableHead>
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
                        <Badge variant={taxTypeColors[code.tax_type] as 'default' | 'secondary' | 'outline'}>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setEditingCode(code);
                          setCodeForm({
                            code: code.code,
                            name: code.name,
                            rate: code.rate,
                            tax_type: code.tax_type,
                            description: code.description,
                          });
                          setCodeDialogOpen(true);
                        }}>
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

        <TabsContent value="iva" className="flex-1 p-4 overflow-auto space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{ui.ivaReturnTitle}</h2>
            {periodPicker}
          </div>

          {reportLoading ? (
            <p className="text-sm text-muted-foreground">{ui.loadingReport}</p>
          ) : outputLines.length === 0 && inputLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.noReportData}</p>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">{ui.outputVatTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{ui.colCode}</TableHead>
                        <TableHead className="text-right">{ui.colRateShort}</TableHead>
                        <TableHead className="text-right">{ui.colTaxBase}</TableHead>
                        <TableHead className="text-right">{ui.colVat}</TableHead>
                        <TableHead className="text-right">{ui.colDocs}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outputLines.map((line, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{line.tax_code}</TableCell>
                          <TableCell className="text-right">{line.tax_rate}%</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(Number(line.total_base))}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatMoney(Number(line.total_tax))}</TableCell>
                          <TableCell className="text-right">{line.document_count}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={3}>{ui.totalOutputVat}</TableCell>
                        <TableCell className="text-right font-mono text-primary">{formatMoney(ivaReport.outputTax)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">{ui.inputVatTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{ui.colCode}</TableHead>
                        <TableHead className="text-right">{ui.colRateShort}</TableHead>
                        <TableHead className="text-right">{ui.colTaxBase}</TableHead>
                        <TableHead className="text-right">{ui.colVat}</TableHead>
                        <TableHead className="text-right">{ui.colDocs}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inputLines.map((line, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{line.tax_code}</TableCell>
                          <TableCell className="text-right">{line.tax_rate}%</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(Number(line.total_base))}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatMoney(Number(line.total_tax))}</TableCell>
                          <TableCell className="text-right">{line.document_count}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={3}>{ui.totalInputVat}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{formatMoney(ivaReport.inputTax)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="border-primary/30">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{ui.netVatPayableTitle}</p>
                      <p className="text-xs text-muted-foreground">{ui.netVatPayableHint}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">{formatMoney(ivaReport.ivaPayable)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(ivaReport.outputTax)} - {formatMoney(ivaReport.inputTax)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="fiscal" className="flex-1 p-4 overflow-auto space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{ui.fiscalDocsTitle}</h2>
              <p className="text-sm text-muted-foreground">{ui.fiscalDocsHint}</p>
            </div>
            {periodPicker}
          </div>

          {reportLoading ? (
            <p className="text-sm text-muted-foreground">{ui.loadingReport}</p>
          ) : fiscalReport.lines.every((l) => l.documentCount === 0) ? (
            <p className="text-sm text-muted-foreground">{ui.noReportData}</p>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ui.colDocType}</TableHead>
                      <TableHead className="text-right">{ui.colDocs}</TableHead>
                      <TableHead className="text-right">{ui.colSubtotal}</TableHead>
                      <TableHead className="text-right">{ui.colTax}</TableHead>
                      <TableHead className="text-right">{ui.colTotal}</TableHead>
                      <TableHead className="text-right">{ui.colAgtValidated}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fiscalReport.lines.map((line) => (
                      <TableRow key={line.docType}>
                        <TableCell className="font-medium">{docTypeLabel(line.docType)}</TableCell>
                        <TableCell className="text-right">{line.documentCount}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(line.subtotal)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(line.taxAmount)}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{formatMoney(line.total)}</TableCell>
                        <TableCell className="text-right">{line.agtValidatedCount}</TableCell>
                      </TableRow>
                    ))}
                    {fiscalReport.totals && (
                      <TableRow className="font-bold border-t-2">
                        <TableCell>{ui.fiscalDocsTotal}</TableCell>
                        <TableCell className="text-right">{fiscalReport.totals.documentCount}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(fiscalReport.totals.subtotal)}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(fiscalReport.totals.taxAmount)}</TableCell>
                        <TableCell className="text-right font-mono text-primary">{formatMoney(fiscalReport.totals.total)}</TableCell>
                        <TableCell className="text-right">{fiscalReport.totals.agtValidatedCount}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="agt" className="flex-1 p-4 overflow-auto space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{ui.agtReportTitle}</h2>
              <p className="text-sm text-muted-foreground">{ui.agtReportHint}</p>
            </div>
            {periodPicker}
          </div>

          {reportLoading ? (
            <p className="text-sm text-muted-foreground">{ui.loadingReport}</p>
          ) : !agtReport || agtReport.summary.total === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.noReportData}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{ui.agtTotalSent}</p><p className="text-2xl font-bold">{agtReport.summary.total}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{ui.agtValidated}</p><p className="text-2xl font-bold text-green-600">{agtReport.summary.validated}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{ui.agtFailed}</p><p className="text-2xl font-bold text-destructive">{agtReport.summary.failed}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{ui.agtPending}</p><p className="text-2xl font-bold">{agtReport.summary.pending}</p></CardContent></Card>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{ui.agtColTransmissionType}</TableHead>
                        <TableHead>{ui.agtColStatus}</TableHead>
                        <TableHead className="text-right">{ui.agtColCount}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agtReport.byTypeStatus.map((row, i) => (
                        <TableRow key={`${row.transmission_type}-${row.agt_status}-${i}`}>
                          <TableCell>{agtTypeLabel(row.transmission_type)}</TableCell>
                          <TableCell><Badge variant="outline">{row.agt_status}</Badge></TableCell>
                          <TableCell className="text-right font-mono">{row.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={codeDialogOpen} onOpenChange={setCodeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCode ? t.common.edit : ui.newCode}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{ui.colCode}</Label>
              <Input value={codeForm.code} onChange={(e) => setCodeForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{t.common.name}</Label>
              <Input value={codeForm.name} onChange={(e) => setCodeForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>{ui.colRate}</Label>
              <Input type="number" value={codeForm.rate} onChange={(e) => setCodeForm((f) => ({ ...f, rate: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1">
              <Label>{t.common.description}</Label>
              <Input value={codeForm.description} onChange={(e) => setCodeForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodeDialogOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={async () => {
              try {
                if (editingCode) {
                  await api.tax.updateCode(editingCode.id, codeForm);
                  setTaxCodes((prev) => prev.map((c) => c.id === editingCode.id ? { ...c, ...codeForm } : c));
                } else {
                  const res = await api.tax.createCode({ ...codeForm, is_active: true });
                  if (res.data) {
                    setTaxCodes((prev) => [...prev, { id: res.data.id, ...codeForm, is_active: true }]);
                  }
                }
                setCodeDialogOpen(false);
                toast.success(t.common.saveChanges);
              } catch {
                toast.error(t.common.error);
              }
            }}>{t.common.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
