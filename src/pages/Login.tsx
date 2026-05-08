import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useERP';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { LogIn, Shield } from 'lucide-react';
import { z } from 'zod';
import defaultLogo from '/icon.png?url';
import { useTranslation } from '@/i18n';

const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long'),
  password: z.string().min(1, 'Password is required'),
});

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const { login } = useAuth();
  const { t } = useTranslation();
  const { companyName, logo } = useCompanyLogo();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({ username, password });
    if (!result.success) {
      const fieldErrors: { username?: string; password?: string } = {};
      result.error.errors.forEach(err => {
        if (err.path[0] === 'username') fieldErrors.username = err.message;
        if (err.path[0] === 'password') fieldErrors.password = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);
    try {
      const success = await login(username, password);
      if (success) {
        toast({ title: t.auth.welcomeToastTitle, description: t.auth.welcomeToastDesc });
        navigate('/');
      } else {
        toast({ title: t.auth.authErrorTitle, description: t.auth.authErrorDesc, variant: 'destructive' });
      }
    } catch {
      toast({ title: t.auth.connectionErrorTitle, description: t.auth.connectionErrorDesc, variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const logoSrc = logo || defaultLogo;

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 gradient-primary items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>

        <div className="relative z-10 text-center text-white max-w-md">
          <div className="mx-auto w-24 h-24 rounded-3xl bg-white/10 backdrop-blur-sm flex items-center justify-center mb-8 shadow-xl overflow-hidden">
            <img src={logoSrc} alt={companyName} className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-4xl font-extrabold mb-3 tracking-tight">{companyName}</h1>
          <p className="text-lg text-white/70 font-medium">{t.auth.tagline}</p>
          <div className="mt-12 flex items-center justify-center gap-6 text-white/50 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> {t.auth.safe}
            </div>
            <div className="w-1 h-1 rounded-full bg-white/30" />
            <div>{t.auth.multiBranch}</div>
            <div className="w-1 h-1 rounded-full bg-white/30" />
            <div>AGT Compliance</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-glow overflow-hidden">
              <img src={logoSrc} alt={companyName} className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-2xl font-extrabold text-gradient">{companyName}</h1>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight">{t.auth.welcomeBack}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t.auth.enterToContinue}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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

            <Button type="submit" className="w-full h-11 rounded-xl text-sm font-bold gradient-primary shadow-glow" disabled={isLoading}>
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  {t.auth.login}
                </>
              )}
            </Button>
          </form>

          <Card className="shadow-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2 font-semibold">{t.auth.demoCredentials}</p>
              <div className="space-y-1 text-xs">
                <p><span className="font-bold text-foreground">Admin:</span> <span className="font-mono text-primary">admin</span></p>
                <p><span className="font-bold text-foreground">Caixa:</span> <span className="font-mono text-primary">caixa1</span></p>
                <p className="text-muted-foreground">{t.auth.anyPassword}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
