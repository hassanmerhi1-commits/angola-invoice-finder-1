import {
  DEFAULT_TODO_ACTIONS,
  inferActionFromText,
  resolveDailyTodoAction,
  type DailyTodoAction,
} from '@/lib/dailyTodoActions';

export interface DailyTodoItem {
  id: string;
  text: string;
  done: boolean;
  /** Stable destination when the user opens this task (ERP activity pattern). */
  action?: DailyTodoAction;
}

export interface DailyTodosState {
  enabled: boolean;
  templateItems: string[];
  lastShownDate: string | null;
  days: Record<string, { items: DailyTodoItem[] }>;
}

const STORAGE_KEY = 'nexor:daily-todos:v1';
export const DAILY_TODOS_CHANGED_EVENT = 'nexor:daily-todos-changed';

/** Fallback English labels when seeding before i18n is available. */
const DEFAULT_TEMPLATE = [
  'Review pending sales invoices and receipts',
  'Check inventory / low-stock items',
  'Reconcile cash register (caixa)',
  'Follow up on overdue customer balances',
];

/** In-memory cache so rapid read/write in the same tick never sees stale localStorage. */
let stateCache: DailyTodosState | null = null;

function newId(): string {
  return `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItem(item: Partial<DailyTodoItem> & { id: string; text: string; done: boolean }): DailyTodoItem {
  const action =
    item.action
    ?? resolveDailyTodoAction({ text: item.text, action: item.action })
    ?? undefined;
  return action ? { id: item.id, text: item.text, done: item.done, action } : { id: item.id, text: item.text, done: item.done };
}

/** Local calendar date YYYY-MM-DD (not UTC). */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

function defaultState(): DailyTodosState {
  return {
    enabled: true,
    templateItems: [...DEFAULT_TEMPLATE],
    lastShownDate: null,
    days: {},
  };
}

function seedTemplateItems(templateItems: string[]): DailyTodoItem[] {
  return templateItems.map((text, index) => {
    const action =
      inferActionFromText(text)
      ?? DEFAULT_TODO_ACTIONS[index]
      ?? undefined;
    return normalizeItem({ id: newId(), text, done: false, action });
  });
}

function parseStoredState(raw: string): DailyTodosState {
  const parsed = JSON.parse(raw) as DailyTodosState;
  const days: DailyTodosState['days'] = {};
  if (parsed.days && typeof parsed.days === 'object') {
    for (const [key, bucket] of Object.entries(parsed.days)) {
      const items = bucket?.items;
      days[key] = {
        items: Array.isArray(items)
          ? items
              .filter(
                (item): item is DailyTodoItem =>
                  !!item
                  && typeof item.id === 'string'
                  && typeof item.text === 'string'
                  && typeof item.done === 'boolean',
              )
              .map((item) => normalizeItem(item))
          : [],
      };
    }
  }
  return {
    ...defaultState(),
    ...parsed,
    templateItems:
      Array.isArray(parsed.templateItems) && parsed.templateItems.length > 0
        ? parsed.templateItems
        : defaultState().templateItems,
    days,
  };
}

function loadFromStorage(): DailyTodosState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return parseStoredState(raw);
  } catch {
    return defaultState();
  }
}

export function readDailyTodosState(): DailyTodosState {
  if (!stateCache) stateCache = loadFromStorage();
  return stateCache;
}

export function writeDailyTodosState(state: DailyTodosState): DailyTodosState {
  stateCache = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(DAILY_TODOS_CHANGED_EVENT));
  } catch (e) {
    console.error('[dailyTodos] failed to persist', e);
  }
  return state;
}

export function setDailyTodosEnabled(enabled: boolean): DailyTodosState {
  return writeDailyTodosState({ ...readDailyTodosState(), enabled });
}

export function setDailyTodoTemplateItems(templateItems: string[]): DailyTodosState {
  const cleaned = templateItems.map((t) => t.trim()).filter(Boolean);
  return writeDailyTodosState({ ...readDailyTodosState(), templateItems: cleaned });
}

export function markDailyTodoShown(date = todayKey()): DailyTodosState {
  return writeDailyTodosState({ ...readDailyTodosState(), lastShownDate: date });
}

export function requestDailyTodoPopup(): DailyTodosState {
  return writeDailyTodosState({ ...readDailyTodosState(), lastShownDate: null });
}

export function shouldShowDailyTodoDialog(): boolean {
  const state = readDailyTodosState();
  if (!state.enabled) return false;
  return state.lastShownDate !== todayKey();
}

export function listScheduledDayKeys(): string[] {
  const state = readDailyTodosState();
  return Object.keys(state.days)
    .filter((key) => (state.days[key]?.items?.length ?? 0) > 0)
    .sort();
}

export function getDayTodos(dateKey: string): DailyTodoItem[] {
  const items = readDailyTodosState().days[dateKey]?.items;
  return Array.isArray(items) ? [...items] : [];
}

export function saveDayTodos(dateKey: string, items: DailyTodoItem[]): DailyTodoItem[] {
  const state = readDailyTodosState();
  const normalized = items.map((item) => normalizeItem(item));
  writeDailyTodosState({
    ...state,
    days: { ...state.days, [dateKey]: { items: normalized } },
  });
  return normalized;
}

/**
 * Load tasks for a day. Seeds default template only the first time today is opened.
 */
export function ensureDayTodos(dateKey: string): DailyTodoItem[] {
  const state = readDailyTodosState();
  if (Object.prototype.hasOwnProperty.call(state.days, dateKey)) {
    return [...(state.days[dateKey]?.items ?? [])].map((item) => normalizeItem(item));
  }

  const isToday = dateKey === todayKey();
  const items = isToday ? seedTemplateItems(state.templateItems) : [];
  writeDailyTodosState({
    ...state,
    days: { ...state.days, [dateKey]: { items } },
  });
  return [...items];
}

export function addDayTodo(dateKey: string, text: string): DailyTodoItem[] {
  const trimmed = text.trim();
  if (!trimmed) return getDayTodos(dateKey);

  const state = readDailyTodosState();
  const current = Object.prototype.hasOwnProperty.call(state.days, dateKey)
    ? [...(state.days[dateKey]?.items ?? [])]
    : ensureDayTodos(dateKey);

  const action = inferActionFromText(trimmed) ?? undefined;
  const items = [
    ...current,
    normalizeItem({ id: newId(), text: trimmed, done: false, action }),
  ];
  return saveDayTodos(dateKey, items);
}

export function updateDayTodo(
  dateKey: string,
  id: string,
  patch: Partial<DailyTodoItem>,
): DailyTodoItem[] {
  const current = getDayTodos(dateKey);
  const base = current.length > 0 ? current : ensureDayTodos(dateKey);
  const items = base.map((item) =>
    (item.id === id ? normalizeItem({ ...item, ...patch }) : item));
  return saveDayTodos(dateKey, items);
}

export function removeDayTodo(dateKey: string, id: string): DailyTodoItem[] {
  const current = getDayTodos(dateKey);
  const base = current.length > 0 ? current : ensureDayTodos(dateKey);
  const items = base.filter((item) => item.id !== id);
  return saveDayTodos(dateKey, items);
}

export function ensureTodayTodos(): DailyTodoItem[] {
  return ensureDayTodos(todayKey());
}

export function getTodayTodos(): DailyTodoItem[] {
  return getDayTodos(todayKey());
}

export function saveTodayTodos(items: DailyTodoItem[]): DailyTodoItem[] {
  return saveDayTodos(todayKey(), items);
}

export function addTodayTodo(text: string): DailyTodoItem[] {
  return addDayTodo(todayKey(), text);
}

export function updateTodayTodo(id: string, patch: Partial<DailyTodoItem>): DailyTodoItem[] {
  return updateDayTodo(todayKey(), id, patch);
}

export function removeTodayTodo(id: string): DailyTodoItem[] {
  return removeDayTodo(todayKey(), id);
}
