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

interface DailyTodoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-[10px] font-semibold">
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
      <DialogContent className="max-w-md sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" />
            {d.title}
          </DialogTitle>
          <DialogDescription>{d.subtitleBriefing}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
            <TabsTrigger value="tasks" className="text-xs sm:text-sm">
              {d.tabTasks}
              <TabCount count={pendingTasks} />
            </TabsTrigger>
            <TabsTrigger value="lowStock" className="text-xs sm:text-sm">
              {d.tabLowStock}
              <TabCount count={briefing.counts.lowStock} />
            </TabsTrigger>
            <TabsTrigger value="receivables" className="text-xs sm:text-sm">
              {d.tabReceivables}
              <TabCount count={briefing.counts.receivables} />
            </TabsTrigger>
            <TabsTrigger value="payables" className="text-xs sm:text-sm">
              {d.tabPayables}
              <TabCount count={briefing.counts.payables} />
            </TabsTrigger>
            <TabsTrigger value="toPrint" className="text-xs sm:text-sm">
              {d.tabToPrint}
              <TabCount count={briefing.counts.unprinted} />
            </TabsTrigger>
            <TabsTrigger value="priceChanges" className="text-xs sm:text-sm">
              {d.tabPriceChanges}
              <TabCount count={briefing.counts.priceChanges} />
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
            <Button type="button" onClick={() => handleClose(true)} className="gap-1">
              <CheckCircle2 className="h-4 w-4" />
              {d.startDay}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
