/** Shared tone classes for stats, tiles, and icons — always read the live theme. */
import { getActivePreset } from '@/themes/active';
import { subscribeColorTheme } from '@/themes/colorTheme';
import type { ToneMap } from '@/themes/types';

export type NexorTone = 'sky' | 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';

function copyTone(map: ToneMap): Record<NexorTone, string> {
  return { ...map };
}

export let NEXOR_TONE_ICON: Record<NexorTone, string> = copyTone(getActivePreset().toneIcon);
export let NEXOR_TONE_TILE: Record<NexorTone, string> = copyTone(getActivePreset().toneTile);
export let NEXOR_STAT_CARD_TONE: Record<NexorTone, string> = copyTone(getActivePreset().statCardTone);
export let NEXOR_FLOW_STEP: string[] = [...getActivePreset().flowStep];
export let NEXOR_PAGE_SURFACE = getActivePreset().pageSurface;
export let NEXOR_SECTION_LABEL = getActivePreset().sectionLabel;

export const NEXOR_STAT_CARD = 'border-border bg-card/90 shadow-sm';
export const NEXOR_PAGE_TITLE = 'text-2xl font-semibold tracking-tight text-foreground';

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

export function refreshNexorToneStyles() {
  const preset = getActivePreset();
  NEXOR_TONE_ICON = copyTone(preset.toneIcon);
  NEXOR_TONE_TILE = copyTone(preset.toneTile);
  NEXOR_STAT_CARD_TONE = copyTone(preset.statCardTone);
  NEXOR_FLOW_STEP = [...preset.flowStep];
  NEXOR_PAGE_SURFACE = preset.pageSurface;
  NEXOR_SECTION_LABEL = preset.sectionLabel;
}

subscribeColorTheme(() => {
  refreshNexorToneStyles();
});
