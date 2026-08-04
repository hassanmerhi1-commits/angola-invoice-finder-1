import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import {
  getCurrentColorTheme,
  setColorTheme,
  THEME_PRESET_LIST,
  type ColorThemeId,
} from '@/themes/colorTheme';
import { cn } from '@/lib/utils';

function themeLabel(
  id: ColorThemeId,
  labels: { light: string; medium: string; warm: string; cold: string },
) {
  return labels[id];
}

export function ColorThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const current = getCurrentColorTheme();
  const labels = t.colorTheme;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            compact ? 'h-7 w-7' : 'h-9 w-9',
            'text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-white/50',
          )}
          title={labels.select}
          aria-label={labels.select}
        >
          <Palette className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold">{labels.select}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_PRESET_LIST.map((preset) => {
          const selected = preset.id === current;
          return (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => {
                if (!selected) setColorTheme(preset.id);
              }}
              className={cn('gap-3 text-xs cursor-pointer', selected && 'bg-accent')}
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
              <span className="flex-1 font-medium">{themeLabel(preset.id, labels)}</span>
              {selected ? (
                <span className="text-[10px] text-muted-foreground">{labels.current}</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
