import { useEffect, useState } from 'react';
import { ListTodo, Play } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/i18n';
import {
  DAILY_TODOS_CHANGED_EVENT,
  readDailyTodosState,
  requestDailyTodoPopup,
  setDailyTodoTemplateItems,
  setDailyTodosEnabled,
} from '@/lib/dailyTodos';

export function DailyTodosSettingsCard() {
  const { t } = useTranslation();
  const d = t.dailyTodosUi;
  const [enabled, setEnabled] = useState(true);
  const [templateText, setTemplateText] = useState('');

  const sync = () => {
    const state = readDailyTodosState();
    setEnabled(state.enabled);
    setTemplateText(state.templateItems.join('\n'));
  };

  useEffect(() => {
    sync();
    window.addEventListener(DAILY_TODOS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DAILY_TODOS_CHANGED_EVENT, sync);
  }, []);

  const saveTemplate = () => {
    setDailyTodoTemplateItems(templateText.split('\n'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="h-5 w-5" />
          {d.settingsTitle}
        </CardTitle>
        <CardDescription>{d.settingsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>{d.settingsEnabled}</Label>
            <p className="text-xs text-muted-foreground">{d.settingsEnabledHint}</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              setDailyTodosEnabled(checked);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>{d.settingsTemplate}</Label>
          <p className="text-xs text-muted-foreground">{d.settingsTemplateHint}</p>
          <Textarea
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
            rows={6}
            className="text-sm font-mono"
            placeholder={d.settingsTemplatePlaceholder}
          />
          <Button type="button" variant="outline" size="sm" onClick={saveTemplate}>
            {d.settingsSaveTemplate}
          </Button>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1"
          onClick={() => {
            requestDailyTodoPopup();
            window.dispatchEvent(new CustomEvent('nexor:show-daily-todos'));
          }}
        >
          <Play className="h-4 w-4" />
          {d.settingsShowNow}
        </Button>
      </CardContent>
    </Card>
  );
}
