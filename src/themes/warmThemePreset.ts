import type { ThemePreset } from '@/themes/types';
import {
  warmChrome,
  warmFlowStep,
  warmPageSurface,
  warmSectionLabel,
  warmStatCardTone,
  warmToneIcon,
  warmToneTile,
  warmToolbar,
} from '@/themes/warmPreset';

/** Warm coral / honey / apricot. */
export const warmThemePreset: ThemePreset = {
  id: 'warm',
  swatches: ['#ffedd5', '#f97316', '#e11d48'],
  toneIcon: { ...warmToneIcon },
  toneTile: { ...warmToneTile },
  statCardTone: { ...warmStatCardTone },
  flowStep: [...warmFlowStep],
  pageSurface: warmPageSurface,
  sectionLabel: warmSectionLabel,
  toolbar: { ...warmToolbar },
  chrome: { ...warmChrome },
};
