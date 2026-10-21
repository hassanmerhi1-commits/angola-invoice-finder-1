import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NEXOR_STAT_CARD_TONE, type NexorTone } from '@/lib/nexorToneStyles';

export type ReportsDoorId = 'vendas' | 'receber' | 'pagar' | 'stock' | 'fecho' | 'iva';

export type ReportsDoor = {
  id: ReportsDoorId;
  title: string;
  hint: string;
  icon: LucideIcon;
};

const DOOR_TONE: Record<ReportsDoorId, NexorTone> = {
  vendas: 'sky',
  receber: 'amber',
  pagar: 'rose',
  stock: 'emerald',
  fecho: 'indigo',
  iva: 'slate',
};

export function ReportsHomeDoors({
  doors,
  selected,
  onSelect,
}: {
  doors: ReportsDoor[];
  selected: ReportsDoorId | null;
  onSelect: (id: ReportsDoorId) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {doors.map((door) => {
        const Icon = door.icon;
        const active = selected === door.id;
        return (
          <button
            key={door.id}
            type="button"
            onClick={() => onSelect(door.id)}
            className={cn(
              'text-left rounded-xl border p-5 min-h-[7.5rem] shadow-sm transition-shadow hover:shadow-md',
              NEXOR_STAT_CARD_TONE[DOOR_TONE[door.id]],
              active && 'ring-2 ring-primary ring-offset-2',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-white/70">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-lg font-semibold">{door.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{door.hint}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
