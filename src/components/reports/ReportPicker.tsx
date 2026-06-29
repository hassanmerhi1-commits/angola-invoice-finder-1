import type { LucideIcon } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface ReportOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Compact report selector used inside each report family. Replaces the previous
 * row of sub-tabs with a single dropdown so families with many reports stay tidy.
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
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ''}`}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[300px] h-10 font-medium">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <SelectItem key={opt.value} value={opt.value}>
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  {opt.label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
