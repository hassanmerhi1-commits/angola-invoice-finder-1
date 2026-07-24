import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useAuth } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import { generateId } from '@/lib/utils';
import { SalesOrder } from '@/lib/salesOrderToDocument';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, RefreshCw, CheckCircle, Package, ArrowRight } from 'lucide-react';

function generateOrderNumber(branchCode: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Date.now().toString().slice(-4);
  return `SO ${branchCode}/${dateStr}/${seq}`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'confirmed':
    case 'reserved':
      return 'default';
    case 'converted':
      return 'outline';
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export default function SalesOrdersPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { currentBranch, apiBranchId } = useBranchScope();
  const { user } = useAuth();
  const branchId = apiBranchId || currentBranch?.id;

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.salesOrders.list(branchId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setOrders(Array.isArray(res.data) ? res.data : []);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const formatMoney = (value: number) =>
    `${value.toLocaleString(uiLocale, { minimumFractionDigits: 2 })} ${t.common.currency}`;

  const formatDate = (value?: string) =>
    value ? new Date(value).toLocaleDateString(uiLocale) : '—';

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'cancelled'),
    [orders],
  );

  const handleCreateDraft = async () => {
    const name = customerName.trim();
    if (!name) {
      toast.error(language === 'pt' ? 'Indique o cliente' : 'Enter customer name');
      return;
    }
    if (!branchId) {
      toast.error(language === 'pt' ? 'Selecione uma filial' : 'Select a branch');
      return;
    }
    setCreating(true);
    try {
      const branchCode = currentBranch?.code || '01';
      const payload: SalesOrder = {
        id: generateId(),
        orderNumber: generateOrderNumber(branchCode),
        branchId,
        branchName: currentBranch?.name || '',
        customerName: name,
        clientId: '',
        items: [],
        subtotal: 0,
        taxAmount: 0,
        discount: 0,
        total: 0,
        currency: 'AOA',
        status: 'draft',
        createdBy: user?.id || '',
        createdByName: user?.name || '',
      };
      const res = await api.salesOrders.create(payload);
      if (res.error || !res.data) {
        toast.error(res.error || (language === 'pt' ? 'Falha ao criar encomenda' : 'Failed to create order'));
        return;
      }
      toast.success(language === 'pt' ? 'Encomenda criada' : 'Order created');
      setCustomerName('');
      await loadOrders();
    } finally {
      setCreating(false);
    }
  };

  const runAction = async (
    id: string,
    action: 'confirm' | 'reserve' | 'convert',
  ) => {
    const fn =
      action === 'confirm'
        ? api.salesOrders.confirm
        : action === 'reserve'
          ? api.salesOrders.reserve
          : api.salesOrders.convert;
    const res = await fn(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (action === 'convert' && res.data?.order) {
      toast.success(language === 'pt' ? 'Encomenda convertida — abrir fatura' : 'Order converted — opening invoice');
      navigate('/invoices', { state: { fromSalesOrder: res.data.order } });
      return;
    }
    toast.success(
      action === 'confirm'
        ? language === 'pt'
          ? 'Encomenda confirmada'
          : 'Order confirmed'
        : language === 'pt'
          ? 'Stock reservado'
          : 'Stock reserved',
    );
    await loadOrders();
  };

  const title = t.nav.salesOrders;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <Button variant="outline" size="sm" onClick={() => void loadOrders()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {t.common.refresh}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {language === 'pt' ? 'Nova encomenda (rascunho)' : 'New draft order'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label htmlFor="so-customer">{language === 'pt' ? 'Cliente' : 'Customer'}</Label>
            <Input
              id="so-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder={language === 'pt' ? 'Nome do cliente' : 'Customer name'}
            />
          </div>
          <Button onClick={() => void handleCreateDraft()} disabled={creating}>
            <Plus className="w-4 h-4 mr-2" />
            {language === 'pt' ? 'Criar rascunho' : 'Create draft'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'pt' ? 'N.º' : 'Number'}</TableHead>
                <TableHead>{language === 'pt' ? 'Cliente' : 'Customer'}</TableHead>
                <TableHead>{language === 'pt' ? 'Data' : 'Date'}</TableHead>
                <TableHead className="text-right">{language === 'pt' ? 'Total' : 'Total'}</TableHead>
                <TableHead>{language === 'pt' ? 'Estado' : 'Status'}</TableHead>
                <TableHead className="text-right">{language === 'pt' ? 'Acções' : 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {language === 'pt' ? 'Sem encomendas' : 'No orders yet'}
                  </TableCell>
                </TableRow>
              ) : (
                activeOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.orderNumber}</TableCell>
                    <TableCell>{order.customerName}</TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-right">{formatMoney(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {order.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runAction(order.id, 'confirm')}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Confirmar' : 'Confirm'}
                        </Button>
                      )}
                      {['draft', 'confirmed'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runAction(order.id, 'reserve')}
                        >
                          <Package className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Reservar' : 'Reserve'}
                        </Button>
                      )}
                      {['confirmed', 'reserved'].includes(order.status) && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => void runAction(order.id, 'convert')}
                        >
                          <ArrowRight className="w-3 h-3 mr-1" />
                          {language === 'pt' ? 'Converter' : 'Convert'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
