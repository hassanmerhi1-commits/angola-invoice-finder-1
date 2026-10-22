import type { ThemePreset } from '@/themes/types';

/** Dark glass — matches the K Split login (ink, teal, gold hairline). */
export const inkPreset: ThemePreset = {
  id: 'ink',
  swatches: ['#070b16', '#1a8aa8', '#c4a574'],
  toneIcon: {
    sky: 'bg-sky-400/15 text-sky-300',
    indigo: 'bg-indigo-400/15 text-indigo-300',
    emerald: 'bg-emerald-400/15 text-emerald-300',
    amber: 'bg-amber-400/15 text-amber-300',
    slate: 'bg-white/10 text-slate-300',
    rose: 'bg-rose-400/15 text-rose-300',
  },
  toneTile: {
    sky: 'bg-sky-500/10 border-sky-400/25 text-sky-100 hover:bg-sky-500/16 [&_svg]:text-sky-300',
    indigo: 'bg-indigo-500/10 border-indigo-400/25 text-indigo-100 hover:bg-indigo-500/16 [&_svg]:text-indigo-300',
    emerald: 'bg-emerald-500/10 border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/16 [&_svg]:text-emerald-300',
    amber: 'bg-amber-500/10 border-amber-400/25 text-amber-100 hover:bg-amber-500/16 [&_svg]:text-amber-300',
    slate: 'bg-white/[0.06] border-white/15 text-slate-100 hover:bg-white/10 [&_svg]:text-slate-300',
    rose: 'bg-rose-500/10 border-rose-400/25 text-rose-100 hover:bg-rose-500/16 [&_svg]:text-rose-300',
  },
  statCardTone: {
    sky: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-sky-400',
    indigo: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-indigo-400',
    emerald: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-emerald-400',
    amber: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-amber-400',
    slate: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-slate-400',
    rose: 'border-white/10 bg-card/70 backdrop-blur-xl border-l-4 border-l-rose-400',
  },
  flowStep: [
    'bg-sky-500/10 border-sky-400/25 text-sky-100 hover:bg-sky-500/16 [&_svg]:text-sky-300',
    'bg-emerald-500/10 border-emerald-400/25 text-emerald-100 hover:bg-emerald-500/16 [&_svg]:text-emerald-300',
    'bg-amber-500/10 border-amber-400/25 text-amber-100 hover:bg-amber-500/16 [&_svg]:text-amber-300',
    'bg-rose-500/10 border-rose-400/25 text-rose-100 hover:bg-rose-500/16 [&_svg]:text-rose-300',
    'bg-teal-500/10 border-teal-400/25 text-teal-100 hover:bg-teal-500/16 [&_svg]:text-teal-300',
  ],
  pageSurface: 'bg-background min-h-full',
  sectionLabel: 'text-xs font-semibold text-[#8b97a8] uppercase',
  toolbar: {
    btn: 'h-7 text-xs gap-1.5 px-3 rounded-lg text-[#e8eef5]/80 border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20',
    btnSm: 'h-7 text-xs gap-1 text-[#e8eef5]/80 hover:bg-white/10',
    action: 'h-6 text-xs gap-1 text-[#e8eef5]/80 hover:bg-white/10',
    tab: 'text-xs rounded-none border-b-2 border-transparent data-[state=active]:border-[#1a8aa8] data-[state=active]:text-[#e8eef5]',
    pill: 'h-9 rounded-full gap-2 px-3.5 text-xs font-medium shadow-none border-white/10 bg-white/5 text-[#e8eef5] hover:bg-white/10 transition-all',
    pillPrimary:
      'h-9 rounded-full gap-2 px-3.5 text-xs font-semibold shadow-none border-transparent bg-[#1a8aa8] text-white hover:bg-[#167a96] transition-all',
    feature:
      'w-full min-h-[3.25rem] h-auto py-2.5 px-3 gap-2.5 rounded-xl shadow-none border-white/10 bg-white/[0.06] text-[#e8eef5] hover:bg-white/10 transition-all flex items-center text-left group',
  },
  chrome: {
    navRow1:
      'h-10 px-3 bg-[#0b101b]/90 backdrop-blur-xl text-[#e8eef5] hidden sm:flex items-center justify-between border-b border-white/10',
    navRow1Mobile:
      'h-14 px-4 flex sm:hidden items-center justify-between bg-[#0b101b]/90 backdrop-blur-xl text-[#e8eef5] border-b border-white/10',
    navBrandBorder: 'flex items-center gap-2 pr-4 mr-2 border-r border-white/10',
    navLogoRing: 'w-6 h-6 rounded-lg overflow-hidden bg-white/10 ring-1 ring-[#c4a574]/40 flex items-center justify-center',
    navBrand: 'font-bold text-sm text-[#e8eef5]',
    navMenuBtn:
      'h-7 px-2.5 text-xs font-medium text-[#e8eef5]/75 hover:text-white hover:bg-white/10 rounded-md',
    navTabsRow:
      'h-10 px-2 bg-[#070b16] hidden sm:flex items-end justify-between gap-2 border-b border-white/10 overflow-x-auto',
    navTabActive:
      'bg-card/80 text-[#e8eef5] border-t-[2px] border-x border-t-[#c4a574] border-x-white/10 -mb-px',
    navTabIdle: 'text-[#d0d7e2] hover:text-white hover:bg-white/10',
    checklistTab:
      'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 ml-0.5 border border-amber-400/25 border-b-0',
    toolbarRow:
      'h-10 px-3 bg-[#0b101b]/80 hidden sm:flex items-center gap-1.5 border-b border-white/10 overflow-x-auto',
    dashboardSurface: 'flex-1 p-6 overflow-auto space-y-6 bg-transparent',
    documentFlowCard:
      'border-white/10 bg-card/70 backdrop-blur-xl shadow-none overflow-hidden',
    documentFlowArrow: 'w-4 h-4 text-[#1a8aa8] flex-shrink-0',
    checklistDialog:
      'max-w-md sm:max-w-2xl border-white/10 bg-[#121826] shadow-xl',
    checklistIcon:
      'flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a8aa8] text-white',
    checklistTabsList:
      'flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5 bg-white/5 border border-white/10',
    checklistStartBtn: 'gap-1 bg-[#1a8aa8] hover:bg-[#167a96] text-white',
    schedulePanel:
      'space-y-3 rounded-md border border-white/10 bg-white/[0.04] p-3',
    scheduleLabel: 'text-xs shrink-0 text-[#8b97a8] font-semibold',
    rowInvoices: 'border-sky-400/25 bg-sky-500/10 hover:bg-sky-500/16',
    rowStock: 'border-amber-400/25 bg-amber-500/10 hover:bg-amber-500/16',
    rowCaixa: 'border-emerald-400/25 bg-emerald-500/10 hover:bg-emerald-500/16',
    rowAr: 'border-teal-400/25 bg-teal-500/10 hover:bg-teal-500/16',
    rowAp: 'border-rose-400/25 bg-rose-500/10 hover:bg-rose-500/16',
    rowPayments: 'border-cyan-400/25 bg-cyan-500/10 hover:bg-cyan-500/16',
    rowPurchases: 'border-indigo-400/25 bg-indigo-500/10 hover:bg-indigo-500/16',
    rowDefault: 'border-border bg-muted/30 hover:bg-muted/40',
    tabActiveTasks: 'text-xs sm:text-sm data-[state=active]:bg-[#1a8aa8] data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveStock: 'text-xs sm:text-sm data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveAr: 'text-xs sm:text-sm data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActiveAp: 'text-xs sm:text-sm data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActivePrint: 'text-xs sm:text-sm data-[state=active]:bg-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    tabActivePrices: 'text-xs sm:text-sm data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-none',
    badgeTasks: 'bg-sky-500/15 text-sky-200 border-sky-400/25',
  },
};
