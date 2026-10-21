import { getThemePreset, resolveColorTheme, type ColorThemeId } from '@/themes/colorTheme';
import type { ThemePreset } from '@/themes/types';

export function getActivePreset(themeId?: ColorThemeId): ThemePreset {
  return getThemePreset(themeId || resolveColorTheme());
}

const preset = getActivePreset();

export const themeChrome = preset.chrome;
export const themeToneIcon = preset.toneIcon;
export const themeToneTile = preset.toneTile;
export const themeStatCardTone = preset.statCardTone;
export const themeFlowStep = preset.flowStep;
export const themeSectionLabel = preset.sectionLabel;
export const themeToolbar = preset.toolbar;
export const themePageSurface = preset.pageSurface;
