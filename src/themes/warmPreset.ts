/** Warm coral / honey / apricot chrome — active try-out palette. */

export const warmToneIcon = {
  sky: 'bg-orange-100 text-orange-800',
  indigo: 'bg-rose-100 text-rose-700',
  emerald: 'bg-lime-100 text-lime-800',
  amber: 'bg-amber-100 text-amber-900',
  slate: 'bg-stone-100 text-stone-600',
  rose: 'bg-rose-100 text-rose-700',
} as const;

export const warmToneTile = {
  sky: 'bg-gradient-to-br from-orange-100 to-amber-50 border-orange-300/80 text-orange-950 hover:from-orange-200/90 hover:to-amber-100 [&_svg]:text-orange-700',
  indigo: 'bg-gradient-to-br from-rose-100 to-orange-50 border-rose-300/70 text-rose-950 hover:from-rose-200/90 hover:to-orange-100 [&_svg]:text-rose-600',
  emerald: 'bg-gradient-to-br from-lime-100 to-amber-50 border-lime-300/80 text-lime-950 hover:from-lime-200/90 hover:to-amber-100 [&_svg]:text-lime-700',
  amber: 'bg-gradient-to-br from-amber-100 to-orange-50 border-amber-400/80 text-amber-950 hover:from-amber-200/90 hover:to-orange-100 [&_svg]:text-amber-700',
  slate: 'bg-gradient-to-br from-stone-100 to-orange-50 border-stone-300/70 text-stone-800 hover:from-stone-200/80 hover:to-orange-100 [&_svg]:text-stone-600',
  rose: 'bg-gradient-to-br from-rose-100 to-amber-50 border-rose-300/80 text-rose-950 hover:from-rose-200/90 hover:to-amber-100 [&_svg]:text-rose-600',
} as const;

export const warmStatCardTone = {
  sky: 'border-orange-300/90 bg-gradient-to-br from-orange-100 via-amber-50 to-yellow-50 shadow-md shadow-orange-200/50 border-l-4 border-l-orange-500',
  indigo: 'border-rose-300/80 bg-gradient-to-br from-rose-100 via-rose-50 to-orange-50 shadow-md shadow-rose-200/40 border-l-4 border-l-rose-500',
  emerald: 'border-lime-300/90 bg-gradient-to-br from-lime-100 via-lime-50 to-amber-50 shadow-md shadow-lime-200/50 border-l-4 border-l-lime-600',
  amber: 'border-amber-400/90 bg-gradient-to-br from-amber-100 via-amber-50 to-orange-50 shadow-md shadow-amber-200/50 border-l-4 border-l-amber-500',
  slate: 'border-stone-300/80 bg-gradient-to-br from-stone-100 via-white to-orange-50 shadow-sm border-l-4 border-l-stone-400',
  rose: 'border-rose-300/90 bg-gradient-to-br from-rose-100 via-rose-50 to-orange-50 shadow-md shadow-rose-200/50 border-l-4 border-l-rose-500',
} as const;

export const warmFlowStep = [
  'bg-orange-100 border-orange-300 text-orange-950 hover:bg-orange-200/90 [&_svg]:text-orange-700',
  'bg-amber-100 border-amber-400 text-amber-950 hover:bg-amber-200/90 [&_svg]:text-amber-700',
  'bg-rose-100 border-rose-300 text-rose-950 hover:bg-rose-200/90 [&_svg]:text-rose-600',
  'bg-lime-100 border-lime-300 text-lime-950 hover:bg-lime-200/90 [&_svg]:text-lime-700',
  'bg-yellow-100 border-yellow-400 text-yellow-950 hover:bg-yellow-200/90 [&_svg]:text-yellow-700',
];

export const warmPageSurface = 'bg-gradient-to-b from-orange-50/70 via-amber-50/40 to-rose-50/30 min-h-full';
export const warmSectionLabel = 'text-xs font-semibold text-orange-800/80 uppercase tracking-widest';

export const warmToolbar = {
  btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-orange-950/80 border-orange-200/70 bg-orange-50/60 hover:bg-orange-100 hover:text-orange-950 hover:border-orange-300',
  btnSm: 'h-7 text-xs gap-1 text-orange-950/80 hover:bg-orange-100 hover:text-orange-950',
  action: 'h-6 text-xs gap-1 text-orange-950/80 hover:bg-orange-100 hover:text-orange-950',
  tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:text-orange-900',
  pill: 'h-9 rounded-xl gap-2 px-3.5 text-xs font-medium shadow-sm border-orange-200/80 bg-gradient-to-b from-white to-orange-50 text-orange-950 hover:from-orange-50 hover:to-amber-100 hover:border-orange-300 transition-all',
  pillPrimary:
    'h-9 rounded-xl gap-2 px-3.5 text-xs font-semibold shadow-sm border-amber-400/80 bg-gradient-to-b from-amber-50 to-orange-100 text-amber-950 hover:from-amber-100 hover:to-orange-200 hover:border-amber-500/70 transition-all',
  feature:
    'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-md shadow-orange-100/80 border-orange-300/70 bg-gradient-to-br from-orange-100 via-amber-50 to-rose-50 text-orange-950 hover:from-orange-200/90 hover:via-amber-100 hover:to-rose-100 hover:border-orange-400/70 transition-all flex items-center text-left group',
};

export const warmChrome = {
  navRow1:
    'h-10 px-3 bg-gradient-to-r from-orange-200/90 via-amber-100 to-rose-200/70 text-sidebar-foreground hidden lg:flex items-center justify-between border-b border-orange-300/70 shadow-md shadow-orange-200/50',
  navRow1Mobile:
    'h-14 px-4 flex lg:hidden items-center justify-between bg-gradient-to-r from-orange-200/90 via-amber-100 to-rose-200/70 text-sidebar-foreground border-b border-orange-300/70 shadow-md shadow-orange-200/50',
  navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-orange-300/60',
  navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-white/80 ring-2 ring-orange-300/70 flex items-center justify-center',
  navBrand: 'font-bold text-sm tracking-tight text-orange-900',
  navMenuBtn:
    'h-7 px-2.5 text-xs font-medium text-orange-950/80 hover:text-orange-950 hover:bg-white/60 rounded-md',
  checklistIconBtn:
    'h-7 w-7 rounded-md bg-amber-300/80 text-amber-950 hover:bg-amber-400/80 hover:text-amber-950',
  navTabsRow:
    'h-10 px-2 bg-gradient-to-r from-orange-100 via-amber-50 to-rose-100/80 hidden lg:flex items-end gap-0.5 border-b border-orange-200/70 overflow-x-auto',
  navTabActive:
    'bg-white text-orange-900 border-t-[3px] border-x border-t-orange-500 border-x-orange-200 -mb-px shadow-sm',
  navTabIdle: 'text-orange-900/70 hover:text-orange-950 hover:bg-white/70',
  checklistTab:
    'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-amber-950 bg-amber-200/80 hover:bg-amber-300/80 ml-0.5 border border-amber-300/80 border-b-0',
  toolbarRow:
    'h-10 px-3 bg-gradient-to-r from-orange-50/90 via-amber-50/60 to-rose-50/50 hidden lg:flex items-center gap-1.5 border-b border-orange-100 overflow-x-auto',
  dashboardSurface:
    'flex-1 p-6 overflow-auto space-y-6 bg-gradient-to-b from-orange-50/60 via-amber-50/30 to-rose-50/25',
  documentFlowCard:
    'border-orange-200/80 bg-gradient-to-br from-white via-amber-50/50 to-rose-50/50 shadow-md shadow-orange-100/50 overflow-hidden',
  documentFlowArrow: 'w-4 h-4 text-orange-400 flex-shrink-0',
  checklistDialog:
    'max-w-md sm:max-w-2xl border-orange-300/80 bg-gradient-to-b from-orange-50 via-amber-50/80 to-rose-50/70 shadow-xl shadow-orange-200/40',
  checklistIcon:
    'flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md shadow-orange-300/50',
  checklistTabsList:
    'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-white/70 border border-orange-200/80 shadow-sm',
  checklistStartBtn: 'gap-1 bg-orange-600 hover:bg-orange-700 text-white',
  schedulePanel:
    'space-y-3 rounded-md border-2 border-orange-300/80 bg-gradient-to-br from-orange-100/80 via-amber-50 to-rose-100/70 p-3 shadow-sm shadow-orange-200/40',
  scheduleLabel: 'text-xs shrink-0 text-orange-900 font-semibold',
  rowInvoices: 'border-orange-300 bg-orange-100/80 hover:bg-orange-100 shadow-sm shadow-orange-200/40',
  rowStock: 'border-amber-400 bg-amber-100/90 hover:bg-amber-100 shadow-sm shadow-amber-200/50',
  rowCaixa: 'border-lime-400 bg-lime-100/80 hover:bg-lime-100 shadow-sm shadow-lime-200/40',
  rowAr: 'border-yellow-400 bg-yellow-100/80 hover:bg-yellow-100 shadow-sm shadow-yellow-200/40',
  rowAp: 'border-rose-300 bg-rose-100/80 hover:bg-rose-100 shadow-sm shadow-rose-200/40',
  rowPayments: 'border-orange-300 bg-orange-50 hover:bg-orange-100 shadow-sm shadow-orange-200/40',
  rowPurchases: 'border-rose-300 bg-rose-50 hover:bg-rose-100 shadow-sm shadow-rose-200/40',
  rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
  tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-orange-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-lime-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-orange-500 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-rose-500 data-[state=active]:text-white data-[state=active]:shadow-md',
  badgeTasks: 'bg-orange-100 text-orange-900 border-orange-200',
};
