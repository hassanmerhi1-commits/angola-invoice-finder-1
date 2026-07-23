import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function ChangePasswordCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, clearMustChangePassword } = useAuth();
  const ui = t.passwordChangeUi;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error(ui.fillAllFields);
      return;
    }
    if (newPassword.length < 8) {
      toast.error(ui.minLength);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(ui.mismatch);
      return;
    }
    if (currentPassword === newPassword) {
      toast.error(ui.sameAsCurrent);
      return;
    }

    setSaving(true);
    try {
      const result = await api.auth.changePassword(currentPassword, newPassword);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      clearMustChangePassword();
      toast.success(ui.success);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ui.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="change-password">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="w-5 h-5" />
          {ui.title}
        </CardTitle>
        <CardDescription>
          {ui.description.replace('{name}', user?.name || user?.email || '')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current-password">{ui.currentPassword}</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">{ui.newPassword}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{ui.confirmPassword}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {ui.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
