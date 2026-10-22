import { useLiveWebappReload } from '@/hooks/useLiveWebappReload';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';

export function LiveWebappBanner() {
  const { pending, reloadNow } = useLiveWebappReload();
  const { t } = useTranslation();
  if (!pending) return null;
  return (
    <div className="flex items-center justify-center gap-3 px-3 py-1.5 text-xs bg-primary/15 text-foreground border-b border-border">
      <span className="font-medium text-foreground">{t.common.webappUpdatedTitle}.</span>
      <span className="text-muted-foreground">{t.common.webappUpdatedDesc}</span>
      <Button size="sm" className="h-6 text-xs" onClick={reloadNow}>
        {t.common.webappUpdatedAction}
      </Button>
    </div>
  );
}
