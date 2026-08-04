/** Preserved cool teal/cyan chrome — restore via setColorTheme('cool'). */

export const coolToneIcon = {
  sky: 'bg-sky-100 text-sky-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-100 text-rose-700',
} as const;

export const coolToneTile = {
  sky: 'bg-gradient-to-br from-sky-100 to-cyan-50 border-sky-300/80 text-sky-900 hover:from-sky-200/90 hover:to-cyan-100 [&_svg]:text-sky-600',
  indigo: 'bg-gradient-to-br from-indigo-100 to-sky-50 border-indigo-300/70 text-indigo-900 hover:from-indigo-200/90 hover:to-sky-100 [&_svg]:text-indigo-600',
  emerald: 'bg-gradient-to-br from-emerald-100 to-teal-50 border-emerald-300/80 text-emerald-900 hover:from-emerald-200/90 hover:to-teal-100 [&_svg]:text-emerald-600',
  amber: 'bg-gradient-to-br from-amber-100 to-orange-50 border-amber-300/80 text-amber-950 hover:from-amber-200/90 hover:to-orange-100 [&_svg]:text-amber-700',
  slate: 'bg-gradient-to-br from-slate-100 to-sky-50 border-slate-300/70 text-slate-800 hover:from-slate-200/80 hover:to-sky-100 [&_svg]:text-slate-600',
  rose: 'bg-gradient-to-br from-rose-100 to-orange-50 border-rose-300/80 text-rose-900 hover:from-rose-200/90 hover:to-orange-100 [&_svg]:text-rose-600',
} as const;

export const coolStatCardTone = {
  sky: 'border-sky-300/90 bg-gradient-to-br from-sky-100 via-sky-50 to-cyan-50 shadow-md shadow-sky-200/50 border-l-4 border-l-sky-500',
  indigo: 'border-indigo-300/80 bg-gradient-to-br from-indigo-100 via-indigo-50 to-sky-50 shadow-md shadow-indigo-200/40 border-l-4 border-l-indigo-500',
  emerald: 'border-emerald-300/90 bg-gradient-to-br from-emerald-100 via-emerald-50 to-teal-50 shadow-md shadow-emerald-200/50 border-l-4 border-l-emerald-500',
  amber: 'border-amber-300/90 bg-gradient-to-br from-amber-100 via-amber-50 to-orange-50 shadow-md shadow-amber-200/50 border-l-4 border-l-amber-500',
  slate: 'border-slate-300/80 bg-gradient-to-br from-slate-100 via-white to-sky-50 shadow-sm border-l-4 border-l-slate-400',
  rose: 'border-rose-300/90 bg-gradient-to-br from-rose-100 via-rose-50 to-orange-50 shadow-md shadow-rose-200/50 border-l-4 border-l-rose-500',
} as const;

export const coolFlowStep = [
  'bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200/90 [&_svg]:text-sky-600',
  'bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200/90 [&_svg]:text-emerald-600',
  'bg-amber-100 border-amber-300 text-amber-950 hover:bg-amber-200/90 [&_svg]:text-amber-700',
  'bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200/90 [&_svg]:text-rose-600',
  'bg-indigo-100 border-indigo-300 text-indigo-900 hover:bg-indigo-200/90 [&_svg]:text-indigo-600',
];

export const coolPageSurface = 'bg-gradient-to-b from-cyan-50/70 via-sky-50/40 to-emerald-50/40 min-h-full';
export const coolSectionLabel = 'text-xs font-semibold text-teal-700/80 uppercase tracking-widest';

export const coolToolbar = {
  btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-sky-900/80 border-sky-200/60 bg-sky-50/50 hover:bg-sky-100 hover:text-sky-950 hover:border-sky-300',
  btnSm: 'h-7 text-xs gap-1 text-sky-900/80 hover:bg-sky-100 hover:text-sky-950',
  action: 'h-6 text-xs gap-1 text-sky-900/80 hover:bg-sky-100 hover:text-sky-950',
  tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-sky-500 data-[state=active]:text-sky-800',
  pill: 'h-9 rounded-xl gap-2 px-3.5 text-xs font-medium shadow-sm border-sky-200/80 bg-gradient-to-b from-white to-sky-50 text-sky-900 hover:from-sky-50 hover:to-sky-100 hover:border-sky-300 transition-all',
  pillPrimary:
    'h-9 rounded-xl gap-2 px-3.5 text-xs font-semibold shadow-sm border-teal-300/80 bg-gradient-to-b from-teal-50 to-emerald-100 text-teal-950 hover:from-teal-100 hover:to-emerald-200 hover:border-teal-400/70 transition-all',
  feature:
    'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-md shadow-teal-100/80 border-teal-300/70 bg-gradient-to-br from-teal-100 via-emerald-50 to-cyan-50 text-teal-950 hover:from-teal-200/90 hover:via-emerald-100 hover:to-cyan-100 hover:border-teal-400/70 transition-all flex items-center text-left group',
};

export const coolChrome = {
  navRow1:
    'h-10 px-3 bg-gradient-to-r from-sky-200/80 via-cyan-100 to-emerald-200/70 text-sidebar-foreground hidden lg:flex items-center justify-between border-b border-teal-200/80 shadow-md shadow-sky-200/40',
  navRow1Mobile:
    'h-14 px-4 flex lg:hidden items-center justify-between bg-gradient-to-r from-sky-200/80 via-cyan-100 to-emerald-200/70 text-sidebar-foreground border-b border-teal-200/80 shadow-md shadow-sky-200/40',
  navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-teal-300/50',
  navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-white/80 ring-2 ring-sky-300/60 flex items-center justify-center',
  navBrand: 'font-bold text-sm tracking-tight text-teal-800',
  navMenuBtn:
    'h-7 px-2.5 text-xs font-medium text-teal-900/80 hover:text-teal-950 hover:bg-white/60 rounded-md',
  checklistIconBtn:
    'h-7 w-7 rounded-md bg-amber-200/70 text-amber-900 hover:bg-amber-300/80 hover:text-amber-950',
  navTabsRow:
    'h-10 px-2 bg-gradient-to-r from-sky-100 via-cyan-50 to-emerald-100/80 hidden lg:flex items-end gap-0.5 border-b border-teal-200/60 overflow-x-auto',
  navTabActive:
    'bg-white text-teal-800 border-t-[3px] border-x border-t-teal-500 border-x-teal-200 -mb-px shadow-sm',
  navTabIdle: 'text-teal-800/70 hover:text-teal-950 hover:bg-white/70',
  checklistTab:
    'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-amber-800 bg-amber-100/70 hover:bg-amber-200/80 ml-0.5 border border-amber-200/80 border-b-0',
  toolbarRow:
    'h-10 px-3 bg-gradient-to-r from-cyan-50/80 via-sky-50/50 to-amber-50/40 hidden lg:flex items-center gap-1.5 border-b border-sky-100 overflow-x-auto',
  dashboardSurface: 'flex-1 p-6 overflow-auto space-y-6 bg-gradient-to-b from-cyan-50/50 via-sky-50/25 to-amber-50/20',
  documentFlowCard:
    'border-teal-200/70 bg-gradient-to-br from-white via-cyan-50/40 to-emerald-50/50 shadow-md shadow-teal-100/40 overflow-hidden',
  documentFlowArrow: 'w-4 h-4 text-teal-400 flex-shrink-0',
  checklistDialog:
    'max-w-md sm:max-w-2xl border-teal-300/70 bg-gradient-to-b from-cyan-50 via-sky-50/80 to-amber-50/60 shadow-xl shadow-teal-200/40',
  checklistIcon:
    'flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-teal-500 text-white shadow-md shadow-sky-300/50',
  checklistTabsList:
    'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-white/70 border border-teal-200/70 shadow-sm',
  checklistStartBtn: 'gap-1 bg-emerald-600 hover:bg-emerald-700 text-white',
  schedulePanel:
    'space-y-3 rounded-md border-2 border-cyan-300/70 bg-gradient-to-br from-cyan-100/80 via-sky-50 to-emerald-100/70 p-3 shadow-sm shadow-cyan-200/40',
  scheduleLabel: 'text-xs shrink-0 text-teal-800 font-semibold',
  rowInvoices: 'border-sky-300 bg-sky-100/80 hover:bg-sky-100 shadow-sm shadow-sky-200/40',
  rowStock: 'border-amber-300 bg-amber-100/80 hover:bg-amber-100 shadow-sm shadow-amber-200/40',
  rowCaixa: 'border-emerald-300 bg-emerald-100/80 hover:bg-emerald-100 shadow-sm shadow-emerald-200/40',
  rowAr: 'border-teal-300 bg-teal-100/80 hover:bg-teal-100 shadow-sm shadow-teal-200/40',
  rowAp: 'border-rose-300 bg-rose-100/80 hover:bg-rose-100 shadow-sm shadow-rose-200/40',
  rowPayments: 'border-cyan-300 bg-cyan-100/80 hover:bg-cyan-100 shadow-sm shadow-cyan-200/40',
  rowPurchases: 'border-indigo-300 bg-indigo-100/70 hover:bg-indigo-100 shadow-sm shadow-indigo-200/40',
  rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
  tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-sky-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md',
  badgeTasks: 'bg-sky-100 text-sky-800 border-sky-200',
};
