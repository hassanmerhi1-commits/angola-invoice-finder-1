import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import {
  getDailyTodoActionTarget,
  navigateDailyTodoAction,
  resolveDailyTodoAction,
  type DailyTodoAction,
} from '@/lib/dailyTodoActions';
import { themeChrome } from '@/themes/active';

interface DailyTodoTasksPanelProps {
  selectedDay: string;
  items: DailyTodoItem[];
  onSelectDay: (dateKey: string) => void;
  onItemsChange: (items: DailyTodoItem[]) => void;
  /** Close checklist after navigating to a task workspace (ERP inbox pattern). */
  onOpenWorkspace?: () => void;
  /** Prefer switching an in-dialog briefing tab when available. */
  onOpenBriefingTab?: (tab: NonNullable<ReturnType<typeof getDailyTodoActionTarget>['briefingTab']>) => void;
}

function formatDayLabel(dateKey: string, locale: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function actionHint(
  action: DailyTodoAction,
  d: ReturnType<typeof useTranslation>['t']['dailyTodosUi'],
): string {
  switch (action) {
    case 'review_invoices':
      return d.taskOpenInvoices;
    case 'low_stock':
      return d.taskOpenInventory;
    case 'reconcile_caixa':
      return d.taskOpenCaixa;
    case 'overdue_ar':
      return d.taskOpenReceivables;
    case 'overdue_ap':
      return d.taskOpenPayables;
    case 'payments':
      return d.taskOpenPayments;
    case 'purchase_invoices':
      return d.taskOpenPurchaseInvoices;
    case 'pos':
      return d.taskOpenPos;
    default:
      return d.taskOpenWorkspace;
  }
}

function actionRowClass(action: DailyTodoAction | null): string {
  switch (action) {
    case 'review_invoices':
      return themeChrome.rowInvoices;
    case 'low_stock':
      return themeChrome.rowStock;
    case 'reconcile_caixa':
    case 'pos':
      return themeChrome.rowCaixa;
    case 'overdue_ar':
      return themeChrome.rowAr;
    case 'overdue_ap':
      return themeChrome.rowAp;
    case 'payments':
      return themeChrome.rowPayments;
    case 'purchase_invoices':
      return themeChrome.rowPurchases;
    default:
      return themeChrome.rowDefault;
  }
}

export function DailyTodoTasksPanel({
  selectedDay,
  items,
  onSelectDay,
  onItemsChange,
  onOpenWorkspace,
  onOpenBriefingTab,
}: DailyTodoTasksPanelProps) {
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const d = t.dailyTodosUi;
  const navigate = useNavigate();
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

  const openTask = (item: DailyTodoItem, preferWorkspace = false) => {
    const action = resolveDailyTodoAction(item);
    if (!action) return;
    const target = getDailyTodoActionTarget(action);
    if (
      !preferWorkspace
      && target.briefingTab
      && onOpenBriefingTab
      && action !== 'reconcile_caixa'
      && action !== 'pos'
    ) {
      onOpenBriefingTab(target.briefingTab);
      return;
    }
    navigateDailyTodoAction(navigate, action);
    onOpenWorkspace?.();
  };

  const addPlaceholder = useMemo(() => {
    if (isToday) return d.addPlaceholderToday;
    return d.addPlaceholderOther.replace('{date}', dateLabel);
  }, [isToday, d.addPlaceholderToday, d.addPlaceholderOther, dateLabel]);

  return (
    <div className="space-y-3">
      <div className={themeChrome.schedulePanel}>
        <div className="flex flex-wrap items-center gap-2">
          <Label className={themeChrome.scheduleLabel}>{d.scheduleFor}</Label>
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

      <p className="text-xs text-muted-foreground">{d.taskOpenHint}</p>

      <div className="space-y-2 max-h-[min(36vh,260px)] overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{d.emptyDay}</p>
        ) : (
          items.map((item) => {
            const action = resolveDailyTodoAction(item);
            return (
              <div
                key={item.id}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 transition-colors ${actionRowClass(action)}`}
              >
                <Checkbox
                  id={`${selectedDay}-${item.id}`}
                  checked={item.done}
                  onCheckedChange={(checked) =>
                    onItemsChange(updateDayTodo(selectedDay, item.id, { done: checked === true }))
                  }
                  className="mt-0.5"
                  aria-label={d.taskMarkDone}
                />
                <button
                  type="button"
                  className={`min-w-0 flex-1 text-left ${action ? 'hover:text-primary' : ''} ${
                    item.done ? 'line-through text-muted-foreground' : ''
                  }`}
                  onClick={() => openTask(item)}
                  disabled={!action}
                  title={action ? actionHint(action, d) : undefined}
                >
                  <span className="text-sm block">{item.text}</span>
                  {action ? (
                    <span className="text-[11px] text-muted-foreground font-normal no-underline">
                      {actionHint(action, d)}
                    </span>
                  ) : null}
                </button>
                {action ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-primary/70 hover:text-primary hover:bg-primary/10"
                    onClick={() => openTask(item, true)}
                    aria-label={actionHint(action, d)}
                    title={d.taskOpenFullPage}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
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
            );
          })
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
