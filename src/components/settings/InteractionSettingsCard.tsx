import { useEffect, useState } from 'react';
import { Keyboard, MousePointerClick } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/i18n';
import { getAppInteractionSettings, saveAppInteractionSettings } from '@/lib/appInteractionSettings';

export function InteractionSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getAppInteractionSettings);

  useEffect(() => {
    const sync = () => setSettings(getAppInteractionSettings());
    window.addEventListener('nexor:interaction-settings', sync);
    return () => window.removeEventListener('nexor:interaction-settings', sync);
  }, []);

  const patch = (next: Partial<typeof settings>) => {
    setSettings(saveAppInteractionSettings(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-5 w-5" />
          {t.interaction.settingsTitle}
        </CardTitle>
        <CardDescription>{t.interaction.settingsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-2">
              <MousePointerClick className="h-4 w-4" />
              {t.interaction.contextMenu}
            </Label>
            <p className="text-xs text-muted-foreground">{t.interaction.contextMenuHint}</p>
          </div>
          <Switch
            checked={settings.contextMenu}
            onCheckedChange={(checked) => patch({ contextMenu: checked })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>{t.interaction.globalShortcuts}</Label>
            <p className="text-xs text-muted-foreground">{t.interaction.globalShortcutsHint}</p>
          </div>
          <Switch
            checked={settings.globalShortcuts}
            onCheckedChange={(checked) => patch({ globalShortcuts: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
