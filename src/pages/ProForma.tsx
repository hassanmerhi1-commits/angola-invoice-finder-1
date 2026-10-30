import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { useProForma } from '@/hooks/useProForma';
import { ProForma } from '@/types/proforma';
import { generateProFormaA4HTML, printProFormaA4 } from '@/lib/proformaA4';
import { recordProformaPrint } from '@/lib/recordPrintAudit';
import { proformaToErpDocumentPrefill } from '@/lib/proformaToDocument';
import { ProFormaCreateDialog } from '@/components/proforma/ProFormaCreateDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ListLoadState } from '@/components/ListLoadState';
import { cn } from '@/lib/utils';
import { readFocusId, scrollToNexorRow } from '@/lib/searchFocus';
import {
  Plus,
  FileText,
  Printer,
  Eye,
  Copy,
  ArrowRight,
  Trash2,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Send,
  RefreshCw,
} from 'lucide-react';

export default function ProFormaPage() {
  const { t, language } = useTranslation();
  const p = t.proFormaUi;
  const navigate = useNavigate();
  const location = useLocation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { currentBranch, apiBranchId, isHeadOffice } = useBranchScope();
  const { user } = useAuth();
  // Head office Invoices was loading every branch. This page must do the same,
  // otherwise old drafts only appear on Invoices.
  const branchId = isHeadOffice ? undefined : (apiBranchId || currentBranch?.id);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const {
    proformas,
    isLoading,
    loadError,
    refresh,
    updateProFormaStatus,
    duplicateProForma,
    deleteProForma,
    getStats,
  } = useProForma(branchId);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedProforma, setSelectedProforma] = useState<ProForma | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [stats, setStats] = useState({ total: 0, draft: 0, sent: 0, accepted: 0, converted: 0, expired: 0, totalValue: 0, pendingValue: 0 });

  useEffect(() => {
    getStats().then(setStats);
  }, [proformas, getStats]);

  useEffect(() => {
    if (!showViewDialog || !selectedProforma) {
      setPreviewHtml('');
      return;
    }
    let cancelled = false;
    const branch = currentBranch || {
      id: selectedProforma.branchId,
      name: selectedProforma.branchName,
      code: '',
      address: '',
      phone: '',
      isMain: false,
      priceLevel: 1,
      createdAt: '',
    };
    void generateProFormaA4HTML(selectedProforma, branch, language).then((html) => {
      if (!cancelled) setPreviewHtml(html);
    });
    return () => { cancelled = true; };
  }, [showViewDialog, selectedProforma, currentBranch, language]);

  useEffect(() => {
    const onNew = () => setShowCreateDialog(true);
    window.addEventListener('nexor:proforma-new', onNew);
    return () => window.removeEventListener('nexor:proforma-new', onNew);
  }, []);

  useEffect(() => {
    const st = location.state as { openProformaCreate?: boolean } | null;
    if (!st?.openProformaCreate) return;
    setShowCreateDialog(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const searchFocusKeyRef = useRef('');
  useEffect(() => {
    const proformaId = readFocusId(location, 'proformaId', 'proforma', 'proformaId');
    if (!proformaId) return;
    const hit = proformas.find((p) => p.id === proformaId);
    if (!hit) return;
    if (searchFocusKeyRef.current === proformaId) {
      scrollToNexorRow(hit.id);
      return;
    }
    searchFocusKeyRef.current = proformaId;
    setStatusFilter('all');
    setSearchTerm(hit.documentNumber || '');
    setSelectedProforma(hit);
    setShowViewDialog(true);
    scrollToNexorRow(hit.id);
  }, [proformas, location.search, location.hash, location.state]);

  const openSalesInvoiceFromProforma = (proforma: ProForma) => {
    navigate('/invoices', {
      state: { prefillFromProforma: proformaToErpDocumentPrefill(proforma) },
    });
  };

  const filteredProformas = useMemo(() => {
    return proformas.filter((pf) => {
      const matchesSearch =
        String(pf.documentNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(pf.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || pf.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [proformas, searchTerm, statusFilter]);

  const formatMoney = (value: number) =>
    `${value.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} ${t.common.currency}`;

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString(uiLocale);

  const getStatusBadge = (status: ProForma['status']) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof Clock }> = {
      draft: { variant: 'secondary', icon: Clock },
      sent: { variant: 'default', icon: Send },
      accepted: { variant: 'default', icon: CheckCircle },
      rejected: { variant: 'destructive', icon: XCircle },
      converted: { variant: 'outline', icon: ArrowRight },
      expired: { variant: 'destructive', icon: Clock },
    };
    const labels: Record<ProForma['status'], string> = {
      draft: p.statusDraft,
      sent: p.statusSent,
      accepted: p.statusAccepted,
      rejected: p.statusRejected,
      converted: p.statusConverted,
      expired: p.statusExpired,
    };
    const { variant, icon: Icon } = variants[status] || variants.draft;
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {labels[status]}
      </Badge>
    );
  };

  const handlePrint = async (proforma: ProForma) => {
    if (!currentBranch) return;
    try {
      await printProFormaA4(proforma, currentBranch, language);
      void recordProformaPrint(proforma, { format: 'a4', source: 'proforma' });
      toast.success(p.sentToPrint);
    } catch {
      toast.error(p.printError);
    }
  };

  const handleDuplicate = async (proforma: ProForma) => {
    if (!currentBranch || !user) return;
    const newProforma = await duplicateProForma(proforma.id, currentBranch.code, user.name);
    if (newProforma) {
      toast.success(p.duplicatedSuccess.replace('{number}', newProforma.documentNumber));
    }
  };

  const handleDelete = (proforma: ProForma) => {
    if (proforma.status === 'converted') {
      toast.error(p.cannotDeleteConverted);
      return;
    }
    if (confirm(p.deleteConfirm)) {
      deleteProForma(proforma.id);
      toast.success(p.deletedSuccess);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">{p.pageTitle}</h1>
          <p className="text-muted-foreground">{p.pageSubtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t.common.refresh}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {p.newProForma}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">{p.statTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600">{stats.draft}</div>
            <p className="text-xs text-muted-foreground">{p.statDrafts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
            <p className="text-xs text-muted-foreground">{p.statSent}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-600">{stats.accepted}</div>
            <p className="text-xs text-muted-foreground">{p.statAccepted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-600">{stats.converted}</div>
            <p className="text-xs text-muted-foreground">{p.statConverted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{formatMoney(stats.pendingValue)}</div>
            <p className="text-xs text-muted-foreground">{p.statPendingValue}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={p.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={p.filterByStatus} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{p.filterAll}</SelectItem>
            <SelectItem value="draft">{p.statusDraft}</SelectItem>
            <SelectItem value="sent">{p.statusSent}</SelectItem>
            <SelectItem value="accepted">{p.statusAccepted}</SelectItem>
            <SelectItem value="converted">{p.statusConverted}</SelectItem>
            <SelectItem value="expired">{p.statusExpired}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Pro Formas Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{p.colDocument}</TableHead>
                <TableHead>{p.colCustomer}</TableHead>
                <TableHead>{p.colDate}</TableHead>
                <TableHead>{p.colValidity}</TableHead>
                <TableHead className="text-right">{t.common.total}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead className="text-right">{p.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProformas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <ListLoadState loading={isLoading} error={loadError} onRetry={() => void refresh()}>
                      <div className="text-center py-8 text-muted-foreground">
                        <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
                        <p>{p.emptyList}</p>
                      </div>
                    </ListLoadState>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProformas.map((proforma) => (
                  <TableRow
                    key={proforma.id}
                    data-nexor-id={proforma.id}
                    className={cn(selectedProforma?.id === proforma.id && 'nexor-row-selected')}
                  >
                    <TableCell className="font-medium">{proforma.documentNumber}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{proforma.customerName}</div>
                        {proforma.customerNif && (
                          <div className="text-xs text-muted-foreground">NIF: {proforma.customerNif}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(proforma.createdAt)}</TableCell>
                    <TableCell>{formatDate(proforma.validUntil)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(proforma.total)}</TableCell>
                    <TableCell>{getStatusBadge(proforma.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setSelectedProforma(proforma);
                            setShowViewDialog(true);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePrint(proforma)}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDuplicate(proforma)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {['draft', 'sent', 'accepted'].includes(proforma.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openSalesInvoiceFromProforma(proforma)}
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        )}
                        {proforma.status !== 'converted' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(proforma)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProFormaCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={() => { void refresh(); }}
      />

      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-[940px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3">
            <DialogTitle className="text-base">{p.viewTitle}</DialogTitle>
            <div className="flex items-center gap-2 pr-6">
              {selectedProforma && getStatusBadge(selectedProforma.status)}
              {selectedProforma && (
                <Button variant="outline" size="sm" onClick={() => handlePrint(selectedProforma)}>
                  <Printer className="h-4 w-4 mr-2" />
                  {p.print}
                </Button>
              )}
              {selectedProforma && ['draft', 'sent', 'accepted'].includes(selectedProforma.status) && (
                <Button size="sm" onClick={() => {
                  setShowViewDialog(false);
                  openSalesInvoiceFromProforma(selectedProforma);
                }}>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  {p.convertToInvoice}
                </Button>
              )}
            </div>
          </DialogHeader>
          {selectedProforma?.convertedToInvoiceNumber && (
            <div className="border-b bg-green-50 px-4 py-2 text-sm text-green-800">
              {p.convertedToInvoice.replace('{number}', selectedProforma.convertedToInvoiceNumber)}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto bg-neutral-200 p-4">
            {previewHtml ? (
              <iframe
                title={selectedProforma?.documentNumber || p.viewTitle}
                srcDoc={previewHtml}
                className="mx-auto block border-0 bg-white shadow"
                style={{ width: '210mm', height: '297mm' }}
              />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">{t.common.loading}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
