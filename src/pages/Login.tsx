import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useERP';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TillCityUiBanner } from '@/components/pos/TillCityUiBanner';
import { z } from 'zod';
import defaultLogo from '/icon.png?url';
import { useLanguage, useTranslation } from '@/i18n';

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
  const { language, setLanguage } = useLanguage();
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
          description: result.message || t.auth.authErrorHint,
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
  const fieldClass =
    'h-11 rounded-lg bg-[#0b101b] border-[#2a3444] text-white placeholder:text-[#6b7788] focus-visible:ring-[#1a8aa8] focus-visible:ring-offset-0';
  const labelClass = 'text-[11px] font-semibold uppercase text-[#9aa6b5]';

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TillCityUiBanner />
      <div className="flex flex-1 min-h-0">
        <div className="hidden lg:flex w-[44%] relative flex-col items-center justify-center text-center px-10 border-r border-white/[0.06]">
          <div className="absolute w-[380px] h-[380px] rounded-full border border-[#c4a574]/20 pointer-events-none" />
          <div className="relative w-[88px] h-[88px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#4aa3c7,#1b4f6b_55%,#0d2433)] flex items-center justify-center overflow-hidden shadow-[inset_0_0_0_6px_rgba(255,255,255,0.12)]">
            <img src={logoSrc} alt={companyName} className="w-14 h-14 object-contain" />
          </div>
          <h1 className="relative mt-[18px] mb-2 text-[28px] font-semibold">{companyName}</h1>
          <p className="relative m-0 max-w-[240px] text-[13px] text-[#8b97a8]">{t.auth.tagline}</p>
        </div>

        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-[360px]">
            <div className="lg:hidden text-center mb-6">
              <div className="mx-auto w-14 h-14 rounded-full bg-[radial-gradient(circle_at_35%_30%,#4aa3c7,#1b4f6b_55%,#0d2433)] flex items-center justify-center overflow-hidden shadow-[inset_0_0_0_4px_rgba(255,255,255,0.12)]">
                <img src={logoSrc} alt={companyName} className="w-8 h-8 object-contain" />
              </div>
              <h1 className="mt-3 text-xl font-semibold">{companyName}</h1>
              <p className="mt-1 text-xs text-[#8b97a8]">{t.auth.tagline}</p>
            </div>

            <div className="relative rounded-[18px] border border-white/[0.08] bg-[rgba(18,24,38,0.72)] px-[26px] pt-7 pb-5">
              <div className="absolute left-4 right-4 top-0 h-0.5 bg-[#c4a574]" />

              <h2 className="text-xl font-semibold mb-[18px]">{t.auth.welcomeBack}</h2>

              {lastConnectionError && (
                <Alert variant="destructive" className="mb-4">
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

              <form onSubmit={handleSubmit} className="space-y-4">
                {!mfaToken ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className={labelClass}>{t.auth.username}</Label>
                      <Input
                        id="username"
                        type="text"
                        placeholder={t.auth.username}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className={`${fieldClass} ${errors.username ? 'border-destructive' : ''}`}
                        autoComplete="username"
                      />
                      {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="password" className={labelClass}>{t.auth.password}</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${fieldClass} ${errors.password ? 'border-destructive' : ''}`}
                        autoComplete="current-password"
                      />
                      {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="mfa-code" className={labelClass}>Authenticator code</Label>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="123456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      className={`${fieldClass} tracking-widest`}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="link"
                      className="px-0 h-auto text-[#8b97a8]"
                      onClick={() => { setMfaToken(null); setMfaCode(''); }}
                    >
                      Back to password
                    </Button>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 mt-1.5 rounded-full bg-[#1a8aa8] hover:bg-[#167a96] text-white text-[15px] font-semibold"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    mfaToken ? 'Verify code' : t.auth.login
                  )}
                </Button>
              </form>

              <div className="mt-3.5 text-xs text-[#7d8896]">
                <button
                  type="button"
                  className={language === 'pt' ? 'text-[#e8eef5] font-semibold' : 'hover:text-[#e8eef5]'}
                  onClick={() => setLanguage('pt')}
                >
                  PT
                </button>
                <span className="mx-1.5">|</span>
                <button
                  type="button"
                  className={language === 'en' ? 'text-[#e8eef5] font-semibold' : 'hover:text-[#e8eef5]'}
                  onClick={() => setLanguage('en')}
                >
                  EN
                </button>
              </div>
            </div>

            {!mfaToken && (
              <p className="mt-4 text-center text-[11px] text-[#7d8896]">{t.auth.defaultAdminHint}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
