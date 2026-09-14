import { useState } from 'react';
import { Globe, Palette, SlidersHorizontal, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/i18n';
import {
  getCurrentColorTheme,
  setColorTheme,
  THEME_PRESET_LIST,
  type ColorThemeId,
} from '@/themes/colorTheme';
import {
  getCurrentTextSize,
  setTextSize,
  TEXT_SIZE_IDS,
  type TextSizeId,
} from '@/themes/textSize';
import { cn } from '@/lib/utils';

function themeLabel(
  id: ColorThemeId,
  labels: { light: string; medium: string; warm: string; cold: string },
) {
  return labels[id];
}

function sizeLabel(
  id: TextSizeId,
  labels: { small: string; medium: string; large: string },
) {
  return labels[id];
}

function sizeSampleClass(id: TextSizeId) {
  if (id === 'small') return 'text-[11px]';
  if (id === 'large') return 'text-[15px]';
  return 'text-[13px]';
}

export function AppearanceSwitcher({
  compact = false,
  variant = 'icon',
  triggerClassName,
}: {
  compact?: boolean;
  variant?: 'icon' | 'menu';
  triggerClassName?: string;
}) {
  const { language, setLanguage, t } = useLanguage();
  const colorLabels = t.colorTheme;
  const sizeLabels = t.textSize;
  const currentTheme = getCurrentColorTheme();
  const [textSize, setTextSizeState] = useState(getCurrentTextSize);
  const isMenu = variant === 'menu';
  const label = t.topNav.menus.display;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {isMenu ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('shrink-0 whitespace-nowrap', triggerClassName)}
            title={label}
          >
            {label}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              compact ? 'h-7 w-7' : 'h-9 w-9',
              'text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-white/50',
            )}
            title={label}
            aria-label={label}
          >
            <SlidersHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align={isMenu ? 'start' : 'end'} className="w-64 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-xs font-semibold">{t.appearance.select}</p>
        </div>

        <section className="space-y-2 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Globe className="h-3 w-3" />
            {t.language.select}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant={language === 'en' ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLanguage('en')}
            >
              🇬🇧 {t.language.english}
            </Button>
            <Button
              type="button"
              variant={language === 'pt' ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setLanguage('pt')}
            >
              🇦🇴 {t.language.portuguese}
            </Button>
          </div>
        </section>

        <section className="space-y-2 border-t px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Palette className="h-3 w-3" />
            {colorLabels.select}
          </div>
          <div className="space-y-1">
            {THEME_PRESET_LIST.map((preset) => {
              const selected = preset.id === currentTheme;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    if (!selected) setColorTheme(preset.id);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/70',
                    selected && 'bg-accent',
                  )}
                >
                  <span className="flex items-center gap-0.5 shrink-0" aria-hidden>
                    {preset.swatches.map((color) => (
                      <span
                        key={color}
                        className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="flex-1 font-medium">{themeLabel(preset.id, colorLabels)}</span>
                  {selected ? (
                    <span className="text-[10px] text-muted-foreground">{colorLabels.current}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2 border-t px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Type className="h-3 w-3" />
            {sizeLabels.select}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {TEXT_SIZE_IDS.map((id) => {
              const selected = id === textSize;
              return (
                <Button
                  key={id}
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-9 flex-col gap-0 px-1"
                  onClick={() => {
                    setTextSize(id);
                    setTextSizeState(id);
                  }}
                >
                  <span className={cn('font-semibold leading-none', sizeSampleClass(id))} aria-hidden>
                    Aa
                  </span>
                  <span className="text-[10px] font-medium">{sizeLabel(id, sizeLabels)}</span>
                </Button>
              );
            })}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
