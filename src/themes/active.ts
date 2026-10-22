import { getThemePreset, resolveColorTheme, type ColorThemeId } from '@/themes/colorTheme';
import type { ThemePreset } from '@/themes/types';

export function getActivePreset(themeId?: ColorThemeId): ThemePreset {
  return getThemePreset(themeId || resolveColorTheme());
}
