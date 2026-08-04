import { resolveColorTheme } from '@/themes/colorTheme';
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

const theme = resolveColorTheme();
const isWarm = theme === 'warm';

export const themeChrome = isWarm ? warmChrome : coolChrome;
export const themeToneIcon = isWarm ? warmToneIcon : coolToneIcon;
export const themeToneTile = isWarm ? warmToneTile : coolToneTile;
export const themeStatCardTone = isWarm ? warmStatCardTone : coolStatCardTone;
export const themeFlowStep = isWarm ? warmFlowStep : coolFlowStep;
export const themePageSurface = isWarm ? warmPageSurface : coolPageSurface;
export const themeSectionLabel = isWarm ? warmSectionLabel : coolSectionLabel;
export const themeToolbar = isWarm ? warmToolbar : coolToolbar;
