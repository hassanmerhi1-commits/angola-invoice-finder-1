import type { ThemePreset } from '@/themes/types';

/** Balanced colorful — soft teal/sky, between light and cold. */
export const mediumPreset: ThemePreset = {
  id: 'medium',
  swatches: ['#e0f2fe', '#14b8a6', '#0ea5e9'],
  toneIcon: {
    sky: 'bg-sky-100 text-sky-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-100 text-rose-700',
  },
  toneTile: {
    sky: 'bg-gradient-to-br from-sky-50 to-cyan-50 border-sky-200/80 text-sky-900 hover:from-sky-100 hover:to-cyan-100 [&_svg]:text-sky-600',
    indigo: 'bg-gradient-to-br from-indigo-50 to-sky-50 border-indigo-200/70 text-indigo-900 hover:from-indigo-100 hover:to-sky-100 [&_svg]:text-indigo-600',
    emerald: 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200/80 text-emerald-900 hover:from-emerald-100 hover:to-teal-100 [&_svg]:text-emerald-600',
    amber: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200/80 text-amber-950 hover:from-amber-100 hover:to-orange-100 [&_svg]:text-amber-700',
    slate: 'bg-gradient-to-br from-slate-50 to-sky-50 border-slate-200/70 text-slate-800 hover:from-slate-100 hover:to-sky-100 [&_svg]:text-slate-600',
    rose: 'bg-gradient-to-br from-rose-50 to-orange-50 border-rose-200/80 text-rose-900 hover:from-rose-100 hover:to-orange-100 [&_svg]:text-rose-600',
  },
  statCardTone: {
    sky: 'border-sky-200/80 bg-gradient-to-br from-sky-50/90 via-white to-cyan-50/40 shadow-sm shadow-sky-100/60 border-l-4 border-l-sky-400',
    indigo: 'border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/30 shadow-sm border-l-4 border-l-indigo-400',
    emerald: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 shadow-sm border-l-4 border-l-emerald-400',
    amber: 'border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/30 shadow-sm border-l-4 border-l-amber-400',
    slate: 'border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-sky-50/20 shadow-sm border-l-4 border-l-slate-400',
    rose: 'border-rose-200/80 bg-gradient-to-br from-rose-50/90 via-white to-orange-50/30 shadow-sm border-l-4 border-l-rose-400',
  },
  flowStep: [
    'bg-sky-50 border-sky-200 text-sky-900 hover:bg-sky-100/90 [&_svg]:text-sky-600',
    'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100/90 [&_svg]:text-emerald-600',
    'bg-amber-50 border-amber-200 text-amber-950 hover:bg-amber-100/90 [&_svg]:text-amber-700',
    'bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100/90 [&_svg]:text-rose-600',
    'bg-teal-50 border-teal-200 text-teal-900 hover:bg-teal-100/90 [&_svg]:text-teal-600',
  ],
  pageSurface: 'bg-gradient-to-b from-sky-50/50 via-background to-emerald-50/20 min-h-full',
  sectionLabel: 'text-xs font-semibold text-teal-700/70 uppercase tracking-widest',
  toolbar: {
    btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-sky-900/80 border-sky-200/50 bg-sky-50/40 hover:bg-sky-100 hover:border-sky-300',
    btnSm: 'h-7 text-xs gap-1 text-sky-900/80 hover:bg-sky-100',
    action: 'h-6 text-xs gap-1 text-sky-900/80 hover:bg-sky-100',
    tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-sky-500 data-[state=active]:text-sky-800',
    pill: 'h-9 rounded-xl gap-2 px-3.5 text-xs font-medium shadow-sm border-sky-200/70 bg-gradient-to-b from-white to-sky-50/80 text-sky-900 hover:to-sky-100 transition-all',
    pillPrimary:
      'h-9 rounded-xl gap-2 px-3.5 text-xs font-semibold shadow-sm border-teal-200/80 bg-gradient-to-b from-teal-50 to-emerald-50 text-teal-950 hover:from-teal-100 hover:to-emerald-100 transition-all',
    feature:
      'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-sm border-teal-200/70 bg-gradient-to-br from-teal-50 via-emerald-50/60 to-cyan-50 text-teal-950 hover:from-teal-100 transition-all flex items-center text-left group',
  },
  chrome: {
    navRow1:
      'h-10 px-3 bg-gradient-to-r from-sky-50 via-sidebar to-emerald-50/60 text-sidebar-foreground hidden lg:flex items-center justify-between border-b border-sky-100 shadow-sm',
    navRow1Mobile:
      'h-14 px-4 flex lg:hidden items-center justify-between bg-gradient-to-r from-sky-50 via-sidebar to-emerald-50/60 text-sidebar-foreground border-b border-sky-100 shadow-sm',
    navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-sky-200/60',
    navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-white/80 ring-2 ring-sky-200/70 flex items-center justify-center',
    navBrand: 'font-bold text-sm tracking-tight text-teal-800',
    navMenuBtn:
      'h-7 px-2.5 text-xs font-medium text-teal-900/75 hover:text-teal-950 hover:bg-white/60 rounded-md',
    checklistIconBtn:
      'h-7 w-7 rounded-md bg-amber-100/80 text-amber-900 hover:bg-amber-200/80',
    navTabsRow:
      'h-10 px-2 bg-gradient-to-r from-card via-sky-50/40 to-card hidden lg:flex items-end gap-0.5 border-b border-sky-100 overflow-x-auto',
    navTabActive:
      'bg-white text-teal-800 border-t-[3px] border-x border-t-teal-500 border-x-sky-100 -mb-px shadow-sm',
    navTabIdle: 'text-teal-800/65 hover:text-teal-950 hover:bg-sky-50/80',
    checklistTab:
      'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-amber-800 bg-amber-50 hover:bg-amber-100 ml-0.5 border border-amber-200/60 border-b-0',
    toolbarRow:
      'h-10 px-3 bg-gradient-to-r from-sky-50/60 via-background to-emerald-50/30 hidden lg:flex items-center gap-1.5 border-b border-sky-100 overflow-x-auto',
    dashboardSurface: 'flex-1 p-6 overflow-auto space-y-6 bg-gradient-to-b from-sky-50/40 via-transparent to-emerald-50/15',
    documentFlowCard:
      'border-sky-200/60 bg-gradient-to-br from-white via-sky-50/30 to-emerald-50/30 shadow-sm overflow-hidden',
    documentFlowArrow: 'w-4 h-4 text-teal-300 flex-shrink-0',
    checklistDialog:
      'max-w-md sm:max-w-2xl border-sky-200/60 bg-gradient-to-b from-sky-50/50 via-background to-emerald-50/20 shadow-xl',
    checklistIcon:
      'flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-teal-500 text-white shadow-md shadow-sky-200/40',
    checklistTabsList:
      'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-white/70 border border-sky-200/60 shadow-sm',
    checklistStartBtn: 'gap-1 bg-teal-600 hover:bg-teal-700 text-white',
    schedulePanel:
      'space-y-3 rounded-md border border-sky-200/70 bg-gradient-to-br from-sky-50/80 via-background to-emerald-50/40 p-3',
    scheduleLabel: 'text-xs shrink-0 text-teal-800/80 font-semibold',
    rowInvoices: 'border-sky-200/80 bg-sky-50/60 hover:bg-sky-50',
    rowStock: 'border-amber-200/80 bg-amber-50/60 hover:bg-amber-50',
    rowCaixa: 'border-emerald-200/80 bg-emerald-50/60 hover:bg-emerald-50',
    rowAr: 'border-teal-200/80 bg-teal-50/60 hover:bg-teal-50',
    rowAp: 'border-rose-200/80 bg-rose-50/60 hover:bg-rose-50',
    rowPayments: 'border-cyan-200/80 bg-cyan-50/60 hover:bg-cyan-50',
    rowPurchases: 'border-indigo-200/80 bg-indigo-50/50 hover:bg-indigo-50',
    rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
    tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-sky-600 data-[state=active]:text-white data-[state=active]:shadow-md',
    tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-md',
    tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md',
    tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md',
    tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-md',
    tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md',
    badgeTasks: 'bg-sky-100 text-sky-800 border-sky-200',
  },
};
