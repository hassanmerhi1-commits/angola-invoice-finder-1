import { cn } from '@/lib/utils';

export type ReportStatBox = {
  label: string;
  value: string;
  hint?: string;
  className?: string;
};

export function ReportStatStrip({ items, columns }: { items: ReportStatBox[]; columns?: string }) {
  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-2', columns ?? 'xl:grid-cols-8')}>
      {items.map((box) => (
        <div key={box.label} className="rounded-lg border bg-card px-3 py-2">
          <p className="text-[11px] text-muted-foreground leading-tight">{box.label}</p>
          <p className={cn('text-sm font-semibold tabular-nums mt-1', box.className)}>{box.value}</p>
          {box.hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{box.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
