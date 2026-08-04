import { coldPreset } from '@/themes/coldPreset';
import { lightPreset } from '@/themes/lightPreset';
import { mediumPreset } from '@/themes/mediumPreset';
import type { ColorThemeId, ThemePreset } from '@/themes/types';
import { COLOR_THEME_IDS, isColorThemeId } from '@/themes/types';
import { warmThemePreset } from '@/themes/warmThemePreset';

export const THEME_PRESETS: Record<ColorThemeId, ThemePreset> = {
  light: lightPreset,
  medium: mediumPreset,
  warm: warmThemePreset,
  cold: coldPreset,
};

export const THEME_PRESET_LIST: ThemePreset[] = COLOR_THEME_IDS.map((id) => THEME_PRESETS[id]);

export function getThemePreset(id: ColorThemeId): ThemePreset {
  return THEME_PRESETS[id] ?? mediumPreset;
}

export { COLOR_THEME_IDS, isColorThemeId };
export type { ColorThemeId, ThemePreset };
