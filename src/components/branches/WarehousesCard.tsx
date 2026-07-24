import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Warehouse } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useBranchContext } from '@/contexts/BranchContext';
import { api } from '@/lib/api/client';

type WarehouseRow = {
  id: string;
  branchId: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

export function WarehousesCard() {
  const { branches } = useBranchContext();
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [code, setCode] = useState('MAIN');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.warehouses.list();
      if (res.error) throw new Error(res.error);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!branchId && branches[0]?.id) setBranchId(branches[0].id);
  }, [branchId, branches]);

  const ensureDefaults = async () => {
    setSaving(true);
    try {
      const res = await api.warehouses.ensureDefaults();
      if (res.error) throw new Error(res.error);
      toast.success(`Defaults ensured (${res.data?.created ?? 0} created)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to ensure defaults');
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!branchId || !code.trim() || !name.trim()) {
      toast.error('Branch, code and name are required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.warehouses.create({
        branchId,
        code: code.trim(),
        name: name.trim(),
        isDefault: true,
      });
      if (res.error) throw new Error(res.error);
      toast.success('Warehouse created');
      setName('');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create warehouse');
    } finally {
      setSaving(false);
    }
  };

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || id.slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Warehouses
          </CardTitle>
          <CardDescription>
            Stock locations per branch (separate from the branch entity).
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void ensureDefaults()} disabled={saving}>
            Ensure defaults
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4 items-end">
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MAIN" />
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main warehouse" />
          </div>
          <Button onClick={() => void create()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No warehouses yet. Use “Ensure defaults” to create one MAIN warehouse per branch.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>{branchName(w.branchId)}</TableCell>
                  <TableCell className="font-mono text-sm">{w.code}</TableCell>
                  <TableCell>{w.name}</TableCell>
                  <TableCell className="space-x-1">
                    {w.isDefault && <Badge>Default</Badge>}
                    {!w.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
