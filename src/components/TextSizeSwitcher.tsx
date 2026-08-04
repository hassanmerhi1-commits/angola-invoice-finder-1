import { useState } from 'react';
import { Type } from 'lucide-react';
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
  getCurrentTextSize,
  setTextSize,
  TEXT_SIZE_IDS,
  type TextSizeId,
} from '@/themes/textSize';
import { cn } from '@/lib/utils';

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

export function TextSizeSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const labels = t.textSize;
  const [current, setCurrent] = useState(getCurrentTextSize);

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
          <Type className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-semibold">{labels.select}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TEXT_SIZE_IDS.map((id) => {
          const selected = id === current;
          return (
            <DropdownMenuItem
              key={id}
              onClick={() => {
                setTextSize(id);
                setCurrent(id);
              }}
              className={cn('gap-3 cursor-pointer', selected && 'bg-accent')}
            >
              <span
                className={cn(
                  'font-semibold text-foreground/80 w-8 shrink-0 tabular-nums',
                  sizeSampleClass(id),
                )}
                aria-hidden
              >
                Aa
              </span>
              <span className="flex-1 text-xs font-medium">{sizeLabel(id, labels)}</span>
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
