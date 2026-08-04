import { getThemePreset, resolveColorTheme } from '@/themes/colorTheme';

const preset = getThemePreset(resolveColorTheme());

export const themeChrome = preset.chrome;
export const themeToneIcon = preset.toneIcon;
export const themeToneTile = preset.toneTile;
export const themeStatCardTone = preset.statCardTone;
export const themeFlowStep = preset.flowStep;
export const themePageSurface = preset.pageSurface;
export const themeSectionLabel = preset.sectionLabel;
export const themeToolbar = preset.toolbar;
