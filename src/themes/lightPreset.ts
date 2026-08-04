import type { ThemePreset } from '@/themes/types';

/** Soft neutral — low color, professional slate/sky. */
export const lightPreset: ThemePreset = {
  id: 'light',
  swatches: ['#f8fafc', '#94a3b8', '#0ea5e9'],
  toneIcon: {
    sky: 'bg-sky-50 text-sky-600',
    indigo: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
    rose: 'bg-rose-50 text-rose-600',
  },
  toneTile: {
    sky: 'bg-sky-50/90 border-sky-200/70 text-sky-900 hover:bg-sky-100/80 [&_svg]:text-sky-600',
    indigo: 'bg-slate-50/90 border-slate-200/70 text-slate-800 hover:bg-slate-100/80 [&_svg]:text-slate-600',
    emerald: 'bg-emerald-50/90 border-emerald-200/70 text-emerald-900 hover:bg-emerald-100/80 [&_svg]:text-emerald-600',
    amber: 'bg-amber-50/90 border-amber-200/70 text-amber-950 hover:bg-amber-100/80 [&_svg]:text-amber-700',
    slate: 'bg-slate-50/90 border-slate-200/70 text-slate-700 hover:bg-slate-100/80 [&_svg]:text-slate-500',
    rose: 'bg-rose-50/90 border-rose-200/70 text-rose-900 hover:bg-rose-100/80 [&_svg]:text-rose-600',
  },
  statCardTone: {
    sky: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-sky-400',
    indigo: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-slate-400',
    emerald: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-emerald-400',
    amber: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-amber-400',
    slate: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-slate-400',
    rose: 'border-slate-200/80 bg-white shadow-sm border-l-4 border-l-rose-400',
  },
  flowStep: [
    'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100 [&_svg]:text-sky-600',
    'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100 [&_svg]:text-emerald-600',
    'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100 [&_svg]:text-amber-600',
    'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100 [&_svg]:text-rose-600',
    'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100 [&_svg]:text-slate-600',
  ],
  pageSurface: 'bg-slate-50/50 min-h-full',
  sectionLabel: 'text-xs font-semibold text-slate-500 uppercase tracking-widest',
  toolbar: {
    btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-foreground border-border bg-card hover:bg-muted',
    btnSm: 'h-7 text-xs gap-1 text-foreground hover:bg-muted',
    action: 'h-6 text-xs gap-1 text-foreground hover:bg-muted',
    tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary',
    pill: 'h-9 rounded-xl gap-2 px-3.5 text-xs font-medium shadow-sm border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50 transition-all',
    pillPrimary:
      'h-9 rounded-xl gap-2 px-3.5 text-xs font-semibold shadow-sm border-sky-200/70 bg-sky-50 text-sky-900 hover:bg-sky-100 transition-all',
    feature:
      'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-sm border-slate-200/80 bg-white text-slate-800 hover:bg-slate-50 transition-all flex items-center text-left group',
  },
  chrome: {
    navRow1:
      'h-10 px-3 bg-white text-sidebar-foreground hidden lg:flex items-center justify-between border-b border-slate-200 shadow-sm',
    navRow1Mobile:
      'h-14 px-4 flex lg:hidden items-center justify-between bg-white text-sidebar-foreground border-b border-slate-200 shadow-sm',
    navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-slate-200',
    navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center',
    navBrand: 'font-bold text-sm tracking-tight text-slate-800',
    navMenuBtn:
      'h-7 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md',
    checklistIconBtn:
      'h-7 w-7 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100',
    navTabsRow:
      'h-10 px-2 bg-slate-50/80 hidden lg:flex items-end gap-0.5 border-b border-slate-200 overflow-x-auto',
    navTabActive:
      'bg-white text-sky-800 border-t-[3px] border-x border-t-sky-500 border-x-slate-200 -mb-px shadow-sm',
    navTabIdle: 'text-slate-500 hover:text-slate-800 hover:bg-white/80',
    checklistTab:
      'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-slate-600 hover:text-slate-900 hover:bg-white/80 ml-0.5',
    toolbarRow:
      'h-10 px-3 bg-white hidden lg:flex items-center gap-1.5 border-b border-slate-100 overflow-x-auto',
    dashboardSurface: 'flex-1 p-6 overflow-auto space-y-6 bg-slate-50/40',
    documentFlowCard: 'border-slate-200/80 bg-white shadow-sm overflow-hidden',
    documentFlowArrow: 'w-4 h-4 text-slate-300 flex-shrink-0',
    checklistDialog: 'max-w-md sm:max-w-2xl border-slate-200 bg-white shadow-xl',
    checklistIcon:
      'flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700',
    checklistTabsList:
      'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-slate-50 border border-slate-200',
    checklistStartBtn: 'gap-1',
    schedulePanel: 'space-y-3 rounded-md border bg-muted/20 p-3',
    scheduleLabel: 'text-xs shrink-0 text-slate-600 font-medium',
    rowInvoices: 'border-slate-200 bg-slate-50/80 hover:bg-slate-100',
    rowStock: 'border-amber-200/80 bg-amber-50/50 hover:bg-amber-50',
    rowCaixa: 'border-emerald-200/80 bg-emerald-50/50 hover:bg-emerald-50',
    rowAr: 'border-sky-200/80 bg-sky-50/50 hover:bg-sky-50',
    rowAp: 'border-rose-200/80 bg-rose-50/50 hover:bg-rose-50',
    rowPayments: 'border-slate-200 bg-slate-50/80 hover:bg-slate-100',
    rowPurchases: 'border-slate-200 bg-slate-50/80 hover:bg-slate-100',
    rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
    tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-sky-600 data-[state=active]:text-white',
    tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-500 data-[state=active]:text-white',
    tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white',
    tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white',
    tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-sky-600 data-[state=active]:text-white',
    tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-slate-600 data-[state=active]:text-white',
    badgeTasks: 'bg-sky-50 text-sky-800 border-sky-200',
  },
};
