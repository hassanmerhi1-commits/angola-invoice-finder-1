import type { ThemePreset } from '@/themes/types';

/** White ink glass — same teal/gold language as ink, on frosted white. */
export const frostPreset: ThemePreset = {
  id: 'frost',
  swatches: ['#f4f6fb', '#1a8aa8', '#c4a574'],
  toneIcon: {
    sky: 'bg-sky-100 text-sky-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-100 text-rose-700',
  },
  toneTile: {
    sky: 'bg-sky-50/90 border-sky-200/80 text-sky-950 hover:bg-sky-100/90 [&_svg]:text-sky-700',
    indigo: 'bg-indigo-50/90 border-indigo-200/80 text-indigo-950 hover:bg-indigo-100/90 [&_svg]:text-indigo-700',
    emerald: 'bg-emerald-50/90 border-emerald-200/80 text-emerald-950 hover:bg-emerald-100/90 [&_svg]:text-emerald-700',
    amber: 'bg-amber-50/90 border-amber-200/80 text-amber-950 hover:bg-amber-100/90 [&_svg]:text-amber-700',
    slate: 'bg-white/80 border-slate-200/80 text-slate-800 hover:bg-white [&_svg]:text-slate-600',
    rose: 'bg-rose-50/90 border-rose-200/80 text-rose-950 hover:bg-rose-100/90 [&_svg]:text-rose-700',
  },
  statCardTone: {
    sky: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-sky-400',
    indigo: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-indigo-400',
    emerald: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-emerald-400',
    amber: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-amber-400',
    slate: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-slate-400',
    rose: 'border-white/70 bg-white/70 backdrop-blur-xl border-l-4 border-l-rose-400',
  },
  flowStep: [
    'bg-sky-50/90 border-sky-200/80 text-sky-950 hover:bg-sky-100/90 [&_svg]:text-sky-700',
    'bg-emerald-50/90 border-emerald-200/80 text-emerald-950 hover:bg-emerald-100/90 [&_svg]:text-emerald-700',
    'bg-amber-50/90 border-amber-200/80 text-amber-950 hover:bg-amber-100/90 [&_svg]:text-amber-700',
    'bg-rose-50/90 border-rose-200/80 text-rose-950 hover:bg-rose-100/90 [&_svg]:text-rose-700',
    'bg-teal-50/90 border-teal-200/80 text-teal-950 hover:bg-teal-100/90 [&_svg]:text-teal-700',
  ],
  pageSurface: 'bg-background min-h-full',
  sectionLabel: 'text-xs font-semibold text-slate-500 uppercase',
  toolbar: {
    btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-slate-700 border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300',
    btnSm: 'h-7 text-xs gap-1 text-slate-700 hover:bg-white/80',
    action: 'h-6 text-xs gap-1 text-slate-700 hover:bg-white/80',
    tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-[#1a8aa8] data-[state=active]:text-slate-900',
    pill: 'h-9 rounded-full gap-2 px-3.5 text-xs font-medium shadow-none border-slate-200/80 bg-white/70 text-slate-800 hover:bg-white transition-all',
    pillPrimary:
      'h-9 rounded-full gap-2 px-3.5 text-xs font-semibold shadow-none border-transparent bg-[#1a8aa8] text-white hover:bg-[#167a96] transition-all',
    feature:
      'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-none border-slate-200/80 bg-white/75 text-slate-800 hover:bg-white transition-all flex items-center text-left group',
  },
  chrome: {
    navRow1:
      'h-10 px-3 bg-white/80 backdrop-blur-xl text-slate-800 hidden sm:flex items-center justify-between border-b border-slate-200/80',
    navRow1Mobile:
      'h-14 px-4 flex sm:hidden items-center justify-between bg-white/80 backdrop-blur-xl text-slate-800 border-b border-slate-200/80',
    navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-slate-200/80',
    navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-slate-100 ring-1 ring-[#c4a574]/50 flex items-center justify-center',
    navBrand: 'font-bold text-sm text-slate-800',
    navMenuBtn:
      'h-7 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 rounded-md',
    navTabsRow:
      'h-10 px-2 bg-[#f4f6fb] hidden sm:flex items-end justify-between gap-2 border-b border-slate-200/80 overflow-x-auto',
    navTabActive:
      'bg-white/90 text-slate-900 border-t-[2px] border-x border-t-[#c4a574] border-x-slate-200/80 -mb-px',
    navTabIdle: 'text-slate-500 hover:text-slate-800 hover:bg-white/70',
    checklistTab:
      'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-amber-800 bg-amber-100/80 hover:bg-amber-100 ml-0.5 border border-amber-200/80 border-b-0',
    toolbarRow:
      'h-10 px-3 bg-white/70 hidden sm:flex items-center gap-1.5 border-b border-slate-200/70 overflow-x-auto',
    dashboardSurface: 'flex-1 p-6 overflow-auto space-y-6 bg-transparent',
    documentFlowCard:
      'border-white/80 bg-white/70 backdrop-blur-xl shadow-none overflow-hidden',
    documentFlowArrow: 'w-4 h-4 text-[#1a8aa8] flex-shrink-0',
    checklistDialog:
      'max-w-md sm:max-w-2xl border-slate-200/80 bg-white/95 shadow-xl',
    checklistIcon:
      'flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a8aa8] text-white',
    checklistTabsList:
      'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-slate-100/80 border border-slate-200/80',
    checklistStartBtn: 'gap-1 bg-[#1a8aa8] hover:bg-[#167a96] text-white',
    schedulePanel:
      'space-y-3 rounded-md border border-slate-200/80 bg-white/60 p-3',
    scheduleLabel: 'text-xs shrink-0 text-slate-500 font-semibold',
    rowInvoices: 'border-sky-200/80 bg-sky-50/80 hover:bg-sky-100/80',
    rowStock: 'border-amber-200/80 bg-amber-50/80 hover:bg-amber-100/80',
    rowCaixa: 'border-emerald-200/80 bg-emerald-50/80 hover:bg-emerald-100/80',
    rowAr: 'border-teal-200/80 bg-teal-50/80 hover:bg-teal-100/80',
    rowAp: 'border-rose-200/80 bg-rose-50/80 hover:bg-rose-100/80',
    rowPayments: 'border-cyan-200/80 bg-cyan-50/80 hover:bg-cyan-100/80',
    rowPurchases: 'border-indigo-200/80 bg-indigo-50/80 hover:bg-indigo-100/80',
    rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
    tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-[#1a8aa8] data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    badgeTasks: 'bg-sky-100 text-sky-800 border-sky-200',
  },
};
