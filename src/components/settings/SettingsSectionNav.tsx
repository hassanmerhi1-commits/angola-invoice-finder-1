import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '@/components/settings/settingsSections';

type SettingsSectionNavProps = {
  active: SettingsSectionId;
  onChange: (section: SettingsSectionId) => void;
};

export function SettingsSectionNav({ active, onChange }: SettingsSectionNavProps) {
  const { t } = useTranslation();
  const sections = t.settingsPage.sections;

  return (
    <>
      {/* Mobile: horizontal scroll */}
      <div className="lg:hidden -mx-1">
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-1 pb-2 px-1">
            {SETTINGS_SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  active === id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sections[id]}
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Desktop: sticky sidebar */}
      <nav
        className="hidden lg:block w-56 shrink-0"
        aria-label={t.nav.settings}
      >
        <div className="sticky top-4 space-y-1 rounded-lg border bg-card p-2">
          {SETTINGS_SECTIONS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                active === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active === id && 'text-primary')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{sections[id]}</span>
                <span className="mt-0.5 block text-xs leading-snug opacity-80">
                  {sections[`${id}Desc` as keyof typeof sections]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

type SettingsSectionHeaderProps = {
  section: SettingsSectionId;
};

export function SettingsSectionHeader({ section }: SettingsSectionHeaderProps) {
  const { t } = useTranslation();
  const sections = t.settingsPage.sections;
  const meta = SETTINGS_SECTIONS.find((s) => s.id === section);
  if (!meta) return null;
  const Icon = meta.icon;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{sections[section]}</h2>
          <p className="text-sm text-muted-foreground">
            {sections[`${section}Desc` as keyof typeof sections]}
          </p>
        </div>
      </div>
    </div>
  );
}
