import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { useProForma } from '@/hooks/useProForma';
import { ProForma } from '@/types/proforma';
import { printProFormaA4 } from '@/lib/proformaA4';
import { recordProformaPrint } from '@/lib/recordPrintAudit';
import { proformaToErpDocumentPrefill } from '@/lib/proformaToDocument';
import { ProFormaCreateDialog } from '@/components/proforma/ProFormaCreateDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
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
  const { currentBranch, apiBranchId } = useBranchScope();
  const { user } = useAuth();
  const branchId = apiBranchId || currentBranch?.id;
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const {
    proformas,
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
  const [stats, setStats] = useState({ total: 0, draft: 0, sent: 0, accepted: 0, converted: 0, expired: 0, totalValue: 0, pendingValue: 0 });

  useEffect(() => {
    getStats().then(setStats);
  }, [proformas, getStats]);

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

  const openSalesInvoiceFromProforma = (proforma: ProForma) => {
    navigate('/invoices', {
      state: { prefillFromProforma: proformaToErpDocumentPrefill(proforma) },
    });
  };

  const filteredProformas = useMemo(() => {
    return proformas.filter((pf) => {
      const matchesSearch =
        pf.documentNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pf.customerName.toLowerCase().includes(searchTerm.toLowerCase());
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
    const { variant, icon: Icon } = variants[status];
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
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-20" />
                    <p>{p.emptyList}</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProformas.map((proforma) => (
                  <TableRow key={proforma.id}>
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

      {/* View Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{p.viewTitle}</DialogTitle>
          </DialogHeader>
          
          {selectedProforma && (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold">{selectedProforma.documentNumber}</h3>
                  <p className="text-muted-foreground">{formatDate(selectedProforma.createdAt)}</p>
                </div>
                {getStatusBadge(selectedProforma.status)}
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <h4 className="font-medium mb-1">{p.customerSection}</h4>
                  <p>{selectedProforma.customerName}</p>
                  {selectedProforma.customerNif && <p className="text-sm text-muted-foreground">NIF: {selectedProforma.customerNif}</p>}
                </div>
                <div>
                  <h4 className="font-medium mb-1">{p.validitySection}</h4>
                  <p>{formatDate(selectedProforma.validUntil)}</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{p.colProduct}</TableHead>
                    <TableHead className="text-right">{p.colQty}</TableHead>
                    <TableHead className="text-right">{p.colPrice}</TableHead>
                    <TableHead className="text-right">{t.common.total}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedProforma.items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.unitPrice)}</TableCell>
                      <TableCell className="text-right">{formatMoney(item.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between">
                    <span>{t.common.subtotal}:</span>
                    <span>{formatMoney(selectedProforma.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{p.vat}:</span>
                    <span>{formatMoney(selectedProforma.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>Total:</span>
                    <span>{formatMoney(selectedProforma.total)}</span>
                  </div>
                </div>
              </div>

              {selectedProforma.convertedToInvoiceNumber && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-700">
                    ✓ {p.convertedToInvoice.replace('{number}', selectedProforma.convertedToInvoiceNumber)}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>
              {t.common.close}
            </Button>
            {selectedProforma && (
              <>
                <Button variant="outline" onClick={() => handlePrint(selectedProforma)}>
                  <Printer className="h-4 w-4 mr-2" />
                  {p.print}
                </Button>
                {['draft', 'sent', 'accepted'].includes(selectedProforma.status) && (
                  <Button onClick={() => {
                    setShowViewDialog(false);
                    openSalesInvoiceFromProforma(selectedProforma);
                  }}>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    {p.convertToInvoice}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
