import { useState } from 'react';
import { format, parseISO, isValid, startOfDay } from 'date-fns';
import { pt, enGB } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { localISODate } from '@/lib/workingDayAccess';

export { localISODate };

function parseLocalISO(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = parseISO(value.slice(0, 10));
  return isValid(d) ? d : undefined;
}

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  locale?: 'pt' | 'en';
  disabled?: boolean;
  /** When set, days before this ISO date cannot be selected. */
  minDate?: string;
  /** Convenience: disable all days before today. */
  disableBeforeToday?: boolean;
};

/** Calendar popover that stores YYYY-MM-DD (avoids free-typed date inputs). */
export function DatePickerButton({
  value,
  onChange,
  placeholder = '…',
  className,
  buttonClassName,
  locale = 'pt',
  disabled,
  minDate,
  disableBeforeToday,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalISO(value);
  const dfLocale = locale === 'pt' ? pt : enGB;
  const floor = disableBeforeToday
    ? startOfDay(new Date())
    : minDate
      ? parseLocalISO(minDate)
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-7 justify-start text-left font-normal text-xs px-2 gap-1.5 min-w-[8.5rem]',
            !value && 'text-muted-foreground',
            buttonClassName,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className={cn('truncate', className)}>
            {selected ? format(selected, 'dd/MM/yyyy', { locale: dfLocale }) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 bg-background border shadow-lg z-50" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => {
            if (!day) return;
            const iso = localISODate(day);
            if (floor && day < floor) return;
            onChange(iso);
            setOpen(false);
          }}
          disabled={floor ? { before: floor } : undefined}
          locale={dfLocale}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
