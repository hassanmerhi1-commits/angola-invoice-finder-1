import { useCallback, useEffect, useState } from 'react';
import { Radio, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';
import { getCompanySettings } from '@/lib/companySettings';

export function AgtSettingsCard() {
  const { t } = useTranslation();
  const ui = t.agtConfigUi;
  const { toast } = useToast();
  const company = getCompanySettings();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [apiUrl, setApiUrl] = useState('');
  const [statusUrl, setStatusUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [companyNif, setCompanyNif] = useState(company.nif || '');
  const [softwareCert, setSoftwareCert] = useState(company.agtCertificateNumber || '');
  const [simulate, setSimulate] = useState(true);
  const [autoTransmit, setAutoTransmit] = useState(true);
  const [hasApiKey, setHasApiKey] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.agt.getConfig();
      if (res.data) {
        setEnvironment((res.data.environment as 'sandbox' | 'production') || 'sandbox');
        setApiUrl(res.data.apiUrl || '');
        setStatusUrl(res.data.statusUrl || '');
        setCompanyNif(res.data.companyNif || company.nif || '');
        setSoftwareCert(res.data.softwareCertificateNumber || company.agtCertificateNumber || '');
        setSimulate(res.data.simulate !== false);
        setAutoTransmit(res.data.autoTransmit !== false);
        setHasApiKey(!!res.data.hasApiKey);
      }
    } catch (err) {
      console.warn('[AgtSettings] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [company.agtCertificateNumber, company.nif]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.agt.saveConfig({
        environment,
        apiUrl,
        statusUrl,
        apiKey: apiKey || undefined,
        companyNif,
        softwareCertificateNumber: softwareCert,
        simulate,
        autoTransmit,
      });
      if (res.error) throw new Error(res.error);
      toast({ title: ui.saveSuccess });
      setApiKey('');
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.saveFailed,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-5 w-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-muted-foreground">{ui.modeLabel}:</span>
              {simulate ? (
                <Badge variant="outline">{ui.simulateBadge}</Badge>
              ) : (
                <Badge>{ui.liveBadge}</Badge>
              )}
              {hasApiKey && <Badge variant="secondary">{ui.apiKeyConfigured}</Badge>}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{ui.environmentLabel}</Label>
                <Select value={environment} onValueChange={(v: 'sandbox' | 'production') => setEnvironment(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">{ui.environmentSandbox}</SelectItem>
                    <SelectItem value="production">{ui.environmentProduction}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{ui.companyNifLabel}</Label>
                <Input value={companyNif} onChange={(e) => setCompanyNif(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{ui.apiUrlLabel}</Label>
                <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={ui.apiUrlPlaceholder} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{ui.statusUrlLabel}</Label>
                <Input value={statusUrl} onChange={(e) => setStatusUrl(e.target.value)} placeholder={ui.statusUrlPlaceholder} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{ui.apiKeyLabel}</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasApiKey ? ui.apiKeyKeepPlaceholder : ui.apiKeyPlaceholder}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{ui.softwareCertLabel}</Label>
                <Input value={softwareCert} onChange={(e) => setSoftwareCert(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-4 sm:justify-start">
                <div>
                  <Label>{ui.simulateLabel}</Label>
                  <p className="text-xs text-muted-foreground">{ui.simulateHint}</p>
                </div>
                <Switch checked={simulate} onCheckedChange={setSimulate} />
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-start">
                <div>
                  <Label>{ui.autoTransmitLabel}</Label>
                  <p className="text-xs text-muted-foreground">{ui.autoTransmitHint}</p>
                </div>
                <Switch checked={autoTransmit} onCheckedChange={setAutoTransmit} />
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? t.common.saving : ui.saveButton}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
