import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useERP';
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

type ApprovalRequestRow = {
  id: string;
  document_type: string;
  document_number: string;
  amount: number;
  status: string;
  current_step: number;
  total_steps: number;
  requested_by_name: string;
  workflow_name?: string;
  workflow_key?: string;
  created_at: string;
  actions: Array<{ action: string; user_name?: string; comments?: string; comments_key?: string; created_at?: string }>;
};

type ApprovalWorkflowRow = {
  id: string;
  name?: string;
  name_key?: string;
  document_type: string;
  min_amount: number;
  max_amount: number | null;
  steps: unknown;
};

function mapApprovalRequest(row: Record<string, unknown>): ApprovalRequestRow {
  const actions = Array.isArray(row.actions) ? row.actions : [];
  return {
    id: String(row.id || ''),
    document_type: String(row.document_type || ''),
    document_number: String(row.document_number || ''),
    amount: Number(row.amount || 0),
    status: String(row.status || 'pending'),
    current_step: Number(row.current_step || 1),
    total_steps: Number(row.total_steps || 1),
    requested_by_name: String(row.requested_by_name || row.requestedByName || '—'),
    workflow_name: row.workflow_name != null ? String(row.workflow_name) : undefined,
    workflow_key: row.workflow_key != null ? String(row.workflow_key) : undefined,
    created_at: String(row.created_at || row.createdAt || new Date().toISOString()),
    actions: actions.map((a: Record<string, unknown>) => ({
      action: String(a.action || ''),
      user_name: a.user_name != null ? String(a.user_name) : undefined,
      comments: a.comments != null ? String(a.comments) : undefined,
      comments_key: a.comments_key != null ? String(a.comments_key) : undefined,
      created_at: a.created_at != null ? String(a.created_at) : undefined,
    })),
  };
}

export default function Approvals() {
  const { t, language } = useTranslation();
  const uiLocale = language === 'pt' ? 'pt-AO' : 'en-US';
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState('requests');
  const [requests, setRequests] = useState<ApprovalRequestRow[]>([]);
  const [workflows, setWorkflows] = useState<ApprovalWorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState<{ requestId: string; action: 'approve' | 'reject' } | null>(null);
  const [comments, setComments] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, wfRes] = await Promise.all([
        api.approvals.requests(),
        api.approvals.workflows(),
      ]);
      setRequests(Array.isArray(reqRes.data) ? reqRes.data.map((r) => mapApprovalRequest(r)) : []);
      setWorkflows(Array.isArray(wfRes.data) ? wfRes.data.map((wf: Record<string, unknown>) => ({
        id: String(wf.id || ''),
        name: wf.name != null ? String(wf.name) : undefined,
        name_key: wf.name_key != null ? String(wf.name_key) : undefined,
        document_type: String(wf.document_type || ''),
        min_amount: Number(wf.min_amount ?? wf.minAmount ?? 0),
        max_amount: wf.max_amount != null || wf.maxAmount != null ? Number(wf.max_amount ?? wf.maxAmount) : null,
        steps: wf.steps,
      })) : []);
    } catch {
      setRequests([]);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const handleAction = async () => {
    if (!actionDialog) return;
    if (actionDialog.action === 'reject' && !comments.trim()) return;
    try {
      const fn = actionDialog.action === 'approve' ? api.approvals.approve : api.approvals.reject;
      const res = await fn(
        actionDialog.requestId,
        user?.id || '',
        user?.name || '',
        comments.trim(),
      );
      if (res.error) throw new Error(res.error);
      toast.success(actionDialog.action === 'approve' ? t.approvalsUi.docApproved : t.approvalsUi.docRejected);
      setActionDialog(null);
      setComments('');
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.common.error;
      toast.error(message);
    }
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
              {loading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {t.common.loading}
                  </TableCell>
                </TableRow>
              )}
              {!loading && requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {t.approvalsUi.noPendingRequests ?? '—'}
                  </TableCell>
                </TableRow>
              )}
              {!loading && requests.map(req => {
                const statusCfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
                const StatusIcon = statusCfg.icon;
                const workflowLabel =
                  req.workflow_name
                  || (req.workflow_key ? t.approvalsUi[req.workflow_key as keyof typeof t.approvalsUi] : undefined)
                  || req.workflow_key
                  || '—';
                return (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono font-medium">{req.document_number}</TableCell>
                    <TableCell>{t.approvalsUi[DOC_TYPE_LABELS[req.document_type] as keyof typeof t.approvalsUi] || req.document_type}</TableCell>
                    <TableCell className="text-right font-mono">{req.amount.toLocaleString(uiLocale)} Kz</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{workflowLabel}</TableCell>
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
                          {(req.actions[req.actions.length - 1].comments
                            || (req.actions[req.actions.length - 1].comments_key
                              ? (t.approvalsUi[req.actions[req.actions.length - 1].comments_key as keyof typeof t.approvalsUi] as string)
                              : '')
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
                        <h3 className="font-medium">
                          {wf.name || (wf.name_key ? t.approvalsUi[wf.name_key as keyof typeof t.approvalsUi] : wf.document_type)}
                        </h3>
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
                            <span>{step.label_key ? t.approvalsUi[step.label_key as keyof typeof t.approvalsUi] : (step.label || step.role)}</span>
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
