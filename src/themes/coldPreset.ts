import type { ThemePreset } from '@/themes/types';
import {
  coolChrome,
  coolFlowStep,
  coolPageSurface,
  coolSectionLabel,
  coolStatCardTone,
  coolToneIcon,
  coolToneTile,
  coolToolbar,
} from '@/themes/coolPreset';

/** Cold teal/cyan — vivid cool palette (formerly "cool"). */
export const coldPreset: ThemePreset = {
  id: 'cold',
  swatches: ['#cffafe', '#06b6d4', '#0d9488'],
  toneIcon: { ...coolToneIcon },
  toneTile: { ...coolToneTile },
  statCardTone: { ...coolStatCardTone },
  flowStep: [...coolFlowStep],
  pageSurface: coolPageSurface,
  sectionLabel: coolSectionLabel,
  toolbar: { ...coolToolbar },
  chrome: { ...coolChrome },
};
