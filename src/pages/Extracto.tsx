// NEXOR ERP - Extracto (Account Statement)
// Shows all documents linked to a customer/supplier with running balance

import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { useBranchScope } from '@/hooks/useBranchScope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import {
  Search, RefreshCw, FileText, Download, Printer,
  TrendingUp, TrendingDown, ArrowRight, User, Building2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDocuments, getSalesInvoicesAsDocuments } from '@/lib/documentStorage';
import { DOCUMENT_TYPE_CONFIG, ERPDocument } from '@/types/documents';
import { exportToExcel } from '@/lib/excel';
import { toast } from 'sonner';

interface EntitySummary {
  name: string;
  nif: string;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  documentCount: number;
  lastActivity: string;
}

function entitySide(doc: ERPDocument): 'customer' | 'supplier' {
  if (doc.entityType === 'customer' || doc.entityType === 'supplier') return doc.entityType;
  return DOCUMENT_TYPE_CONFIG[doc.documentType]?.entityType === 'supplier' ? 'supplier' : 'customer';
}

/** Running balance: debits increase what they owe us / we owe them; credits decrease it. */
/** Legacy purchase returns were saved as supplier nota_debito — treat as credit on statements. */
function isLegacySupplierPurchaseReturn(doc: ERPDocument): boolean {
  return (
    doc.documentType === 'nota_debito' &&
    (doc.entityType === 'supplier' || doc.parentDocumentType === 'fatura_compra')
  );
}

function isStatementDebit(doc: ERPDocument, isCustomer: boolean): boolean {
  if (isLegacySupplierPurchaseReturn(doc)) return false;
  if (isCustomer) {
    return ['fatura_venda', 'nota_debito'].includes(doc.documentType);
  }
  return doc.documentType === 'fatura_compra';
}

function isStatementCredit(doc: ERPDocument, isCustomer: boolean): boolean {
  if (isLegacySupplierPurchaseReturn(doc)) return true;
  if (isCustomer) {
    return ['recibo', 'nota_credito'].includes(doc.documentType);
  }
  return ['pagamento', 'nota_credito'].includes(doc.documentType);
}

export default function Extracto() {
  const { t } = useTranslation();
  const { listBranchId, isHeadOffice, branches } = useBranchScope();
  const [activeTab, setActiveTab] = useState('clientes');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [allDocs, setAllDocs] = useState<ERPDocument[]>([]);

  useEffect(() => {
    const branchNames = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    Promise.all([
      getDocuments(undefined, listBranchId),
      getSalesInvoicesAsDocuments(listBranchId, branchNames, isHeadOffice),
    ]).then(([docs, salesDocs]) => {
      const seen = new Set(docs.map((d) => d.documentNumber));
      const merged = [...docs];
      for (const doc of salesDocs) {
        if (doc.documentNumber && !seen.has(doc.documentNumber)) merged.push(doc);
      }
      setAllDocs(merged);
    });
  }, [listBranchId, isHeadOffice, branches, refreshKey]);

  // Group documents by entity
  const entitySummaries = useMemo(() => {
    const isCustomer = activeTab === 'clientes';
    const relevantDocs = allDocs.filter(d => entitySide(d) === (isCustomer ? 'customer' : 'supplier'));

    const grouped = new Map<string, EntitySummary>();
    relevantDocs.forEach(doc => {
      const key = doc.entityNif || doc.entityName;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: doc.entityName,
          nif: doc.entityNif || '',
          totalInvoiced: 0,
          totalPaid: 0,
          balance: 0,
          documentCount: 0,
          lastActivity: doc.issueDate,
        });
      }
      const s = grouped.get(key)!;
      s.documentCount++;
      if (doc.issueDate > s.lastActivity) s.lastActivity = doc.issueDate;

      if (isStatementDebit(doc, isCustomer)) {
        s.totalInvoiced += doc.total;
      }
      if (isStatementCredit(doc, isCustomer)) {
        s.totalPaid += doc.total;
      }
      s.balance = s.totalInvoiced - s.totalPaid;
    });

    return Array.from(grouped.values())
      .filter(s => !searchTerm || s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.nif.includes(searchTerm))
      .sort((a, b) => b.balance - a.balance);
  }, [allDocs, activeTab, searchTerm]);

  // Documents for selected entity
  const entityDocuments = useMemo(() => {
    if (!selectedEntity) return [];
    return allDocs
      .filter(d => (d.entityNif || d.entityName) === selectedEntity)
      .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());
  }, [allDocs, selectedEntity]);

  // Running balance for statement
  const statementLines = useMemo(() => {
    let running = 0;
    return entityDocuments.map(doc => {
      const isDebit = isStatementDebit(doc, activeTab === 'clientes');
      const amount = doc.total;
      running += isDebit ? amount : -amount;
      return { doc, debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount, running };
    });
  }, [entityDocuments]);

  const totals = useMemo(() => entitySummaries.reduce((a, s) => ({
    invoiced: a.invoiced + s.totalInvoiced,
    paid: a.paid + s.totalPaid,
    balance: a.balance + s.balance,
  }), { invoiced: 0, paid: 0, balance: 0 }), [entitySummaries]);

  const selectedSummary = entitySummaries.find(s => (s.nif || s.name) === selectedEntity);

  const handlePrintStatement = () => {
    if (!selectedSummary || !statementLines.length) return;
    const html = `<html><head><title>Extracto — ${selectedSummary.name}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f5f5f5}.right{text-align:right}</style>
      </head><body><h2>Extracto — ${selectedSummary.name}</h2><p>NIF: ${selectedSummary.nif || '-'}</p>
      <table><thead><tr><th>Data</th><th>Documento</th><th class="right">Débito</th><th class="right">Crédito</th><th class="right">Saldo</th></tr></thead><tbody>
      ${statementLines.map(({ doc, debit, credit, running }) =>
        `<tr><td>${doc.issueDate}</td><td>${doc.documentNumber}</td><td class="right">${debit ? debit.toLocaleString('pt-AO') : ''}</td><td class="right">${credit ? credit.toLocaleString('pt-AO') : ''}</td><td class="right">${running.toLocaleString('pt-AO')}</td></tr>`
      ).join('')}
      </tbody></table></body></html>`;
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Popup bloqueado — permita popups para imprimir.');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const handleExportExcel = () => {
    if (!selectedSummary || !statementLines.length) return;
    exportToExcel(
      statementLines.map(({ doc, debit, credit, running }) => ({
        Data: doc.issueDate,
        Documento: doc.documentNumber,
        Tipo: doc.documentType,
        Debito: debit,
        Credito: credit,
        Saldo: running,
      })),
      `Extracto_${selectedSummary.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`,
    );
    toast.success('Extracto exportado para Excel.');
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedEntity} onClick={handlePrintStatement}>
          <Printer className="w-3 h-3" /> Imprimir Extracto
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!selectedEntity} onClick={handleExportExcel}>
          <Download className="w-3 h-3" /> Excel
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setRefreshKey(k => k + 1)}>
          <RefreshCw className="w-3 h-3" />
        </Button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input placeholder="Pesquisar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-7 text-xs pl-7 w-48" />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); setSelectedEntity(null); }}>
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 h-auto p-0">
          <TabsTrigger value="clientes" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5 gap-1">
            <User className="w-3 h-3" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="fornecedores" className="text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-1.5 gap-1">
            <Building2 className="w-3 h-3" /> Fornecedores
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Split view: entity list + statement */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Entity list */}
        <div className="w-96 border-r overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 border-b sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">Nome</th>
                <th className="px-3 py-1.5 text-left font-semibold w-24">NIF</th>
                <th className="px-3 py-1.5 text-right font-semibold w-28">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {entitySummaries.map(s => {
                const key = s.nif || s.name;
                return (
                  <tr key={key} className={cn("cursor-pointer hover:bg-accent/50", selectedEntity === key && "nexor-row-selected")}
                    onClick={() => setSelectedEntity(key)}>
                    <td className="px-3 py-1.5 font-medium">{s.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{s.nif || '-'}</td>
                    <td className={cn("px-3 py-1.5 text-right font-mono font-medium", s.balance > 0 ? "text-destructive" : "text-green-600")}>
                      {s.balance.toLocaleString('pt-AO')} Kz
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/80 border-t-2">
              <tr className="font-bold text-xs">
                <td className="px-3 py-2" colSpan={2}>TOTAL ({entitySummaries.length})</td>
                <td className={cn("px-3 py-2 text-right font-mono", totals.balance > 0 ? "text-destructive" : "text-green-600")}>
                  {totals.balance.toLocaleString('pt-AO')} Kz
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Right: Statement */}
        <div className="flex-1 overflow-auto">
          {!selectedEntity ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Seleccione um {activeTab === 'clientes' ? 'cliente' : 'fornecedor'}</p>
                <p className="text-xs mt-1">para ver o extracto</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Entity header */}
              {selectedSummary && (
                <div className="px-4 py-2 bg-muted/30 border-b flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm">{selectedSummary.name}</h3>
                    <p className="text-xs text-muted-foreground">NIF: {selectedSummary.nif || 'N/A'} • {selectedSummary.documentCount} documentos</p>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <div className="text-center">
                      <div className="text-muted-foreground">Facturado</div>
                      <div className="font-mono font-bold">{selectedSummary.totalInvoiced.toLocaleString('pt-AO')} Kz</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">Pago</div>
                      <div className="font-mono font-bold text-green-600">{selectedSummary.totalPaid.toLocaleString('pt-AO')} Kz</div>
                    </div>
                    <div className="text-center">
                      <div className="text-muted-foreground">Saldo</div>
                      <div className={cn("font-mono font-bold", selectedSummary.balance > 0 ? "text-destructive" : "text-green-600")}>
                        {selectedSummary.balance.toLocaleString('pt-AO')} Kz
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Statement grid */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-semibold w-24">Data</th>
                      <th className="px-3 py-1.5 text-left font-semibold w-14">Tipo</th>
                      <th className="px-3 py-1.5 text-left font-semibold w-40">Nº Documento</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Descrição</th>
                      <th className="px-3 py-1.5 text-right font-semibold w-28">Débito</th>
                      <th className="px-3 py-1.5 text-right font-semibold w-28">Crédito</th>
                      <th className="px-3 py-1.5 text-right font-semibold w-28">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {statementLines.map(({ doc, debit, credit, running }) => {
                      const cfg = DOCUMENT_TYPE_CONFIG[doc.documentType];
                      return (
                        <tr key={doc.id} className="hover:bg-accent/30">
                          <td className="px-3 py-1.5 text-muted-foreground">{new Date(doc.issueDate).toLocaleDateString('pt-AO')}</td>
                          <td className={cn("px-3 py-1.5 font-medium", cfg.color)}>{cfg.prefix}</td>
                          <td className="px-3 py-1.5 font-mono">{doc.documentNumber}</td>
                          <td className="px-3 py-1.5">{doc.lines.length > 0 ? `${doc.lines.length} linhas` : '-'}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{debit > 0 ? debit.toLocaleString('pt-AO') : ''}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-green-600">{credit > 0 ? credit.toLocaleString('pt-AO') : ''}</td>
                          <td className={cn("px-3 py-1.5 text-right font-mono font-medium", running > 0 ? "text-destructive" : "text-green-600")}>
                            {running.toLocaleString('pt-AO')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {statementLines.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">Sem movimentos</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
