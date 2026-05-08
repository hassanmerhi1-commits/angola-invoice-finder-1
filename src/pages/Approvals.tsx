import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  GitBranch, CheckCircle, XCircle, Clock, User, MessageSquare, ArrowRight, Settings
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/i18n';

const STATUS_CONFIG: Record<string, { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: any }> = {
  pending: { labelKey: 'statusPending', variant: 'outline', icon: Clock },
  approved: { labelKey: 'statusApproved', variant: 'default', icon: CheckCircle },
  rejected: { labelKey: 'statusRejected', variant: 'destructive', icon: XCircle },
  cancelled: { labelKey: 'statusCancelled', variant: 'secondary', icon: XCircle },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  purchase_order: 'docTypePurchaseOrder',
  expense: 'docTypeExpense',
  credit_note: 'docTypeCreditNote',
  payment: 'docTypePayment',
};

// Demo data
const DEMO_REQUESTS = [
  { id: '1', document_type: 'purchase_order', document_number: 'OC-20260331-0005', amount: 850000, status: 'pending', current_step: 1, total_steps: 2, requested_by_name: 'Operador1', workflow_key: 'workflowHighValuePO', created_at: new Date().toISOString(), actions: [] },
  { id: '2', document_type: 'expense', document_number: 'DESP-20260330-0012', amount: 75000, status: 'pending', current_step: 1, total_steps: 1, requested_by_name: 'Admin', workflow_key: 'workflowExpense', created_at: new Date(Date.now() - 86400000).toISOString(), actions: [] },
  { id: '3', document_type: 'purchase_order', document_number: 'OC-20260329-0003', amount: 320000, status: 'approved', current_step: 1, total_steps: 1, requested_by_name: 'Operador2', workflow_key: 'workflowPurchaseOrder', created_at: new Date(Date.now() - 172800000).toISOString(), actions: [{ action: 'approve', user_name: 'Director', comments_key: 'commentPreferredSupplier', created_at: new Date(Date.now() - 86400000).toISOString() }] },
  { id: '4', document_type: 'credit_note', document_number: 'NC-20260328-0001', amount: 45000, status: 'rejected', current_step: 1, total_steps: 1, requested_by_name: 'Admin', workflow_key: 'workflowCreditNote', created_at: new Date(Date.now() - 259200000).toISOString(), actions: [{ action: 'reject', user_name: 'Director', comments_key: 'commentInsufficientJustification', created_at: new Date(Date.now() - 172800000).toISOString() }] },
];

const DEMO_WORKFLOWS = [
  { id: '1', name_key: 'workflowPurchaseOrder', document_type: 'purchase_order', min_amount: 0, max_amount: 500000, steps: [{ step: 1, role: 'manager', label_key: 'rolePurchasingManager' }] },
  { id: '2', name_key: 'workflowHighValuePOShort', document_type: 'purchase_order', min_amount: 500000, max_amount: null, steps: [{ step: 1, role: 'manager', label_key: 'rolePurchasingManager' }, { step: 2, role: 'admin', label_key: 'roleFinanceDirector' }] },
  { id: '3', name_key: 'workflowExpense', document_type: 'expense', min_amount: 50000, max_amount: null, steps: [{ step: 1, role: 'manager', label_key: 'roleManager' }] },
  { id: '4', name_key: 'workflowCreditNote', document_type: 'credit_note', min_amount: 0, max_amount: null, steps: [{ step: 1, role: 'admin', label_key: 'roleAdmin' }] },
];

export default function Approvals() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';

  const [activeTab, setActiveTab] = useState('requests');
  const [requests, setRequests] = useState(DEMO_REQUESTS);
  const [workflows] = useState(DEMO_WORKFLOWS);
  const [actionDialog, setActionDialog] = useState<{ requestId: string; action: 'approve' | 'reject' } | null>(null);
  const [comments, setComments] = useState('');

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const handleAction = () => {
    if (!actionDialog) return;
    setRequests(prev => prev.map(r =>
      r.id === actionDialog.requestId
        ? { ...r, status: actionDialog.action === 'approve' ? 'approved' : 'rejected',
            actions: [...r.actions, { action: actionDialog.action, user_name: 'Admin', comments, created_at: new Date().toISOString() }] }
        : r
    ));
    toast.success(actionDialog.action === 'approve' ? t.approvalsUi.docApproved : t.approvalsUi.docRejected);
    setActionDialog(null);
    setComments('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <GitBranch className="w-5 h-5" />
              {t.approvalsUi.title}
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-1">{pendingCount}</Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">{t.approvalsUi.subtitle}</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="requests" className="gap-1.5">
            <Clock className="w-4 h-4" /> {t.approvalsUi.tabRequests}
            {pendingCount > 0 && <Badge variant="destructive" className="ml-1 h-5 text-[10px]">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1.5">
            <Settings className="w-4 h-4" /> {t.approvalsUi.tabWorkflows}
          </TabsTrigger>
        </TabsList>

        {/* Requests Tab */}
        <TabsContent value="requests" className="flex-1 p-4 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.approvalsUi.colDocument}</TableHead>
                <TableHead>{t.approvalsUi.colType}</TableHead>
                <TableHead className="text-right">{t.approvalsUi.colAmount}</TableHead>
                <TableHead>{t.approvalsUi.colWorkflow}</TableHead>
                <TableHead>{t.approvalsUi.colStep}</TableHead>
                <TableHead>{t.approvalsUi.colRequestedBy}</TableHead>
                <TableHead>{t.approvalsUi.colDate}</TableHead>
                <TableHead className="text-center">{t.approvalsUi.colStatus}</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(req => {
                const statusCfg = STATUS_CONFIG[req.status];
                const StatusIcon = statusCfg.icon;
                return (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono font-medium">{req.document_number}</TableCell>
                    <TableCell>{t.approvalsUi[DOC_TYPE_LABELS[req.document_type] as keyof typeof t.approvalsUi] || req.document_type}</TableCell>
                    <TableCell className="text-right font-mono">{req.amount.toLocaleString(uiLocale)} Kz</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.approvalsUi[req.workflow_key as keyof typeof t.approvalsUi] || req.workflow_key}</TableCell>
                    <TableCell>
                      <span className="text-xs">{req.current_step}/{req.total_steps}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm">{req.requested_by_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString(uiLocale)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={statusCfg.variant} className="gap-1">
                        <StatusIcon className="w-3 h-3" />
                        {t.approvalsUi[statusCfg.labelKey as keyof typeof t.approvalsUi]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {req.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" className="h-7 text-xs gap-1"
                            onClick={() => setActionDialog({ requestId: req.id, action: 'approve' })}>
                            <CheckCircle className="w-3 h-3" /> {t.approvalsUi.approve}
                          </Button>
                          <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                            onClick={() => setActionDialog({ requestId: req.id, action: 'reject' })}>
                            <XCircle className="w-3 h-3" /> {t.approvalsUi.reject}
                          </Button>
                        </div>
                      )}
                      {req.actions.length > 0 && req.status !== 'pending' && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {(req.actions[req.actions.length - 1].comments_key
                            ? (t.approvalsUi[req.actions[req.actions.length - 1].comments_key as keyof typeof t.approvalsUi] as any)
                            : req.actions[req.actions.length - 1].comments
                          )?.slice(0, 30)}...
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="flex-1 p-4 overflow-auto">
          <div className="grid gap-3">
            {workflows.map(wf => {
              const steps = typeof wf.steps === 'string' ? JSON.parse(wf.steps) : wf.steps;
              return (
                <Card key={wf.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium">{t.approvalsUi[wf.name_key as keyof typeof t.approvalsUi]}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">{t.approvalsUi[DOC_TYPE_LABELS[wf.document_type] as keyof typeof t.approvalsUi]}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {wf.min_amount > 0
                              ? t.approvalsUi.minAmountAtLeast
                                  .replace('{amount}', wf.min_amount.toLocaleString(uiLocale))
                              : t.approvalsUi.anyAmount}
                            {wf.max_amount
                              ? t.approvalsUi.maxAmountUpTo.replace('{amount}', wf.max_amount.toLocaleString(uiLocale))
                              : ''}
                          </span>
                        </div>
                      </div>
                      <Badge>
                        {t.approvalsUi.stepsCount
                          .replace('{count}', String(steps.length))}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      {steps.map((step: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-md text-xs">
                            <span className="font-medium">{step.step}.</span>
                            <span>{t.approvalsUi[step.label_key as keyof typeof t.approvalsUi]}</span>
                            <Badge variant="secondary" className="text-[10px] ml-1">{step.role}</Badge>
                          </div>
                          {i < steps.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Approve/Reject Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.action === 'approve' ? t.approvalsUi.approveDocTitle : t.approvalsUi.rejectDocTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                {t.approvalsUi.commentsLabel}{' '}
                {actionDialog?.action === 'reject' ? t.approvalsUi.requiredTag : t.approvalsUi.optionalTag}
              </Label>
              <Textarea value={comments} onChange={e => setComments(e.target.value)}
                placeholder={actionDialog?.action === 'approve' ? t.approvalsUi.notesPlaceholder : t.approvalsUi.rejectReasonPlaceholder} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>{t.approvalsUi.cancel}</Button>
            <Button
              variant={actionDialog?.action === 'approve' ? 'default' : 'destructive'}
              onClick={handleAction}
              disabled={actionDialog?.action === 'reject' && !comments.trim()}
            >
              {actionDialog?.action === 'approve' ? t.approvalsUi.confirmApprove : t.approvalsUi.confirmReject}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
