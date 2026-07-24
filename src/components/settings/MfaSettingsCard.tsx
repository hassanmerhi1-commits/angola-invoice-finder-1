import { useCallback, useEffect, useState } from 'react';
import { Shield, Loader2, Copy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useERP';

export function MfaSettingsCard() {
  const { user } = useAuth();
  const roleOk = user?.role === 'admin' || user?.role === 'manager';
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!roleOk) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await api.auth.mfaStatus();
    if (res.data) setEnabled(!!res.data.mfaEnabled);
    setLoading(false);
  }, [roleOk]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!roleOk) return null;

  const startSetup = async () => {
    setBusy(true);
    try {
      const res = await api.auth.mfaSetup();
      if (res.error) throw new Error(res.error);
      setSecret(res.data?.secret || null);
      setOtpauth(res.data?.otpauthUrl || null);
      setBackupCodes(null);
      toast.success('Scan the secret in your authenticator app, then enter a code to enable.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'MFA setup failed');
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      const res = await api.auth.mfaEnable(code);
      if (res.error) throw new Error(res.error);
      setEnabled(true);
      setSecret(null);
      setOtpauth(null);
      setCode('');
      setBackupCodes(res.data?.backupCodes || null);
      toast.success('MFA enabled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not enable MFA');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const password = window.prompt('Enter your password to disable MFA') || '';
    if (!password) return;
    setBusy(true);
    try {
      const res = await api.auth.mfaDisable({ password });
      if (res.error) throw new Error(res.error);
      setEnabled(false);
      setBackupCodes(null);
      toast.success('MFA disabled');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disable MFA');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5" />
          Two-factor authentication (TOTP)
          {enabled ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
        </CardTitle>
        <CardDescription>
          Required second step at login for admin/manager accounts using an authenticator app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : enabled ? (
          <Button variant="outline" disabled={busy} onClick={() => void disable()}>
            Disable MFA
          </Button>
        ) : (
          <div className="space-y-3">
            {!secret ? (
              <Button disabled={busy} onClick={() => void startSetup()}>
                Set up authenticator
              </Button>
            ) : (
              <>
                <div className="text-sm space-y-1">
                  <p className="font-medium">Secret</p>
                  <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{secret}</code>
                  {otpauth && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        void navigator.clipboard.writeText(otpauth);
                        toast.success('otpauth URL copied');
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy otpauth URL
                    </Button>
                  )}
                </div>
                <div className="space-y-2 max-w-xs">
                  <Label htmlFor="mfa-enable-code">Authentication code</Label>
                  <Input
                    id="mfa-enable-code"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                  <Button disabled={busy || code.length < 6} onClick={() => void enable()}>
                    Enable MFA
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {backupCodes && backupCodes.length > 0 && (
          <div className="rounded border p-3 text-sm space-y-1">
            <p className="font-medium">Backup codes (save these now)</p>
            <ul className="font-mono text-xs grid grid-cols-2 gap-1">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
