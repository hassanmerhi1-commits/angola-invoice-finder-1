import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, Upload, Trash2, CheckCircle2, AlertTriangle, Copy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { api } from '@/lib/api/client';

type CertificateRow = {
  id: string;
  alias: string;
  keyType: string;
  certificateNumber?: string;
  subjectCn?: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
};

export function SigningSettingsCard() {
  const { t } = useTranslation();
  const ui = t.signingUi;
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'rsa' | 'hash-only'>('hash-only');
  const [activeAlias, setActiveAlias] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<CertificateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [alias, setAlias] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [pfxBase64, setPfxBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [publicKeyPem, setPublicKeyPem] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.signing.getStatus();
      if (res.data) {
        setMode(res.data.mode);
        setActiveAlias(res.data.activeKeyAlias);
        setCertificates(res.data.certificates || []);
        setPublicKeyPem(res.data.publicKeyPem || '');
      }
    } catch (err) {
      console.warn('[SigningSettings] status failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFileChange = (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      setPfxBase64(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUpload = async () => {
    if (!alias.trim() || !pfxBase64) {
      toast({ variant: 'destructive', title: t.common.error, description: ui.uploadMissingFields });
      return;
    }
    setUploading(true);
    try {
      const res = await api.signing.uploadCertificate({
        alias: alias.trim(),
        pfxBase64,
        passphrase,
        certificateNumber: certificateNumber.trim() || undefined,
      });
      if (res.error) throw new Error(res.error);
      toast({ title: ui.uploadSuccess });
      setAlias('');
      setPassphrase('');
      setCertificateNumber('');
      setPfxBase64('');
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.uploadFailed,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const res = await api.signing.activateCertificate(id);
      if (res.error) throw new Error(res.error);
      toast({ title: ui.activateSuccess });
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.activateFailed,
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await api.signing.deleteCertificate(id);
      if (res.error) throw new Error(res.error);
      toast({ title: ui.deleteSuccess });
      await refresh();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t.common.error,
        description: err instanceof Error ? err.message : ui.deleteFailed,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>{ui.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{ui.currentMode}:</span>
          {mode === 'rsa' ? (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {ui.modeRsa}
              {activeAlias ? ` (${activeAlias})` : ''}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-amber-700 border-amber-500">
              <AlertTriangle className="h-3 w-3" />
              {ui.modeHashOnly}
            </Badge>
          )}
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm font-medium">{ui.publicKeyTitle}</p>
          <p className="text-xs text-muted-foreground">{ui.publicKeyHint}</p>
          {publicKeyPem ? (
            <>
              <textarea
                readOnly
                value={publicKeyPem}
                className="w-full h-28 text-xs font-mono rounded-md border bg-muted/40 p-2"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(publicKeyPem);
                  toast({ title: ui.publicKeyCopied });
                }}
              >
                <Copy className="h-4 w-4" />
                {ui.copyPublicKey}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{ui.publicKeyMissing}</p>
          )}
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">{ui.uploadTitle}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{ui.aliasLabel}</Label>
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={ui.aliasPlaceholder} />
            </div>
            <div className="space-y-1">
              <Label>{ui.certNumberLabel}</Label>
              <Input
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
                placeholder={ui.certNumberPlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{ui.passphraseLabel}</Label>
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={ui.passphrasePlaceholder}
              />
            </div>
            <div className="space-y-1">
              <Label>{ui.pfxLabel}</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
              />
              {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
            </div>
          </div>
          <Button onClick={handleUpload} disabled={uploading} className="gap-2">
            <Upload className="h-4 w-4" />
            {uploading ? ui.uploading : ui.uploadButton}
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{ui.installedCerts}</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t.common.loading}</p>
          ) : certificates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ui.noCertificates}</p>
          ) : (
            <div className="space-y-2">
              {certificates.map((cert) => (
                <div
                  key={cert.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {cert.alias}
                      {cert.isActive && <Badge>{ui.activeBadge}</Badge>}
                    </div>
                    <div className="text-muted-foreground text-xs mt-1">
                      {cert.subjectCn || cert.keyType}
                      {' · '}
                      {ui.validUntil} {new Date(cert.validUntil).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!cert.isActive && (
                      <Button size="sm" variant="outline" onClick={() => handleActivate(cert.id)}>
                        {ui.activateButton}
                      </Button>
                    )}
                    {!cert.isActive && (
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(cert.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
