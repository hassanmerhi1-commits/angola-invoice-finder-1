import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ReportOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Compact in-report view switcher. Labels stay visible (e.g. Por Categoria)
 * so grouping is one click, not buried in a dropdown.
 */
export function ReportPicker({
  options,
  value,
  onChange,
  actions,
  className,
}: {
  options: ReportOption[];
  value: string;
  onChange: (value: string) => void;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
