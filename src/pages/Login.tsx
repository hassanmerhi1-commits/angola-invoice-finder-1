import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useERP';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { LogIn, Shield, RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { z } from 'zod';
import defaultLogo from '/icon.png?url';
import { useTranslation } from '@/i18n';

const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(80, 'Username too long'),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'),
});

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRetryingServer, setIsRetryingServer] = useState(false);
  const [lastConnectionError, setLastConnectionError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const { login, completeMfaLogin } = useAuth();
  const { t } = useTranslation();
  const { companyName, logo } = useCompanyLogo();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!window.electronAPI?.db?.getStatus) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await window.electronAPI?.db?.getStatus?.();
        if (cancelled || !status) return;
        if (status.backendNativeError) {
          setLastConnectionError(String(status.backendNativeError));
          return;
        }
        if (status.mode === 'server' && status.expressPort) {
          const base = `http://127.0.0.1:${status.expressPort}`;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          try {
            const res = await fetch(`${base}/api/health?lite=1`, { signal: ctrl.signal });
            const payload = await res.json().catch(() => null);
            if (!cancelled && payload?.dbUnreachable) {
              setLastConnectionError(
                String(payload.hint || payload.error || 'PostgreSQL is not running. Start Docker Desktop.'),
              );
            }
          } catch {
            /* backend still starting */
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!mfaToken) {
      const parsed = loginSchema.safeParse({ username, password });
      if (!parsed.success) {
        const fieldErrors: { username?: string; password?: string } = {};
        parsed.error.errors.forEach((err) => {
          if (err.path[0] === 'username') fieldErrors.username = err.message;
          if (err.path[0] === 'password') fieldErrors.password = err.message;
        });
        setErrors(fieldErrors);
        return;
      }
    } else if (mfaCode.trim().length < 6) {
      toast({ title: t.auth.authErrorTitle, description: 'Enter the 6-digit code', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      if (mfaToken) {
        const mfaResult = await completeMfaLogin(mfaToken, mfaCode);
        if (mfaResult.ok) {
          setMfaToken(null);
          setMfaCode('');
          if (mfaResult.mustChangePassword) {
            navigate('/settings?focus=password');
          } else {
            toast({ title: t.auth.welcomeToastTitle, description: t.auth.welcomeToastDesc });
            navigate('/');
          }
        } else {
          toast({
            title: t.auth.authErrorTitle,
            description: mfaResult.message || 'Invalid authentication code',
            variant: 'destructive',
          });
        }
        setIsLoading(false);
        return;
      }

      const result = await login(username, password);
      if (result.ok) {
        if (result.offline) {
          toast({
            title: t.auth.welcomeToastTitle,
            description: t.auth.offlineLoginDesc,
          });
        } else if (result.mustChangePassword) {
          toast({
            title: t.auth.welcomeToastTitle,
            description: t.auth.mustChangePasswordDesc,
            variant: 'destructive',
          });
          navigate('/settings?focus=password');
          return;
        } else {
          toast({ title: t.auth.welcomeToastTitle, description: t.auth.welcomeToastDesc });
        }
        navigate('/');
      } else if (result.kind === 'mfa') {
        setMfaToken(result.mfaToken);
        toast({
          title: t.auth.welcomeToastTitle,
          description: 'Enter the 6-digit code from your authenticator app.',
        });
      } else if (result.kind === 'connection') {
        const msg = result.message || t.auth.connectionErrorDesc;
        setLastConnectionError(msg);
        toast({
          title: t.auth.connectionErrorTitle,
          description: msg,
          variant: 'destructive',
        });
      } else {
        toast({
          title: t.auth.authErrorTitle,
          description: t.auth.authErrorHint,
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: t.auth.connectionErrorTitle, description: t.auth.connectionErrorDesc, variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const retryServerConnection = useCallback(async () => {
    if (!window.electronAPI?.db?.ensureBackend) {
      toast({ title: t.auth.connectionErrorTitle, description: t.auth.connectionErrorDesc, variant: 'destructive' });
      return;
    }
    setIsRetryingServer(true);
    try {
      const r = await window.electronAPI.db.ensureBackend();
      if (r?.success) {
        setLastConnectionError(null);
        toast({ title: t.auth.serverStartedTitle, description: t.auth.serverStartedDesc });
      } else {
        const msg = r?.error || t.auth.connectionErrorDesc;
        setLastConnectionError(msg);
        toast({ title: t.auth.connectionErrorTitle, description: msg, variant: 'destructive' });
      }
    } catch {
      toast({ title: t.auth.connectionErrorTitle, description: t.auth.connectionErrorDesc, variant: 'destructive' });
    } finally {
      setIsRetryingServer(false);
    }
  }, [t, toast]);

  const logoSrc = logo || defaultLogo;

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 nexor-auth-hero items-center justify-center p-12 relative overflow-hidden border-r border-slate-200/80">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-sky-100/60 blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-indigo-100/40 blur-3xl" />
        </div>

        <div className="relative z-10 text-center max-w-md">
          <div className="mx-auto w-24 h-24 rounded-3xl bg-white border border-slate-200/80 flex items-center justify-center mb-8 shadow-sm overflow-hidden">
            <img src={logoSrc} alt={companyName} className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-4xl font-semibold mb-3 tracking-tight text-slate-800">{companyName}</h1>
          <p className="text-lg text-slate-500 font-medium">{t.auth.tagline}</p>
          <div className="mt-12 flex items-center justify-center gap-6 text-slate-400 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> {t.auth.safe}
            </div>
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            <div>{t.auth.multiBranch}</div>
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            <div>AGT Compliance</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-white border border-slate-200/80 flex items-center justify-center mb-4 shadow-sm overflow-hidden">
              <img src={logoSrc} alt={companyName} className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-2xl font-semibold text-slate-800">{companyName}</h1>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{t.auth.welcomeBack}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t.auth.enterToContinue}</p>
          </div>

          {lastConnectionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p className="text-sm">{lastConnectionError}</p>
                {window.electronAPI?.db?.ensureBackend && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-destructive/40"
                    disabled={isRetryingServer}
                    onClick={() => void retryServerConnection()}
                  >
                    {isRetryingServer ? (
                      <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        {t.auth.retryServerConnection}
                      </>
                    )}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {!mfaToken ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-semibold">{t.auth.username}</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder={t.auth.username}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`h-11 rounded-xl ${errors.username ? 'border-destructive' : ''}`}
                    autoComplete="username"
                  />
                  {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-semibold">{t.auth.password}</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`h-11 rounded-xl ${errors.password ? 'border-destructive' : ''}`}
                    autoComplete="current-password"
                  />
                  {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="mfa-code" className="text-sm font-semibold">Authenticator code</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="h-11 rounded-xl tracking-widest"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="link"
                  className="px-0 h-auto"
                  onClick={() => { setMfaToken(null); setMfaCode(''); }}
                >
                  Back to password
                </Button>
              </div>
            )}

            <Button type="submit" className="w-full h-11 rounded-xl text-sm font-semibold" disabled={isLoading}>
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  {mfaToken ? 'Verify code' : t.auth.login}
                </>
              )}
            </Button>
          </form>

          <Card className="shadow-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2 font-semibold">{t.auth.defaultAccountsTitle}</p>
              <div className="space-y-1 text-xs">
                <p>{t.auth.defaultAdminHint}</p>
                <p>{t.auth.defaultCashierHint}</p>
                <p className="text-muted-foreground mt-2">{t.auth.changePasswordHint}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
