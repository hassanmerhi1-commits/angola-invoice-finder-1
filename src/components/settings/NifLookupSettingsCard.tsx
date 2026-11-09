import { useCallback, useEffect, useState } from 'react';
import { Save, Search, UserSearch } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { api, type NifLookupResult } from '@/lib/api/client';
import { NifLookupHint } from '@/components/NifLookupHint';

export function NifLookupSettingsCard() {
  const { t } = useTranslation();
  const ui = t.nifLookupUi;
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [testNif, setTestNif] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NifLookupResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.agt.getNifLookupConfig();
      if (res.data) {
        setEnabled(!!res.data.enabled);
        setUrl(res.data.url || '');
        setMethod(res.data.method === 'POST' ? 'POST' : 'GET');
        setUsername(res.data.username || '');
        setHasPassword(!!res.data.hasPassword);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.agt.saveNifLookupConfig({
        enabled,
        url,
        method,
        username,
        password: password || undefined,
      });
      if (res.error) throw new Error(res.error);
      toast({ title: ui.saveSuccess });
      setPassword('');
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : t.agtConfigUi.saveFailed,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.agt.testNifLookup(testNif);
      setTestResult(res.data ?? { nif: testNif, status: 'unavailable', message: res.error });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserSearch className="h-5 w-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>{ui.enabledLabel}</Label>
                <p className="text-xs text-muted-foreground">{ui.enabledHint}</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-3">
                <Label>{ui.urlLabel}</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={ui.urlPlaceholder} />
              </div>
              <div className="space-y-1">
                <Label>{ui.methodLabel}</Label>
                <Select value={method} onValueChange={(v: 'GET' | 'POST') => setMethod(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{ui.usernameLabel}</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={ui.usernamePlaceholder}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="flex items-center gap-2">
                  {ui.passwordLabel}
                  {hasPassword && <Badge variant="secondary">{ui.passwordSaved}</Badge>}
                </Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={hasPassword ? ui.passwordKeepPlaceholder : ui.passwordPlaceholder}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? t.common.saving : ui.saveButton}
            </Button>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1 space-y-1">
                  <Label>{ui.testNifLabel}</Label>
                  <Input
                    value={testNif}
                    onChange={(e) => setTestNif(e.target.value.trim())}
                    className="font-mono"
                    placeholder="5000000000"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => void handleTest()}
                  disabled={testing || !testNif}
                >
                  <Search className="h-4 w-4" />
                  {ui.testButton}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{ui.testHint}</p>
              <NifLookupHint result={testResult} loading={testing} />
              {testResult?.status === 'not_configured' && (
                <p className="text-xs text-muted-foreground">{ui.enabledHint}</p>
              )}
              {testResult?.message && <p className="text-xs text-muted-foreground">{testResult.message}</p>}
              {testResult?.raw && (
                <div className="space-y-1">
                  <Label className="text-xs">
                    {ui.rawResponse}{testResult.httpStatus ? ` (HTTP ${testResult.httpStatus})` : ''}
                  </Label>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                    {testResult.raw}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
