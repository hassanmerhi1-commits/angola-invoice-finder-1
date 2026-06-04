import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import {
  addDayTodo,
  addDaysToKey,
  removeDayTodo,
  todayKey,
  updateDayTodo,
  type DailyTodoItem,
} from '@/lib/dailyTodos';

interface DailyTodoTasksPanelProps {
  selectedDay: string;
  items: DailyTodoItem[];
  onSelectDay: (dateKey: string) => void;
  onItemsChange: (items: DailyTodoItem[]) => void;
}

function formatDayLabel(dateKey: string, locale: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function DailyTodoTasksPanel({
  selectedDay,
  items,
  onSelectDay,
  onItemsChange,
}: DailyTodoTasksPanelProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const d = t.dailyTodosUi;
  const [newText, setNewText] = useState('');

  const today = todayKey();
  const isToday = selectedDay === today;
  const isPast = selectedDay < today;
  const dateLabel = formatDayLabel(selectedDay, locale);
  const doneCount = items.filter((i) => i.done).length;

  const shiftDay = (delta: number) => {
    onSelectDay(addDaysToKey(selectedDay, delta));
  };

  const handleAdd = () => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const next = addDayTodo(selectedDay, trimmed);
    onItemsChange([...next]);
    setNewText('');
  };

  const addPlaceholder = useMemo(() => {
    if (isToday) return d.addPlaceholderToday;
    return d.addPlaceholderOther.replace('{date}', dateLabel);
  }, [isToday, d.addPlaceholderToday, d.addPlaceholderOther, dateLabel]);

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs shrink-0">{d.scheduleFor}</Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDay(-1)}
              aria-label={d.previousDay}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={selectedDay}
              onChange={(e) => {
                const v = e.target.value;
                if (v) onSelectDay(v);
              }}
              className="h-8 w-[10.5rem] text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDay(1)}
              aria-label={d.nextDay}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={isToday ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelectDay(today)}
          >
            {d.today}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelectDay(addDaysToKey(today, 1))}
          >
            {d.tomorrow}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelectDay(addDaysToKey(today, 7))}
          >
            {d.nextWeek}
          </Button>
        </div>
        {!isToday && (
          <Badge variant="secondary" className="text-xs font-normal">
            {d.viewingDay.replace('{date}', dateLabel)}
            {isPast ? ` · ${d.pastDay}` : ''}
          </Badge>
        )}
      </div>

      <div className="space-y-2 max-h-[min(36vh,260px)] overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{d.emptyDay}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
            >
              <Checkbox
                id={`${selectedDay}-${item.id}`}
                checked={item.done}
                onCheckedChange={(checked) =>
                  onItemsChange(updateDayTodo(selectedDay, item.id, { done: checked === true }))
                }
                className="mt-0.5"
              />
              <label
                htmlFor={`${selectedDay}-${item.id}`}
                className={`flex-1 text-sm cursor-pointer ${item.done ? 'line-through text-muted-foreground' : ''}`}
              >
                {item.text}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={() => onItemsChange(removeDayTodo(selectedDay, item.id))}
                aria-label={t.common.delete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={addPlaceholder}
          className="h-9 text-sm flex-1"
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          {t.common.add}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {d.progress.replace('{done}', String(doneCount)).replace('{total}', String(items.length))}
      </p>
    </div>
  );
}
