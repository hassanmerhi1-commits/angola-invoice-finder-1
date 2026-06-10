/** Shared light, professional tone classes for stats, tiles, and icons. */

export type NexorTone = 'sky' | 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';

export const NEXOR_TONE_ICON: Record<NexorTone, string> = {
  sky: 'bg-sky-50 text-sky-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-600',
};

/** @deprecated Use NEXOR_TONE_ICON — maps legacy gradient-* class names to tones. */
export const NEXOR_LEGACY_GRADIENT_TONE: Record<string, NexorTone> = {
  'gradient-primary': 'sky',
  'gradient-accent': 'indigo',
  'gradient-success': 'emerald',
  'gradient-warm': 'amber',
};

export function nexorIconTone(tone: NexorTone | string): string {
  if (tone in NEXOR_TONE_ICON) return NEXOR_TONE_ICON[tone as NexorTone];
  const mapped = NEXOR_LEGACY_GRADIENT_TONE[tone];
  return mapped ? NEXOR_TONE_ICON[mapped] : NEXOR_TONE_ICON.slate;
}

export const NEXOR_TONE_TILE: Record<NexorTone, string> = {
  sky: 'bg-sky-50/90 border-sky-200/70 text-sky-800 hover:bg-sky-100/80 [&_svg]:text-sky-600',
  indigo: 'bg-indigo-50/90 border-indigo-200/70 text-indigo-800 hover:bg-indigo-100/80 [&_svg]:text-indigo-600',
  emerald: 'bg-emerald-50/90 border-emerald-200/70 text-emerald-800 hover:bg-emerald-100/80 [&_svg]:text-emerald-600',
  amber: 'bg-amber-50/90 border-amber-200/70 text-amber-900 hover:bg-amber-100/80 [&_svg]:text-amber-700',
  slate: 'bg-slate-50/90 border-slate-200/70 text-slate-700 hover:bg-slate-100/80 [&_svg]:text-slate-500',
  rose: 'bg-rose-50/90 border-rose-200/70 text-rose-800 hover:bg-rose-100/80 [&_svg]:text-rose-600',
};

export const NEXOR_STAT_CARD = 'border-slate-200/80 bg-white/90 shadow-sm';
export const NEXOR_PAGE_SURFACE = 'bg-slate-50/40 min-h-full';
export const NEXOR_SECTION_LABEL = 'text-xs font-semibold text-slate-500 uppercase tracking-widest';
export const NEXOR_PAGE_TITLE = 'text-2xl font-semibold tracking-tight text-slate-800';
