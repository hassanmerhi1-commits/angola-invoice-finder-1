import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ListTodo } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useDailyBriefing } from '@/hooks/useDailyBriefing';
import { DailyTodoTasksPanel } from '@/components/daily/DailyTodoTasksPanel';
import { DailyTodoBriefingList } from '@/components/daily/DailyTodoBriefingList';
import { ensureDayTodos, markDailyTodoShown, todayKey, type DailyTodoItem } from '@/lib/dailyTodos';
import { themeChrome } from '@/themes/active';

interface DailyTodoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TabCount({ count, tone = 'tasks' }: { count: number; tone?: 'tasks' | 'amber' | 'emerald' | 'rose' | 'indigo' }) {
  if (count <= 0) return null;
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : tone === 'emerald'
        ? 'bg-lime-100 text-lime-800 border-lime-200'
        : tone === 'rose'
          ? 'bg-rose-100 text-rose-800 border-rose-200'
          : tone === 'indigo'
            ? 'bg-rose-100 text-rose-800 border-rose-200'
            : themeChrome.badgeTasks;
  return (
    <Badge variant="outline" className={`ml-1 h-5 min-w-5 px-1 text-[10px] font-semibold border ${toneClass}`}>
      {count > 99 ? '99+' : count}
    </Badge>
  );
}

export function DailyTodoDialog({ open, onOpenChange }: DailyTodoDialogProps) {
  const { t } = useTranslation();
  const d = t.dailyTodosUi;
  const { apiBranchId } = useBranchScope();
  const [selectedDay, setSelectedDay] = useState(() => todayKey());
  const [items, setItems] = useState<DailyTodoItem[]>([]);
  const [activeTab, setActiveTab] = useState('tasks');

  const briefing = useDailyBriefing(apiBranchId || undefined, open);

  const selectDay = useCallback((dateKey: string) => {
    setSelectedDay(dateKey);
    setItems(ensureDayTodos(dateKey));
  }, []);

  useEffect(() => {
    if (!open) return;
    selectDay(todayKey());
    setActiveTab('tasks');
  }, [open, selectDay]);

  const today = todayKey();
  const isToday = selectedDay === today;
  const pendingTasks = items.filter((i) => !i.done).length;

  const handleClose = (markShown: boolean) => {
    if (markShown && isToday) markDailyTodoShown();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose(isToday);
      }}
    >
      <DialogContent className={themeChrome.checklistDialog}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={themeChrome.checklistIcon}>
              <ListTodo className="h-5 w-5" />
            </span>
            {d.title}
          </DialogTitle>
          <DialogDescription>{d.subtitleBriefing}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={themeChrome.checklistTabsList}>
            <TabsTrigger value="tasks" className={themeChrome.tabActiveTasks}>
              {d.tabTasks}
              <TabCount count={pendingTasks} tone="tasks" />
            </TabsTrigger>
            <TabsTrigger value="lowStock" className={themeChrome.tabActiveStock}>
              {d.tabLowStock}
              <TabCount count={briefing.counts.lowStock} tone="amber" />
            </TabsTrigger>
            <TabsTrigger value="receivables" className={themeChrome.tabActiveAr}>
              {d.tabReceivables}
              <TabCount count={briefing.counts.receivables} tone="emerald" />
            </TabsTrigger>
            <TabsTrigger value="payables" className={themeChrome.tabActiveAp}>
              {d.tabPayables}
              <TabCount count={briefing.counts.payables} tone="rose" />
            </TabsTrigger>
            <TabsTrigger value="toPrint" className={themeChrome.tabActivePrint}>
              {d.tabToPrint}
              <TabCount count={briefing.counts.unprinted} tone="tasks" />
            </TabsTrigger>
            <TabsTrigger value="priceChanges" className={themeChrome.tabActivePrices}>
              {d.tabPriceChanges}
              <TabCount count={briefing.counts.priceChanges} tone="indigo" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="mt-3 focus-visible:outline-none">
            <DailyTodoTasksPanel
              selectedDay={selectedDay}
              items={items}
              onSelectDay={selectDay}
              onItemsChange={setItems}
              onOpenBriefingTab={(tab) => setActiveTab(tab)}
              onOpenWorkspace={() => handleClose(isToday)}
            />
          </TabsContent>

          <TabsContent value="lowStock" className="mt-3 focus-visible:outline-none">
            <DailyTodoBriefingList
              kind="lowStock"
              loading={briefing.loading}
              error={briefing.error}
              lowStock={briefing.lowStock}
              onRefresh={briefing.refresh}
              onNavigateAway={() => handleClose(isToday)}
            />
          </TabsContent>

          <TabsContent value="receivables" className="mt-3 focus-visible:outline-none">
            <DailyTodoBriefingList
              kind="receivables"
              loading={briefing.loading}
              error={briefing.error}
              dueItems={briefing.receivables}
              onRefresh={briefing.refresh}
              onNavigateAway={() => handleClose(isToday)}
            />
          </TabsContent>

          <TabsContent value="payables" className="mt-3 focus-visible:outline-none">
            <DailyTodoBriefingList
              kind="payables"
              loading={briefing.loading}
              error={briefing.error}
              dueItems={briefing.payables}
              onRefresh={briefing.refresh}
              onNavigateAway={() => handleClose(isToday)}
            />
          </TabsContent>

          <TabsContent value="toPrint" className="mt-3 focus-visible:outline-none">
            <DailyTodoBriefingList
              kind="toPrint"
              loading={briefing.loading}
              error={briefing.error}
              unprinted={briefing.unprintedInvoices}
              onRefresh={briefing.refresh}
              onNavigateAway={() => handleClose(isToday)}
            />
          </TabsContent>

          <TabsContent value="priceChanges" className="mt-3 focus-visible:outline-none">
            <DailyTodoBriefingList
              kind="priceChanges"
              loading={briefing.loading}
              error={briefing.error}
              priceChanges={briefing.priceChanges}
              onRefresh={briefing.refresh}
              onNavigateAway={() => handleClose(isToday)}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => handleClose(isToday)}>
            {isToday ? d.skipToday : t.common.close}
          </Button>
          {isToday && (
            <Button type="button" onClick={() => handleClose(true)} className={themeChrome.checklistStartBtn}>
              <CheckCircle2 className="h-4 w-4" />
              {d.startDay}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
