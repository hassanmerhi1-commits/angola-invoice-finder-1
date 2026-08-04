/** Shared light, professional tone classes for stats, tiles, and icons. */
import {
  themeFlowStep,
  themePageSurface,
  themeSectionLabel,
  themeStatCardTone,
  themeToneIcon,
  themeToneTile,
} from '@/themes/active';

export type NexorTone = 'sky' | 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';

export const NEXOR_TONE_ICON: Record<NexorTone, string> = { ...themeToneIcon };

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

export const NEXOR_TONE_TILE: Record<NexorTone, string> = { ...themeToneTile };

export const NEXOR_STAT_CARD = 'border-slate-200/80 bg-white/90 shadow-sm';

export const NEXOR_STAT_CARD_TONE: Record<NexorTone, string> = { ...themeStatCardTone };

export const NEXOR_FLOW_STEP: string[] = [...themeFlowStep];

export const NEXOR_PAGE_SURFACE = themePageSurface;
export const NEXOR_SECTION_LABEL = themeSectionLabel;
export const NEXOR_PAGE_TITLE = 'text-2xl font-semibold tracking-tight text-slate-800';
